import {
  TicketCloseReason,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { RuleEngineService } from './rule-engine.service';

/**
 * Unit tests for the card 1.3 additions to the rule engine: the numeric `gte`
 * operator, the hour fields in the ticket context, and AUTO_CLOSED being passed
 * when an automation closes a ticket. No DB — deps are stubbed.
 */

type Ctx = Record<string, unknown>;

function engine(ticketsService: unknown = {}): RuleEngineService {
  return new RuleEngineService(
    {} as never,
    {} as never,
    ticketsService as never,
    {} as never,
  );
}

const evalSingle = (
  e: RuleEngineService,
  field: string,
  operator: string,
  value: unknown,
  c: Ctx,
) =>
  (
    e as unknown as {
      evaluateSingle: (f: string, o: string, v: unknown, c: Ctx) => boolean;
    }
  ).evaluateSingle(field, operator, value, c);

describe('RuleEngineService gte operator', () => {
  const e = engine();
  it('compares numerically', () => {
    expect(
      evalSingle(e, 'hoursSinceActivity', 'gte', 168, {
        hoursSinceActivity: 170,
      }),
    ).toBe(true);
    expect(
      evalSingle(e, 'hoursSinceActivity', 'gte', 168, {
        hoursSinceActivity: 168,
      }),
    ).toBe(true);
    expect(
      evalSingle(e, 'hoursSinceActivity', 'gte', 168, {
        hoursSinceActivity: 167,
      }),
    ).toBe(false);
  });
  it('accepts numeric strings (rule values arrive as JSON from the UI)', () => {
    expect(
      evalSingle(e, 'hoursUnassigned', 'gte', '4', { hoursUnassigned: 5 }),
    ).toBe(true);
  });
  it('never matches non-numeric operands', () => {
    expect(
      evalSingle(e, 'hoursUnassigned', 'gte', 'soon', { hoursUnassigned: 5 }),
    ).toBe(false);
    expect(evalSingle(e, 'subject', 'gte', 1, { subject: 'Printer' })).toBe(
      false,
    );
    expect(evalSingle(e, 'missing', 'gte', 1, {})).toBe(false);
  });
});

describe('RuleEngineService.ticketToContext hour fields', () => {
  const now = new Date('2026-08-27T12:00:00.000Z');
  const base = {
    id: 't1',
    subject: 'S',
    description: null,
    priority: TicketPriority.SEV3,
    status: TicketStatus.RESOLVED,
    assignedTeamId: null,
    assigneeId: null,
    categoryId: null,
    requesterId: 'r1',
  };

  it('computes whole hours since last activity and since creation while unassigned', () => {
    const ctx = engine().ticketToContext(
      {
        ...base,
        createdAt: new Date('2026-08-27T07:30:00.000Z'),
        updatedAt: new Date('2026-08-20T11:00:00.000Z'),
      },
      now,
    );
    expect(ctx.hoursSinceActivity).toBe(169);
    expect(ctx.hoursUnassigned).toBe(4);
  });

  it('reports 0 hours unassigned once an assignee is set, and 0 when dates are missing', () => {
    const assigned = engine().ticketToContext(
      {
        ...base,
        assigneeId: 'a1',
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
      },
      now,
    );
    expect(assigned.hoursUnassigned).toBe(0);
    const bare = engine().ticketToContext(base, now);
    expect(bare.hoursSinceActivity).toBe(0);
    expect(bare.hoursUnassigned).toBe(0);
  });
});

describe('RuleEngineService.applyStatusTransitionAction close reason', () => {
  const current = {
    id: 't1',
    subject: 'S',
    createdAt: new Date(),
    assignedTeamId: 'team',
    assigneeId: 'a1',
    priority: TicketPriority.SEV3,
    status: TicketStatus.RESOLVED,
    firstResponseDueAt: null,
    resolvedAt: new Date(),
    closedAt: null,
    completedAt: new Date(),
    dueAt: null,
    slaPausedAt: null,
    requesterId: 'r1',
  };

  function run(newStatus: TicketStatus) {
    const applyStatusTransitionInTx = jest
      .fn<Promise<void>, unknown[]>()
      .mockResolvedValue(undefined);
    const e = engine({ applyStatusTransitionInTx });
    const tx = {
      ticket: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...current, status: newStatus }),
      },
    } as unknown as Prisma.TransactionClient;
    return (
      e as unknown as {
        applyStatusTransitionAction: (
          tx: Prisma.TransactionClient,
          ticketId: string,
          c: typeof current,
          s: TicketStatus,
          actor: string,
        ) => Promise<unknown>;
      }
    )
      .applyStatusTransitionAction(tx, 't1', current, newStatus, 'rule-owner')
      .then(() => applyStatusTransitionInTx);
  }

  it('passes AUTO_CLOSED as the close reason when the action closes the ticket', async () => {
    const spy = await run(TicketStatus.CLOSED);
    expect(spy).toHaveBeenCalledTimes(1);
    const args: unknown[] = spy.mock.calls[0];
    expect(args[2]).toBe(TicketStatus.CLOSED);
    expect(args[4]).toBe(TicketCloseReason.AUTO_CLOSED);
  });

  it('passes no close reason for other statuses', async () => {
    const spy = await run(TicketStatus.REOPENED);
    const args: unknown[] = spy.mock.calls[0];
    expect(args[2]).toBe(TicketStatus.REOPENED);
    expect(args[4]).toBeUndefined();
  });
});
