import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TicketPriority } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { parsePositiveInt, DEFAULT_SLA_CONFIG } from '../common/config.utils';

export type BusinessWeekDay =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sunday';

export type BusinessDaySchedule = {
  day: BusinessWeekDay;
  enabled: boolean;
  start: string;
  end: string;
};

export type BusinessHoursSettings = {
  timezone: string;
  schedule: BusinessDaySchedule[];
  holidays: Array<{ name: string; date: string }>;
};

export type SlaConfigResult = {
  policyConfigId: string | null;
  firstResponseHours: number;
  resolutionHours: number;
  businessHoursOnly: boolean;
};

@Injectable()
export class TicketSlaCalculationService {
  private readonly logger = new Logger(TicketSlaCalculationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private readonly businessDaysOrder: BusinessWeekDay[] = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];

  private readonly defaultBusinessSchedule: BusinessDaySchedule[] = [
    { day: 'Monday', enabled: true, start: '09:00', end: '18:00' },
    { day: 'Tuesday', enabled: true, start: '09:00', end: '18:00' },
    { day: 'Wednesday', enabled: true, start: '09:00', end: '18:00' },
    { day: 'Thursday', enabled: true, start: '09:00', end: '18:00' },
    { day: 'Friday', enabled: true, start: '09:00', end: '17:00' },
    { day: 'Saturday', enabled: false, start: '10:00', end: '14:00' },
    { day: 'Sunday', enabled: false, start: '10:00', end: '14:00' },
  ];

  private readonly schemaCheckCacheTtlMs = parsePositiveInt(
    process.env.SCHEMA_CHECK_CACHE_TTL_MS,
    300_000,
  );

  private businessHoursSettingsCache: {
    value: BusinessHoursSettings;
    checkedAtMs: number;
  } | null = null;

