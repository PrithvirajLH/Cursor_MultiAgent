import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from '../ai/ai.module';
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
  // ⚠️ `AiModule` IS LAST, AND CARD 1.63 CHECKED FOR A CYCLE BEFORE ADDING IT.
  // `AiModule` imports `forwardRef(() => TicketsModule)` and `KbModule`, and
  // nothing in that subtree reaches back here - only `app.module.ts` and
  // `operations` import this module. Card 1.103 spent a batch breaking a cycle
  // that began exactly like this edge, so `app.module.boot.spec.ts` compiling
  // the graph is the check that matters.
  imports: [ConfigModule, NotificationsModule, TicketsModule, AiModule],
  providers: [
    InboundMailboxService,
    { provide: GraphMailClient, useClass: GraphMailHttpClient },
  ],
  exports: [InboundMailboxService],
})
export class InboundMailboxModule {}
