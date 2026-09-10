import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './auth/public.decorator';

@Controller()
export class AppController {
  @Get()
  @Public()
  getRoot() {
    return {
      message: 'Codex Ticketing API',
      health: '/api/health',
      docs: 'See README or /api/health for availability.',
    };
  }

  /**
   * The App Service health probe, and the ONLY route the platform calls on its
   * own — `siteConfig.healthCheckPath` is `/api/health`, confirmed by reading
   * the live app on 2026-09-10.
   *
   * ⚠️ CARD 1.69, STEP 3. It was spending from the same rate-limit bucket as
   * real users at roughly one request a minute. In a quiet window that was
   * essentially all the traffic, and it can never be the caller you want to
   * refuse: a 429 here reads to Azure as an unhealthy instance and takes the
   * site out to fix a problem that does not exist.
   *
   * Exempt is safe specifically because this handler touches nothing — no
   * database, no integration, a constant and a timestamp. See
   * HealthController.ready for the one that is deliberately still limited.
   */
  @Get('health')
  @Public()
  @SkipThrottle()
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
