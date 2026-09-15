import { TicketStatus, UserRole } from '@prisma/client';
import type { Cache } from 'cache-manager';
import type { AuthUser } from '../auth/current-user.decorator';
import type { PrismaService } from '../prisma/prisma.service';
import type { TicketRealtimeService } from './ticket-realtime.service';
import { TicketsService } from './tickets.service';

const OWNER: AuthUser = {
  id: 'owner-1',
  email: 'owner@example.com',
  displayName: 'Owner',
  role: UserRole.OWNER,
};

/**
 * Card 1.111 — unassign used to leave work in progress with nobody on it.
 *
 * ⚠️ THE ASYMMETRY WAS THE TELL. `applyAssigneeInTx` promotes NEW, TRIAGED
 * and REOPENED to ASSIGNED on the way in. The journey out had no equivalent:
 * `unassign` wrote `{ assigneeId: null }` and never touched status, so an
 * IN_PROGRESS ticket became an IN_PROGRESS ticket with no assignee. The queue
 * says somebody is working on it; nobody is.
 */
describe('unassigning an in-flight ticket (card 1.111)', () => {
  const build = (status: TicketStatus, assigneeId: string | null = 'agent-1') => {
    const updates: Record<string, unknown>[] = [];
    const events: Record<string, unknown>[] = [];
    const ticket = {
      id: 't1',
      status,
      assigneeId,
      assignedTeamId: 'team-1',
      requesterId: 'req-1',
      deletedAt: null,
    };
    const tx = {
      ticket: {
        update: (args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
          return Promise.resolve({});
        },
        findUniqueOrThrow: () => Promise.resolve({ ...ticket, assigneeId: null }),
      },
      ticketEvent: {
        create: (args: { data: Record<string, unknown> }) => {
          events.push(args.data);
          return Promise.resolve({});
        },
      },
    };
    const service = Object.create(TicketsService.prototype) as TicketsService;
    Object.assign(service, {
      prisma: {
        ticket: {
          findUnique: () => Promise.resolve(ticket),
          findUniqueOrThrow: () => Promise.resolve(ticket),
        },
        $transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
      } as unknown as PrismaService,
      cache: { del: () => Promise.resolve(undefined) } as unknown as Cache,
      ticketRealtime: {
        safeRealtime: (fn: () => Promise<void>) => fn(),
        emitTicketRealtimeEvent: () => Promise.resolve(),
      } as unknown as TicketRealtimeService,
    });
    return { service, updates, events };
  };

  const statusEvent = (events: Record<string, unknown>[]) =>
    events.find((e) => e.type === 'TICKET_STATUS_CHANGED') as
      | { payload: { from: string; to: string } }
      | undefined;

  it('⚠️ IN_PROGRESS lands on TRIAGED instead of staying in progress', async () => {
    // THE REGRESSION ASSERTION.
    const { service, updates } = build(TicketStatus.IN_PROGRESS);
    await service.unassign('t1', OWNER);
    expect(updates[0]).toMatchObject({
      assigneeId: null,
      status: TicketStatus.TRIAGED,
    });
  });

  it('⚠️ and it writes a TICKET_STATUS_CHANGED event', async () => {
    // A status that changes with no event is invisible in the history, which is
    // the whole of card 1.95.
    const { service, events } = build(TicketStatus.IN_PROGRESS);
    await service.unassign('t1', OWNER);
    expect(statusEvent(events)?.payload).toEqual({
      from: TicketStatus.IN_PROGRESS,
      to: TicketStatus.TRIAGED,
    });
    expect(events.some((e) => e.type === 'TICKET_UNASSIGNED')).toBe(true);
  });

  it('ASSIGNED also demotes', async () => {
    const { service, updates } = build(TicketStatus.ASSIGNED);
    await service.unassign('t1', OWNER);
    expect(updates[0]).toMatchObject({ status: TicketStatus.TRIAGED });
  });

  it('⚠️ a RESOLVED ticket is NOT reopened', async () => {
    // Card 1.80's bug in a new dress, and the assertion that would catch it.
    const { service, updates, events } = build(TicketStatus.RESOLVED);
    await service.unassign('t1', OWNER);
    expect(updates[0]).toMatchObject({ status: TicketStatus.RESOLVED });
    expect(statusEvent(events)).toBeUndefined();
  });

  it('a CLOSED ticket is not touched either', async () => {
    const { service, updates } = build(TicketStatus.CLOSED);
    await service.unassign('t1', OWNER);
    expect(updates[0]).toMatchObject({ status: TicketStatus.CLOSED });
  });

  it('⚠️ WAITING_ON_REQUESTER keeps its status', async () => {
    // Deliberate: it records who is being waited on, which is still true with
    // nobody assigned. Demoting it would lose information the desk uses.
    const { service, updates, events } = build(TicketStatus.WAITING_ON_REQUESTER);
    await service.unassign('t1', OWNER);
    expect(updates[0]).toMatchObject({
      status: TicketStatus.WAITING_ON_REQUESTER,
    });
    expect(statusEvent(events)).toBeUndefined();
  });

  it('⚠️ an already-unassigned ticket is a no-op', async () => {
    // NON-VACUITY. It returns before the transaction, so nothing is written and
    // no spurious status event appears in the history.
    const { service, updates, events } = build(TicketStatus.IN_PROGRESS, null);
    await service.unassign('t1', OWNER);
    expect(updates).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});
