import { Global, Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AutomationModule } from '../automation/automation.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessControlService } from './access-control.service';
import { AiObservabilityService } from './ai-observability.service';
import { AutomationQueueService } from './automation-queue.service';
import { IdempotencyService } from './idempotency.service';

@Global()
@Module({
  imports: [ConfigModule, PrismaModule, forwardRef(() => AutomationModule)],
  providers: [
    AccessControlService,
    AiObservabilityService,
    AutomationQueueService,
    IdempotencyService,
  ],
  exports: [
    AccessControlService,
    AiObservabilityService,
    AutomationQueueService,
    IdempotencyService,
  ],
})
export class CommonModule {}
