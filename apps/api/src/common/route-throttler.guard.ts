import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as Throttler from '@nestjs/throttler';
import {
  THROTTLE_POLICY_KEY,
  type ThrottlePolicyName,
} from './throttle-policy.decorator';

import { parsePositiveInt } from './config.utils';
import {
  resolveThrottleTracker,
  type ThrottleTrackerSource,
} from './throttle-tracker.util';

const DEFAULT_WEBHOOK_LIMIT = 30;
const DEFAULT_WEBHOOK_TTL_MS = 60_000;
const DEFAULT_HIGH_WRITE_LIMIT = 60;
const DEFAULT_HIGH_WRITE_TTL_MS = 60_000;

/**
 * Extends ThrottlerGuard to apply route-specific limits (webhook / highWrite) using ConfigService
 * at request time, so .env is already loaded and RATE_LIMIT_WEBHOOK_* / RATE_LIMIT_HIGH_WRITE_*
 * apply correctly (RL-01).
 *
 * ⚠️ CARD 1.69 ALSO MADE THIS THE PLACE THE TRACKER LIVES, and the
 * choice is load-bearing rather than stylistic. The handoff said to add
 * `getTracker` to the `ThrottlerModule` config; read against the library, that
 * would have fixed HALF the routes and looked complete.
 *
 * `app.module.ts` passes an ARRAY of throttler definitions, so
 * `ThrottlerGuard.onModuleInit` takes its `Array.isArray` branch: it sets
 * `commonOptions = {}` and then fills `commonOptions.getTracker` with
 * `this.getTracker.bind(this)` (throttler.guard.js:45-58). Two consequences:
 *
 * 1. A `getTracker` on the array element is read as `namedThrottler.getTracker`
 *    by the DEFAULT path (`:85`) - but the webhook / highWrite path below reads
 *    `this.commonOptions.getTracker`, which is still the guard's own method. So
 *    the intake webhook and every high-write route would have kept keying on
 *    `req.ip`, i.e. one bucket for everyone, on exactly the write paths most
 *    worth limiting per-caller.
 * 2. Overriding the METHOD fixes both, because `onModuleInit` binds whatever
 *    `this.getTracker` resolves to - which, on a subclass, is the override.
 *
 * One override, both paths, no module-config change.
 */
@Injectable()
export class RouteThrottlerGuard extends Throttler.ThrottlerGuard {
  private readonly logger = new Logger(RouteThrottlerGuard.name);
  private readonly seenTrackerSources = new Set<ThrottleTrackerSource>();

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
        // ⚠️ CARD 1.69: both of these were `!` non-null assertions. The
        // handoff calls them assertions on something never set; that is not
        // quite it - `onModuleInit` fills both from the guard's own bound
        // methods, so both were true. They were still worth removing: an
        // assertion that holds only because of a line in a dependency's
        // lifecycle hook is one library upgrade away from a TypeError on the
        // intake webhook. These fallbacks resolve to the same two functions
        // that hook would have bound, so behaviour is identical and nothing is
        // asserted.
        getTracker:
          this.commonOptions.getTracker ?? ((req) => this.getTracker(req)),
        generateKey:
          this.commonOptions.generateKey ??
          ((ctx, tracker, name) => this.generateKey(ctx, tracker, name)),
      });
    }
    return super.canActivate(context);
  }

  /**
   * The rate-limit bucket for this request.
   *
   * Replaces the library default of `req.ip`, which behind the App Service
   * ingress is a single bucket for the entire application - card 1.69's
   * outage: 288 requests refused with 429 in one day, every one of them
   * `/api/tickets`.
   *
   * ⚠️ the signature takes `req` only, matching the base class.
   * `handleRequest` passes a context too, and widening the parameter list here
   * would break assignability to `ThrottlerGetTrackerFunction`. Nothing here
   * needs it.
   */
  override async getTracker(req: Record<string, unknown>): Promise<string> {
    const tracker = resolveThrottleTracker(req, {
      allowInsecureHeaders: this.allowInsecureHeaders(),
    });
    this.noteTrackerSource(tracker.source);
    return tracker.key;
  }

  /**
   * Mirrors `AuthGuard.shouldAllowInsecureHeaders()`, including reading
   * `process.env` first so a permissive value is never cached at boot.
   *
   * ⚠️ deliberately duplicated rather than shared. Importing AuthGuard
   * here would make the throttler depend on the auth module it runs before, and
   * the one thing worse than two copies of this predicate is a DI cycle in a
   * global guard. If the copies ever diverge the tracker falls back to a lower
   * tier - conservative, and visible in the log line below.
   */
  private allowInsecureHeaders(): boolean {
    const configured =
      process.env.AUTH_ALLOW_INSECURE_HEADERS ??
      this.config.get<string>('AUTH_ALLOW_INSECURE_HEADERS');
    if (configured !== 'true') {
      return false;
    }
    const nodeEnv = (
      this.config.get<string>('NODE_ENV') ??
      process.env.NODE_ENV ??
      ''
    ).toLowerCase();
    return nodeEnv !== 'production';
  }

  /**
   * Log each tracker tier the first time it is used, and never again.
   *
   * The point is answerable diagnosis: if this ever logs `ip` in production for
   * authenticated traffic, the fix has silently degraded to the behaviour it
   * replaced, and nothing else in the system would say so. Once per source per
   * process, because this is on the hot path for every request.
   *
   * ⚠️ the SOURCE only, never the key. Card 1.54: this log ships to
   * Kudu, and the key contains a user id or a token subject.
   */
  private noteTrackerSource(source: ThrottleTrackerSource): void {
    if (this.seenTrackerSources.has(source)) {
      return;
    }
    this.seenTrackerSources.add(source);
    this.logger.log(`Rate-limit bucket keyed on: ${source}`);
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
