import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TicketPriority, TicketStatus, TeamRole, User } from '@prisma/client';
import { RuleEngineService } from '../automation/rule-engine.service';
import { InAppNotificationsService } from '../notifications/in-app-notifications.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SlaEngineService } from './sla-engine.service';

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
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private enabled = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly inAppNotifications: InAppNotificationsService,
    private readonly config: ConfigService,
    private readonly slaEngine: SlaEngineService,
    private readonly ruleEngine: RuleEngineService,
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
      this.checkBreaches().catch((error) => {
        console.error('SLA breach worker failed', error);
      });
    }, intervalMs);

    this.checkBreaches().catch((error) => {
      console.error('SLA breach worker failed', error);
    });
  }

  async onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async checkBreaches() {
    if (!this.enabled || this.running) {
      return;
    }

    this.running = true;
    try {
      // Run backfill separately with its own session-level lock.
      // If backfill fails, we still run breach processing so existing instances are checked.
      try {
        await this.runBackfillWithLock();
      } catch (backfillError) {
        console.error('SLA backfill failed', backfillError);
      }

      const now = new Date();
      const atRiskThresholdMs = this.atRiskThresholdMs();
      const windowEnd =
        atRiskThresholdMs > 0 ? new Date(now.getTime() + atRiskThresholdMs) : now;
      const batchSize = Number(
        this.config.get<string>('SLA_BREACH_BATCH_SIZE') ?? '100',
      );

      // Collect notification intents during transaction, dispatch after commit
      // This keeps the transaction short and prevents duplicate notifications on rollback
      const notificationIntents: NotificationIntent[] = [];

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

          const instances = await tx.slaInstance.findMany({
            where: { nextDueAt: { lte: windowEnd } },
            orderBy: { nextDueAt: 'asc' },
            take: batchSize,
            include: { ticket: { include: { assignedTeam: true } } },
          });

          for (const instance of instances) {
            await this.handleInstance(tx, instance, now, notificationIntents);
          }
        },
        { timeout: 60_000, maxWait: 10_000 },
      );

      // Dispatch notifications after transaction commits successfully
      // This prevents duplicate notifications if transaction rolls back
      for (const intent of notificationIntents) {
        await this.dispatchNotification(intent);
      }
      // Run automation rules for SLA breach / at-risk
      for (const intent of notificationIntents) {
        const trigger = intent.kind === 'BREACH' ? 'SLA_BREACHED' : 'SLA_APPROACHING';
        this.ruleEngine.runForTicket(intent.ticketId, trigger).catch((err) =>
          console.error(`Automation ${trigger} failed for ticket ${intent.ticketId}`, err),
        );
      }
    } finally {
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
      policyId: string | null;
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
      await this.handleBreach(tx, instance, ticket, 'FIRST_RESPONSE', now, notificationIntents);
      return;
    }

    const shouldBreachResolution =
      !ticket.completedAt &&
      !instance.resolutionBreachedAt &&
      !!instance.resolutionDueAt &&
      instance.resolutionDueAt <= now;

    if (shouldBreachResolution) {
      await this.handleBreach(tx, instance, ticket, 'RESOLUTION', now, notificationIntents);
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
        instance.firstResponseDueAt.getTime() - now.getTime() <= atRiskThresholdMs;

      if (shouldNotifyFirstResponseAtRisk) {
        await this.handleAtRisk(
          tx,
          instance,
          ticket,
          'FIRST_RESPONSE',
          now,
          notificationIntents,
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
      policyId: string | null;
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
  ) {
    const nextDueAt =
      breachType === 'FIRST_RESPONSE' && !instance.resolutionBreachedAt
        ? instance.resolutionDueAt ?? null
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
          policyId: instance.policyId,
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
      policyId: instance.policyId,
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
      policyId: string | null;
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

    await tx.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'SLA_AT_RISK',
        payload: {
          breachType,
          dueAt: dueAt.toISOString(),
          policyId: instance.policyId,
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
    const timeRemaining = this.formatTimeRemaining(dueAt.getTime() - now.getTime());

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
      policyId: instance.policyId,
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
      const eventType = intent.kind === 'BREACH' ? 'SLA_BREACHED' : 'SLA_AT_RISK';

      if (intent.leadUsers.length > 0) {
        await this.notifications.notifyUsers(intent.leadUsers, {
          eventType,
          subject: intent.subject,
          body: intent.body,
          ticketId: intent.ticketId,
          payload: intent.payload,
        });

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

      if (intent.onCallEmails.length > 0) {
        await this.notifications.notifyAddresses(intent.onCallEmails, {
          eventType,
          subject: intent.subject,
          body: intent.body,
          ticketId: intent.ticketId,
          payload: intent.payload,
        });
      }
    } catch (error) {
      console.error('Failed to dispatch SLA notification', error);
    }
  }

  private async loadLeadUsers(tx: Prisma.TransactionClient, teamId: string | null): Promise<User[]> {
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
      case TicketPriority.P4:
        return TicketPriority.P3;
      case TicketPriority.P3:
        return TicketPriority.P2;
      case TicketPriority.P2:
        return TicketPriority.P1;
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
