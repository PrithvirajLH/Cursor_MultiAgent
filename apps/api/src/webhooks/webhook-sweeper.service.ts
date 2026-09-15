import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parsePositiveInt } from '../common/config.utils';
import { WebhooksService } from './webhooks.service';

/** Matches the email sweeper's cadence; production has no Redis, so this polls. */
const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Delivers queued webhooks (card 2.6).
 *
 * ⚠️ MODELLED ON `EmailOutboxSweeperService` DELIBERATELY, down to the env flag
 * and the interval, because the rows it delivers live in the same table and go
 * through the same claim/retry/dead-letter code. Two schedulers with different
 * shapes over one table is how the two halves drift apart.
 *
 * Off by default in tests, where a timer that fires mid-suite is noise.
 */
@Injectable()
export class WebhookSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookSweeperService.name);
  private timer: NodeJS.Timeout | null = null;
  private enabled = false;
  private intervalMs = DEFAULT_INTERVAL_MS;

  constructor(
    private readonly config: ConfigService,
    private readonly webhooks: WebhooksService,
  ) {}

  onModuleInit(): void {
    this.enabled =
      this.config.get<string>('WEBHOOK_SWEEP_ENABLED') === 'true' ||
      (this.config.get<string>('NODE_ENV') !== 'test' &&
        this.config.get<string>('WEBHOOK_SWEEP_ENABLED') !== 'false');
    this.intervalMs = parsePositiveInt(
      this.config.get<string>('WEBHOOK_SWEEP_INTERVAL_MS'),
      DEFAULT_INTERVAL_MS,
    );
    if (!this.enabled) {
      this.logger.log('Webhook sweeper disabled');
      return;
    }
    this.logger.log(`Webhook sweeper enabled (every ${this.intervalMs} ms)`);
    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        this.logger.error('Webhook sweep failed', (error as Error).stack);
      });
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One pass. Exposed so a test or an operator can drive it directly. */
  async runOnce(): Promise<{ attempted: number; sent: number; failed: number }> {
    return this.webhooks.deliverPending();
  }
}
