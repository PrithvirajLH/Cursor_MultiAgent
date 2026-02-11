import { Module, forwardRef } from '@nestjs/common';
import { SlasModule } from '../slas/slas.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AutomationRulesController } from './automation.controller';
import { AutomationService } from './automation.service';
import { RuleEngineService } from './rule-engine.service';

@Module({
  imports: [forwardRef(() => SlasModule), forwardRef(() => TicketsModule)],
  controllers: [AutomationRulesController],
  providers: [AutomationService, RuleEngineService],
  exports: [RuleEngineService],
})
export class AutomationModule {}
