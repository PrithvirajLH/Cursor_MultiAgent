import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Public } from '../auth/public.decorator';
import { HealthService } from './health.service';
import type { ReadinessReport } from './readiness-report.type';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * GET /api/health/ready — integration inventory for operators and monitors.
   * Open unless HEALTH_READY_TOKEN is set, in which case x-health-token must match.
   *
   * ⚠️ CARD 1.69, STEP 3: DELIBERATELY STILL RATE LIMITED, unlike
   * `/api/health`. Three reasons, and they all point the same way. The platform
   * does not call this one — `healthCheckPath` is `/api/health` — so exempting
   * it would buy nothing. It does real work, reaching out to every configured
   * integration, so it is the more expensive of the two by a wide margin. And
   * it is `@Public()`, so nothing in this application authenticates it;
   * `HEALTH_READY_TOKEN` is optional and is not currently set in production. An
   * unlimited endpoint that fans out to every dependency is a free amplifier.
   * It stays limited.
   *
   * ⚠️ CARD 1.114 CORRECTS THE SENTENCE THAT USED TO BE HERE. It said this
   * was "reachable from outside by anyone who guesses the path", and the
   * 2026-09-13 audit said the same. Both overstate it. `/api/health/ready` is
   * NOT in the live Easy Auth `excludedPaths` list - verified 2026-09-14, which
   * holds only `/api/tickets/inbound-email`, `/api/tickets/intake`,
   * `/api/email-actions` and `/api/email-actions/*` - so Easy Auth already
   * refuses anonymous callers at the edge, before this code runs.
   *
   * The real exposure is ANY SIGNED-IN TENANT ACCOUNT, plus anything running
   * inside the container. That is much smaller than "open to the internet", and
   * it is worth being accurate about: an overstated finding is how F-052 came
   * to be re-raised twice.
   *
   * ⚠️ THE BODY IS DELIBERATELY NOT THINNED FOR AN UNAUTHENTICATED CALLER.
   * It carries STATES ONLY - 'configured', 'missing', 'degraded' - and never a
   * connection string, key or endpoint; `readiness-report.type.ts` says so and
   * `readiness-no-secrets.spec.ts` now holds it to that. Thinning it would
   * change the response for the only configuration that exists today, breaking
   * every monitor reading it, in exchange for hiding which integrations are
   * switched on from callers who are already signed in to the tenant.
   *
   * ⚠️ THE CHEAPEST CORRECT FIX IS TO SET `HEALTH_READY_TOKEN`, AND THAT IS
   * THE OWNER'S ACTION, NOT THIS CARD'S. The mechanism is already here and
   * already timing-safe; it needs a value, not code.
   */
  @Get('ready')
  @Public()
  async ready(
    @Headers('x-health-token') token: string | undefined,
  ): Promise<ReadinessReport> {
    this.assertToken(token);
    return this.health.readiness();
  }

  private assertToken(received: string | undefined): void {
    const expected = this.config.get<string>('HEALTH_READY_TOKEN')?.trim();
    if (!expected) {
      return;
    }
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(received ?? '', 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Invalid health token');
    }
  }
}
