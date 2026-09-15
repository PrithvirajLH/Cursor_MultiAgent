import { Global, Module, forwardRef } from '@nestjs/common';
import { AutomationRunner } from '../common/automation-runner';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SlasModule } from '../slas/slas.module';
import { TagsModule } from '../tags/tags.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AutomationSchedulerService } from './automation-scheduler.service';
import { AutomationRulesController } from './automation.controller';
import { AutomationService } from './automation.service';
import { RuleEngineService } from './rule-engine.service';

/**
 * ⚠️ @Global BECAUSE IT PUBLISHES `AutomationRunner` TO A @Global CONSUMER
 * (card 1.103). `AutomationQueueService` lives in the @Global `CommonModule`,
 * so its dependencies must resolve without CommonModule importing anything -
 * importing this module back is exactly the cycle that stopped the app booting.
 * Marking this global lets the binding reach it with no import edge.
 */
@Global()
@Module({
  imports: [
    RealtimeModule,
    TagsModule,
    NotificationsModule,
    forwardRef(() => SlasModule),
    forwardRef(() => TicketsModule),
  ],
  controllers: [AutomationRulesController],
  providers: [
    AutomationService,
    RuleEngineService,
    AutomationSchedulerService,
    // One instance, two tokens: `common/` injects the abstraction, everything
    // else keeps injecting RuleEngineService directly.
    { provide: AutomationRunner, useExisting: RuleEngineService },
  ],
  exports: [RuleEngineService, AutomationSchedulerService, AutomationRunner],
})
export class AutomationModule {}
