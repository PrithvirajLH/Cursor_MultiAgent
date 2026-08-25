import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessHoursCacheService } from '../slas/business-hours-cache.service';
import {
  TicketSlaCalculationService,
  type BusinessHoursSettings,
} from './ticket-sla-calculation.service';

/**
 * SLA business-hours edge cases.
 *
 * 2,546 lines of SLA logic previously had two business-hours tests and no DST
 * coverage at all. These are the cases the QA testing spec names: DST in both
 * directions, consecutive holidays, and a high-severity ticket raised minutes
 * before close. Naive elapsed-time maths here pages people at 3am for tickets
 * that are not actually breached.
 *
 * `addBusinessHours` takes its settings as a parameter, so this is a pure unit
 * test — no database.
 */
describe('TicketSlaCalculationService — business hours edge cases', () => {
  let service: TicketSlaCalculationService;

  beforeEach(() => {
    service = new TicketSlaCalculationService(
      {} as unknown as PrismaService,
      { get: jest.fn() } as unknown as ConfigService,
      new BusinessHoursCacheService(),
    );
  });

  /** Mon-Fri 09:00-17:00, no holidays unless supplied. */
  function settings(
    overrides: Partial<BusinessHoursSettings> = {},
  ): BusinessHoursSettings {
    const weekday = { enabled: true, start: '09:00', end: '17:00' };
    return {
      timezone: 'America/Chicago',
      schedule: [
        { day: 'Monday', ...weekday },
        { day: 'Tuesday', ...weekday },
        { day: 'Wednesday', ...weekday },
        { day: 'Thursday', ...weekday },
        { day: 'Friday', ...weekday },
        { day: 'Saturday', enabled: false, start: '09:00', end: '17:00' },
        { day: 'Sunday', enabled: false, start: '09:00', end: '17:00' },
      ],
      holidays: [],
      ...overrides,
    };
  }

  /** Build a UTC Date from a wall-clock time in the settings timezone. */
  function local(iso: string, zone = 'America/Chicago'): Date {
    return DateTime.fromISO(iso, { zone }).toUTC().toJSDate();
  }

  /** Render a UTC Date back into settings-timezone wall clock for assertions. */
  function asLocal(date: Date, zone = 'America/Chicago'): string {
    return DateTime.fromJSDate(date).setZone(zone).toFormat('yyyy-MM-dd HH:mm');
  }

  describe('within a single business day', () => {
    it('adds hours inside the window without rolling over', () => {
      const due = service.addBusinessHours(
        local('2026-03-11T09:00'),
        4,
        settings(),
      );
      expect(asLocal(due)).toBe('2026-03-11 13:00');
    });

    it('rolls a SEV1 15-minute target raised at 16:55 into the next business day', () => {
      // 5 minutes of Wednesday remain; the other 10 must come from Thursday.
      const due = service.addBusinessHours(
        local('2026-03-11T16:55'),
        0.25,
        settings(),
      );
      expect(asLocal(due)).toBe('2026-03-12 09:10');
    });

    it('starts the clock at opening when raised before business hours', () => {
      const due = service.addBusinessHours(
        local('2026-03-11T03:00'),
        1,
        settings(),
      );
      expect(asLocal(due)).toBe('2026-03-11 10:00');
    });

    it('starts the clock next morning when raised after close', () => {
      const due = service.addBusinessHours(
        local('2026-03-11T19:00'),
        1,
        settings(),
      );
      expect(asLocal(due)).toBe('2026-03-12 10:00');
    });
  });

  describe('weekends and holidays', () => {
    it('skips the weekend', () => {
      // Friday 16:00 + 2h = 1h Friday, 1h Monday.
      const due = service.addBusinessHours(
        local('2026-03-13T16:00'),
        2,
        settings(),
      );
      expect(asLocal(due)).toBe('2026-03-16 10:00');
    });

    it('skips a single holiday', () => {
      const due = service.addBusinessHours(
        local('2026-03-11T16:00'),
        2,
        settings({ holidays: [{ name: 'Company day', date: '2026-03-12' }] }),
      );
      expect(asLocal(due)).toBe('2026-03-13 10:00');
    });

    it('skips consecutive holidays that bridge into a weekend', () => {
      // Thu + Fri are holidays, Sat/Sun closed, so the remaining hour lands Monday.
      const due = service.addBusinessHours(
        local('2026-03-11T16:00'),
        2,
        settings({
          holidays: [
            { name: 'Long weekend day 1', date: '2026-03-12' },
            { name: 'Long weekend day 2', date: '2026-03-13' },
          ],
        }),
      );
      expect(asLocal(due)).toBe('2026-03-16 10:00');
    });
  });

  describe('daylight saving transitions', () => {
    // US DST 2026: forward Sun 8 Mar, back Sun 1 Nov. Neither lands inside a
    // Mon-Fri 09:00-17:00 window, so wall-clock arithmetic must stay stable
    // across the boundary rather than drifting by an hour.
    it('keeps wall-clock due times stable across spring forward', () => {
      // Friday 6 Mar 16:00 + 2h; the weekend contains the spring-forward.
      const due = service.addBusinessHours(
        local('2026-03-06T16:00'),
        2,
        settings(),
      );
      expect(asLocal(due)).toBe('2026-03-09 10:00');
    });

    it('keeps wall-clock due times stable across fall back', () => {
      // Friday 30 Oct 16:00 + 2h; the weekend contains the fall-back.
      const due = service.addBusinessHours(
        local('2026-10-30T16:00'),
        2,
        settings(),
      );
      expect(asLocal(due)).toBe('2026-11-02 10:00');
    });

    it('does not drift when a multi-day SLA spans the spring-forward weekend', () => {
      // 16 business hours = two full days. Thu 5 Mar 09:00 -> Fri, then Mon.
      const due = service.addBusinessHours(
        local('2026-03-05T09:00'),
        16,
        settings(),
      );
      expect(asLocal(due)).toBe('2026-03-06 17:00');
    });

    it('produces a real instant, not a nonexistent local time', () => {
      const due = service.addBusinessHours(
        local('2026-03-06T16:00'),
        2,
        settings(),
      );
      expect(Number.isNaN(due.getTime())).toBe(false);
      expect(DateTime.fromJSDate(due).isValid).toBe(true);
    });
  });

  describe('timezone handling', () => {
    it('honours a non-UTC business timezone', () => {
      const due = service.addBusinessHours(
        local('2026-03-11T09:00', 'Asia/Kolkata'),
        3,
        settings({ timezone: 'Asia/Kolkata' }),
      );
      expect(asLocal(due, 'Asia/Kolkata')).toBe('2026-03-11 12:00');
    });

    it('falls back to UTC for an invalid timezone rather than throwing', () => {
      expect(service.normalizeTimeZone('Not/AZone')).toBe('UTC');
    });
  });

  describe('degenerate input', () => {
    it('returns the start instant unchanged for a zero-hour target', () => {
      const start = local('2026-03-11T10:00');
      expect(service.addBusinessHours(start, 0, settings()).getTime()).toBe(
        start.getTime(),
      );
    });

    it('falls back to raw hour addition when every day is disabled', () => {
      const allClosed = settings({
        schedule: settings().schedule.map((day) => ({
          ...day,
          enabled: false,
        })),
      });
      const due = service.addBusinessHours(
        local('2026-03-11T10:00'),
        2,
        allClosed,
      );
      expect(Number.isNaN(due.getTime())).toBe(false);
    });
  });
});

