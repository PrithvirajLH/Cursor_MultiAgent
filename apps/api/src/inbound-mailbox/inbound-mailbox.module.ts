import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationsModule } from '../notifications/notifications.module';
import { TicketsModule } from '../tickets/tickets.module';
import { GraphMailClient } from './graph-mail.client';
import { GraphMailHttpClient } from './graph-mail.http-client';
import { InboundMailboxService } from './inbound-mailbox.service';

/**
 * The inbound mailbox worker (card 1.24).
 *
 * ⚠️ `GraphMailClient` is bound to the HTTP implementation HERE and nowhere
 * else. That single line is what lets every test swap in a fake without any
 * production code knowing, and it is why the card could be built before the
 * `Mail.ReadWrite` permission existed.
 */
@Module({
  imports: [ConfigModule, NotificationsModule, TicketsModule],
  providers: [
    InboundMailboxService,
    { provide: GraphMailClient, useClass: GraphMailHttpClient },
  ],
  exports: [InboundMailboxService],
})
export class InboundMailboxModule {}
