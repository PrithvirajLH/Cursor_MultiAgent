import { ConfigService } from '@nestjs/config';
import { TicketPriority, TicketStatus } from '@prisma/client';
import { AutomationQueueService } from '../common/automation-queue.service';
import { InAppNotificationsService } from '../notifications/in-app-notifications.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketRealtimeService } from '../tickets/ticket-realtime.service';
import { SlaBreachService } from './sla-breach.service';
import { SlaEngineService } from './sla-engine.service';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const HOUR_MS = 60 * 60 * 1000;

/** A first-response deadline an hour in the past: this tick must breach it. */
function buildOverdueInstance() {
  return {
    id: 'instance-1',
    ticketId: TICKET_ID,
    policyConfigId: null,
    priority: TicketPriority.SEV3,
    firstResponseDueAt: new Date(Date.now() - HOUR_MS),
    resolutionDueAt: null,
    pausedAt: null,
    nextDueAt: new Date(Date.now() - HOUR_MS),
    firstResponseAtRiskNotifiedAt: null,
    resolutionAtRiskNotifiedAt: null,
    firstResponseBreachedAt: null,
    resolutionBreachedAt: null,
    ticket: {
      id: TICKET_ID,
      number: 1,
      displayId: 'IS_20260901_001',
      subject: 'Printer down',
      status: TicketStatus.NEW,
      priority: TicketPriority.SEV3,
      // No team, so there are no leads to notify. The worker still changed the
      // ticket, and that is the case this suite exists to pin down.
      assignedTeamId: null,
      assignedTeam: null,
      firstResponseAt: null,
      completedAt: null,
    },
  };
}

type Harness = {
  service: SlaBreachService;
  emit: jest.Mock;
  updateMany: jest.Mock;
};

function buildHarness(options: { instances: unknown[]; emit?: jest.Mock }): Harness {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ pg_try_advisory_xact_lock: true }]),
    slaInstance: {
      findMany: jest.fn().mockResolvedValue(options.instances),
      updateMany,
      update: jest.fn().mockResolvedValue({}),
    },
    ticketEvent: { create: jest.fn().mockResolvedValue({}) },
    ticket: { update: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    teamMember: { findMany: jest.fn().mockResolvedValue([]) },
  };
  let transactionCall = 0;
  const prisma = {
    // The first $transaction of a tick is the backfill, which has its own lock
    // and its own tests; skipping its callback keeps this suite on the breach
    // path rather than mocking a second unrelated query shape.
    $transaction: jest.fn(async (fn: (client: unknown) => Promise<unknown>) => {
      transactionCall += 1;
      if (transactionCall === 1) return undefined;
      return fn(tx);
    }),
  } as unknown as PrismaService;
  const emit = options.emit ?? jest.fn().mockResolvedValue(undefined);
  const ticketRealtime = {
    emitTicketRealtimeEvent: emit,
    // The real safeRealtime swallows and logs; reproduce that here so the test
    // proves the worker survives a publish failure rather than assuming it.
    safeRealtime: jest.fn(async (task: () => Promise<void>) => {
      try {
        await task();
      } catch {
        /* swallowed, exactly as the real service does */
      }
    }),
  } as unknown as TicketRealtimeService;
  const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
  const service = new SlaBreachService(
    prisma,
    { sendMail: jest.fn() } as unknown as NotificationsService,
    { createForUsers: jest.fn() } as unknown as InAppNotificationsService,
    config,
    {} as unknown as SlaEngineService,
    { enqueue: jest.fn().mockResolvedValue(undefined) } as unknown as AutomationQueueService,
    ticketRealtime,
  );
  return { service, emit, updateMany };
}

describe('SlaBreachService realtime announcements', () => {
  it('publishes one sla_changed for a ticket it breached', async () => {
    const { service, emit } = buildHarness({ instances: [buildOverdueInstance()] });
    await service.runOnce();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      ticketId: TICKET_ID,
      reason: 'sla_changed',
      actorId: null,
    });
  });

  it('announces a breach even when there is nobody to notify', async () => {
    // The ticket has no team, so no lead users and no on-call address exist and
    // the worker collects no notification intent. It still changed the ticket,
    // so deriving the publish from the intents would silently skip this row -
    // which is the whole failure this card is about.
    const { service, emit } = buildHarness({ instances: [buildOverdueInstance()] });
    await service.runOnce();
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('publishes nothing on a tick that changed nothing', async () => {
    const { service, emit } = buildHarness({ instances: [] });
    await service.runOnce();
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not publish for an instance another worker had already marked', async () => {
    const { service, emit, updateMany } = buildHarness({
      instances: [buildOverdueInstance()],
    });
    updateMany.mockResolvedValue({ count: 0 });
    await service.runOnce();
    expect(emit).not.toHaveBeenCalled();
  });

  it('completes the tick when publishing throws', async () => {
    const emit = jest.fn().mockRejectedValue(new Error('web pubsub is down'));
    const { service } = buildHarness({ instances: [buildOverdueInstance()], emit });
    const summary = await service.runOnce();
    expect(summary).not.toBeNull();
    expect(summary?.ok).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
