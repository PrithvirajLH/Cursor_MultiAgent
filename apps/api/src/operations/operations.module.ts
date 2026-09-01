import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AutomationModule } from '../automation/automation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HealthModule } from '../health/health.module';
import { RetentionModule } from '../retention/retention.module';
import { SlasModule } from '../slas/slas.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  imports: [
    ConfigModule,
    HealthModule,
    SlasModule,
    RetentionModule,
    AutomationModule,
    // For the email suppression list (card 1.23).
    NotificationsModule,
  ],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
