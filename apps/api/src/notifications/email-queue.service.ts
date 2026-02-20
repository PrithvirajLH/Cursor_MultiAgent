import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { EmailProcessorService } from './email-processor.service';

const QUEUE_NAME = 'notification-email';

@Injectable()
export class EmailQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailQueueService.name);
  private queue: Queue<{ outboxId: string }> | null = null;
  private worker: Worker<{ outboxId: string }> | null = null;
  private connection: IORedis | null = null;
  private enabled = true;

  constructor(
    private readonly config: ConfigService,
    private readonly processor: EmailProcessorService,
  ) {}

  onModuleInit() {
    this.enabled =
      this.config.get<string>('NOTIFICATIONS_QUEUE_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.log('Email queue disabled – processing inline');
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

      this.connection.on('error', (err) => {
        if (!this.enabled) return;
        this.logger.warn(
          `Redis connection error (email queue): ${err.message}`,
        );
      });

      this.connection.on('end', () => {
        if (this.enabled) {
          this.logger.warn(
            'Redis connection closed – email queue falling back to inline',
          );
          this.fallbackToInline();
        }
      });

      this.queue = new Queue(QUEUE_NAME, { connection: this.connection });
      this.worker = new Worker(
        QUEUE_NAME,
        async (job) => {
          await this.processor.process(job.data.outboxId);
        },
        { connection: this.connection, concurrency: 4 },
      );

      this.worker.on('failed', (job, error) => {
        this.logger.error(
          `Email job failed [${job?.id}]: ${error.message}`,
          error.stack,
        );
      });

      this.logger.log('Email queue initialized');
    } catch (err) {
      this.logger.warn(
        `Failed to initialize email queue, falling back to inline: ${(err as Error).message}`,
      );
      this.fallbackToInline();
    }
  }

  async enqueue(outboxId: string) {
    if (!this.enabled || !this.queue) {
      await this.processor.process(outboxId);
      return;
    }

    await this.queue.add(
      'send',
      { outboxId },
      { attempts: 5, backoff: { type: 'exponential', delay: 10000 } },
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
        `Redis unreachable after ${times} attempts – email queue falling back to inline`,
      );
      this.fallbackToInline();
      return null; // stop retrying
    }
    return Math.min(times * 500, 5_000);
  }

  private fallbackToInline() {
    this.enabled = false;
    this.queue = null;
    this.worker = null;
  }
}
