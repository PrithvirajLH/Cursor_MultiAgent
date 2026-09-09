import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '../common/common.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { EmailProcessorService } from './email-processor.service';
import { EmailOutboxSweeperService } from './email-outbox-sweeper.service';
import { EmailQueueService } from './email-queue.service';
import { EmailSuppressionService } from './email-suppression.service';
import { EmailService } from './email.service';
import { InAppNotificationsController } from './in-app-notifications.controller';
import { InAppNotificationsService } from './in-app-notifications.service';
import { LeadDigestService } from './lead-digest.service';
import { NotificationsService } from './notifications.service';
import { OutboxService } from './outbox.service';
import { TicketEmailThreadService } from './ticket-email-thread.service';

@Module({
  imports: [ConfigModule, RealtimeModule, CommonModule],
  controllers: [InAppNotificationsController],
  providers: [
    NotificationsService,
    InAppNotificationsService,
    OutboxService,
    TicketEmailThreadService,
    EmailService,
    EmailProcessorService,
    EmailQueueService,
    EmailSuppressionService,
    EmailOutboxSweeperService,
    LeadDigestService,
  ],
  exports: [
    NotificationsService,
    InAppNotificationsService,
    TicketEmailThreadService,
    EmailService,
    EmailQueueService,
    EmailSuppressionService,
    EmailOutboxSweeperService,
    // Readiness and the operations console both read outbox depth (card 1.32).
    OutboxService,
    // The operations console runs and inspects the digest (cards 1.16, 1.21).
    LeadDigestService,
  ],
})
export class NotificationsModule {}
