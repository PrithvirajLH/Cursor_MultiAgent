import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  TicketPriority,
  TicketStatus,
  TeamRole,
  User,
} from '@prisma/client';
import { AutomationQueueService } from '../common/automation-queue.service';
import { InAppNotificationsService } from '../notifications/in-app-notifications.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketRealtimeService } from '../tickets/ticket-realtime.service';
import { SlaEngineService } from './sla-engine.service';
import type { SlaWorkerRunSummary } from './sla-worker-run-summary.type';
import type { SlaWorkerState } from './sla-worker-state.type';

type BreachType = 'FIRST_RESPONSE' | 'RESOLUTION';

// Advisory lock keys for SLA breach worker (arbitrary unique numbers)
const SLA_BREACH_LOCK_KEY = 847291;
const SLA_BACKFILL_LOCK_KEY = 847292;

// Notification intent collected during transaction, dispatched after commit
type NotificationIntent = {
  kind: 'BREACH' | 'AT_RISK';
  leadUsers: User[];
  onCallEmails: string[];
  subject: string;
  body: string;
  ticketSubject: string;
  timeRemaining?: string;
  ticketId: string;
  payload: Prisma.InputJsonValue;
};

@Injectable()
export class SlaBreachService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaBreachService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private enabled = true;
  private lastRunAt: Date | null = null;
  private lastRunOk: boolean | null = null;
  private lastSummary: SlaWorkerRunSummary | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly inAppNotifications: InAppNotificationsService,
    private readonly config: ConfigService,
    private readonly slaEngine: SlaEngineService,
    private readonly automationQueue: AutomationQueueService,
    private readonly ticketRealtime: TicketRealtimeService,
  ) {}

  onModuleInit() {
    this.enabled =
      this.config.get<string>('SLA_BREACH_WORKER_ENABLED') !== 'false';
    if (!this.enabled) {
      return;
    }

    const intervalMs = Number(
      this.config.get<string>('SLA_BREACH_INTERVAL_MS') ?? '60000',
    );

    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        this.logger.error('SLA breach worker failed', (error as Error).stack);
      });
    }, intervalMs);

    this.runOnce().catch((error) => {
      this.logger.error('SLA breach worker failed', (error as Error).stack);
    });
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Worker state for the readiness probe; `lastRunAt` is null until the first tick completes. */
  getWorkerState(): SlaWorkerState {
    return {
      enabled: this.enabled,
      lastRunAt: this.lastRunAt ? this.lastRunAt.toISOString() : null,
      lastRunOk: this.lastRunOk,
      lastSummary: this.lastSummary,
    };
  }

  /**
   * One breach-worker tick. Returns `null` when another instance holds the
   * advisory lock or a tick is already running here — that is information, not
   * a failure. Public so the operations console can trigger a run (card 1.21);
   * the interval calls exactly the same path it always did.
   */
  async runOnce(): Promise<SlaWorkerRunSummary | null> {
    if (this.running) {
      return null;
    }

    this.running = true;
    let lockAcquired = false;
    try {
      // Run backfill separately with its own session-level lock.
      // If backfill fails, we still run breach processing so existing instances are checked.
      try {
        await this.runBackfillWithLock();
      } catch (backfillError) {
        this.logger.error(
          'SLA backfill failed',
          (backfillError as Error).stack,
        );
      }

      const now = new Date();
      const atRiskThresholdMs = this.atRiskThresholdMs();
      const windowEnd =
        atRiskThresholdMs > 0
          ? new Date(now.getTime() + atRiskThresholdMs)
          : now;
      const batchSize = Number(
        this.config.get<string>('SLA_BREACH_BATCH_SIZE') ?? '100',
      );

      // Collect notification intents during transaction, dispatch after commit
      // This keeps the transaction short and prevents duplicate notifications on rollback
      const notificationIntents: NotificationIntent[] = [];
      // Tickets whose SLA state this tick actually changed. Deliberately NOT
      // derived from notificationIntents: a breach on a team with no lead and
      // no on-call address is marked and then returns without an intent, and
      // that ticket still has to reach the screen.
      const changedTicketIds = new Set<string>();

      // Use a transaction with advisory lock to ensure only one instance processes
      // pg_try_advisory_xact_lock is released automatically when transaction ends.
      // Use a longer timeout so large batches (many instances × multiple writes) don't hit
      // the default 5s and cause P2028 (transaction not found).
      await this.prisma.$transaction(
        async (tx) => {
          const [{ pg_try_advisory_xact_lock: locked }] = await tx.$queryRaw<
            [{ pg_try_advisory_xact_lock: boolean }]
          >`SELECT pg_try_advisory_xact_lock(${SLA_BREACH_LOCK_KEY})`;

          if (!locked) {
            return; // Another instance is already processing
          }
          lockAcquired = true;

          const instances = await tx.slaInstance.findMany({
            where: { nextDueAt: { lte: windowEnd } },
            orderBy: { nextDueAt: 'asc' },
            take: batchSize,
            include: { ticket: { include: { assignedTeam: true } } },
          });

          for (const instance of instances) {
            await this.handleInstance(
              tx,
              instance,
              now,
              notificationIntents,
              changedTicketIds,
            );
          }
        },
        { timeout: 60_000, maxWait: 10_000 },
      );

      // Dispatch notifications after transaction commits successfully
      // This prevents duplicate notifications if transaction rolls back
      for (const intent of notificationIntents) {
        await this.dispatchNotification(intent);
      }
      // Queue automation rules for SLA breach / at-risk via BullMQ with retry
      for (const intent of notificationIntents) {
        const trigger =
          intent.kind === 'BREACH' ? 'SLA_BREACHED' : 'SLA_APPROACHING';
        this.automationQueue
          .enqueue(intent.ticketId, trigger)
          .catch((err) =>
            this.logger.error(
              `Failed to enqueue automation for ticket ${intent.ticketId}: ${(err as Error).message}`,
            ),
          );
      }
      // Best effort and deliberately last: the breach marking and the
      // notifications are the job, this is a courtesy. safeRealtime swallows
      // and logs, so a broken socket cannot fail or shorten a tick.
      for (const ticketId of changedTicketIds) {
        await this.ticketRealtime.safeRealtime(() =>
          this.ticketRealtime.emitTicketRealtimeEvent({
            ticketId,
            reason: 'sla_changed',
            // No user raised this. Same as the attachment scan callback, which
            // is the existing precedent for a system-raised ticket event.
            actorId: null,
          }),
        );
      }
      this.lastRunOk = true;
      if (!lockAcquired) {
        return null;
      }
      const summary: SlaWorkerRunSummary = {
        ranAt: new Date().toISOString(),
        ok: true,
        breachesProcessed: notificationIntents.filter(
          (intent) => intent.kind === 'BREACH',
        ).length,
        atRiskProcessed: notificationIntents.filter(
          (intent) => intent.kind === 'AT_RISK',
        ).length,
      };
      this.lastSummary = summary;
      return summary;
    } catch (error) {
      this.lastRunOk = false;
      throw error;
    } finally {
      this.lastRunAt = new Date();
      this.running = false;
    }
  }

  /**
   * Run backfill inside a transaction with pg_try_advisory_xact_lock.
   * This ensures the lock and all backfill queries run on the same connection,
   * avoiding lock leaks with Prisma's connection pooling.
   */
  private async runBackfillWithLock() {
    const backfillBatchSize = Number(
      this.config.get<string>('SLA_BACKFILL_BATCH_SIZE') ?? '50',
    );

    await this.prisma.$transaction(
      async (tx) => {
        // Transaction-scoped lock - automatically released when tx ends
        const [{ pg_try_advisory_xact_lock: locked }] = await tx.$queryRaw<
          [{ pg_try_advisory_xact_lock: boolean }]
        >`SELECT pg_try_advisory_xact_lock(${SLA_BACKFILL_LOCK_KEY})`;

        if (!locked) {
          return; // Another instance is doing backfill
        }

        // Find open tickets without an SlaInstance
        const ticketsWithoutInstance = await tx.ticket.findMany({
          where: {
            completedAt: null,
            deletedAt: null,
            slaInstance: null,
          },
          select: { id: true },
          take: backfillBatchSize,
        });

        // Pass tx to syncFromTicket so all operations use the same connection.
        // Fail fast: any error aborts the transaction and releases the lock.
        for (const ticket of ticketsWithoutInstance) {
          await this.slaEngine.syncFromTicket(ticket.id, undefined, tx);
        }
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  private async handleInstance(
    tx: Prisma.TransactionClient,
    instance: {
      id: string;
      ticketId: string;
      policyConfigId: string | null;
      priority: TicketPriority;
      firstResponseDueAt: Date | null;
      resolutionDueAt: Date | null;
      pausedAt: Date | null;
      nextDueAt: Date | null;
      firstResponseAtRiskNotifiedAt: Date | null;
      resolutionAtRiskNotifiedAt: Date | null;
      firstResponseBreachedAt: Date | null;
      resolutionBreachedAt: Date | null;
      ticket: {
        id: string;
        number: number;
        displayId: string | null;
        subject: string;
        status: TicketStatus;
        priority: TicketPriority;
        assignedTeamId: string | null;
        assignedTeam: { name: string } | null;
        firstResponseAt: Date | null;
        completedAt: Date | null;
      };
    },
    now: Date,
    notificationIntents: NotificationIntent[],
    changedTicketIds: Set<string>,
  ) {
    const ticket = instance.ticket;

    if (instance.pausedAt) {
      await this.syncInstanceInTx(tx, instance, ticket);
      return;
    }

    const shouldBreachFirstResponse =
      !ticket.firstResponseAt &&
      !instance.firstResponseBreachedAt &&
      !!instance.firstResponseDueAt &&
      instance.firstResponseDueAt <= now;

    if (shouldBreachFirstResponse) {
      await this.handleBreach(
        tx,
        instance,
        ticket,
        'FIRST_RESPONSE',
        now,
        notificationIntents,
        changedTicketIds,
      );
      return;
    }

    const shouldBreachResolution =
      !ticket.completedAt &&
      !instance.resolutionBreachedAt &&
      !!instance.resolutionDueAt &&
      instance.resolutionDueAt <= now;

    if (shouldBreachResolution) {
      await this.handleBreach(
        tx,
        instance,
        ticket,
        'RESOLUTION',
        now,
        notificationIntents,
        changedTicketIds,
      );
      return;
    }

    const atRiskThresholdMs = this.atRiskThresholdMs();
    if (atRiskThresholdMs > 0) {
      const shouldNotifyFirstResponseAtRisk =
        !ticket.firstResponseAt &&
        !instance.firstResponseBreachedAt &&
        !instance.firstResponseAtRiskNotifiedAt &&
        !!instance.firstResponseDueAt &&
        instance.firstResponseDueAt > now &&
        instance.firstResponseDueAt.getTime() - now.getTime() <=
          atRiskThresholdMs;

      if (shouldNotifyFirstResponseAtRisk) {
        await this.handleAtRisk(
          tx,
          instance,
          ticket,
          'FIRST_RESPONSE',
          now,
          notificationIntents,
          changedTicketIds,
        );
        return;
      }

      const shouldNotifyResolutionAtRisk =
        !ticket.completedAt &&
        !instance.resolutionBreachedAt &&
        !instance.resolutionAtRiskNotifiedAt &&
        !!instance.resolutionDueAt &&
        instance.resolutionDueAt > now &&
        instance.resolutionDueAt.getTime() - now.getTime() <= atRiskThresholdMs;

      if (shouldNotifyResolutionAtRisk) {
        await this.handleAtRisk(
          tx,
          instance,
          ticket,
          'RESOLUTION',
          now,
          notificationIntents,
          changedTicketIds,
        );
        return;
      }
    }

    await this.syncInstanceInTx(tx, instance, ticket);
  }

  /**
   * Sync SlaInstance within a transaction (simplified version for breach worker)
   */
  private async syncInstanceInTx(
    tx: Prisma.TransactionClient,
    instance: {
      id: string;
      firstResponseBreachedAt: Date | null;
      resolutionBreachedAt: Date | null;
    },
    ticket: {
      id: string;
      priority: TicketPriority;
      firstResponseAt: Date | null;
      completedAt: Date | null;
    },
  ) {
    // Compute next due date based on current state
    const ticketData = await tx.ticket.findUnique({
      where: { id: ticket.id },
      select: {
        firstResponseDueAt: true,
        dueAt: true,
        slaPausedAt: true,
      },
    });

    if (!ticketData) return;

    let nextDueAt: Date | null = null;
    if (!ticketData.slaPausedAt) {
      const firstResponsePending =
        !ticket.firstResponseAt && !instance.firstResponseBreachedAt;
      if (firstResponsePending && ticketData.firstResponseDueAt) {
        nextDueAt = ticketData.firstResponseDueAt;
      } else {
        const resolutionPending =
          !ticket.completedAt && !instance.resolutionBreachedAt;
        if (resolutionPending && ticketData.dueAt) {
          nextDueAt = ticketData.dueAt;
        }
      }
    }

    await tx.slaInstance.update({
      where: { id: instance.id },
      data: {
        priority: ticket.priority,
        firstResponseDueAt: ticketData.firstResponseDueAt,
        resolutionDueAt: ticketData.dueAt,
        pausedAt: ticketData.slaPausedAt,
        nextDueAt,
      },
    });
  }

  private async handleBreach(
    tx: Prisma.TransactionClient,
    instance: {
      id: string;
      ticketId: string;
      policyConfigId: string | null;
      firstResponseDueAt: Date | null;
      resolutionDueAt: Date | null;
      firstResponseBreachedAt: Date | null;
      resolutionBreachedAt: Date | null;
      pausedAt: Date | null;
    },
    ticket: {
      id: string;
      number: number;
      displayId: string | null;
      subject: string;
      status: TicketStatus;
      priority: TicketPriority;
      assignedTeamId: string | null;
      assignedTeam: { name: string } | null;
    },
    breachType: BreachType,
    now: Date,
    notificationIntents: NotificationIntent[],
    changedTicketIds: Set<string>,
  ) {
    const nextDueAt =
      breachType === 'FIRST_RESPONSE' && !instance.resolutionBreachedAt
        ? (instance.resolutionDueAt ?? null)
        : null;

    const updateResult = await tx.slaInstance.updateMany({
      where:
        breachType === 'FIRST_RESPONSE'
          ? { id: instance.id, firstResponseBreachedAt: null }
          : { id: instance.id, resolutionBreachedAt: null },
      data:
        breachType === 'FIRST_RESPONSE'
          ? { firstResponseBreachedAt: now, nextDueAt }
          : { resolutionBreachedAt: now, nextDueAt: null },
    });

    if (updateResult.count === 0) {
      return;
    }
    // updateMany matched, so this tick is the one that changed the state - a
    // concurrent worker that got there first leaves count at 0 and returns
    // above, so this cannot double-publish.
    changedTicketIds.add(ticket.id);

    const dueAt =
      breachType === 'FIRST_RESPONSE'
        ? instance.firstResponseDueAt
        : instance.resolutionDueAt;

    await tx.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'SLA_BREACHED',
        payload: {
          breachType,
          dueAt: dueAt?.toISOString() ?? null,
          policyConfigId: instance.policyConfigId,
        },
        createdById: null,
      },
    });

    let priority = ticket.priority;
    const bumpedPriority = await this.applyPriorityBump(tx, ticket, breachType);
    if (bumpedPriority) {
      priority = bumpedPriority;
    }

    // Collect notification data inside transaction but don't send yet
    const leadUsers = await this.loadLeadUsers(tx, ticket.assignedTeamId);
    const onCallEmails = this.getOnCallEmails();

    if (leadUsers.length === 0 && onCallEmails.length === 0) {
      return;
    }

    const breachLabel =
      breachType === 'FIRST_RESPONSE' ? 'First response' : 'Resolution';

    const subject = `[Ticket ${this.ticketLabel(ticket)}] SLA Breach: ${breachLabel}`;
    const body = [
      `SLA breached: ${breachLabel}`,
      `Subject: ${ticket.subject}`,
      `Priority: ${priority}`,
      `Status: ${ticket.status}`,
      `Team: ${ticket.assignedTeam?.name ?? 'Unassigned'}`,
      `Due: ${dueAt?.toISOString() ?? 'Unknown'}`,
      bumpedPriority ? `Priority bumped to ${priority}.` : null,
      '',
      `View: ${this.ticketLink(ticket.id)}`,
    ]
      .filter(Boolean)
      .join('\n');

    const payload: Prisma.InputJsonValue = {
      breachType,
      dueAt: dueAt?.toISOString() ?? null,
      priority,
      policyConfigId: instance.policyConfigId,
    };

    // Queue notification intent to be dispatched after transaction commits
    notificationIntents.push({
      kind: 'BREACH',
      leadUsers,
      onCallEmails,
      subject,
      body,
      ticketSubject: ticket.subject,
      ticketId: ticket.id,
      payload,
    });
  }

  private async handleAtRisk(
    tx: Prisma.TransactionClient,
    instance: {
      id: string;
      ticketId: string;
      policyConfigId: string | null;
      firstResponseDueAt: Date | null;
      resolutionDueAt: Date | null;
      firstResponseAtRiskNotifiedAt: Date | null;
      resolutionAtRiskNotifiedAt: Date | null;
    },
    ticket: {
      id: string;
      number: number;
      displayId: string | null;
      subject: string;
      status: TicketStatus;
      priority: TicketPriority;
      assignedTeamId: string | null;
      assignedTeam: { name: string } | null;
    },
    breachType: BreachType,
    now: Date,
    notificationIntents: NotificationIntent[],
    changedTicketIds: Set<string>,
  ) {
    const dueAt =
      breachType === 'FIRST_RESPONSE'
        ? instance.firstResponseDueAt
        : instance.resolutionDueAt;

    if (!dueAt) {
      return;
    }

    const updateResult = await tx.slaInstance.updateMany({
      where:
        breachType === 'FIRST_RESPONSE'
          ? { id: instance.id, firstResponseAtRiskNotifiedAt: null }
          : { id: instance.id, resolutionAtRiskNotifiedAt: null },
      data:
        breachType === 'FIRST_RESPONSE'
          ? { firstResponseAtRiskNotifiedAt: now }
          : { resolutionAtRiskNotifiedAt: now },
    });

    if (updateResult.count === 0) {
      return;
    }
    // updateMany matched, so this tick is the one that changed the state - a
    // concurrent worker that got there first leaves count at 0 and returns
    // above, so this cannot double-publish.
    changedTicketIds.add(ticket.id);

    await tx.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'SLA_AT_RISK',
        payload: {
          breachType,
          dueAt: dueAt.toISOString(),
          policyConfigId: instance.policyConfigId,
        },
        createdById: null,
      },
    });

    const leadUsers = await this.loadLeadUsers(tx, ticket.assignedTeamId);
    const onCallEmails = this.getOnCallEmails();

    if (leadUsers.length === 0 && onCallEmails.length === 0) {
      return;
    }

    const breachLabel =
      breachType === 'FIRST_RESPONSE' ? 'First response' : 'Resolution';
    const timeRemaining = this.formatTimeRemaining(
      dueAt.getTime() - now.getTime(),
    );

    const subject = `[Ticket ${this.ticketLabel(ticket)}] SLA at risk: ${breachLabel}`;
    const body = [
      `SLA at risk: ${breachLabel}`,
      `Subject: ${ticket.subject}`,
      `Priority: ${ticket.priority}`,
      `Status: ${ticket.status}`,
      `Team: ${ticket.assignedTeam?.name ?? 'Unassigned'}`,
      `Due: ${dueAt.toISOString()}`,
      `Time remaining: ${timeRemaining}`,
      '',
      `View: ${this.ticketLink(ticket.id)}`,
    ].join('\n');

    const payload: Prisma.InputJsonValue = {
      breachType,
      dueAt: dueAt.toISOString(),
      priority: ticket.priority,
      policyConfigId: instance.policyConfigId,
    };

    notificationIntents.push({
      kind: 'AT_RISK',
      leadUsers,
      onCallEmails,
      subject,
      body,
      ticketSubject: ticket.subject,
      timeRemaining,
      ticketId: ticket.id,
      payload,
    });
  }

  /**
   * Dispatch a notification after the transaction has committed.
   * This prevents duplicate notifications if the transaction rolls back.
   */
  private async dispatchNotification(intent: NotificationIntent) {
    try {
      // NO EMAIL, for either kind (card 1.42). The owner overruled the
      // planner on this one explicitly: "I don't want any emails to agent or
      // lead, not even the breach email. We can all track that on the
      // platform." The planner's objection - that an alert reaching only
      // somebody already looking at the app is not an alert - is recorded in
      // the card and is NOT to be re-argued here. A breach is now seen when
      // somebody next opens the app, and card 1.16's digest covers the rest.
      //
      // It costs the metrics nothing: agent-performance, sla-compliance,
      // sla-breaches and reopen-rate all read timers and timestamps. The emails
      // were never the record.
      //
      // ⚠️ THE IN-APP ALERT BELOW IS THE WHOLE REMAINING SIGNAL. It used to sit
      // inside the same `if` as the send; keep it firing. If a later tidy-up
      // removes it as well, an SLA breach becomes invisible.
      if (intent.leadUsers.length > 0) {
        const leadIds = intent.leadUsers.map((user) => user.id);
        if (intent.kind === 'BREACH') {
          await this.inAppNotifications.notifySlaBreached(
            intent.ticketId,
            leadIds,
            intent.ticketSubject,
          );
        } else if (intent.timeRemaining) {
          await this.inAppNotifications.notifySlaAtRisk(
            intent.ticketId,
            leadIds,
            intent.ticketSubject,
            intent.timeRemaining,
          );
        }
      }

      // The on-call addresses are gone too. They are raw addresses rather
      // than users, so they LOOK like the automation escape hatch in §1b - but
      // they exist to page staff out of hours, which is the exact thing the
      // owner's decision removes. Flagged in the report: if the owner wants a
      // pager route back, this is the one place to restore it, and it belongs
      // to the digest card rather than here.
    } catch (error) {
      this.logger.error(
        'Failed to dispatch SLA notification',
        (error as Error).stack,
      );
    }
  }

  private async loadLeadUsers(
    tx: Prisma.TransactionClient,
    teamId: string | null,
  ): Promise<User[]> {
    if (!teamId) {
      return [];
    }

    const members = await tx.teamMember.findMany({
      where: { teamId, role: TeamRole.LEAD },
      include: { user: true },
    });

    return members
      .map((member) => member.user)
      .filter((user): user is User => user !== null && !!user.email);
  }

  private getOnCallEmails() {
    const raw =
      this.config.get<string>('SLA_ON_CALL_EMAILS') ??
      this.config.get<string>('SLA_ON_CALL_EMAIL') ??
      '';

    return raw
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean);
  }

  private atRiskThresholdMs() {
    if (this.config.get<string>('SLA_AT_RISK_ENABLED') === 'false') {
      return 0;
    }

    const minutes = Number(
      this.config.get<string>('SLA_AT_RISK_THRESHOLD_MINUTES') ?? '120',
    );

    if (!Number.isFinite(minutes) || minutes <= 0) {
      return 0;
    }

    return minutes * 60 * 1000;
  }

  private formatTimeRemaining(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) {
      return 'Less than 1 minute';
    }

    const totalMinutes = Math.max(1, Math.round(ms / 60000));
    const minutes = totalMinutes % 60;
    const totalHours = Math.floor(totalMinutes / 60);
    const hours = totalHours % 24;
    const days = Math.floor(totalHours / 24);

    const parts: string[] = [];
    if (days > 0) {
      parts.push(`${days}d`);
    }
    if (hours > 0) {
      parts.push(`${hours}h`);
    }
    if (minutes > 0 && days === 0) {
      parts.push(`${minutes}m`);
    }

    return parts.length > 0 ? parts.join(' ') : 'Less than 1 minute';
  }

  private async applyPriorityBump(
    tx: Prisma.TransactionClient,
    ticket: { id: string; priority: TicketPriority },
    breachType: BreachType,
  ) {
    if (this.config.get<string>('SLA_PRIORITY_BUMP_ENABLED') === 'false') {
      return null;
    }

    const nextPriority = this.nextPriority(ticket.priority);
    if (!nextPriority) {
      return null;
    }

    await tx.ticket.update({
      where: { id: ticket.id },
      data: { priority: nextPriority },
    });

    await tx.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'PRIORITY_BUMPED',
        payload: {
          from: ticket.priority,
          to: nextPriority,
          reason: breachType,
        },
        createdById: null,
      },
    });

    // Update SlaInstance priority inline (no need to call syncFromTicket since we're in tx)
    await tx.slaInstance.updateMany({
      where: { ticketId: ticket.id },
      data: { priority: nextPriority },
    });

    return nextPriority;
  }

  private nextPriority(priority: TicketPriority) {
    switch (priority) {
      case TicketPriority.SEV4:
        return TicketPriority.SEV3;
      case TicketPriority.SEV3:
        return TicketPriority.SEV2;
      case TicketPriority.SEV2:
        return TicketPriority.SEV1;
      default:
        return null;
    }
  }

  private ticketLabel(ticket: { displayId: string | null; number: number }) {
    return ticket.displayId ?? `#${ticket.number}`;
  }

  private ticketLink(ticketId: string) {
    const base = (
      this.config.get<string>('WEB_APP_URL') ?? 'http://localhost:5173'
    ).replace(/\/$/, '');
    return `${base}/tickets/${ticketId}`;
  }
}
