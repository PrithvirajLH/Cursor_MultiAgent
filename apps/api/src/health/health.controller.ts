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
   * it is `@Public()`, which makes it reachable from outside by anyone who
   * guesses the path; `HEALTH_READY_TOKEN` is optional and is not currently set
   * in production. An unlimited, unauthenticated endpoint that fans out to
   * every dependency is a free amplifier. It stays limited.
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
