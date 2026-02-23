import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';
import { RealtimeService } from './realtime.service';

@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Get('negotiate')
  async negotiate(@CurrentUser() user: AuthUser) {
    return {
      data: await this.realtime.negotiateForUser(user),
    };
  }
}
