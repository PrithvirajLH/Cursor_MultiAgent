import { Controller, Get } from '@nestjs/common';
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

  @Get('health')
  @Public()
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