/**
 * Per-department calendars: resolution order, cache isolation, and the
 * two-calendar rule on transfer.
 *
 * These stub Prisma rather than hitting a database — the point under test is
 * which calendar the service picks, not how it is stored.
 */
describe('TicketSlaCalculationService — per-department calendars', () => {
  const ALL_DAYS = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];
  const WEEKDAYS = ALL_DAYS.slice(0, 5);
  const teamAlwaysOpen = '11111111-1111-4111-8111-111111111111';
  const teamOffice = '22222222-2222-4222-8222-222222222222';

  type StoredCalendar = {
    timezone: string;
    schedule: Array<{
      day: string;
      enabled: boolean;
      start: string;
      end: string;
    }>;
    holidays: Array<{ name: string; date: string }>;
  };

  /** A calendar open `start`-`end` on `openDays` and closed otherwise. */
  function buildCalendar(
    timezone: string,
    start: string,
    end: string,
    openDays: string[] = ALL_DAYS,
  ): StoredCalendar {
    return {
      timezone,
      schedule: ALL_DAYS.map((day) => ({
        day,
        enabled: openDays.includes(day),
        start,
        end,
      })),
      holidays: [],
    };
  }

  /** Prisma stub serving one organisation default plus any team rows. */
  function buildPrismaStub(rows: {
    global?: StoredCalendar | null;
    teams?: Record<string, StoredCalendar>;
  }) {
    const findUnique = jest.fn(
      ({ where }: { where: { id?: string; teamId?: string } }) => {
        if (where.teamId) {
          return Promise.resolve(rows.teams?.[where.teamId] ?? null);
        }
        return Promise.resolve(rows.global ?? null);
      },
    );
    const prisma = {
      slaBusinessHoursSetting: { findUnique },
    } as unknown as PrismaService;
    return { prisma, findUnique };
  }

  function buildService(prisma: PrismaService): TicketSlaCalculationService {
    return new TicketSlaCalculationService(
      prisma,
      { get: jest.fn() } as unknown as ConfigService,
      new BusinessHoursCacheService(),
    );
  }

  /** Build a UTC Date from a wall-clock time in `zone`. */
  function toDate(iso: string, zone = 'utc'): Date {
    return DateTime.fromISO(iso, { zone }).toUTC().toJSDate();
  }

  /** Render a UTC Date as wall clock in `zone` for assertions. */
  function formatIn(date: Date, zone = 'utc'): string {
    return DateTime.fromJSDate(date).setZone(zone).toFormat('yyyy-MM-dd HH:mm');
  }

  describe('resolution order', () => {
    it("prefers the team's own calendar over the organisation default", async () => {
      const { prisma } = buildPrismaStub({
        global: buildCalendar('UTC', '09:00', '17:00', WEEKDAYS),
        teams: {
          [teamOffice]: buildCalendar(
            'Asia/Kolkata',
            '09:00',
            '17:00',
            WEEKDAYS,
          ),
        },
      });
      const settings =
        await buildService(prisma).getBusinessHoursSettings(teamOffice);
      expect(settings.timezone).toBe('Asia/Kolkata');
    });

    it('falls back to the organisation default when the team has none', async () => {
      const { prisma } = buildPrismaStub({
        global: buildCalendar('America/Chicago', '09:00', '17:00', WEEKDAYS),
      });
      const settings =
        await buildService(prisma).getBusinessHoursSettings(teamOffice);
      expect(settings.timezone).toBe('America/Chicago');
    });

    it('falls back to UTC when neither the team nor the default exists', async () => {
      const { prisma } = buildPrismaStub({ global: null });
      const settings =
        await buildService(prisma).getBusinessHoursSettings(teamOffice);
      expect(settings.timezone).toBe('UTC');
      expect(settings.schedule).toHaveLength(7);
    });

    it('reads the organisation default for an unassigned ticket', async () => {
      const { prisma } = buildPrismaStub({
        global: buildCalendar('Europe/London', '09:00', '17:00', WEEKDAYS),
      });
      const settings =
        await buildService(prisma).getBusinessHoursSettings(null);
      expect(settings.timezone).toBe('Europe/London');
    });
  });

  describe('cache isolation', () => {
    // A single-slot cache would serve whichever team was queried first to the
    // other, so both orders have to be asserted.
    const calendars = {
      [teamAlwaysOpen]: buildCalendar('Asia/Kolkata', '00:00', '23:59'),
      [teamOffice]: buildCalendar(
        'America/Chicago',
        '09:00',
        '17:00',
        WEEKDAYS,
      ),
    };

    it('keeps calendars apart when the 24/7 team is read first', async () => {
      const { prisma } = buildPrismaStub({ global: null, teams: calendars });
      const service = buildService(prisma);
      const alwaysOpen = await service.getBusinessHoursSettings(teamAlwaysOpen);
      const office = await service.getBusinessHoursSettings(teamOffice);
      expect(alwaysOpen.timezone).toBe('Asia/Kolkata');
      expect(office.timezone).toBe('America/Chicago');
    });

    it('keeps calendars apart when the office team is read first', async () => {
      const { prisma } = buildPrismaStub({ global: null, teams: calendars });
      const service = buildService(prisma);
      const office = await service.getBusinessHoursSettings(teamOffice);
      const alwaysOpen = await service.getBusinessHoursSettings(teamAlwaysOpen);
      expect(office.timezone).toBe('America/Chicago');
      expect(alwaysOpen.timezone).toBe('Asia/Kolkata');
    });

    it('does not let a team inheriting the default poison another team', async () => {
      const { prisma } = buildPrismaStub({
        global: buildCalendar('UTC', '09:00', '17:00', WEEKDAYS),
        teams: {
          [teamAlwaysOpen]: buildCalendar('Asia/Kolkata', '00:00', '23:59'),
        },
      });
      const service = buildService(prisma);
      const inheriting = await service.getBusinessHoursSettings(teamOffice);
      const owning = await service.getBusinessHoursSettings(teamAlwaysOpen);
      expect(inheriting.timezone).toBe('UTC');
      expect(owning.timezone).toBe('Asia/Kolkata');
    });

    it('serves a repeat read from cache without re-querying', async () => {
      const { prisma, findUnique } = buildPrismaStub({
        global: null,
        teams: {
          [teamOffice]: buildCalendar('UTC', '09:00', '17:00', WEEKDAYS),
        },
      });
      const service = buildService(prisma);
      await service.getBusinessHoursSettings(teamOffice);
      await service.getBusinessHoursSettings(teamOffice);
      expect(findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('cross-team transfer', () => {
    function buildTransferService(): TicketSlaCalculationService {
      const { prisma } = buildPrismaStub({
        global: null,
        teams: {
          [teamAlwaysOpen]: buildCalendar('UTC', '00:00', '23:59'),
          [teamOffice]: buildCalendar('UTC', '09:00', '17:00', WEEKDAYS),
        },
      });
      return buildService(prisma);
    }

    it('unwinds on the source calendar and re-dates on the destination', async () => {
      const service = buildTransferService();
      // Raised 20:00 Wednesday on a 24/7 team: the 2h target lands at 22:00.
      const raisedAt = toDate('2026-03-11T20:00');
      const dueOnSource = await service.addSlaHours(
        raisedAt,
        2,
        true,
        teamAlwaysOpen,
      );
      expect(formatIn(dueOnSource)).toBe('2026-03-11 22:00');
      // Transferred to a 09:00-17:00 team: unwind on the source calendar back
      // to the original 20:00 anchor, then re-date on the destination's, which
      // cannot start before Thursday opening.
      const cycleStart = await service.subtractSlaHours(
        dueOnSource,
        2,
        true,
        teamAlwaysOpen,
      );
      const dueOnDestination = await service.addSlaHours(
        cycleStart,
        2,
        true,
        teamOffice,
      );
      expect(formatIn(cycleStart)).toBe('2026-03-11 20:00');
      expect(formatIn(dueOnDestination)).toBe('2026-03-12 11:00');
    });

    it('produces a different, wrong date if one calendar is used for both halves', async () => {
      const service = buildTransferService();
      const dueOnSource = await service.addSlaHours(
        toDate('2026-03-11T20:00'),
        2,
        true,
        teamAlwaysOpen,
      );
      // The bug this guards: unwinding on the destination calendar moves the
      // anchor into Wednesday afternoon and loses most of a day.
      const wrongStart = await service.subtractSlaHours(
        dueOnSource,
        2,
        true,
        teamOffice,
      );
      const wrongDue = await service.addSlaHours(
        wrongStart,
        2,
        true,
        teamOffice,
      );
      expect(formatIn(wrongDue)).toBe('2026-03-11 17:00');
      expect(formatIn(wrongDue)).not.toBe('2026-03-12 11:00');
    });
  });

  describe('team calendars still honour DST and holidays', () => {
    it('keeps wall-clock stable across spring forward on a team calendar', async () => {
      const { prisma } = buildPrismaStub({
        global: null,
        teams: {
          [teamOffice]: buildCalendar(
            'America/Chicago',
            '09:00',
            '17:00',
            WEEKDAYS,
          ),
        },
      });
      const due = await buildService(prisma).addSlaHours(
        toDate('2026-03-06T16:00', 'America/Chicago'),
        2,
        true,
        teamOffice,
      );
      expect(formatIn(due, 'America/Chicago')).toBe('2026-03-09 10:00');
    });

    it('skips a holiday recorded on the team calendar', async () => {
      const calendar = buildCalendar('UTC', '09:00', '17:00', WEEKDAYS);
      calendar.holidays = [{ name: 'Company day', date: '2026-03-12' }];
      const { prisma } = buildPrismaStub({
        global: null,
        teams: { [teamOffice]: calendar },
      });
      const due = await buildService(prisma).addSlaHours(
        toDate('2026-03-11T16:00'),
        2,
        true,
        teamOffice,
      );
      expect(formatIn(due)).toBe('2026-03-13 10:00');
    });
  });
});
