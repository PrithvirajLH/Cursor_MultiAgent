import {
  TicketCloseReason,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import {
  MACRO_TRANSACTION_OPTIONS,
  RuleEngineService,
} from './rule-engine.service';
import { fillTemplateVars } from './template-vars.util';

/**
 * Unit tests for the card 1.3 additions to the rule engine: the numeric `gte`
 * operator, the hour fields in the ticket context, and AUTO_CLOSED being passed
 * when an automation closes a ticket. No DB — deps are stubbed.
 */

type Ctx = Record<string, unknown>;

function engine(
  ticketsService: unknown = {},
  deps: { prisma?: unknown; tags?: unknown; notifications?: unknown } = {},
): RuleEngineService {
  return new RuleEngineService(
    (deps.prisma ?? {}) as never,
    {} as never,
    ticketsService as never,
    {} as never,
    (deps.tags ?? {}) as never,
    (deps.notifications ?? {}) as never,
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

describe('fillTemplateVars', () => {
  it('replaces known placeholders and blanks unknown ones', () => {
    const out = fillTemplateVars(
      'Re: {{ticket.displayId}} — {{ ticket.subject }} for {{requester.displayName}}{{nope}}',
      {
        'ticket.displayId': 'IT-42',
        'ticket.subject': 'VPN broken',
        'requester.displayName': 'Requestor One',
      },
    );
    expect(out).toBe('Re: IT-42 — VPN broken for Requestor One');
  });
  it('leaves text without placeholders untouched', () => {
    expect(fillTemplateVars('plain', {})).toBe('plain');
  });
});

describe('RuleEngineService card 1.4 actions', () => {
  const requester = {
    id: 'r1',
    email: 'requester@company.com',
    displayName: 'Requestor One',
    role: 'EMPLOYEE',
    isActive: true,
  };
  const baseTicket = {
    id: 't1',
    displayId: 'IT-7',
    subject: 'VPN down again',
    description: null,
    priority: TicketPriority.SEV3,
    status: TicketStatus.NEW,
    assignedTeamId: null,
    assigneeId: null,
    categoryId: null,
    requesterId: 'r1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    firstResponseDueAt: null,
    resolvedAt: null,
    closedAt: null,
    completedAt: null,
    dueAt: null,
    slaPausedAt: null,
    requester,
    assignee: null,
    assignedTeam: null,
  };
  const emailAction = {
    type: 'send_email',
    to: 'requester',
    subject: 'Re: {{ticket.displayId}} {{ticket.subject}}',
    body: 'Hello {{requester.displayName}}',
  };

  function harness(actions: unknown[], ticketUpdate: jest.Mock) {
    const tx = {
      category: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'cat-1', isActive: true }),
      },
      ticket: {
        update: ticketUpdate,
        findUnique: jest.fn().mockResolvedValue(baseTicket),
      },
      ticketEvent: { create: jest.fn().mockResolvedValue({}) },
      automationExecution: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      ticket: { findUnique: jest.fn().mockResolvedValue(baseTicket) },
      automationRule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rule-1',
            name: 'VPN rule',
            teamId: null,
            createdById: 'owner',
            conditions: [
              { field: 'subject', operator: 'contains', value: 'vpn' },
            ],
            actions,
          },
        ]),
      },
      $transaction: jest.fn(async (fn: (client: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
      automationExecution: { create: jest.fn().mockResolvedValue({}) },
    };
    const notifications = {
      notifyUsers: jest.fn().mockResolvedValue(undefined),
      notifyAddresses: jest.fn().mockResolvedValue(undefined),
    };
    const ticketsService = {
      publishAutomationRealtimeUpdate: jest.fn().mockResolvedValue(undefined),
    };
    const e = engine(ticketsService, { prisma, notifications });
    return { e, prisma, tx, notifications };
  }

  it('does not email when a later action makes the transaction fail', async () => {
    const { e, prisma, notifications } = harness(
      [emailAction, { type: 'set_category', categoryId: 'cat-1' }],
      jest.fn().mockRejectedValue(new Error('boom')),
    );
    const result = await e.runForTicket('t1', 'TICKET_CREATED');
    expect(result.executed).toBe(0);
    expect(result.errors[0]).toContain('boom');
    expect(notifications.notifyUsers).not.toHaveBeenCalled();
    const failed = prisma.automationExecution.create.mock.calls[0] as unknown[];
    expect(failed[0]).toMatchObject({ data: { success: false } });
  });

  it('emails the requester after the transaction commits, with placeholders filled', async () => {
    const { e, notifications } = harness([emailAction], jest.fn());
    const result = await e.runForTicket('t1', 'TICKET_CREATED');
    expect(result.executed).toBe(1);
    expect(notifications.notifyUsers).toHaveBeenCalledTimes(1);
    const call = notifications.notifyUsers.mock.calls[0] as unknown[];
    expect(call[0]).toEqual([requester]);
    expect(call[1]).toMatchObject({
      eventType: 'AUTOMATION_EMAIL',
      subject: 'Re: IT-7 VPN down again',
      body: 'Hello Requestor One',
      ticketId: 't1',
      payload: { ruleId: 'rule-1' },
    });
  });

  it('add_follower with target assignee on an unassigned ticket is a no-op', async () => {
    const tx = { ticketFollower: { upsert: jest.fn() } };
    const e = engine();
    const run = (
      e as unknown as {
        executeActions: (
          tx: unknown,
          ticketId: string,
          actions: unknown[],
          ticket: unknown,
          ruleId: string,
          ruleCreatedById: string,
        ) => Promise<{ postCommit: unknown[] }>;
      }
    ).executeActions(
      tx,
      't1',
      [{ type: 'add_follower', target: 'assignee' }],
      baseTicket,
      'rule-1',
      'owner',
    );
    await expect(run).resolves.toEqual(
      expect.objectContaining({ postCommit: [] }),
    );
    expect(tx.ticketFollower.upsert).not.toHaveBeenCalled();
  });
});

