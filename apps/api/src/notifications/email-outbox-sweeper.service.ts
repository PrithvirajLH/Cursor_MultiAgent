import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parsePositiveInt } from '../common/config.utils';
import { PrismaService } from '../prisma/prisma.service';
import { EmailProcessorService } from './email-processor.service';
import { OutboxService } from './outbox.service';

/**
 * Fresh advisory lock key. 847291 and 847292 are the SLA worker's, 847293 is
 * retention's and 847294 is the automation scheduler's.
 */
const SWEEP_LOCK_KEY = 847295;

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BATCH = 20;

/**
 * How long a row may sit in PROCESSING before we assume the process that
 * claimed it is gone. Comfortably longer than any real send, including the
 * 30-second request timeout plus a retry.
 */
const STALE_PROCESSING_MS = 10 * 60 * 1000;

export type EmailOutboxSweepSummary = {
  ranAt: string;
  ok: boolean;
  /** PROCESSING rows put back to PENDING. */
  reclaimed: number;
  /** PROCESSING rows that had no attempts left, so they went to FAILED. */
  exhausted: number;
  /** Rows handed to the processor this tick. */
  retried: number;
  /** Of those, how many the row itself now says were sent. */
  sent: number;
  /** Of those, how many ended terminally failed. */
  failed: number;
  /** Still pending after the attempt, so a later tick will try again. */
  stillPending: number;
};

/**
 * Drives the outbox retry ladder that nothing else drives.
 *
 * `EmailProcessorService.process()` has two callers: the BullMQ worker and one
 * inline call at queue time. Redis is off in production, so an email is
 * attempted exactly once, when it is queued — and `markFailed` faithfully puts
 * the row back to PENDING for a retry that never comes. The ladder was already
 * written; this is the thing that climbs it.
 *
 * Deliberately enabled by default. Retention ships off because its failure mode
 * is deleting data; this one's failure mode is losing mail, so silence is the
 * more expensive default. It is a no-op when nothing is pending.
 */
@Injectable()
export class EmailOutboxSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailOutboxSweeperService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private enabled = true;
  private intervalMs = DEFAULT_INTERVAL_MS;
  private batchSize = DEFAULT_BATCH;
  private lastRunAt: Date | null = null;
  private lastRunOk: boolean | null = null;
  private lastSummary: EmailOutboxSweepSummary | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly outbox: OutboxService,
    private readonly processor: EmailProcessorService,
  ) {}

  onModuleInit(): void {
    // Only the literal 'false' turns it off, matching the other workers.
    this.enabled =
      this.config.get<string>('EMAIL_OUTBOX_SWEEP_ENABLED') !== 'false';
    this.intervalMs = parsePositiveInt(
      this.config.get<string>('EMAIL_OUTBOX_SWEEP_INTERVAL_MS'),
      DEFAULT_INTERVAL_MS,
    );
    this.batchSize = parsePositiveInt(
      this.config.get<string>('EMAIL_OUTBOX_SWEEP_BATCH'),
      DEFAULT_BATCH,
    );
    if (!this.enabled) {
      this.logger.log(
        'Email outbox sweeper disabled (EMAIL_OUTBOX_SWEEP_ENABLED=false)',
      );
      return;
    }
    this.logger.log(
      `Email outbox sweeper enabled (every ${this.intervalMs} ms, batch ${this.batchSize})`,
    );
    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        this.logger.error(
          'Email outbox sweep failed',
          (error as Error).stack,
        );
      });
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getPolicy(): {
    enabled: boolean;
    intervalMs: number;
    batchSize: number;
  } {
    return {
      enabled: this.enabled,
      intervalMs: this.intervalMs,
      batchSize: this.batchSize,
    };
  }

  /** Last-run state for the operations console. In memory; a restart clears it. */
  getRunState(): {
    lastRunAt: string | null;
    lastRunOk: boolean | null;
    lastSummary: EmailOutboxSweepSummary | null;
  } {
    return {
      lastRunAt: this.lastRunAt ? this.lastRunAt.toISOString() : null,
      lastRunOk: this.lastRunOk,
      lastSummary: this.lastSummary,
    };
  }

  /**
   * One sweep. Returns null when another instance holds the lock or a run is
   * already in flight, which is information rather than a failure.
   */
  async runOnce(): Promise<EmailOutboxSweepSummary | null> {
    if (this.running) {
      return null;
    }
    this.running = true;
    try {
      const claim = await this.selectWork();
      if (claim === null) {
        return null;
      }
      for (const id of claim.ids) {
        // process() records its outcome on the row and rethrows. One bad
        // address must not end the sweep for everything queued behind it, so
        // the throw is swallowed here and the truth is read from the rows
        // afterwards.
        try {
          await this.processor.process(id);
        } catch (error) {
          this.logger.warn(
            `Outbox row ${id} failed on retry: ${(error as Error).message}`,
          );
        }
      }
      const outcome = await this.outbox.summariseOutcomes(claim.ids);
      const summary: EmailOutboxSweepSummary = {
        ranAt: new Date().toISOString(),
        ok: true,
        reclaimed: claim.reclaimed,
        exhausted: claim.exhausted,
        retried: claim.ids.length,
        sent: outcome.sent,
        failed: outcome.failed,
        stillPending: outcome.pending,
      };
      this.lastRunOk = true;
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
   * Take the lock, reclaim what was abandoned, and pick this tick's batch - all
   * in one transaction, so the lock is transaction-scoped and cannot leak.
   *
   * `pg_try_advisory_xact_lock` rather than a session lock on purpose: Prisma
   * pools connections, so a session lock taken on one connection and released
   * on another leaks forever. The other three workers use the transaction form
   * for the same reason.
   *
   * Both queries take `tx`, so they run on the connection that holds the lock
   * rather than borrowing a second one from the pool while a transaction is
   * open - which is how a small pool deadlocks.
   *
   * The delivery loop then runs OUTSIDE this transaction, which is safe because
   * the lock only serialises *selection*. `claimPending` flips PENDING to
   * PROCESSING in its own atomic updateMany, so even if two instances picked
   * the same row, only one can claim it and the other's process() returns
   * early. Holding a transaction open across twenty sends would be the worse
   * trade.
   */
  private async selectWork(): Promise<{
    ids: string[];
    reclaimed: number;
    exhausted: number;
  } | null> {
    return this.prisma.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw<[{ locked: boolean }]>`
        SELECT pg_try_advisory_xact_lock(${SWEEP_LOCK_KEY}) AS locked
      `;
      if (!locked) {
        return null;
      }
      const stale = await this.outbox.reclaimStaleProcessing(
        new Date(Date.now() - STALE_PROCESSING_MS),
        tx,
      );
      const ids = await this.outbox.listRetryablePending(this.batchSize, tx);
      return { ids, reclaimed: stale.reclaimed, exhausted: stale.exhausted };
    });
  }
}
