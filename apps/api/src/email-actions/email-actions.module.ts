import { Module, forwardRef } from '@nestjs/common';
import { CsatModule } from '../csat/csat.module';
import { TicketsModule } from '../tickets/tickets.module';
import { EmailActionsController } from './email-actions.controller';
import { EmailActionsService } from './email-actions.service';

/**
 * Card 1.44. Both imports are for reuse rather than convenience: the actions a
 * link performs are card 1.2's requester transitions and the same
 * `CsatService.submit` the signed-in widget calls, so a token can do nothing a
 * requester could not do themselves.
 *
 * `forwardRef` on both because NotificationsModule - which this service is
 * injected into, to build the links - already sits inside TicketsModule's
 * dependency graph.
 */
@Module({
  imports: [forwardRef(() => TicketsModule), CsatModule],
  controllers: [EmailActionsController],
  providers: [EmailActionsService],
  exports: [EmailActionsService],
})
export class EmailActionsModule {}
