import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AutomationModule } from '../automation/automation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HealthModule } from '../health/health.module';
import { InboundMailboxModule } from '../inbound-mailbox/inbound-mailbox.module';
import { RetentionModule } from '../retention/retention.module';
import { UsersModule } from '../users/users.module';
import { SlasModule } from '../slas/slas.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  imports: [
    ConfigModule,
    HealthModule,
    SlasModule,
    RetentionModule,
    // Card 2.2: the availability-return sweep is an operations job.
    UsersModule,
    AutomationModule,
    // For the email suppression list (card 1.23).
    NotificationsModule,
    // For the inbound mailbox worker's status and Run now (card 1.24).
    InboundMailboxModule,
  ],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
