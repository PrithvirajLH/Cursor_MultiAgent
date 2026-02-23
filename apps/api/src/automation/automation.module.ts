import { Module, forwardRef } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { SlasModule } from '../slas/slas.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AutomationRulesController } from './automation.controller';
import { AutomationService } from './automation.service';
import { RuleEngineService } from './rule-engine.service';

@Module({
  imports: [
    RealtimeModule,
    forwardRef(() => SlasModule),
    forwardRef(() => TicketsModule),
  ],
  controllers: [AutomationRulesController],
  providers: [AutomationService, RuleEngineService],
  exports: [RuleEngineService],
})
export class AutomationModule {}
