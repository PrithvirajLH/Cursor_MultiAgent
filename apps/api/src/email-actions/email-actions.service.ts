import { createHash } from 'crypto';
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
  | 'noLongerPossible'
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
    // ⚠️ CARD 1.100: SPEND THE TOKEN BEFORE ACTING, NOT AFTER.
    //
    // The token is a stateless HMAC, so nothing in it can record that it has
    // been used. Card 1.93 stopped a SCANNER acting; what remained was a person
    // replaying a link they still have. Closing a closed ticket is a no-op, but
    // submitting a satisfaction score repeatedly is not - CSAT is a number the
    // desk is judged on, and `rate` is the reason this card exists.
    //
    // The INSERT is the lock: `tokenHash` is unique, so two simultaneous clicks
    // race and exactly one wins. Claiming BEFORE performing is what makes that
    // true - claiming afterwards would let both do the work and only then
    // discover one was a duplicate.
    const claim = await this.claimToken(token, ticketId, action);
    if (!claim.won) {
      // ⚠️ A replay is not an error and must not read like one: the person did
      // nothing wrong, they pressed a link twice. They are shown the sentence
      // the first use produced. `alreadyDone` is the fallback for the narrow
      // window where the first use has claimed but not yet finished.
      return claim.outcome ?? 'alreadyDone';
    }
    const outcome =
      action === 'rate'
        ? await this.rate(ticketId, value ?? 0, actor)
        : await this.move(ticket, action, actor);
    await this.recordOutcome(claim.tokenHash, outcome);
    return outcome;
  }

  /** The stored form of a token. Never the token itself. */
  private hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  /**
   * Take ownership of this token, or discover somebody already has.
   *
   * ⚠️ ON CONFLICT DO NOTHING rather than a read-then-write: the read would
   * leave a window in which two clicks both see nothing and both act, which is
   * exactly the replay this card closes.
   */
  private async claimToken(
    token: string,
    ticketId: string,
    action: string,
  ): Promise<{ won: boolean; tokenHash: string; outcome?: EmailActionOutcome }> {
    const tokenHash = this.hashToken(token);
    try {
      await this.prisma.emailActionUse.create({
        data: { tokenHash, ticketId, action },
      });
      return { won: true, tokenHash };
    } catch {
      const existing = await this.prisma.emailActionUse.findUnique({
        where: { tokenHash },
        select: { outcome: true },
      });
      return {
        won: false,
        tokenHash,
        outcome: (existing?.outcome as EmailActionOutcome | null) ?? undefined,
      };
    }
  }

  /** Remember what the first use answered, so a replay can be shown it. */
  private async recordOutcome(
    tokenHash: string,
    outcome: EmailActionOutcome,
  ): Promise<void> {
    await this.prisma.emailActionUse
      .update({ where: { tokenHash }, data: { outcome } })
      .catch(() => undefined);
  }

  /**
   * Confirm or reopen, through card 1.2's requester transitions.
   *
   * ⚠️ Two different unhappy endings, and they must not be conflated.
   *
   *  - The ticket is ALREADY where the link would put it: a second click on the
   *    same link. `alreadyDone`, and nothing happens.
   *  - The move is no longer legal FROM WHERE THE TICKET IS NOW: reopen it, and
   *    then click "Yes, close it" in the same email. REOPENED -> CLOSED is not
   *    a move a requester may make, so it is refused. This used to answer
   *    "that is already done" while the ticket sat open - found by clicking the
   *    links in order during the browser pass, and not by any test, because
   *    every test clicked one link on a fresh ticket.
   */
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
    try {
      await this.tickets.transition(ticket.id, { status: target }, actor);
    } catch (error) {
      this.logger.log(
        `Email action ${action} on ${ticket.id} was refused from ${
          ticket.status
        }: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return 'noLongerPossible';
    }
    await this.recordProvenance(ticket.id, action, actor.id);
    return action;
  }

  /**
   * One rating, through the same service the signed-in widget uses.
   *
   * A second rating - by any route, including the signed-in widget - is refused
   * by CsatService, and that IS `alreadyDone`: the thing the link asked for has
   * happened, just not by this click.
   */
  private async rate(
    ticketId: string,
    rating: number,
    actor: AuthUser,
  ): Promise<EmailActionOutcome> {
    try {
      await this.csat.submit({ ticketId, rating }, actor);
    } catch (error) {
      this.logger.log(
        `Email rating on ${ticketId} was refused: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return 'alreadyDone';
    }
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
