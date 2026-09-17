import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageType, Prisma, TicketStatus, UserRole } from '@prisma/client';
import type { TicketMessage, User } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import {
  buildResolvedEmailLinks as buildLinks,
  type ResolvedEmailLinks,
} from '../email-actions/email-action-link.util';
import { PrismaService } from '../prisma/prisma.service';
import { ticketLink } from './ticket-link.util';
import { EmailQueueService } from './email-queue.service';
import { EmailSuppressionService } from './email-suppression.service';
import { resolveOutboundRecipients } from './outbound-recipients.util';
import { renderMessageBodyEmailHtml } from './message-body-email-html.util';
import { inlineAttachmentIds } from '../tickets/inline-attachment-ids.util';
import { messageBodyToEmailText } from './message-body-email-text.util';
import { messageBodyToPreheaderText } from './message-body-preheader-text.util';
import { isStaffRole } from './is-staff-role.util';
import { canManageOtherFollowers } from '../common/can-manage-followers.util';
import type { MessageRecipientsPreview } from './message-recipients-preview.type';
import { InAppNotificationsService } from './in-app-notifications.service';
import {
  type EmailOutboxContent,
  type EmailOutboxMetadata,
  OutboxService,
} from './outbox.service';
import { TicketEmailThreadService } from './ticket-email-thread.service';

/** Roughly what an inbox preview shows before it truncates anyway. */
const PREHEADER_MAX_LENGTH = 90;

/**
 * NOTE ON THE TIMESTAMP. The design shows `SEP 2, 10:02` with no zone, which
 * means the reader's local time - and there is no timezone configuration
 * anywhere in this repo to derive that from. Guessing one would put visibly
 * wrong times in a requester's inbox, so the zone is stated instead. Give the
 * organisation a display-timezone setting and this becomes `SEP 2, 10:02`.
 */

type RecipientOptions = {
  includeRequester?: boolean;
  includeAssignee?: boolean;
  includeFollowers?: boolean;
  excludeUserId?: string;
  excludeEmployees?: boolean;
};

