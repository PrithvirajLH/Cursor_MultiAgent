import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** What one sweep did, for the operations console. */
export type AvailabilityReturnSummary = {
  returned: number;
  ranAt: string;
};

const DEFAULT_INTERVAL_MS = 15 * 60_000;

/**
 * Brings people back from leave when their `awayUntil` has passed (card 2.2).
 *
 * ⚠️ THIS JOB IS COSMETIC, AND THAT IS THE DESIGN RATHER THAN AN OVERSIGHT.
 * `availableUserFilter` already treats a past `awayUntil` as back, so somebody
 * whose return date has passed receives auto-assigned work whether or not this
 * has run. Making correctness depend on a worker is how a person stays
 * invisible for a week because a queue was wedged — a shape this repo has met
 * before, and the reason card 1.47 exists.
 *
 * What it does is settle the STORED flag so the screen agrees with the
 * behaviour: an avatar menu still reading "away" while tickets arrive is its
 * own kind of wrong.
 *
 * Runs on an interval rather than a cron because that is what every other job
 * here does (retention, the outbox sweeper, the automation scheduler) and
 * because the exact minute does not matter — the filter has already handled the
 * moment of return.
 */
@Injectable()
export class AvailabilityReturnService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AvailabilityReturnService.name);
  private timer: NodeJS.Timeout | null = null;
  private lastSummary: AvailabilityReturnSummary | null = null;
  private lastError: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const intervalMs = DEFAULT_INTERVAL_MS;
    this.logger.log(`Availability return job enabled (every ${intervalMs} ms)`);
    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        this.logger.error(
          'Availability return sweep failed',
          (error as Error).stack,
        );
      });
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Last-run state for the operations console (card 1.21). In memory only. */
  getWorkerState(): {
    lastSummary: AvailabilityReturnSummary | null;
    lastError: string | null;
  } {
    return { lastSummary: this.lastSummary, lastError: this.lastError };
  }

  /**
   * Flip everyone whose absence has ended back to available.
   *
   * `awayUntil` is cleared at the same time, so the row does not keep a date
   * that has stopped meaning anything — and so a second sweep does not report
   * the same people as returned again.
   */
  async runOnce(): Promise<AvailabilityReturnSummary> {
    const now = new Date();
    try {
      const result = await this.prisma.user.updateMany({
        where: { isAvailable: false, awayUntil: { not: null, lte: now } },
        data: { isAvailable: true, awayUntil: null },
      });
      this.lastSummary = {
        returned: result.count,
        ranAt: now.toISOString(),
      };
      this.lastError = null;
      if (result.count > 0) {
        this.logger.log(`Returned ${result.count} user(s) from leave`);
      }
      return this.lastSummary;
    } catch (error) {
      this.lastError = (error as Error).message;
      throw error;
    }
  }
}
