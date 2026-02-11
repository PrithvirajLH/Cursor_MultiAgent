import { Module, forwardRef } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SlaBreachService } from './sla-breach.service';
import { SlaEngineService } from './sla-engine.service';
import { SlasController } from './slas.controller';
import { SlasService } from './slas.service';

@Module({
  imports: [forwardRef(() => AutomationModule), PrismaModule, NotificationsModule],
  controllers: [SlasController],
  providers: [SlasService, SlaEngineService, SlaBreachService],
  exports: [SlaEngineService],
})
export class SlasModule {}
