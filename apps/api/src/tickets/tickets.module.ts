import { Module } from '@nestjs/common';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SlasModule } from '../slas/slas.module';
import { AttachmentsController } from './attachments.controller';
import { InboundEmailService } from './inbound-email.service';
import { TicketAttachmentService } from './ticket-attachment.service';
import { TicketRealtimeService } from './ticket-realtime.service';
import { TicketSlaCalculationService } from './ticket-sla-calculation.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [
    CustomFieldsModule,
    NotificationsModule,
    RealtimeModule,
    SlasModule,
  ],
  controllers: [TicketsController, AttachmentsController],
  providers: [
    TicketsService,
    TicketAttachmentService,
    TicketRealtimeService,
    TicketSlaCalculationService,
    InboundEmailService,
  ],
  exports: [TicketsService],
})
export class TicketsModule { }
