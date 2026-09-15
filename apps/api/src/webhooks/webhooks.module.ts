import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WebhooksController } from './webhooks.controller';
import { WebhookSweeperService } from './webhook-sweeper.service';
import { WebhooksService } from './webhooks.service';

/**
 * Outbound webhooks (card 2.6).
 *
 * `@Global` so the services that emit events (tickets, messages) can inject
 * WebhooksService without each importing this module.
 */
@Global()
@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookSweeperService],
  exports: [WebhooksService, WebhookSweeperService],
})
export class WebhooksModule {}
