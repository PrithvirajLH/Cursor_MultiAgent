import { Module, forwardRef } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SlasModule } from '../slas/slas.module';
import { TagsModule } from '../tags/tags.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AutomationSchedulerService } from './automation-scheduler.service';
import { AutomationRulesController } from './automation.controller';
import { AutomationService } from './automation.service';
import { RuleEngineService } from './rule-engine.service';

@Module({
  imports: [
    RealtimeModule,
    TagsModule,
    NotificationsModule,
    forwardRef(() => SlasModule),
    forwardRef(() => TicketsModule),
  ],
  controllers: [AutomationRulesController],
  providers: [AutomationService, RuleEngineService, AutomationSchedulerService],
  exports: [RuleEngineService, AutomationSchedulerService],
})
export class AutomationModule {}
