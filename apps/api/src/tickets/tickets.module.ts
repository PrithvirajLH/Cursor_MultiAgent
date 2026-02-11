import { Module, forwardRef } from '@nestjs/common';
import { AutomationModule } from '../automation/automation.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SlasModule } from '../slas/slas.module';
import { AttachmentsController } from './attachments.controller';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [forwardRef(() => AutomationModule), CustomFieldsModule, NotificationsModule, SlasModule],
  controllers: [TicketsController, AttachmentsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
