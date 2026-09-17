import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { AccessControlService } from './access-control.service';
import { AiObservabilityService } from './ai-observability.service';
import { AttachmentStorageService } from './attachment-storage.service';
import { AutomationQueueService } from './automation-queue.service';
import { DuplicateAccountService } from './duplicate-account.service';
import { IdempotencyService } from './idempotency.service';
import { InlineEmailImagesService } from './inline-email-images.service';
import { UserIdentityService } from './user-identity.service';

@Global()
@Module({
  // ⚠️ CARD 1.103: `common` NO LONGER IMPORTS `automation`, AND MUST NOT AGAIN.
  // This read `forwardRef(() => AutomationModule)`, which made a @Global
  // low-level module depend on a feature module and closed the cycle
  // common -> automation -> notifications -> common. `AutomationQueueService`
  // now injects `AutomationRunner`, declared here and bound by AutomationModule.
  imports: [ConfigModule, PrismaModule],
  providers: [
    AccessControlService,
    AiObservabilityService,
    AttachmentStorageService,
    AutomationQueueService,
    DuplicateAccountService,
    IdempotencyService,
    InlineEmailImagesService,
    UserIdentityService,
  ],
  exports: [
    AccessControlService,
    AiObservabilityService,
    AttachmentStorageService,
    AutomationQueueService,
    DuplicateAccountService,
    IdempotencyService,
    InlineEmailImagesService,
    UserIdentityService,
  ],
})
export class CommonModule {}
