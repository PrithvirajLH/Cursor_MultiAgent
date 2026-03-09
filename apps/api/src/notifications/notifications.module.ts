import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RealtimeModule } from '../realtime/realtime.module';
import { EmailProcessorService } from './email-processor.service';
import { EmailQueueService } from './email-queue.service';
import { EmailService } from './email.service';
import { InAppNotificationsController } from './in-app-notifications.controller';
import { InAppNotificationsService } from './in-app-notifications.service';
import { NotificationsService } from './notifications.service';
import { OutboxService } from './outbox.service';
import { TicketEmailThreadService } from './ticket-email-thread.service';

@Module({
  imports: [ConfigModule, RealtimeModule],
  controllers: [InAppNotificationsController],
  providers: [
    NotificationsService,
    InAppNotificationsService,
    OutboxService,
    TicketEmailThreadService,
    EmailService,
    EmailProcessorService,
    EmailQueueService,
  ],
  exports: [
    NotificationsService,
    InAppNotificationsService,
    TicketEmailThreadService,
  ],
})
export class NotificationsModule {}
