import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';
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
      const due = service.addBusinessHours(local('2026-03-11T09:00'), 4, settings());
      expect(asLocal(due)).toBe('2026-03-11 13:00');
    });

    it('rolls a SEV1 15-minute target raised at 16:55 into the next business day', () => {
      // 5 minutes of Wednesday remain; the other 10 must come from Thursday.
      const due = service.addBusinessHours(local('2026-03-11T16:55'), 0.25, settings());
      expect(asLocal(due)).toBe('2026-03-12 09:10');
    });

    it('starts the clock at opening when raised before business hours', () => {
      const due = service.addBusinessHours(local('2026-03-11T03:00'), 1, settings());
      expect(asLocal(due)).toBe('2026-03-11 10:00');
    });

    it('starts the clock next morning when raised after close', () => {
      const due = service.addBusinessHours(local('2026-03-11T19:00'), 1, settings());
      expect(asLocal(due)).toBe('2026-03-12 10:00');
    });
  });

  describe('weekends and holidays', () => {
    it('skips the weekend', () => {
      // Friday 16:00 + 2h = 1h Friday, 1h Monday.
      const due = service.addBusinessHours(local('2026-03-13T16:00'), 2, settings());
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
      const due = service.addBusinessHours(local('2026-03-06T16:00'), 2, settings());
      expect(asLocal(due)).toBe('2026-03-09 10:00');
    });

    it('keeps wall-clock due times stable across fall back', () => {
      // Friday 30 Oct 16:00 + 2h; the weekend contains the fall-back.
      const due = service.addBusinessHours(local('2026-10-30T16:00'), 2, settings());
      expect(asLocal(due)).toBe('2026-11-02 10:00');
    });

    it('does not drift when a multi-day SLA spans the spring-forward weekend', () => {
      // 16 business hours = two full days. Thu 5 Mar 09:00 -> Fri, then Mon.
      const due = service.addBusinessHours(local('2026-03-05T09:00'), 16, settings());
      expect(asLocal(due)).toBe('2026-03-06 17:00');
    });

    it('produces a real instant, not a nonexistent local time', () => {
      const due = service.addBusinessHours(local('2026-03-06T16:00'), 2, settings());
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
        schedule: settings().schedule.map((day) => ({ ...day, enabled: false })),
      });
      const due = service.addBusinessHours(local('2026-03-11T10:00'), 2, allClosed);
      expect(Number.isNaN(due.getTime())).toBe(false);
    });
  });
});
