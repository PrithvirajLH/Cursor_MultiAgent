import { Module, forwardRef } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { CommonModule } from '../common/common.module';
import { BulkMacroController } from './bulk-macro.controller';
import { CannedResponsesController } from './canned-responses.controller';
import { CannedResponsesService } from './canned-responses.service';

/**
 * AutomationModule is imported for ONE thing: RuleEngineService's shared action
 * executor (card 1.7 §3). A macro deliberately reuses the rule engine's action
 * switch rather than keeping a second copy - a second copy is what produced the
 * faults cards 1.36 and 1.38 had to fix. forwardRef because AutomationModule
 * itself forward-references TicketsModule.
 */
@Module({
  imports: [CommonModule, forwardRef(() => AutomationModule)],
  controllers: [CannedResponsesController, BulkMacroController],
  providers: [CannedResponsesService],
  exports: [CannedResponsesService],
})
export class CannedResponsesModule {}
