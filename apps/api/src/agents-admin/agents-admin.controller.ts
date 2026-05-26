import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AgentsAdminService } from './agents-admin.service';

@Controller('admin/agents')
export class AgentsAdminController {
  constructor(private readonly agentsService: AgentsAdminService) {}

  @Get()
  async list(@CurrentUser() actor: AuthUser) {
    return this.agentsService.list(actor);
  }

  @Get(':id')
  async getProfile(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.agentsService.getProfile(id, actor);
  }
}
