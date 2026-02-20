import { Global, Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AutomationModule } from '../automation/automation.module';
import { AccessControlService } from './access-control.service';
import { AutomationQueueService } from './automation-queue.service';

@Global()
@Module({
  imports: [ConfigModule, forwardRef(() => AutomationModule)],
  providers: [AccessControlService, AutomationQueueService],
  exports: [AccessControlService, AutomationQueueService],
})
export class CommonModule {}
