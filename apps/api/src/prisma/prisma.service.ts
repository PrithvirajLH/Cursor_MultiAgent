import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly dbConnectMaxRetries = this.parseIntegerEnv(
    process.env.DB_CONNECT_MAX_RETRIES,
    8,
    { min: 0 },
  );
  private readonly dbConnectInitialDelayMs = this.parseIntegerEnv(
    process.env.DB_CONNECT_INITIAL_DELAY_MS,
    500,
    { min: 1 },
  );
  private readonly dbConnectMaxDelayMs = this.parseIntegerEnv(
    process.env.DB_CONNECT_MAX_DELAY_MS,
    10_000,
    { min: 1 },
  );

  constructor() {
    const logQueries = process.env.PRISMA_LOG_QUERIES === 'true';
    super({
      log: logQueries ? [{ emit: 'event', level: 'query' }] : [],
    });

    if (logQueries) {
      const slowThreshold = Number(process.env.PRISMA_SLOW_QUERY_MS ?? '200');
      const maxQueryLength = Number(process.env.PRISMA_QUERY_MAX_LEN ?? '200');
      this.$on('query', (event: Prisma.QueryEvent) => {
        if (event.duration < slowThreshold) return;
        const query =
          event.query.length > maxQueryLength
            ? `${event.query.slice(0, maxQueryLength)}…`
            : event.query;
        this.logger.warn(
          `Slow query: ${event.duration}ms ${event.target} :: ${query}`,
        );
      });
    }
  }

  async onModuleInit() {
    const maxAttempts = this.dbConnectMaxRetries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        if (attempt > 1) {
          this.logger.log(`Connected to database after ${attempt} attempt(s).`);
        }
        return;
      } catch (error) {
        if (attempt >= maxAttempts) {
          this.logger.error(
            `Database connection failed after ${maxAttempts} attempt(s).`,
            error instanceof Error ? error.stack : String(error),
          );
          throw error;
        }

        const delayMs = this.computeBackoffDelayMs(attempt);
        this.logger.warn(
          `Database connection attempt ${attempt}/${maxAttempts} failed. Retrying in ${delayMs}ms...`,
        );
        await this.sleep(delayMs);
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private computeBackoffDelayMs(attempt: number): number {
    const exponential = this.dbConnectInitialDelayMs * 2 ** (attempt - 1);
    return Math.min(exponential, this.dbConnectMaxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private parseIntegerEnv(
    raw: string | undefined,
    fallback: number,
    opts: { min?: number; max?: number } = {},
  ): number {
    const value = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(value)) return fallback;

    const min = opts.min ?? Number.MIN_SAFE_INTEGER;
    const max = opts.max ?? Number.MAX_SAFE_INTEGER;
    if (value < min || value > max) return fallback;
    return value;
  }
}
