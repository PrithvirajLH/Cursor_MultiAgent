import { Module } from '@nestjs/common';
import { AgentsAdminController } from './agents-admin.controller';
import { AgentsAdminService } from './agents-admin.service';

@Module({
  controllers: [AgentsAdminController],
  providers: [AgentsAdminService],
})
export class AgentsAdminModule {}