type QueuedEmailDetails = {
  subject: string;
  body: string;
  /**
   * The hidden inbox-preview line (card 1.34, applied by 1.42).
   *
   * Explicit rather than derived, because the first line of the body is often
   * the least useful thing to preview - "We have marked your request as
   * resolved" tells the reader nothing they cannot see in the subject, whereas
   * "tell us if it is fixed, or reopen it" is why they should open it. Falls
   * back to the body when a caller has nothing better to say.
   */
  preheader?: string;
  eventType: string;
  ticketId?: string;
  /** Card 2.12: what the link in the email says. Falls back to the UUID. */
  ticketDisplayId?: string | null;
  payload?: Prisma.InputJsonValue;
  emailMetadata?: EmailOutboxMetadata;
  emailContent?: EmailOutboxContent;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly emailQueue: EmailQueueService,
    private readonly config: ConfigService,
    private readonly inAppNotifications: InAppNotificationsService,
    private readonly ticketEmailThreads: TicketEmailThreadService,
    private readonly emailSuppression: EmailSuppressionService,
  ) {}

  /**
   * A new ticket: ONE email, to the requester, and a bell for the team.
   *
   * Card 1.42. The assignee-and-followers email is gone - staff read the app.
   * What replaced it is `notifyTeamOfNewTicket` below, and that had to be built
   * before this email could be cut: until this card `ticketCreated` queued email
   * and never touched InAppNotificationsService at all, so the deleted email was
   * the ONLY signal that work had arrived.
   *
   * `suppressEmail` is for the inbound path, which sends its own and better
   * acknowledgement (§3 - otherwise one emailed-in request produces two emails
   * back). It suppresses THE EMAIL ONLY and the bell still fires: §3 says
   * "suppress the created-email", and suppressing the whole call would have
   * silenced the team notification on exactly the tickets nobody is watching a
   * queue for.
   */
  async ticketCreated(
    ticket: { id: string },
    actor: AuthUser,
    options?: { suppressEmail?: boolean },
  ) {
    const fullTicket = await this.loadTicket(ticket.id);
    if (!fullTicket) {
      return;
    }
    await this.notifyTeamOfNewTicket(fullTicket, actor);
    if (options?.suppressEmail) {
      return;
    }
    const requester = fullTicket.requester;
    if (!requester?.email) {
      return;
    }
    // ⚠️ THE ACTOR IS NOT EXCLUDED HERE, and that is a deliberate change.
    //
    // The old code built this audience with `excludeUserId: actor.id`, and on
    // the portal the requester IS the actor - so the "ticket created ->
    // requester" email that §1 keeps had in practice almost never fired. It
    // reached the assignee and followers, who are exactly the staff this card
    // removes. Keeping the exclusion would have left a survivor that only
    // sends when staff raise a ticket on somebody's behalf.
    //
    // So a requester now gets an acknowledgement for a portal ticket, the same
    // courtesy the inbound path already gave for an emailed one. That is a NEW
    // email in practice rather than a preserved one; flagged in the report,
    // and one line to reverse if the owner would rather it stayed silent.
    const emailContext = await this.buildTicketEmailContext(fullTicket);
    const reference = this.ticketLabel(fullTicket);
    // No raw status or priority enum, and no team name: a requester does not
    // need our internal routing, and card 1.42 forbids the enum outright. The
    // old body led with "A new ticket has been created", which is what the
    // subject line already said.
    const body = [
      'We have logged your request and the team will pick it up.',
      '',
      `Your reference is ${reference}.`,
    ].join('\n');
    await this.queueEmails([requester], {
      eventType: 'TICKET_CREATED',
      subject: emailContext.subject,
      body,
      preheader: `Logged as ${reference}. We will be in touch.`,
      ticketId: fullTicket.id,
      ticketDisplayId: fullTicket.displayId,
      // The payload is the outbox audit row, never shown to a recipient, so the
      // enums stay here where reporting can still read them.
      payload: {
        priority: fullTicket.priority,
        status: fullTicket.status,
      },
      emailMetadata: emailContext.emailMetadata,
    });
  }

  /**
   * Tell the assigned team that a new ticket landed (card 1.42 §2a).
   *
   * `buildRecipients` cannot answer this and that is why it is a separate
   * query: it offers requester / assignee / followers and has NO notion of a
   * team, while a brand-new ticket usually has no assignee and no followers at
   * all - so the existing options would have notified nobody. The team roster
   * (TeamMember) is the lookup.
   *
   * The roster is staff by construction, so this cannot show a ticket to
   * somebody outside the team. With no team at all - an unrouted intake ticket -
   * it deliberately tells NOBODY rather than everybody; that ticket is found in
   * the unassigned queue, and waking the whole organisation is worse.
   *
   * ⚠️ The requester is excluded EXPLICITLY, not merely via the actor. §2a
   * assumed `excludeUserId` covered it - it does not. An agent raising a ticket
   * on behalf of a colleague who happens to sit on the assigned team would
   * otherwise send that colleague a "new ticket" bell for their own request.
   */
  private async notifyTeamOfNewTicket(
    ticket: {
      id: string;
      subject: string;
      requesterId: string;
      assigneeId: string | null;
      assignedTeamId: string | null;
      assignedTeam?: { name: string } | null;
    },
    actor: AuthUser,
  ) {
    const ids = new Set<string>();
    if (ticket.assigneeId) {
      ids.add(ticket.assigneeId);
    }
    if (ticket.assignedTeamId) {
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: ticket.assignedTeamId },
        select: { userId: true },
      });
      for (const member of members) {
        ids.add(member.userId);
      }
    }
    ids.delete(ticket.requesterId);
    const recipientIds = Array.from(ids);
    if (recipientIds.length === 0) {
      return;
    }
    await this.inAppNotifications
      .notifyTicketCreated(
        ticket.id,
        recipientIds,
        actor.id,
        ticket.subject,
        ticket.assignedTeam?.name ?? null,
      )
      .catch((error) =>
        this.logger.error(
          'Failed to create new-ticket notification',
          (error as Error).stack,
        ),
      );
  }

  /**
   * Teams whose outbound mail stays anonymous, by slug.
   *
   * The owner named HR and Payroll because of termination work, but that is a
   * policy that will change and should not need a deploy - so it is config,
   * read at send time. The rule is expressed by simply NOT putting the name on
   * the payload: `buildFromIdentity` then returns the generic identity by
   * itself, so there is one decision in one place and the formatter stays dumb.
   */
  private genericIdentityTeamSlugs(): Set<string> {
    const raw =
      this.config.get<string>('EMAIL_GENERIC_IDENTITY_TEAMS') ?? 'hr,payroll';
    return new Set(
      raw
        .split(',')
        .map((slug) => slug.trim().toLowerCase())
        .filter((slug) => slug !== ''),
    );
  }

  /** The name to sign a reply with, or null when this team stays anonymous. */
  private agentDisplayNameFor(
    teamSlug: string | null | undefined,
    actor: AuthUser,
  ): string | null {
    if (teamSlug && this.genericIdentityTeamSlugs().has(teamSlug.toLowerCase())) {
      return null;
    }
    const name = (actor.displayName || actor.email || '').trim();
    return name === '' ? null : name;
  }

  async messageAdded(
    ticketId: string,
    message: TicketMessage,
    actor: AuthUser,
  ) {
    const fullTicket = await this.loadTicket(ticketId);
    if (!fullTicket) {
      return;
    }

    const isInternal = message.type === MessageType.INTERNAL;
    const agentDisplayName = this.agentDisplayNameFor(
      fullTicket.assignedTeam?.slug,
      actor,
    );
    // TWO audiences, and they are deliberately different (card 1.42 §1c).
    // Everyone on the ticket gets the bell; only the people outside the system
    // get an email.
    const recipients = this.buildRecipients(
      fullTicket,
      this.messageAudienceOptions(actor.id, isInternal),
    );
    const emailRecipients = this.emailAudience(fullTicket, actor.id);

    // An INTERNAL note sends no email, to anybody (card 1.33 section 4.0b).
    // Staff see it in the ticket conversation and get the in-app notification
    // raised below, which already has a realtime push and a poll fallback;
    // email added nothing and cost a great deal - it moved the thread pointer,
    // so a requester's next email referenced a note they were never sent.
    // There is deliberately no subject or body built for it here: dead code
    // that still compiles is how a future card re-enables this by accident.
    // Card 1.22's refusal stays in place as defence in depth.
    if (!isInternal) {
      await this.queuePublicReplyEmail(
        fullTicket,
        emailRecipients,
        message,
        actor,
        agentDisplayName,
      );
    }

    // Create in-app notifications
    const recipientIds = recipients.map((r) => r.id);
    await this.inAppNotifications
      .notifyNewMessage(
        fullTicket.id,
        recipientIds,
        actor.id,
        fullTicket.subject,
        isInternal,
      )
      .catch((error) =>
        this.logger.error(
          'Failed to create in-app notification',
          (error as Error).stack,
        ),
      );
  }

  async notifyMentioned(
    ticketId: string,
    mentionedUserIds: string[],
    actorId: string,
    ticketSubject: string,
  ) {
    await this.inAppNotifications
      .notifyMentioned(ticketId, mentionedUserIds, actorId, ticketSubject)
      .catch((error) =>
        this.logger.error(
          'Failed to create mention notification',
          (error as Error).stack,
        ),
      );
  }

  async ticketAssigned(ticket: { id: string }, actor: AuthUser) {
    const fullTicket = await this.loadTicket(ticket.id);
    if (!fullTicket) {
      return;
    }

    // NO EMAIL (card 1.42). Assignment concerns the assignee and the followers,
    // who are staff, and staff read the app. The in-app notification below is
    // what tells them, and it already existed - which is why this deletion was
    // safe and the created-email's was not.
    //
    // Nothing is composed here on purpose. A subject and body left behind for a
    // send that no longer happens is how a later card re-enables this by
    // accident; the same reasoning as the internal-note comment above.

    // Create in-app notification for assignee
    if (fullTicket.assigneeId) {
      await this.inAppNotifications
        .notifyTicketAssigned(
          fullTicket.id,
          fullTicket.assigneeId,
          actor.id,
          fullTicket.subject,
        )
        .catch((error) =>
          this.logger.error(
            'Failed to create in-app notification',
            (error as Error).stack,
          ),
        );
    }
  }

  async ticketTransferred(
    ticket: { id: string },
    actor: AuthUser,
    priorTeamId: string | null,
  ) {
    const fullTicket = await this.loadTicket(ticket.id);
    if (!fullTicket) {
      return;
    }

    const recipients = this.buildRecipients(fullTicket, {
      includeRequester: true,
      includeAssignee: true,
      includeFollowers: true,
      excludeUserId: actor.id,
    });

    // NO EMAIL (card 1.42). A transfer is an internal routing decision; the
    // requester does not need to know which team holds their ticket, and the
    // teams involved read the app. `recipients` survives because the in-app
    // notification below still goes to the whole ticket audience.

    // Create in-app notifications
    const recipientIds = recipients.map((r) => r.id);
    await this.inAppNotifications
      .notifyTicketTransferred(
        fullTicket.id,
        recipientIds,
        actor.id,
        fullTicket.subject,
        fullTicket.assignedTeam?.name ?? 'Unassigned',
      )
      .catch((error) =>
        this.logger.error(
          'Failed to create in-app notification',
          (error as Error).stack,
        ),
      );
  }

  async ticketStatusChanged(
    ticket: { id: string; status: TicketStatus },
    previousStatus: TicketStatus,
    actor: AuthUser,
  ) {
    const fullTicket = await this.loadTicket(ticket.id);
    if (!fullTicket) {
      return;
    }

    const recipients = this.buildRecipients(fullTicket, {
      includeRequester: true,
      includeAssignee: true,
      includeFollowers: true,
      excludeUserId: actor.id,
    });

    // ONE status change sends email, and only to the requester (card 1.42).
    //
    // Every other transition sent one before this card - to the requester, the
    // assignee and every follower - and none of them needed it. WAITING_ON_VENDOR
    // is a note to ourselves; ASSIGNED and IN_PROGRESS are visible in the queue.
    // The old body also leaked the raw enum ("Status changed from NEW to
    // WAITING_ON_REQUESTER") to the person being waited on.
    //
    // RESOLVED survives because it asks the requester for something: confirm,
    // reopen, or rate it. The links only pre-open a dialog in the portal; the
    // API still authorises.
    if (fullTicket.status === TicketStatus.RESOLVED) {
      await this.queueResolvedEmail(fullTicket, previousStatus, actor);
    }

    // Create in-app notifications for resolved tickets
    if (
      fullTicket.status === TicketStatus.RESOLVED ||
      fullTicket.status === TicketStatus.CLOSED
    ) {
      const recipientIds = recipients.map((r) => r.id);
      await this.inAppNotifications
        .notifyTicketResolved(
          fullTicket.id,
          recipientIds,
          actor.id,
          fullTicket.subject,
        )
        .catch((error) =>
          this.logger.error(
            'Failed to create in-app notification',
            (error as Error).stack,
          ),
        );
    }
  }

  /**
   * The one status email a requester still receives - and card 1.14 folded in.
   *
   * It has its own body rather than going through the default builder because
   * it asks three things at once. `buildHtmlContentBlocks` escapes the body
   * text, so a URL written into it renders as unclickable characters; three
   * real anchors matter too much here to accept that.
   *
   * ⚠️ The rating is a LINK to the ticket, where card 1.14's widget already
   * lives - NOT a one-click star in the email. A public rating endpoint would be
   * an unauthenticated write whose only authorisation is a token sitting in a
   * forwardable email, which is precisely the hazard card 1.40 exists to
   * prevent. Sign-in is SSO on a managed device, so the link costs the requester
   * very little. If response rates turn out poor that is a later decision with a
   * proper design, not a shortcut taken here.
   */
  private async queueResolvedEmail(
    ticket: {
      id: string;
      displayId: string | null;
      number: number;
      subject: string;
      requester?: User | null;
    },
    previousStatus: TicketStatus,
    actor: AuthUser,
  ) {
    const requester = ticket.requester;
    if (!requester?.email || requester.id === actor.id) {
      return;
    }
    const emailContext = await this.buildTicketEmailContext(ticket);
    // Card 1.44. Null when no signing secret is configured, and the email then
    // carries no action links at all rather than links that would answer
    // "this link is not valid" when clicked.
    //
    // ⚠️ This comment used to say it "falls back to the plain view online
    // link". Card 1.68 removed that link, so there is no fallback now - the
    // email is simply shorter. Corrected rather than left describing a link
    // that no longer exists.
    const links = this.buildResolvedEmailLinks(ticket.id);
    await this.queueEmails([requester], {
      eventType: 'TICKET_STATUS_CHANGED',
      subject: emailContext.subject,
      body: this.buildResolvedTextBody(ticket.id, links),
      // What matters is the ask, not the fact. "Resolved" is already in the
      // subject; whether they need to do something about it is not.
      preheader: 'Tell us if this is fixed, or reopen it.',
      ticketId: ticket.id,
      ticketDisplayId: ticket.displayId,
      payload: {
        from: previousStatus,
        to: TicketStatus.RESOLVED,
      },
      emailMetadata: emailContext.emailMetadata,
      emailContent: { html: this.buildResolvedHtmlBody(ticket.id, links) },
    });
  }

  /**
   * The seven one-click links for the resolved email (card 1.44).
   *
   * All seven or none: if signing is not configured, the email keeps its shape
   * without them rather than offering links that cannot work.
   */
  private buildResolvedEmailLinks(ticketId: string): ResolvedEmailLinks {
    // A pure util over ConfigService rather than an injected service, and
    // deliberately: EmailActionsModule imports TicketsModule, which imports
    // this module, so injecting it here would close a cycle for the sake of
    // one function that needs nothing but three config keys.
    return buildLinks(this.config, ticketId);
  }

  /**
   * The plain-text half of the resolved email, mirroring the HTML exactly.
   *
   * Every link is a full URL on its own labelled line - a plain-text reader
   * cannot click a word, and a URL split across two lines does not work.
   */
  private buildResolvedTextBody(ticketId: string, links: ResolvedEmailLinks) {
    const lines = ['We have marked your request as resolved.', ''];
    if (links.confirm && links.reopen) {
      lines.push(
        `Is it fixed? Close it: ${links.confirm}`,
        `Not fixed? Reopen it: ${links.reopen}`,
        '',
      );
    }
    if (links.ratings.length > 0) {
      lines.push('How did we do? 1 is poor, 5 is great:');
      links.ratings.forEach((url, index) => {
        lines.push(`  ${index + 1} of 5: ${url}`);
      });
      lines.push('');
    }
    // trimEnd because each block above pushes a trailing '' to separate
    // itself from the footer that used to follow. With the footer gone
    // (card 1.68) that blank became the last thing in the body, which a
    // mail client shows as an empty line a reader takes for truncation.
    return lines.join('\n').trimEnd();
  }

  /**
   * Card 1.34's shape: hidden preheader, content first, no hero button, no
   * sign-off, and no raw status enum anywhere - the word "resolved" in a
   * sentence, never `RESOLVED` in a details block.
   */
  private buildResolvedHtmlBody(ticketId: string, links: ResolvedEmailLinks) {
    const preheader = this.escapeHtml('Tell us if this is fixed, or reopen it.');
    const actionStyle =
      'font-size:15px;line-height:1.7;color:#2563eb;text-decoration:underline;';
    // ⚠️ TEXT STARS, NEVER IMAGES. Most clients block remote images by
    // default, and a rating nobody can see is a rating nobody gives. U+2605 is
    // a plain character: it renders with no download, survives image blocking
    // entirely, and copies as text in a plain-text reader.
    //
    // Five separate links, left to right, with the scale spelled out beneath -
    // five identical stars with no caption say nothing about which is which.
    const stars =
      links.ratings.length > 0
        ? [
            '                <div style="font-size:15px;line-height:1.7;color:#374151;margin-bottom:4px;">How did we do?</div>',
            `                <div style="margin-bottom:4px;">${links.ratings
              .map(
                (url, index) =>
                  `<a href="${this.escapeHtml(url)}" style="font-size:28px;line-height:1.2;color:#f59e0b;text-decoration:none;padding:0 4px;" title="${index + 1} out of 5">&#9733;</a>`,
              )
              .join('')}</div>`,
            '                <div style="font-size:12px;line-height:1.6;color:#6b7280;margin-bottom:20px;">1 is poor, 5 is great. One click and you are done.</div>',
          ]
        : [];
    const actions =
      links.confirm && links.reopen
        ? [
            `                <div style="margin-bottom:10px;">Is it fixed? <a href="${this.escapeHtml(links.confirm)}" style="${actionStyle}">Yes, close it</a></div>`,
            `                <div style="margin-bottom:20px;">Not fixed? <a href="${this.escapeHtml(links.reopen)}" style="${actionStyle}">Reopen it</a></div>`,
          ]
        : [];
    return [
      '<!DOCTYPE html>',
      '<html>',
      // 'Segoe UI' quoted: unquoted it is invalid CSS and strict clients drop
      // the whole stack. The public-reply body has always had this right; the
      // two older builders did not, and card 1.42 fixed them.
      `  <body style="margin:0;padding:0;background-color:#f4f6f8;font-family:'Segoe UI', Arial, sans-serif;color:#1f2937;">`,
      `    <div style="display:none;font-size:0;line-height:0;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>`,
      '    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f6f8;padding:24px 0;">',
      '      <tr>',
      '        <td align="center">',
      '          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:640px;max-width:640px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">',
      '            <tr>',
      '              <td style="padding:32px;">',
      '                <div style="font-size:16px;line-height:1.7;color:#111827;margin-bottom:20px;">We have marked your request as resolved.</div>',
      ...actions,
      ...stars,
      '              </td>',
      '            </tr>',
      '          </table>',
      '        </td>',
      '      </tr>',
      '    </table>',
      '  </body>',
      '</html>',
    ].join('\n');
  }

  async inboundEmailAcknowledged(details: {
    ticketId: string;
    toEmail: string;
    requesterName?: string | null;
    ticketDisplayId: string | null;
    ticketNumber: number;
    ticketSubject: string;
    inboundMessageId: string;
  }) {
    const emailContext =
      await this.ticketEmailThreads.buildOutboundEmailContext({
        ticketId: details.ticketId,
        ticketSubject: details.ticketSubject,
        ticketDisplayId: details.ticketDisplayId,
        ticketNumber: details.ticketNumber,
        preferredInReplyTo: details.inboundMessageId,
        additionalReferences: [details.inboundMessageId],
      });
    const body = this.buildInboundAcknowledgementTextBody(details);
    const emailContent = {
      html: this.buildInboundAcknowledgementHtmlBody(details),
    };

    await this.notifyAddresses([details.toEmail], {
      eventType: 'INBOUND_EMAIL_ACKNOWLEDGED',
      subject: emailContext.subject,
      body,
      ticketId: details.ticketId,
      ticketDisplayId: details.ticketDisplayId,
      payload: {
        inboundMessageId: details.inboundMessageId,
      },
      emailMetadata: emailContext.emailMetadata,
      emailContent,
    });
  }

  async notifyUsers(recipients: User[], details: QueuedEmailDetails) {
    await this.queueEmails(recipients, details);
  }

  async notifyAddresses(addresses: string[], details: QueuedEmailDetails) {
    const deduped = Array.from(
      new Set(addresses.map((address) => address.trim()).filter(Boolean)),
    );
    const tasks = deduped.map((email) =>
      this.createAndEnqueueEmail(email, null, details).catch((error) => {
        this.logger.error('Failed to queue email', (error as Error).stack);
      }),
    );

    await Promise.all(tasks);
  }

  private async loadTicket(ticketId: string) {
    return this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        requester: true,
        assignee: true,
        assignedTeam: true,
        followers: { include: { user: true } },
      },
    });
  }

  /**
   * The audience of a ticket message: requester, assignee and followers, minus
   * the person writing it.
   *
   * Extracted so `messageAdded` and `previewMessageRecipients` cannot drift.
   * A compose-screen preview that disagrees with the send is worse than no
   * preview, because an agent writes something candid on the strength of it.
   *
   * `excludeEmployees` for an internal note is what makes it staff-only - but
   * it is a ROLE test, and the requester of a ticket is not always an EMPLOYEE.
   * A payroll lead raising a ticket about her own pay is staff, so the role
   * test alone keeps her in the audience for internal notes written about her.
   * The requester is dropped explicitly below for exactly that reason.
   */
  private messageAudienceOptions(
    actorId: string,
    isInternal: boolean,
  ): RecipientOptions {
    return {
      includeRequester: !isInternal,
      includeAssignee: true,
      includeFollowers: true,
      excludeUserId: actorId,
      excludeEmployees: isInternal,
    };
  }

  /**
   * Who may be EMAILED about a public message (card 1.42 §1c).
   *
   * The requester, plus the followers who are not staff - exactly the people
   * card 1.33 puts on Cc. Staff are absent even here, and the owner is the one
   * who caught that they should be: the reply arrives by email, is pulled onto
   * the ticket, and the assignee reads it there with a bell. Emailing her would
   * tell her something already on her screen.
   *
   * A RELATIONSHIP test, not a domain one. Everybody is on the organisation's
   * own domain, so an address says nothing about whether its owner is staff -
   * see is-staff-role.util.ts. The requester is kept whatever their role, which
   * is the case the role test alone would get wrong.
   *
   * Returns [] readily, and `queuePublicReplyEmail` then queues nothing rather
   * than an email with an empty To (§1c).
   */
  private emailAudience(
    ticket: {
      requester?: User | null;
      followers: { userId: string; user: User }[];
    },
    actorId: string,
  ): User[] {
    const recipients = new Map<string, User>();
    if (ticket.requester) {
      recipients.set(ticket.requester.id, ticket.requester);
    }
    for (const follower of ticket.followers) {
      if (follower.user && !isStaffRole(follower.user.role)) {
        recipients.set(follower.userId, follower.user);
      }
    }
    return Array.from(recipients.values()).filter(
      (user) => user.id !== actorId,
    );
  }

  /**
   * Who a message is about to reach, for the compose screen (card 1.28).
   *
   * Runs the same audience calculation as the send, then the same outbound
   * guard, so what an agent reads above the box is what will actually happen.
   *
   * Addresses are never returned for the audience itself - this renders on a
   * screen a requester may be reading over a shoulder, and names read better
   * anyway. `refused` carries addresses because a refusal is an operator
   * problem an agent may have to report; the UI shows the count and the reason,
   * not the address.
   */
  async previewMessageRecipients(
    ticketId: string,
    type: MessageType,
    actor: AuthUser,
  ): Promise<MessageRecipientsPreview> {
    const ticket = await this.loadTicket(ticketId);
    if (!ticket) {
      return { to: null, cc: [], refused: [], emails: false };
    }
    const isInternal = type === MessageType.INTERNAL;
    // For a public message this is now the EMAIL audience (card 1.42 §1c), not
    // everyone on the ticket. The preview exists so an agent knows who will
    // receive what they are writing; listing a colleague who will not be
    // emailed would be the same lie the preview was built to remove. The
    // internal branch below still shows the full in-app audience.
    const audience = isInternal
      ? this.buildRecipients(
          ticket,
          this.messageAudienceOptions(actor.id, isInternal),
        )
      : this.emailAudience(ticket, actor.id);
    const requesterId = ticket.requester?.id ?? null;
    const assigneeId = ticket.assignee?.id ?? null;
    const followerIds = new Set(ticket.followers.map((row) => row.userId));
    const nameOf = (user: User) =>
      user.displayName?.trim() || user.email?.trim() || 'Unknown';
    /**
     * Removal unfollows from the ticket, and TicketsService.unfollowTicket
     * lets only OWNER, TEAM_ADMIN and LEAD remove somebody else - an AGENT may
     * only remove themselves. Offering the control to an agent produced a
     * confirm dialog followed by a silent 403, caught in the browser rather
     * than by any test. The actor is never in their own audience
     * (excludeUserId), so "or it is me" cannot arise here.
     *
     * The endpoint keeps applying its own rules; this only stops us promising
     * an action it will refuse.
     */
    const canManageFollowers = canManageOtherFollowers(actor.role);
    const isRemovable = (userId: string) =>
      canManageFollowers &&
      followerIds.has(userId) &&
      userId !== requesterId &&
      userId !== assigneeId;

    // An internal note sends no email at all (card 1.33), so there is no
    // outbound resolution to run and nothing that could be refused. Running it
    // anyway would also throw: resolveOutboundRecipients refuses outright to
    // build an INTERNAL email addressed to the requester, by design.
    if (isInternal) {
      return {
        to: null,
        cc: audience.map((user) => ({
          id: user.id,
          name: nameOf(user),
          removable: isRemovable(user.id),
        })),
        refused: [],
        emails: false,
      };
    }

    const candidates = audience
      .map((user) => ({
        user,
        address: user.email?.trim() ?? '',
        isRequester: requesterId != null && user.id === requesterId,
      }))
      .filter((candidate) => candidate.address !== '');
    const suppressed: string[] = [];
    for (const candidate of candidates) {
      if (await this.emailSuppression.isSuppressed(candidate.address)) {
        suppressed.push(candidate.address);
      }
    }
    const { allowed, refused } = resolveOutboundRecipients({
      recipients: candidates.map((candidate) => ({
        address: candidate.address,
        isRequester: candidate.isRequester,
      })),
      messageType: type,
      suppressed,
    });
    const allowedLower = new Set(
      allowed.map((address) => address.toLowerCase()),
    );
    const survives = candidates.filter((candidate) =>
      allowedLower.has(candidate.address.toLowerCase()),
    );
    // Mirrors queuePublicReplyEmail: the requester takes To, and with no
    // requester the first surviving recipient is promoted rather than sending
    // a message with an empty To.
    const toCandidate =
      survives.find((candidate) => candidate.isRequester) ?? survives[0] ?? null;
    return {
      to: toCandidate
        ? { id: toCandidate.user.id, name: nameOf(toCandidate.user) }
        : null,
      cc: survives
        .filter((candidate) => candidate !== toCandidate)
        .map((candidate) => ({
          id: candidate.user.id,
          name: nameOf(candidate.user),
          // Only for someone who is on the ticket BECAUSE they follow it:
          // unfollowing the assignee would not stop them receiving it, and the
          // requester cannot be removed at all.
          removable: isRemovable(candidate.user.id),
        })),
      refused,
      emails: true,
    };
  }

  private buildRecipients(
    ticket: {
      requester?: User | null;
      assignee?: User | null;
      followers: { userId: string; user: User }[];
    },
    options: RecipientOptions,
  ) {
    const recipients = new Map<string, User>();

    if (options.includeRequester && ticket.requester) {
      recipients.set(ticket.requester.id, ticket.requester);
    }

    if (options.includeAssignee && ticket.assignee) {
      recipients.set(ticket.assignee.id, ticket.assignee);
    }

    if (options.includeFollowers) {
      for (const follower of ticket.followers) {
        if (follower.user) {
          recipients.set(follower.userId, follower.user);
        }
      }
    }

    let users = Array.from(recipients.values());

    if (options.excludeUserId) {
      users = users.filter((user) => user.id !== options.excludeUserId);
    }

    if (options.excludeEmployees) {
      users = users.filter((user) => user.role !== UserRole.EMPLOYEE);
    }

    return users;
  }

  /**
   * One public reply, one email: `To:` the requester, `CC:` everyone else.
   *
   * This is how a person sends mail, and it removes card 1.33's worst fault at
   * the root. Previously each recipient got their own outbox row and therefore
   * their own Message-ID, while the thread pointer was a single shared field -
   * so the pointer usually named somebody else's copy and at least one
   * recipient of every multi-recipient reply could never thread.
   *
   * Suppressed and out-of-domain addresses are dropped from the CC here, before
   * the message is composed, rather than failing the send at the transport. One
   * bad colleague address must not stop the requester hearing back.
   */
  private async queuePublicReplyEmail(
    ticket: {
      id: string;
      displayId: string | null;
      number: number;
      subject: string;
      status: TicketStatus;
      requester?: User | null;
    },
    recipients: User[],
    message: TicketMessage,
    actor: AuthUser,
    agentDisplayName: string | null,
  ) {
    const requesterEmail = ticket.requester?.email?.trim() ?? '';
    const candidates = recipients
      .map((user) => ({
        address: user.email?.trim() ?? '',
        userId: user.id,
        isRequester: Boolean(
          requesterEmail &&
            user.email?.trim().toLowerCase() === requesterEmail.toLowerCase(),
        ),
      }))
      .filter((candidate) => candidate.address !== '');
    if (candidates.length === 0) {
      return;
    }
    const suppressed: string[] = [];
    for (const candidate of candidates) {
      if (await this.emailSuppression.isSuppressed(candidate.address)) {
        suppressed.push(candidate.address);
      }
    }
    const { allowed, refused } = resolveOutboundRecipients({
      recipients: candidates.map((candidate) => ({
        address: candidate.address,
        isRequester: candidate.isRequester,
      })),
      messageType: message.type,
      suppressed,
    });
    if (refused.length > 0) {
      await this.recordRefusedRecipients(ticket.id, refused, message.id);
    }
    if (allowed.length === 0) {
      return;
    }
    const allowedLower = new Set(
      allowed.map((address) => address.toLowerCase()),
    );
    // The requester takes To. With no requester - an intake ticket whose
    // requester never resolved - the first surviving CC is promoted, because a
    // message with an empty To and only CC recipients is a spam signal.
    const toCandidate =
      candidates.find(
        (candidate) =>
          candidate.isRequester && allowedLower.has(candidate.address.toLowerCase()),
      ) ??
      candidates.find((candidate) =>
        allowedLower.has(candidate.address.toLowerCase()),
      );
    if (!toCandidate) {
      return;
    }
    const cc = allowed.filter(
      (address) => address.toLowerCase() !== toCandidate.address.toLowerCase(),
    );
    const emailContext = await this.buildTicketEmailContext(ticket);
    // ⚠️ CARD 1.130. The ids the agent's body pasted, each given a `cid` so the
    // HTML can point at a part the processor will attach.
    //
    // ⚠️ IDS TRAVEL, BYTES DO NOT. A 2.8 MB screenshot is ~3.8 MB of base64,
    // and the outbox payload is a JSON column written once per recipient. The
    // files are read at send time instead.
    //
    // ⚠️ NOTHING IS VALIDATED HERE, DELIBERATELY. `inlineAttachmentIds` parses
    // text an agent authored and its own doc says a caller must scope by
    // ticket; `InlineEmailImagesService` does exactly that, and refuses a file
    // on an internal note, one the AV gate blocks, and one over the ceiling.
    const inlineImages = inlineAttachmentIds(message.body).map(
      (attachmentId) => ({
        attachmentId,
        cid: `${attachmentId}@${this.replyAddressDomain()}`,
      }),
    );
    await this.createAndEnqueueEmail(toCandidate.address, toCandidate.userId, {
      eventType: 'MESSAGE_ADDED',
      subject: emailContext.subject,
      body: this.buildPublicReplyTextBody(ticket, actor, message.body),
      ticketId: ticket.id,
      ticketDisplayId: ticket.displayId,
      payload: {
        messageId: message.id,
        type: message.type,
        // Only a reply has a person behind it. The five worker- and
        // system-raised call sites omit this and keep the desk identity.
        ...(agentDisplayName === null ? {} : { agentDisplayName }),
      },
      emailMetadata: { ...emailContext.emailMetadata, cc },
      emailContent: {
        html: this.buildPublicReplyHtmlBody(
          ticket,
          actor,
          message.body,
          inlineImages,
        ),
        // Only when there is something to carry, so every other email's
        // payload keeps exactly the shape it had.
        ...(inlineImages.length > 0 ? { inlineImages } : {}),
      },
    });
  }

  /**
   * Say on the ticket that someone did not receive the reply.
   *
   * The guard returns its refusals rather than dropping them precisely so an
   * agent can see this. Addresses go in the event payload, which is what an
   * agent reads - not into the log, per the logging rules.
   */
  private async recordRefusedRecipients(
    ticketId: string,
    refused: { address: string; reason: string }[],
    messageId: string,
  ) {
    await this.prisma.ticketEvent
      .create({
        data: {
          ticketId,
          type: 'EMAIL_RECIPIENT_REFUSED',
          // messageId so a refusal can be attributed to the message that
          // caused it. Without it the event says only that somebody on this
          // ticket was unreachable at some point, which an agent cannot act on.
          payload: { refused, messageId },
          createdById: null,
        },
      })
      .catch((error) =>
        this.logger.error(
          'Failed to record refused email recipients',
          (error as Error).stack,
        ),
      );
  }

  private async queueEmails(recipients: User[], details: QueuedEmailDetails) {
    const tasks = recipients.map((user) =>
      this.queueEmail(user, details).catch((error) => {
        this.logger.error(
          `Failed to queue email for user ${user.id}`,
          (error as Error).stack,
        );
      }),
    );
    await Promise.all(tasks);
  }

  private async queueEmail(user: User, details: QueuedEmailDetails) {
    if (!user.email) {
      return;
    }
    await this.createAndEnqueueEmail(user.email, user.id, details);
  }

  private resolveEmailContent(details: QueuedEmailDetails) {
    if (details.emailContent?.html) {
      return details.emailContent;
    }

    return {
      html: this.buildDefaultNotificationHtmlBody(details),
    };
  }

  private async createAndEnqueueEmail(
    toEmail: string,
    toUserId: string | null,
    details: QueuedEmailDetails,
  ) {
    const outbox = await this.outbox.createEmail({
      toEmail,
      toUserId,
      ticketId: details.ticketId,
      subject: details.subject,
      body: details.body,
      eventType: details.eventType,
      payload: details.payload ?? null,
      emailMetadata: details.emailMetadata ?? null,
      emailContent: this.resolveEmailContent(details),
    });

    // Deliberately nothing here about the thread pointer. It used to be
    // reserved at this point, on INTENT: a row that then failed to send left
    // the whole ticket referencing a message nobody ever received. Only
    // recordOutboundEmail writes it now, after markSent. The thread row itself
    // is created earlier, by buildOutboundEmailContext.
    await this.emailQueue.enqueue(outbox.id);
  }

  /**
   * The domain a `cid` is qualified with (card 1.130).
   *
   * RFC 2392 wants a globally unique id, and the desk's own sending domain is
   * the honest one to use. Taken from the configured reply address rather than
   * hardcoded, so it follows the mailbox rather than drifting from it.
   */
  private replyAddressDomain(): string {
    const address = this.ticketEmailThreads.getBaseReplyToAddress();
    const domain = address.split('@')[1]?.trim();
    return domain && domain !== '' ? domain : 'tickets.local';
  }

  private buildTicketEmailContext(ticket: {
    id: string;
    displayId: string | null;
    number: number;
    subject: string;
  }) {
    return this.ticketEmailThreads.buildOutboundEmailContext({
      ticketId: ticket.id,
      ticketSubject: ticket.subject,
      ticketDisplayId: ticket.displayId,
      ticketNumber: ticket.number,
    });
  }

  /**
   * The plain-text half, mirroring the HTML exactly: name and time, the
   * message, the instruction, then the URL on its own line.
   *
   * Not an afterthought - it is a deliverability signal, and it is what a watch
   * or a screen reader shows. No ASCII-art borders: they read as noise when
   * spoken aloud.
   */
  private buildPublicReplyTextBody(
    ticket: {
      id: string;
      displayId: string | null;
      number: number;
      subject: string;
      requester?: User | null;
    },
    actor: AuthUser,
    messageBody: string,
  ) {
    return [
      actor.displayName || actor.email,
      '',
      // ⚠️ CARD 1.129 FAULT C. This was the stored body verbatim, so a body the
      // composer had written as HTML reached the requester as raw markup - the
      // exact mirror of card 1.62, running outbound.
      messageBodyToEmailText(messageBody),
    ].join('\n');
  }

  /**
   * The reply a requester receives. Card 1.34, design 2, every department.
   *
   * Four parts and nothing else: a hidden preheader, the quoted message with a
   * name and time, the instruction, and one text link. Everything that used to
   * be here - a heading, a greeting, "We have an update on your request", a
   * Ticket details block, a View Ticket button, a sign-off - was removed
   * deliberately. Each one either repeated the subject line or pushed the real
   * content below the fold, and the details block leaked `WAITING_ON_REQUESTER`
   * to the person waiting. See docs/email-conversation.md before adding
   * anything back.
   *
   * NO CONVERSATION HISTORY, EVER. The recipient's own client quotes the
   * previous message; a digest here would sit on top of that and double the
   * length of every email. This is a rule, not an omission.
   *
   * The marker at the top is added by EmailService, not here, and
   * stripQuotedReply matches on it - so this body must not carry a second one.
   */
  private buildPublicReplyHtmlBody(
    ticket: {
      id: string;
      displayId: string | null;
      number: number;
      subject: string;
      requester?: User | null;
    },
    actor: AuthUser,
    messageBody: string,
    inlineImages: { attachmentId: string; cid: string }[] = [],
  ) {
    const actorName = this.escapeHtml(actor.displayName || actor.email);
    // ⚠️ CARD 1.129 FAULT C. This was `escapeHtml(messageBody)`, which showed
    // an agent's own formatting to the requester as visible tags. It is NOT
    // simply unescaped now - the renderer is default-deny and drops everything
    // it does not recognise, because a stored body is not trusted markup.
    const renderedMessage = renderMessageBodyEmailHtml(
      messageBody,
      new Map(inlineImages.map((image) => [image.attachmentId, image.cid])),
    );
    // Escaped like everything else. Easy to forget precisely because it is
    // invisible, which is why there is a test for it.
    // ⚠️ AND FLATTENED FIRST (card 1.129): the preview is built from the
    // earliest text a client finds, so markup here put
    // `<img data-attachment-id=...` in the inbox list itself.
    // ⚠️ AND WITHOUT THE PICTURES (card 1.136): flattening left `[image:
    // image.png]` sitting in front of the sentence in the inbox list. Right in
    // the text part, wrong here - see `message-body-preheader-text.util.ts`.
    const preheader = this.escapeHtml(
      this.buildPreheader(messageBodyToPreheaderText(messageBody)),
    );

    return [
      '<!DOCTYPE html>',
      '<html>',
      // 'Segoe UI' is quoted: unquoted it is invalid CSS and strict clients
      // silently drop the whole font stack.
      `  <body style="margin:0;padding:0;background-color:#f4f6f8;font-family:'Segoe UI', Arial, sans-serif;color:#1f2937;">`,
      // The preheader must be the FIRST thing in the body: clients build the
      // inbox preview from the earliest text they find.
      `    <div style="display:none;font-size:0;line-height:0;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>`,
      '    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f6f8;padding:24px 0;">',
      '      <tr>',
      '        <td align="center">',
      '          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:640px;max-width:640px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">',
      '            <tr>',
      '              <td style="padding:32px;">',
      // A bordered <td> rather than a div with border-left: Outlook renders
      // this reliably and has neither flexbox nor a usable <style> block.
      '                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">',
      '                  <tr>',
      '                    <td style="border-left:4px solid #2563eb;padding:2px 0 2px 16px;">',
      `                      <div style="font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">${actorName}</div>`,
      `                      <div style="font-size:16px;line-height:1.7;color:#111827;">${renderedMessage}</div>`,
      '                    </td>',
      '                  </tr>',
      '                </table>',
      '              </td>',
      '            </tr>',
      '          </table>',
      '        </td>',
      '      </tr>',
      '    </table>',
      '  </body>',
      '</html>',
    ].join('\n');
  }

  /**
   * The first words of the message, for the inbox preview.
   *
   * The highest-value part of this card: without it the preview is boilerplate
   * and the requester has to open the email to learn there is a question in it.
   * Truncated on a word boundary so it does not end mid-word.
   */
  private buildPreheader(messageBody: string) {
    const flat = messageBody.replace(/\s+/g, ' ').trim();
    if (flat.length <= PREHEADER_MAX_LENGTH) {
      return flat;
    }
    const clipped = flat.slice(0, PREHEADER_MAX_LENGTH);
    const lastSpace = clipped.lastIndexOf(' ');
    const onWordBoundary = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
    return `${onWordBoundary.trimEnd()}\u2026`;
  }


  private buildInboundAcknowledgementTextBody(details: {
    ticketId: string;
    requesterName?: string | null;
    ticketDisplayId: string | null;
    ticketSubject: string;
  }) {
    const requesterName = details.requesterName?.trim() || 'there';
    const ticketId = details.ticketDisplayId ?? details.ticketId;

    // Card 1.42 cut this to what a person needs on first contact: we have it,
    // here is the reference, reply to add anything. Gone: the "What happens
    // next" block (it promised only that we would respond), the Ticket details
    // block (it restated the subject they wrote and a status), and the
    // "Best regards" sign-off - the From line says who this is.
    //
    // The greeting stays, unlike the public reply's. This is the only email a
    // requester gets before any human has spoken to them, and it is the one
    // place the courtesy reads as courtesy rather than padding.
    return [
      `Hello ${requesterName},`,
      '',
      'We have your email and opened a ticket for it.',
      '',
      `Your reference is ${ticketId}.`,
    ].join('\n');
  }

  private buildInboundAcknowledgementHtmlBody(details: {
    ticketId: string;
    requesterName?: string | null;
    ticketDisplayId: string | null;
    ticketSubject: string;
  }) {
    const requesterName = this.escapeHtml(
      details.requesterName?.trim() || 'there',
    );
    const ticketId = this.escapeHtml(
      details.ticketDisplayId ?? details.ticketId,
    );
    // Escaped like everything else, and easy to forget precisely because it is
    // invisible - hence a test for it.
    const preheader = this.escapeHtml(
      `We have your email. Your reference is ${
        details.ticketDisplayId ?? details.ticketId
      }.`,
    );

    return [
      '<!DOCTYPE html>',
      '<html>',
      `  <body style="margin:0;padding:0;background-color:#f4f6f8;font-family:'Segoe UI', Arial, sans-serif;color:#1f2937;">`,
      // First in the body: clients build the inbox preview from the earliest
      // text they find.
      `    <div style="display:none;font-size:0;line-height:0;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>`,
      '    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f6f8;padding:24px 0;">',
      '      <tr>',
      '        <td align="center">',
      '          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:640px;max-width:640px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">',
      '            <tr>',
      '              <td style="padding:32px;">',
      `                <div style="font-size:15px;line-height:1.7;color:#374151;margin-bottom:16px;">Hello ${requesterName},</div>`,
      '                <div style="font-size:16px;line-height:1.7;color:#111827;margin-bottom:20px;">We have your email and opened a ticket for it.</div>',
      `                <div style="font-size:15px;line-height:1.7;color:#374151;margin-bottom:20px;">Your reference is <strong>${ticketId}</strong>.</div>`,
      '              </td>',
      '            </tr>',
      '          </table>',
      '        </td>',
      '      </tr>',
      '    </table>',
      '  </body>',
      '</html>',
    ].join('\n');
  }

  /**
   * The body for the survivors that are not a public reply or the two with
   * bespoke bodies: the ticket-created notice and an automation rule's own
   * message.
   *
   * Card 1.42 put this into card 1.34's shape, which the owner reviewed and
   * chose. Deleted deliberately: the uppercase event headline, the 24px repeat
   * of the subject line (the reader has just read it in their inbox), the
   * "View Ticket" hero button, and the "Best regards" sign-off - the From line
   * already says who this is, and since card 1.31 it names the agent. What is
   * left is a hidden preheader, the content, and one quiet text link.
   *
   * See docs/email-conversation.md before adding anything back.
   */
  private buildDefaultNotificationHtmlBody(details: QueuedEmailDetails) {
    const contentBlocks = this.buildHtmlContentBlocks(
      details.body,
      details.ticketId,
      details.ticketDisplayId,
    );
    const preheader = this.escapeHtml(
      this.buildPreheader(details.preheader ?? details.body),
    );

    return [
      '<!DOCTYPE html>',
      '<html>',
      `  <body style="margin:0;padding:0;background-color:#f4f6f8;font-family:'Segoe UI', Arial, sans-serif;color:#1f2937;">`,
      `    <div style="display:none;font-size:0;line-height:0;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>`,
      '    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f6f8;padding:24px 0;">',
      '      <tr>',
      '        <td align="center">',
      '          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:640px;max-width:640px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">',
      '            <tr>',
      '              <td style="padding:32px;">',
      ...contentBlocks,
      '              </td>',
      '            </tr>',
      '          </table>',
      '        </td>',
      '      </tr>',
      '    </table>',
      '  </body>',
      '</html>',
    ].join('\n');
  }

  private buildHtmlContentBlocks(
    body: string,
    ticketId?: string,
    ticketDisplayId?: string | null,
  ) {
    // Card 2.12: the shared builder, and the display id when the caller has one.
    const ticketUrl = ticketId
      ? ticketLink(this.config.get<string>('WEB_APP_URL'), {
          id: ticketId,
          displayId: ticketDisplayId,
        })
      : null;
    const cleanedLines = body
      .split(/\r?\n/)
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return true;
        }
        if (trimmed.startsWith('View: ')) {
          return false;
        }
        if (ticketUrl && trimmed === ticketUrl) {
          return false;
        }
        return true;
      })
      .join('\n');

    const blocks = cleanedLines
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean);

    if (blocks.length === 0) {
      return [
        '                  <div style="font-size:15px;line-height:1.8;color:#111827;">No additional details provided.</div>',
      ];
    }

    return blocks.map((block) => {
      const escaped = this.escapeHtml(block).replace(/\n/g, '<br />');
      return `                  <div style="font-size:15px;line-height:1.8;color:#111827;margin-bottom:14px;">${escaped}</div>`;
    });
  }


  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private ticketLabel(ticket: { displayId: string | null; number: number }) {
    return ticket.displayId ?? `#${ticket.number}`;
  }

}
