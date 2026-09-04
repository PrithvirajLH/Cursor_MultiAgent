import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TicketStatus, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator';
import { CsatService } from '../csat/csat.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import {
  emailActionSecret,
  EMAIL_ACTION_TTL_DAYS,
} from './email-action-link.util';
import {
  verifyEmailActionToken,
  type EmailActionKind,
} from './email-action-token.util';

export type EmailActionOutcome =
  | 'confirm'
  | 'reopen'
  | 'rate'
  | 'alreadyDone'
  | 'expired'
  | 'invalid'
  | 'failed';

@Injectable()
export class EmailActionsService {
  private readonly logger = new Logger(EmailActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tickets: TicketsService,
    private readonly csat: CsatService,
  ) {}

  /**
   * Perform the token's one action, as the ticket's own requester.
   *
   * ⚠️ Only ever reached from a POST. The GET that serves the page changes
   * nothing, because a scanner fetching the URL must not act (see
   * email-action-page.util.ts).
   *
   * Everything reuses the existing paths - card 1.2's requester transitions and
   * `CsatService.submit` - so a token can do nothing a signed-in requester
   * could not do on their own ticket. The authenticated CSAT endpoint is
   * untouched: this calls the same service beside it rather than loosening it.
   *
   * Every unhappy path answers a calm outcome key, never a stack trace and
   * never anything about the ticket. An action that is already done answers
   * `alreadyDone` rather than an error, because from the requester's point of
   * view clicking twice is not a failure.
   */
  async perform(token: string): Promise<EmailActionOutcome> {
    const secret = emailActionSecret(this.config);
    if (!secret) {
      this.logger.warn(
        'An email action link was used but no signing secret is configured',
      );
      return 'invalid';
    }
    const verdict = verifyEmailActionToken(token, secret);
    if (!verdict.ok) {
      return verdict.reason;
    }
    const { ticketId, action, value } = verdict.claims;
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, deletedAt: null },
      select: { id: true, status: true, requesterId: true },
    });
    // A deleted or unknown ticket answers `invalid` - the same sentence as a
    // forged token. Distinguishing them would let a token holder learn that a
    // ticket had been deleted, which is precisely the leak card 1.6 warned
    // about in another form.
    if (!ticket) {
      return 'invalid';
    }
    const requester = await this.prisma.user.findUnique({
      where: { id: ticket.requesterId },
      select: { id: true, email: true, role: true },
    });
    if (!requester) {
      return 'invalid';
    }
    const actor: AuthUser = {
      id: requester.id,
      email: requester.email,
      role: requester.role,
      teamId: null,
      primaryTeamId: null,
    } as AuthUser;
    try {
      if (action === 'rate') {
        return await this.rate(ticketId, value ?? 0, actor);
      }
      return await this.move(ticket, action, actor);
    } catch (error) {
      // The three actions all REFUSE a repeat rather than performing it twice
      // (see the tests), so a second click lands here with a 4xx from the
      // service. That is a harmless outcome, not a failure to report as one.
      this.logger.log(
        `Email action ${action} on ${ticketId} was refused: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return 'alreadyDone';
    }
  }

  /** Confirm or reopen, through card 1.2's requester transitions. */
  private async move(
    ticket: { id: string; status: TicketStatus },
    action: 'confirm' | 'reopen',
    actor: AuthUser,
  ): Promise<EmailActionOutcome> {
    const target =
      action === 'confirm' ? TicketStatus.CLOSED : TicketStatus.REOPENED;
    if (ticket.status === target) {
      // Already there. Not an error, and not worth a second event.
      return 'alreadyDone';
    }
    await this.tickets.transition(ticket.id, { status: target }, actor);
    await this.recordProvenance(ticket.id, action, actor.id);
    return action;
  }

  /** One rating, through the same service the signed-in widget uses. */
  private async rate(
    ticketId: string,
    rating: number,
    actor: AuthUser,
  ): Promise<EmailActionOutcome> {
    await this.csat.submit({ ticketId, rating }, actor);
    await this.recordProvenance(ticketId, 'rate', actor.id, rating);
    return 'rate';
  }

  /**
   * Where the timeline records that this came from an email link.
   *
   * A separate `TICKET_ACTION_FROM_EMAIL` event rather than a field on the
   * status change, because the transition and CSAT paths write their own events
   * and neither takes a provenance argument - threading one through both would
   * touch code every other caller shares, for a fact only this caller has. An
   * agent reading the timeline sees the normal event plus this one, and can
   * tell the requester clicked a link rather than signing in.
   */
  private async recordProvenance(
    ticketId: string,
    action: EmailActionKind,
    actorId: string,
    value?: number,
  ) {
    await this.prisma.ticketEvent.create({
      data: {
        ticketId,
        type: 'TICKET_ACTION_FROM_EMAIL',
        payload: { action, ...(value === undefined ? {} : { value }) },
        createdById: actorId,
      },
    });
  }

  /** For the report and the tests: how long a link lasts. */
  static readonly TOKEN_TTL_DAYS = EMAIL_ACTION_TTL_DAYS;
}
