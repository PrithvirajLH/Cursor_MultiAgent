import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as Throttler from '@nestjs/throttler';
import {
  THROTTLE_POLICY_KEY,
  type ThrottlePolicyName,
} from './throttle-policy.decorator';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_WEBHOOK_LIMIT = 30;
const DEFAULT_WEBHOOK_TTL_MS = 60_000;
const DEFAULT_HIGH_WRITE_LIMIT = 60;
const DEFAULT_HIGH_WRITE_TTL_MS = 60_000;

/**
 * Extends ThrottlerGuard to apply route-specific limits (webhook / highWrite) using ConfigService
 * at request time, so .env is already loaded and RATE_LIMIT_WEBHOOK_* / RATE_LIMIT_HIGH_WRITE_*
 * apply correctly (RL-01).
 */
@Injectable()
export class RouteThrottlerGuard extends Throttler.ThrottlerGuard {
  constructor(
    @Throttler.InjectThrottlerOptions()
    options: Throttler.ThrottlerModuleOptions,
    @Throttler.InjectThrottlerStorage()
    storageService: Throttler.ThrottlerStorage,
    protected readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.get<ThrottlePolicyName | undefined>(
      THROTTLE_POLICY_KEY,
      context.getHandler(),
    );
    if (policy === 'webhook' || policy === 'highWrite') {
      const limit = this.getPolicyLimit(policy);
      const ttl = this.getPolicyTtl(policy);
      const syntheticThrottler = {
        name: policy,
        limit,
        ttl,
        setHeaders: true,
      };
      return this.handleRequest({
        context,
        limit,
        ttl,
        throttler: syntheticThrottler,
        blockDuration: ttl,
        getTracker: this.commonOptions.getTracker!,
        generateKey: this.commonOptions.generateKey!.bind(this),
      });
    }
    return super.canActivate(context);
  }

  private getPolicyLimit(policy: ThrottlePolicyName): number {
    if (policy === 'webhook') {
      return parsePositiveInt(
        this.config.get<string>('RATE_LIMIT_WEBHOOK_LIMIT'),
        DEFAULT_WEBHOOK_LIMIT,
      );
    }
    return parsePositiveInt(
      this.config.get<string>('RATE_LIMIT_HIGH_WRITE_LIMIT'),
      DEFAULT_HIGH_WRITE_LIMIT,
    );
  }

  private getPolicyTtl(policy: ThrottlePolicyName): number {
    if (policy === 'webhook') {
      return parsePositiveInt(
        this.config.get<string>('RATE_LIMIT_WEBHOOK_TTL_MS'),
        DEFAULT_WEBHOOK_TTL_MS,
      );
    }
    return parsePositiveInt(
      this.config.get<string>('RATE_LIMIT_HIGH_WRITE_TTL_MS'),
      DEFAULT_HIGH_WRITE_TTL_MS,
    );
  }
}