  async getSlaConfig(
    priority: TicketPriority,
    teamId: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<SlaConfigResult> {
    const client = tx ?? this.prisma;

    if (teamId) {
      const assignedRows = await client.$queryRaw<
        Array<{
          policyConfigId: string;
          firstResponseHours: number;
          resolutionHours: number;
          businessHoursOnly: boolean;
        }>
      >`
        SELECT
          p."id" AS "policyConfigId",
          t."firstResponseHours" AS "firstResponseHours",
          t."resolutionHours" AS "resolutionHours",
          p."businessHoursOnly" AS "businessHoursOnly"
        FROM "SlaPolicyAssignment" a
        INNER JOIN "SlaPolicyConfig" p ON p."id" = a."policyConfigId"
        INNER JOIN "SlaPolicyConfigTarget" t
          ON t."policyConfigId" = p."id"
         AND t."priority" = ${priority}::"TicketPriority"
        WHERE a."teamId" = ${teamId}
          AND p."enabled" = true
        ORDER BY a."updatedAt" DESC
        LIMIT 1
      `;
      if (assignedRows[0]) {
        return assignedRows[0];
      }
    }

    const defaultRows = await client.$queryRaw<
      Array<{
        policyConfigId: string;
        firstResponseHours: number;
        resolutionHours: number;
        businessHoursOnly: boolean;
      }>
    >`
      SELECT
        p."id" AS "policyConfigId",
        t."firstResponseHours" AS "firstResponseHours",
        t."resolutionHours" AS "resolutionHours",
        p."businessHoursOnly" AS "businessHoursOnly"
      FROM "SlaPolicyConfig" p
      INNER JOIN "SlaPolicyConfigTarget" t
        ON t."policyConfigId" = p."id"
       AND t."priority" = ${priority}::"TicketPriority"
      WHERE p."isDefault" = true
        AND p."enabled" = true
      ORDER BY p."updatedAt" DESC
      LIMIT 1
    `;
    if (defaultRows[0]) {
      return defaultRows[0];
    }

    return {
      policyConfigId: null,
      ...DEFAULT_SLA_CONFIG[priority],
      businessHoursOnly: true,
    };
  }

  async addSlaHours(
    startAt: Date,
    hours: number,
    businessHoursOnly: boolean,
    tx?: Prisma.TransactionClient,
  ) {
    if (!businessHoursOnly) {
      return this.addHours(startAt, hours);
    }
    const settings = await this.getBusinessHoursSettings(tx);
    return this.addBusinessHours(startAt, hours, settings);
  }

  async subtractSlaHours(
    endAt: Date,
    hours: number,
    businessHoursOnly: boolean,
    tx?: Prisma.TransactionClient,
  ) {
    if (!businessHoursOnly) {
      return this.addHours(endAt, -hours);
    }
    const settings = await this.getBusinessHoursSettings(tx);
    return this.subtractBusinessHours(endAt, hours, settings);
  }

  async getBusinessHoursSettings(tx?: Prisma.TransactionClient) {
    const now = Date.now();
    if (
      !tx &&
      this.businessHoursSettingsCache &&
      now - this.businessHoursSettingsCache.checkedAtMs <=
        this.schemaCheckCacheTtlMs
    ) {
      return this.businessHoursSettingsCache.value;
    }

    const client = tx ?? this.prisma;
    const row = await client.slaBusinessHoursSetting.findUnique({
      where: { id: 'global' },
      select: { timezone: true, schedule: true, holidays: true },
    });
    const value = row
      ? this.normalizeBusinessHoursSettings(
          row.timezone,
          row.schedule,
          row.holidays,
        )
      : {
          timezone: 'UTC',
          schedule: [...this.defaultBusinessSchedule],
          holidays: [],
        };

    if (!tx) {
      this.businessHoursSettingsCache = {
        value,
        checkedAtMs: now,
      };
    }

    return value;
  }

  normalizeBusinessHoursSettings(
    timezoneRaw: string,
    scheduleRaw: Prisma.JsonValue,
    holidaysRaw: Prisma.JsonValue,
  ): BusinessHoursSettings {
    const timezone = this.normalizeTimeZone(timezoneRaw);
    const schedule = this.normalizeBusinessSchedule(scheduleRaw);
    const holidays = this.normalizeBusinessHolidays(holidaysRaw);
    return { timezone, schedule, holidays };
  }

  normalizeTimeZone(timezoneRaw: string) {
    const candidate = (timezoneRaw ?? '').trim() || 'UTC';
    return DateTime.now().setZone(candidate).isValid ? candidate : 'UTC';
  }

  readTrimmedPrimitive(value: unknown) {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value).trim();
    }
    return '';
  }

  normalizeBusinessSchedule(raw: Prisma.JsonValue) {
    const source = Array.isArray(raw) ? raw : [];
    const map = new Map<BusinessWeekDay, BusinessDaySchedule>();

    for (const value of source) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      const dayValue = (value as { day?: unknown }).day;
      if (
        typeof dayValue !== 'string' ||
        !this.businessDaysOrder.includes(dayValue as BusinessWeekDay)
      ) {
        continue;
      }

      const startRaw = this.readTrimmedPrimitive(
        (value as { start?: unknown }).start,
      );
      const endRaw = this.readTrimmedPrimitive(
        (value as { end?: unknown }).end,
      );
      const startMinutes = this.timeToMinutes(startRaw);
      const endMinutes = this.timeToMinutes(endRaw);
      if (
        startMinutes == null ||
        endMinutes == null ||
        startMinutes >= endMinutes
      ) {
        continue;
      }

      map.set(dayValue as BusinessWeekDay, {
        day: dayValue as BusinessWeekDay,
        enabled: Boolean((value as { enabled?: unknown }).enabled ?? true),
        start: startRaw,
        end: endRaw,
      });
    }

    return this.businessDaysOrder.map((day, index) => {
      const existing = map.get(day);
      if (existing) {
        return existing;
      }
      const fallback = this.defaultBusinessSchedule[index];
      return {
        day,
        enabled: fallback.enabled,
        start: fallback.start,
        end: fallback.end,
      };
    });
  }

  normalizeBusinessHolidays(raw: Prisma.JsonValue) {
    if (!Array.isArray(raw)) {
      return [] as Array<{ name: string; date: string }>;
    }
    const validDate = /^\d{4}-\d{2}-\d{2}$/;
    const dedup = new Map<string, { name: string; date: string }>();
    for (const value of raw) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      const name = this.readTrimmedPrimitive(
        (value as { name?: unknown }).name,
      );
      const date = this.readTrimmedPrimitive(
        (value as { date?: unknown }).date,
      );
      if (!name || !validDate.test(date)) {
        continue;
      }
      dedup.set(date, { name, date });
    }
    return [...dedup.values()];
  }

  addBusinessHours(
    startAt: Date,
    hours: number,
    settings: BusinessHoursSettings,
  ) {
    const remainingMinutesStart = Math.max(0, Math.round(hours * 60));
    if (remainingMinutesStart === 0) {
      return new Date(startAt.getTime());
    }

    let remainingMinutes = remainingMinutesStart;
    let cursor = DateTime.fromJSDate(startAt, { zone: 'utc' })
      .setZone(settings.timezone)
      .set({ second: 0, millisecond: 0 });

    // Guardrail to avoid infinite loops when settings are malformed.
    for (let i = 0; i < 20_000 && remainingMinutes > 0; i++) {
      cursor = this.alignToBusinessWindow(cursor, settings);

      const dayName = cursor.toFormat('cccc') as BusinessWeekDay;
      const day = settings.schedule.find((item) => item.day === dayName);
      if (!day || !day.enabled) {
        cursor = cursor.plus({ days: 1 }).startOf('day');
        continue;
      }

      const endMinutes = this.timeToMinutes(day.end);
      if (endMinutes == null) {
        cursor = cursor.plus({ days: 1 }).startOf('day');
        continue;
      }

      const windowEnd = cursor.set({
        hour: Math.floor(endMinutes / 60),
        minute: endMinutes % 60,
        second: 0,
        millisecond: 0,
      });
      const available = Math.max(
        0,
        Math.floor(windowEnd.diff(cursor, 'minutes').minutes),
      );

      if (available === 0) {
        cursor = cursor.plus({ days: 1 }).startOf('day');
        continue;
      }

      if (remainingMinutes <= available) {
        cursor = cursor.plus({ minutes: remainingMinutes });
        remainingMinutes = 0;
        break;
      }

      remainingMinutes -= available;
      cursor = windowEnd.plus({ minutes: 1 });
    }

    if (remainingMinutes > 0) {
      this.logger.warn(
        'Business-hours due date calculation hit safety limit; falling back to raw hour addition',
      );
      return this.addHours(startAt, hours);
    }

    return cursor.toUTC().toJSDate();
  }

  subtractBusinessHours(
    endAt: Date,
    hours: number,
    settings: BusinessHoursSettings,
  ) {
    const remainingMinutesStart = Math.max(0, Math.round(hours * 60));
    if (remainingMinutesStart === 0) {
      return new Date(endAt.getTime());
    }

    let remainingMinutes = remainingMinutesStart;
    let cursor = DateTime.fromJSDate(endAt, { zone: 'utc' })
      .setZone(settings.timezone)
      .set({ second: 0, millisecond: 0 });

    // Guardrail to avoid infinite loops when settings are malformed.
    for (let i = 0; i < 20_000 && remainingMinutes > 0; i++) {
      cursor = this.alignBackwardToBusinessWindow(cursor, settings);

      const dayName = cursor.toFormat('cccc') as BusinessWeekDay;
      const day = settings.schedule.find((item) => item.day === dayName);
      if (!day || !day.enabled) {
        cursor = cursor
          .minus({ days: 1 })
          .endOf('day')
          .set({ second: 0, millisecond: 0 });
        continue;
      }

      const startMinutes = this.timeToMinutes(day.start);
      if (startMinutes == null) {
        cursor = cursor
          .minus({ days: 1 })
          .endOf('day')
          .set({ second: 0, millisecond: 0 });
        continue;
      }

      const windowStart = cursor.set({
        hour: Math.floor(startMinutes / 60),
        minute: startMinutes % 60,
        second: 0,
        millisecond: 0,
      });
      const available = Math.max(
        0,
        Math.floor(cursor.diff(windowStart, 'minutes').minutes),
      );

      if (available === 0) {
        cursor = windowStart.minus({ minutes: 1 });
        continue;
      }

      if (remainingMinutes <= available) {
        cursor = cursor.minus({ minutes: remainingMinutes });
        remainingMinutes = 0;
        break;
      }

      remainingMinutes -= available;
      cursor = windowStart.minus({ minutes: 1 });
    }

    if (remainingMinutes > 0) {
      this.logger.warn(
        'Business-hours reverse due date calculation hit safety limit; falling back to raw hour subtraction',
      );
      return this.addHours(endAt, -hours);
    }

    return cursor.toUTC().toJSDate();
  }

  alignToBusinessWindow(
    start: DateTime,
    settings: BusinessHoursSettings,
  ): DateTime {
    let cursor = start.set({ second: 0, millisecond: 0 });

    for (let i = 0; i < 14; i++) {
      const dayName = cursor.toFormat('cccc') as BusinessWeekDay;
      const localDate = cursor.toFormat('yyyy-LL-dd');
      const day = settings.schedule.find((item) => item.day === dayName);
      const isHoliday = settings.holidays.some(
        (holiday) => holiday.date === localDate,
      );

      if (!day || !day.enabled || isHoliday) {
        cursor = cursor.plus({ days: 1 }).startOf('day');
        continue;
      }

      const startMinutes = this.timeToMinutes(day.start);
      const endMinutes = this.timeToMinutes(day.end);
      if (
        startMinutes == null ||
        endMinutes == null ||
        startMinutes >= endMinutes
      ) {
        cursor = cursor.plus({ days: 1 }).startOf('day');
        continue;
      }

      const windowStart = cursor.set({
        hour: Math.floor(startMinutes / 60),
        minute: startMinutes % 60,
        second: 0,
        millisecond: 0,
      });
      const windowEnd = cursor.set({
        hour: Math.floor(endMinutes / 60),
        minute: endMinutes % 60,
        second: 0,
        millisecond: 0,
      });

      const cursorMs = cursor.toMillis();
      const startMs = windowStart.toMillis();
      const endMs = windowEnd.toMillis();
      if (cursorMs < startMs) {
        return windowStart;
      }
      if (cursorMs >= endMs) {
        cursor = cursor.plus({ days: 1 }).startOf('day');
        continue;
      }
      return cursor;
    }

    return start;
  }

  alignBackwardToBusinessWindow(
    end: DateTime,
    settings: BusinessHoursSettings,
  ): DateTime {
    let cursor = end.set({ second: 0, millisecond: 0 });

    for (let i = 0; i < 14; i++) {
      const dayName = cursor.toFormat('cccc') as BusinessWeekDay;
      const localDate = cursor.toFormat('yyyy-LL-dd');
      const day = settings.schedule.find((item) => item.day === dayName);
      const isHoliday = settings.holidays.some(
        (holiday) => holiday.date === localDate,
      );

      if (!day || !day.enabled || isHoliday) {
        cursor = cursor
          .minus({ days: 1 })
          .endOf('day')
          .set({ second: 0, millisecond: 0 });
        continue;
      }

      const startMinutes = this.timeToMinutes(day.start);
      const endMinutes = this.timeToMinutes(day.end);
      if (
        startMinutes == null ||
        endMinutes == null ||
        startMinutes >= endMinutes
      ) {
        cursor = cursor
          .minus({ days: 1 })
          .endOf('day')
          .set({ second: 0, millisecond: 0 });
        continue;
      }

      const windowStart = cursor.set({
        hour: Math.floor(startMinutes / 60),
        minute: startMinutes % 60,
        second: 0,
        millisecond: 0,
      });
      const windowEnd = cursor.set({
        hour: Math.floor(endMinutes / 60),
        minute: endMinutes % 60,
        second: 0,
        millisecond: 0,
      });

      const cursorMs = cursor.toMillis();
      const startMs = windowStart.toMillis();
      const endMs = windowEnd.toMillis();
      if (cursorMs > endMs) {
        return windowEnd;
      }
      if (cursorMs <= startMs) {
        cursor = cursor
          .minus({ days: 1 })
          .endOf('day')
          .set({ second: 0, millisecond: 0 });
        continue;
      }
      return cursor;
    }

    return end;
  }

  timeToMinutes(time: string): number | null {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
    if (!match) {
      return null;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours * 60 + minutes;
  }

  addHours(date: Date, hours: number) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
  }
}