/**
 * Card 1.51 — the macro transaction must carry a timeout.
 *
 * A bulk macro over three tickets failed live on one of them with
 * "Transaction already closed: ... the timeout for this transaction was 5000
 * ms, however 5037 ms passed", inside `slaInstance.upsert` — reached because
 * `set_priority` syncs the SLA INSIDE the transaction. Latency rather than
 * logic: the retry succeeded and the rollback was clean.
 *
 * ⚠️ A TEST CANNOT REPRODUCE THE LATENCY, so it asserts the option is passed
 * instead. That is cheap and it catches the regression that matters: somebody
 * removing the argument, after which the default 5 s silently returns.
 */
describe('macro transaction options (card 1.51)', () => {
  function engineWithPrismaSpy() {
    const calls: unknown[][] = [];
    const prisma = {
      ticket: {
        findUnique: jest.fn().mockResolvedValue({
          id: 't-1',
          deletedAt: null,
          requester: null,
          assignee: null,
          assignedTeam: null,
        }),
      },
      $transaction: jest.fn(async (...args: unknown[]) => {
        calls.push(args);
        // Do not run the callback: this test is about the OPTIONS, and the
        // body needs a real database.
        return undefined;
      }),
    };
    // The macro path publishes a realtime update after the commit; stub it,
    // or the test dies after the thing it is measuring.
    const ticketsService = {
      publishAutomationRealtimeUpdate: jest.fn().mockResolvedValue(undefined),
    };
    return { engine: engine(ticketsService, { prisma }), calls, prisma };
  }

  it('⚠️ passes a 15 second timeout, not Prisma\'s 5 second default', async () => {
    const { engine: svc, calls } = engineWithPrismaSpy();
    await svc.applyMacroActions('t-1', [], {
      kind: 'macro',
      cannedResponseId: 'c-1',
      actorId: 'u-1',
    });
    expect(calls).toHaveLength(1);
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK: the second argument is
    // the options object, and it must carry the raised timeout.
    const options = calls[0][1] as { timeout?: number } | undefined;
    expect(options).toBeDefined();
    expect(options?.timeout).toBe(15_000);
  });

  it('exports the value so it cannot drift from what is documented', () => {
    expect(MACRO_TRANSACTION_OPTIONS.timeout).toBe(15_000);
    // Comfortably clear of the observed 5,037 ms overrun - just under three
    // times it. (My first version of this asserted MORE than three times,
    // which 15,000 is not: 3 x 5,037 is 15,111. The assertion was wrong, not
    // the value.)
    expect(MACRO_TRANSACTION_OPTIONS.timeout).toBeGreaterThan(2 * 5_037);
  });

  it('is well short of the scheduler\'s 60 s, which runs alone', () => {
    // A bulk macro runs five of these at once, and a long-held transaction
    // starves a pooled connection for everybody else.
    expect(MACRO_TRANSACTION_OPTIONS.timeout).toBeLessThan(60_000);
  });
});
