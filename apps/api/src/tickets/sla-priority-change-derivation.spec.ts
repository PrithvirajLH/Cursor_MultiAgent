import { readFileSync } from 'fs';
import { join } from 'path';
import { TicketSlaCalculationService } from './ticket-sla-calculation.service';

/** A 9-to-5, Monday-to-Friday calendar — the shape the normaliser produces. */
const BUSINESS_WEEK = {
  timezone: 'UTC',
  schedule: [
    { day: 'Monday', enabled: true, start: '09:00', end: '17:00' },
    { day: 'Tuesday', enabled: true, start: '09:00', end: '17:00' },
    { day: 'Wednesday', enabled: true, start: '09:00', end: '17:00' },
    { day: 'Thursday', enabled: true, start: '09:00', end: '17:00' },
    { day: 'Friday', enabled: true, start: '09:00', end: '17:00' },
    { day: 'Saturday', enabled: false, start: '09:00', end: '17:00' },
    { day: 'Sunday', enabled: false, start: '09:00', end: '17:00' },
  ],
  holidays: [] as Array<{ name: string; date: string }>,
};

/**
 * Card 1.82 — one derivation for an SLA deadline, not two that agree today.
 *
 * ⚠️ THE DEFECT: `rule-engine.service.ts` recomputed `firstResponseDueAt` and
 * `dueAt` with a private `addHours` that adds `hours * 60 * 60 * 1000` to a
 * Date — wall-clock milliseconds, ignoring the policy's `businessHoursOnly`
 * flag and the team's calendar. The same priority change made through
 * `POST /tickets/bulk/priority` went through `TicketSlaCalculationService`.
 *
 * So the deadline depended on WHICH PATH made the change, and the wrong value
 * was written back to the ticket and to `SlaInstance`, where it compounded.
 *
 * ⚠️ FRIDAY AFTERNOON SPECIFICALLY, as the card insists. That is when business
 * hours and wall-clock diverge most — the weekend sits between them. A
 * Tuesday-morning fixture gives the same answer both ways and would pass while
 * the code was broken.
 */
describe('a priority change derives one deadline, whichever path made it (card 1.82)', () => {
  const service = Object.create(
    TicketSlaCalculationService.prototype,
  ) as TicketSlaCalculationService;

  // The shared method only needs the calendar lookup stubbed; everything else
  // is the real business-hours arithmetic.
  (service as unknown as { getBusinessHoursSettings: () => unknown }).getBusinessHoursSettings =
    () => Promise.resolve(BUSINESS_WEEK);

  /** Friday 15:00 UTC — two hours of the working week left. */
  const FRIDAY_3PM = new Date('2026-09-11T15:00:00.000Z');

  const sla = (hours: number, businessHoursOnly: boolean) => ({
    firstResponseHours: hours,
    resolutionHours: hours,
    businessHoursOnly,
  });

  it('⚠️ honours business hours, so a Friday deadline lands on Monday', async () => {
    // THE ASSERTION THE RAW-MILLISECOND VERSION FAILS. Four business hours from
    // Friday 15:00 is Monday 11:00 — two hours on Friday, two on Monday.
    // Wall-clock would say Friday 19:00, outside the working week entirely.
    const result = await service.recalculateDeadlinesForPriorityChange({
      createdAt: FRIDAY_3PM,
      firstResponseDueAt: null,
      dueAt: null,
      assignedTeamId: null,
      oldSla: sla(4, true),
      newSla: sla(4, true),
    });
    expect(result.dueAt.toISOString()).toBe('2026-09-14T11:00:00.000Z');
    expect(result.firstResponseDueAt.toISOString()).toBe(
      '2026-09-14T11:00:00.000Z',
    );
  });

  it('⚠️ and that is NOT what wall-clock arithmetic gives', async () => {
    // Makes the divergence explicit rather than implied: the old code produced
    // this value, and it is 40 hours adrift.
    const wallClock = new Date(FRIDAY_3PM.getTime() + 4 * 60 * 60 * 1000);
    expect(wallClock.toISOString()).toBe('2026-09-11T19:00:00.000Z');
    const result = await service.recalculateDeadlinesForPriorityChange({
      createdAt: FRIDAY_3PM,
      firstResponseDueAt: null,
      dueAt: null,
      assignedTeamId: null,
      oldSla: sla(4, true),
      newSla: sla(4, true),
    });
    expect(result.dueAt.toISOString()).not.toBe(wallClock.toISOString());
  });

  it('still uses wall-clock when the policy says 24/7', async () => {
    // The non-vacuity half: a method that always applied business hours would
    // break every round-the-clock policy.
    const result = await service.recalculateDeadlinesForPriorityChange({
      createdAt: FRIDAY_3PM,
      firstResponseDueAt: null,
      dueAt: null,
      assignedTeamId: null,
      oldSla: sla(4, false),
      newSla: sla(4, false),
    });
    expect(result.dueAt.toISOString()).toBe('2026-09-11T19:00:00.000Z');
  });

  it('⚠️ preserves elapsed time rather than restarting the clock', async () => {
    // Why this is not `createdAt + newHours`: a ticket already part-way through
    // its cycle must keep that progress when the priority changes. Unwinding 8
    // business hours from an existing Friday 15:00 deadline lands on Thursday
    // 15:00, and adding the new 4 hours forward gives Friday 11:00.
    const result = await service.recalculateDeadlinesForPriorityChange({
      createdAt: new Date('2026-09-01T09:00:00.000Z'),
      firstResponseDueAt: FRIDAY_3PM,
      dueAt: FRIDAY_3PM,
      assignedTeamId: null,
      oldSla: sla(8, true),
      newSla: sla(4, true),
    });
    expect(result.dueAt.toISOString()).toBe('2026-09-11T11:00:00.000Z');
  });
});

/**
 * The structural half: there is one derivation, and the raw-millisecond helper
 * that caused the split is gone.
 */
describe('the automation path cannot drift from the bulk path again (card 1.82)', () => {
  const ruleEngine = readFileSync(
    join(__dirname, '..', 'automation', 'rule-engine.service.ts'),
    'utf8',
  );
  const tickets = readFileSync(join(__dirname, 'tickets.service.ts'), 'utf8');

  it('⚠️ the rule engine no longer carries its own hour arithmetic', () => {
    // The helper was `new Date(date.getTime() + hours * 60 * 60 * 1000)`. A
    // second one would be the thirteenth instance of this project's recurring
    // shape, so its absence is asserted rather than assumed.
    expect(ruleEngine).not.toMatch(/private addHours/);
    expect(ruleEngine).not.toMatch(/getTime\(\) \+ hours \* 60 \* 60 \* 1000/);
  });

  it('⚠️ both callers use the same calculator method', () => {
    expect(ruleEngine).toContain('recalculateDeadlinesForPriorityChange');
    expect(tickets).toContain('recalculateDeadlinesForPriorityChange');
  });
});
