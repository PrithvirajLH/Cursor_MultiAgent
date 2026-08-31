import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxStatus, Prisma, TicketStatus } from '@prisma/client';
import { parsePositiveInt } from '../common/config.utils';
import { PrismaService } from '../prisma/prisma.service';
import { TicketAttachmentService } from '../tickets/ticket-attachment.service';
import type { RetentionPolicy } from './retention-policy.type';
import type { RetentionRunSummary } from './retention-run-summary.type';

// Advisory lock key for the retention worker. SLA breach uses 847291/847292.
const RETENTION_LOCK_KEY = 847293;
const DAY_MS = 86_400_000;
const DEFAULT_INTERVAL_MS = 21_600_000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_SOFT_DELETED_DAYS = 30;
const DEFAULT_OUTBOX_SENT_DAYS = 180;
/** Audit event type written by every run; never purged by the job itself. */
const RETENTION_RUN_EVENT = 'RETENTION_RUN';

type PurgeOutcome = { summary: RetentionRunSummary; storageKeys: string[] };

/**
 * Periodic purge of data past its retention window. Two independent switches
 * must both be flipped before anything is destroyed: RETENTION_ENABLED starts
 * the job, RETENTION_DRY_RUN=false lets it delete. Every run writes one
 * RETENTION_RUN admin audit event with per-class counts.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private policy: RetentionPolicy;
  private lastRunAt: Date | null = null;
  private lastRunOk: boolean | null = null;
  private lastSummary: RetentionRunSummary | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly attachments: TicketAttachmentService,
  ) {
    this.policy = RetentionService.readPolicy(config);
  }

  /** Reads the RETENTION_* variables; unset class windows stay `null` (skipped). */
  static readPolicy(config: ConfigService): RetentionPolicy {
    return {
      enabled: config.get<string>('RETENTION_ENABLED') === 'true',
      dryRun: config.get<string>('RETENTION_DRY_RUN') !== 'false',
      intervalMs: parsePositiveInt(
        config.get<string>('RETENTION_INTERVAL_MS'),
        DEFAULT_INTERVAL_MS,
      ),
      batchSize: parsePositiveInt(
        config.get<string>('RETENTION_BATCH_SIZE'),
        DEFAULT_BATCH_SIZE,
      ),
      softDeletedDays: parsePositiveInt(
        config.get<string>('RETENTION_SOFT_DELETED_DAYS'),
        DEFAULT_SOFT_DELETED_DAYS,
      ),
      closedTicketDays: RetentionService.parseOptionalDays(
        config.get<string>('RETENTION_CLOSED_TICKET_DAYS'),
      ),
      adminAuditDays: RetentionService.parseOptionalDays(
        config.get<string>('RETENTION_ADMIN_AUDIT_DAYS'),
      ),
      outboxSentDays: parsePositiveInt(
        config.get<string>('RETENTION_OUTBOX_SENT_DAYS'),
        DEFAULT_OUTBOX_SENT_DAYS,
      ),
    };
  }

  /** Rows older than this instant are past the window. */
  static cutoff(days: number, now: Date = new Date()): Date {
    return new Date(now.getTime() - days * DAY_MS);
  }

  /** A window the owner has not set yet is `null`; zero/garbage also disables it. */
  private static parseOptionalDays(value: string | undefined): number | null {
    if (value === undefined || value.trim() === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  onModuleInit(): void {
    if (!this.policy.enabled) {
      this.logger.log('Retention job disabled (RETENTION_ENABLED is not true)');
      return;
    }
    this.logger.log(
      `Retention job enabled (dryRun=${this.policy.dryRun}, every ${this.policy.intervalMs} ms)`,
    );
    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        this.logger.error('Retention run failed', (error as Error).stack);
      });
    }, this.policy.intervalMs);
    this.runOnce().catch((error) => {
      this.logger.error('Retention run failed', (error as Error).stack);
    });
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Current effective policy (copy). */
  /**
   * Last-run state for the operations console (card 1.21). In memory only — a
   * restart clears it; persisting runs would need a table.
   */
  getRunState(): {
    lastRunAt: string | null;
    lastRunOk: boolean | null;
    lastSummary: RetentionRunSummary | null;
  } {
    return {
      lastRunAt: this.lastRunAt ? this.lastRunAt.toISOString() : null,
      lastRunOk: this.lastRunOk,
      lastSummary: this.lastSummary,
    };
  }

  getPolicy(): RetentionPolicy {
    return { ...this.policy };
  }

  /**
   * TEST ONLY. Overrides the env-derived policy for the integration suite so it
   * can exercise the non-dry-run path without a real environment. Never call
   * this from production code.
   */
  setPolicyForTests(overrides: Partial<RetentionPolicy>): void {
    this.policy = { ...this.policy, ...overrides };
  }

  /**
   * One retention tick. Returns null when another instance holds the lock or a
   * run is already in progress; otherwise the summary that was also written as
   * a RETENTION_RUN admin audit event. Public so tests and a future admin
   * endpoint can trigger it.
   */
  async runOnce(): Promise<RetentionRunSummary | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const outcome = await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = await tx.$queryRaw<
            [{ locked: boolean }]
          >`SELECT pg_try_advisory_xact_lock(${RETENTION_LOCK_KEY}) AS locked`;
          if (!locked) return null;
          return this.purgeInTx(tx);
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
      if (!outcome) return null;
      const { summary, storageKeys } = outcome;
      if (!this.policy.dryRun) {
        await this.deleteAttachmentFiles(storageKeys, summary);
      }
      await this.prisma.adminAuditEvent.create({
        data: {
          type: RETENTION_RUN_EVENT,
          payload: summary,
          actorEmail: 'system',
          actorName: 'Retention job',
        },
      });
      this.logger.log(JSON.stringify(summary));
      this.lastSummary = summary;
      this.lastRunOk = true;
      return summary;
    } catch (error) {
      this.lastRunOk = false;
      throw error;
    } finally {
      this.lastRunAt = new Date();
      this.running = false;
    }
  }

  private async purgeInTx(tx: Prisma.TransactionClient): Promise<PurgeOutcome> {
    const policy = this.policy;
    const summary: RetentionRunSummary = {
      ranAt: new Date().toISOString(),
      dryRun: policy.dryRun,
      softDeletedTicketsPurged: 0,
      closedTicketsPurged: 0,
      kbArticlesPurged: 0,
      adminAuditEventsPurged: 0,
      outboxRowsPurged: 0,
      attachmentFilesDeleted: 0,
      attachmentFileErrors: 0,
    };
    const storageKeys: string[] = [];
    summary.softDeletedTicketsPurged = await this.purgeTickets(
      tx,
      { deletedAt: { lt: RetentionService.cutoff(policy.softDeletedDays) } },
      storageKeys,
    );
    if (policy.closedTicketDays !== null) {
      summary.closedTicketsPurged = await this.purgeTickets(
        tx,
        {
          deletedAt: null,
          status: TicketStatus.CLOSED,
          closedAt: { lt: RetentionService.cutoff(policy.closedTicketDays) },
        },
        storageKeys,
      );
    }
    const kbWhere: Prisma.KbArticleWhereInput = {
      deletedAt: { lt: RetentionService.cutoff(policy.softDeletedDays) },
    };
    summary.kbArticlesPurged = policy.dryRun
      ? await tx.kbArticle.count({ where: kbWhere })
      : (await tx.kbArticle.deleteMany({ where: kbWhere })).count;
    if (policy.adminAuditDays !== null) {
      const auditWhere: Prisma.AdminAuditEventWhereInput = {
        createdAt: { lt: RetentionService.cutoff(policy.adminAuditDays) },
        type: { not: RETENTION_RUN_EVENT },
      };
      summary.adminAuditEventsPurged = policy.dryRun
        ? await tx.adminAuditEvent.count({ where: auditWhere })
        : (await tx.adminAuditEvent.deleteMany({ where: auditWhere })).count;
    }
    const outboxWhere: Prisma.NotificationOutboxWhereInput = {
      status: OutboxStatus.SENT,
      sentAt: { lt: RetentionService.cutoff(policy.outboxSentDays) },
    };
    summary.outboxRowsPurged = policy.dryRun
      ? await tx.notificationOutbox.count({ where: outboxWhere })
      : (await tx.notificationOutbox.deleteMany({ where: outboxWhere })).count;
    return { summary, storageKeys };
  }

  /** Deletes (or, in dry run, only counts) one batch of tickets; children cascade at the database. */
  private async purgeTickets(
    tx: Prisma.TransactionClient,
    where: Prisma.TicketWhereInput,
    storageKeys: string[],
  ): Promise<number> {
    const rows = await tx.ticket.findMany({
      where,
      select: { id: true, attachments: { select: { storageKey: true } } },
      take: this.policy.batchSize,
    });
    if (rows.length === 0) return 0;
    if (this.policy.dryRun) return rows.length;
    await tx.ticket.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    for (const row of rows) {
      for (const attachment of row.attachments) {
        storageKeys.push(attachment.storageKey);
      }
    }
    return rows.length;
  }

  /** Best-effort, after commit: a storage outage cannot roll back the purge. */
  private async deleteAttachmentFiles(
    storageKeys: string[],
    summary: RetentionRunSummary,
  ): Promise<void> {
    for (const key of storageKeys) {
      try {
        await this.attachments.deleteAttachmentFile(key);
        summary.attachmentFilesDeleted += 1;
      } catch {
        summary.attachmentFileErrors += 1;
      }
    }
  }
}
