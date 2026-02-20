import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { RuleEngineService } from '../automation/rule-engine.service';

type AutomationJobData = { ticketId: string; trigger: string };

const QUEUE_NAME = 'automation-tasks';

/**
 * BullMQ-based queue for automation rule execution.
 * Replaces fire-and-forget `.catch()` patterns with durable retries
 * and structured error tracking.
 *
 * When Redis is unavailable the service falls back to inline execution
 * so the application keeps working without a queue.
 */
@Injectable()
export class AutomationQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationQueueService.name);
  private queue: Queue<AutomationJobData> | null = null;
  private worker: Worker<AutomationJobData> | null = null;
  private connection: IORedis | null = null;
  private enabled = true;

  constructor(
    private readonly config: ConfigService,
    @Inject(forwardRef(() => RuleEngineService))
    private readonly ruleEngine: RuleEngineService,
  ) {}

  onModuleInit() {
    this.enabled =
      this.config.get<string>('AUTOMATION_QUEUE_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.log('Automation queue disabled – running inline');
      return;
    }

    const redisUrl = this.config.get<string>('REDIS_URL');
    const host = this.config.get<string>('REDIS_HOST') ?? '127.0.0.1';
    const port = Number(this.config.get<string>('REDIS_PORT') ?? '6379');
    const password = this.config.get<string>('REDIS_PASSWORD');

    try {
      this.connection = redisUrl
        ? new IORedis(redisUrl, {
            maxRetriesPerRequest: null,
            retryStrategy: (times) => this.retryStrategy(times),
          })
        : new IORedis({
            host,
            port,
            password,
            maxRetriesPerRequest: null,
            retryStrategy: (times) => this.retryStrategy(times),
          });

      // Handle async connection errors without crashing the process
      this.connection.on('error', (err) => {
        if (!this.enabled) return; // already fell back
        this.logger.warn(
          `Redis connection error (automation queue): ${err.message}`,
        );
      });

      this.connection.on('end', () => {
        if (this.enabled) {
          this.logger.warn(
            'Redis connection closed – automation queue falling back to inline',
          );
          this.fallbackToInline();
        }
      });

      this.queue = new Queue(QUEUE_NAME, { connection: this.connection });

      this.worker = new Worker(
        QUEUE_NAME,
        async (job) => {
          this.logger.log(
            `Processing automation: ${job.data.trigger} for ticket ${job.data.ticketId} (attempt ${job.attemptsMade + 1})`,
          );
          await this.ruleEngine.runForTicket(
            job.data.ticketId,
            job.data.trigger as Parameters<
              RuleEngineService['runForTicket']
            >[1],
          );
        },
        { connection: this.connection, concurrency: 5 },
      );

      this.worker.on('failed', (job, error) => {
        this.logger.error(
          `Automation job failed [${job?.data?.trigger}] ticket=${job?.data?.ticketId}: ${error.message}`,
          error.stack,
        );
      });

      this.worker.on('completed', (job) => {
        this.logger.debug(
          `Automation completed: ${job.data.trigger} for ticket ${job.data.ticketId}`,
        );
      });

      this.logger.log('Automation queue initialized');
    } catch (err) {
      this.logger.warn(
        `Failed to initialize automation queue, falling back to inline execution: ${(err as Error).message}`,
      );
      this.fallbackToInline();
    }
  }

  /**
   * Enqueue an automation trigger for background processing with retry.
   * Falls back to inline execution if the queue is not available.
   */
  async enqueue(ticketId: string, trigger: string): Promise<void> {
    if (!this.enabled || !this.queue) {
      // Fallback: run inline with proper error handling
      try {
        await this.ruleEngine.runForTicket(
          ticketId,
          trigger as Parameters<RuleEngineService['runForTicket']>[1],
        );
      } catch (err) {
        this.logger.error(
          `Automation ${trigger} failed inline for ticket ${ticketId}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
      return;
    }

    await this.queue.add(
      trigger,
      { ticketId, trigger },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    if (
      this.connection?.status === 'ready' ||
      this.connection?.status === 'connecting'
    ) {
      await this.connection.quit().catch(() => {});
    }
  }

  /** Limit reconnection attempts to avoid flooding logs when Redis is down. */
  private retryStrategy(times: number): number | null {
    if (times > 5) {
      this.logger.warn(
        `Redis unreachable after ${times} attempts – automation queue falling back to inline`,
      );
      this.fallbackToInline();
      return null; // stop retrying
    }
    return Math.min(times * 500, 5_000); // exponential back-off capped at 5s
  }

  private fallbackToInline() {
    this.enabled = false;
    this.queue = null;
    this.worker = null;
  }
}
