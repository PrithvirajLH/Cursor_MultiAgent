import { Module, forwardRef } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { FoundryClientService } from './foundry-client.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { UserToolsService } from './tools/user-tools.service';
import { ClassificationToolsService } from './tools/classification-tools.service';
import { TicketToolsService } from './tools/ticket-tools.service';

@Module({
  imports: [forwardRef(() => TicketsModule)],
  controllers: [AiController],
  providers: [
    AiService,
    FoundryClientService,
    ToolRegistryService,
    UserToolsService,
    ClassificationToolsService,
    TicketToolsService,
  ],
  exports: [AiService],
})
export class AiModule {}
