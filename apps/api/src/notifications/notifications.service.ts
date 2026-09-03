import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageType, Prisma, TicketStatus, UserRole } from '@prisma/client';
import type { TicketMessage, User } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from './email-queue.service';
import { EmailSuppressionService } from './email-suppression.service';
import { resolveOutboundRecipients } from './outbound-recipients.util';
import { canManageOtherFollowers } from '../common/can-manage-followers.util';
import type { MessageRecipientsPreview } from './message-recipients-preview.type';
import { InAppNotificationsService } from './in-app-notifications.service';
import {
  type EmailOutboxContent,
  type EmailOutboxMetadata,
  OutboxService,
} from './outbox.service';
import { TicketEmailThreadService } from './ticket-email-thread.service';

/**
 * The one instruction in a reply email. The owner's exact wording - an earlier
 * draft read "Reply to this email and your answer goes onto the ticket" and the
 * shorter line is the decision. Do not lengthen it.
 */
const REPLY_INSTRUCTION = 'Reply to this email';

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
  eventType: string;
  ticketId?: string;
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

  async ticketCreated(ticket: { id: string }, actor: AuthUser) {
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

    const emailContext = await this.buildTicketEmailContext(fullTicket);
    const body = [
      'A new ticket has been created.',
      `Subject: ${fullTicket.subject}`,
      `Priority: ${fullTicket.priority}`,
      `Status: ${fullTicket.status}`,
      `Team: ${fullTicket.assignedTeam?.name ?? 'Unassigned'}`,
      '',
      `View: ${this.ticketLink(fullTicket.id)}`,
    ].join('\n');
    await this.queueEmails(recipients, {
      eventType: 'TICKET_CREATED',
      subject: emailContext.subject,
      body,
      ticketId: fullTicket.id,
      payload: {
        priority: fullTicket.priority,
        status: fullTicket.status,
      },
      emailMetadata: emailContext.emailMetadata,
    });
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
    const recipients = this.buildRecipients(
      fullTicket,
      this.messageAudienceOptions(actor.id, isInternal),
    );

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
        recipients,
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

    const recipients = this.buildRecipients(fullTicket, {
      includeAssignee: true,
      includeFollowers: true,
      excludeUserId: actor.id,
    });

    const assigneeName = fullTicket.assignee?.displayName ?? 'Unassigned';
    const emailContext = await this.buildTicketEmailContext(fullTicket);
    const body = [
      `Ticket assigned to ${assigneeName}.`,
      `Status: ${fullTicket.status}`,
      '',
      `View: ${this.ticketLink(fullTicket.id)}`,
    ].join('\n');

    // Queue email notifications
    await this.queueEmails(recipients, {
      eventType: 'TICKET_ASSIGNED',
      subject: emailContext.subject,
      body,
      ticketId: fullTicket.id,
      payload: {
        assigneeId: fullTicket.assigneeId,
      },
      emailMetadata: emailContext.emailMetadata,
    });

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

    const priorTeam = priorTeamId
      ? await this.prisma.team.findUnique({ where: { id: priorTeamId } })
      : null;
    const emailContext = await this.buildTicketEmailContext(fullTicket);
    const body = [
      `Ticket transferred from ${priorTeam?.name ?? 'Unassigned'} to ${fullTicket.assignedTeam?.name ?? 'Unassigned'}.`,
      '',
      `View: ${this.ticketLink(fullTicket.id)}`,
    ].join('\n');

    // Queue email notifications
    await this.queueEmails(recipients, {
      eventType: 'TICKET_TRANSFERRED',
      subject: emailContext.subject,
      body,
      ticketId: fullTicket.id,
      payload: {
        fromTeamId: priorTeamId,
        toTeamId: fullTicket.assignedTeamId,
      },
      emailMetadata: emailContext.emailMetadata,
    });

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

    const emailContext = await this.buildTicketEmailContext(fullTicket);
    // On RESOLVED the requester can confirm or reopen from the email; the
    // links only pre-open a dialog in the portal, the API still authorises.
    const requesterActionLines =
      fullTicket.status === TicketStatus.RESOLVED
        ? [
            `Is it fixed? Close it: ${this.ticketLink(fullTicket.id)}?action=confirm`,
            `Not fixed? Reopen it: ${this.ticketLink(fullTicket.id)}?action=reopen`,
            '',
          ]
        : [];
    const body = [
      `Status changed from ${previousStatus} to ${fullTicket.status}.`,
      '',
      'If you need anything else, reply to this email and the ticket will update automatically.',
      '',
      ...requesterActionLines,
      `View: ${this.ticketLink(fullTicket.id)}`,
    ].join('\n');
    // Queue email notifications
    await this.queueEmails(recipients, {
      eventType: 'TICKET_STATUS_CHANGED',
      subject: emailContext.subject,
      body,
      ticketId: fullTicket.id,
      payload: {
        from: previousStatus,
        to: fullTicket.status,
      },
      emailMetadata: emailContext.emailMetadata,
    });

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
    const audience = this.buildRecipients(
      ticket,
      this.messageAudienceOptions(actor.id, isInternal),
    );
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
    await this.createAndEnqueueEmail(toCandidate.address, toCandidate.userId, {
      eventType: 'MESSAGE_ADDED',
      subject: emailContext.subject,
      body: this.buildPublicReplyTextBody(ticket, actor, message.body),
      ticketId: ticket.id,
      payload: {
        messageId: message.id,
        type: message.type,
        // Only a reply has a person behind it. The five worker- and
        // system-raised call sites omit this and keep the desk identity.
        ...(agentDisplayName === null ? {} : { agentDisplayName }),
      },
      emailMetadata: { ...emailContext.emailMetadata, cc },
      emailContent: {
        html: this.buildPublicReplyHtmlBody(ticket, actor, message.body),
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
      messageBody,
      '',
      REPLY_INSTRUCTION,
      this.ticketLink(ticket.id),
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
  ) {
    const actorName = this.escapeHtml(actor.displayName || actor.email);
    const escapedMessage = this.escapeHtml(messageBody).replace(
      /\n/g,
      '<br />',
    );
    // Escaped like everything else. Easy to forget precisely because it is
    // invisible, which is why there is a test for it.
    const preheader = this.escapeHtml(this.buildPreheader(messageBody));
    const ticketUrl = this.escapeHtml(this.ticketLink(ticket.id));

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
      `                      <div style="font-size:16px;line-height:1.7;color:#111827;">${escapedMessage}</div>`,
      '                    </td>',
      '                  </tr>',
      '                </table>',
      `                <div style="font-size:15px;line-height:1.7;color:#374151;margin:28px 0 0 0;">${REPLY_INSTRUCTION}</div>`,
      '                <div style="border-top:1px solid #e5e7eb;margin:10px 0 10px 0;"></div>',
      `                <div><a href="${ticketUrl}" style="font-size:13px;color:#6b7280;text-decoration:underline;">view online</a></div>`,
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
    const companyName = this.companyName();

    return [
      `Hello ${requesterName},`,
      '',
      'We received your email and created a support ticket for your request.',
      '',
      'What happens next',
      'Our team will review your request and respond as soon as possible.',
      'You can reply directly to this email at any time to add more details.',
      '',
      'Ticket details',
      `Ticket ID: ${ticketId}`,
      `Subject: ${details.ticketSubject}`,
      'Status: New',
      '',
      'Reply to this email if you need to share more information, or view your ticket here:',
      this.ticketLink(details.ticketId),
      '',
      'Best regards,',
      `${companyName} Support`,
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
    const ticketSubject = this.escapeHtml(details.ticketSubject);
    const ticketUrl = this.escapeHtml(this.ticketLink(details.ticketId));
    const companyName = this.escapeHtml(this.companyName());

    return [
      '<!DOCTYPE html>',
      '<html>',
      '  <body style="margin:0;padding:0;background-color:#f4f6f8;font-family:Segoe UI, Arial, sans-serif;color:#1f2937;">',
      '    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f6f8;padding:24px 0;">',
      '      <tr>',
      '        <td align="center">',
      '          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:640px;max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">',
      '            <tr>',
      '              <td style="padding:32px 32px 16px 32px;">',
      '                <div style="font-size:24px;font-weight:700;color:#111827;margin-bottom:16px;">',
      '                  Request received',
      '                </div>',
      `                <div style="font-size:15px;line-height:1.7;color:#374151;margin-bottom:20px;">Hello ${requesterName},</div>`,
      '                <div style="font-size:15px;line-height:1.7;color:#374151;margin-bottom:20px;">',
      '                  We received your email and created a support ticket for your request.',
      '                </div>',
      '                <div style="background:#f8fafc;border:1px solid #dbe4ea;border-left:5px solid #2563eb;border-radius:10px;padding:20px;margin:0 0 24px 0;">',
      '                  <div style="font-size:13px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;color:#2563eb;margin-bottom:10px;">What happens next</div>',
      '                  <div style="font-size:15px;line-height:1.8;color:#111827;">',
      '                    Our team will review your request and respond as soon as possible.',
      '                    You can reply directly to this email at any time to add more details.',
      '                  </div>',
      '                </div>',
      '                <div style="font-size:16px;font-weight:700;color:#111827;margin-bottom:12px;">Ticket details</div>',
      '                <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin-bottom:24px;">',
      '                  <div style="font-size:14px;line-height:1.8;color:#374151;">',
      `                    <div><strong>Ticket ID:</strong> ${ticketId}</div>`,
      `                    <div><strong>Subject:</strong> ${ticketSubject}</div>`,
      '                    <div><strong>Status:</strong> New</div>',
      '                  </div>',
      '                </div>',
      '                <div style="font-size:15px;line-height:1.7;color:#374151;margin-bottom:20px;">',
      '                  Reply to this email if you need to share more information, or view your ticket here:',
      '                </div>',
      '                <div style="margin-bottom:28px;">',
      `                  <a href="${ticketUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:14px;font-weight:600;">View Ticket</a>`,
      '                </div>',
      `                <div style="font-size:15px;line-height:1.7;color:#374151;">Best regards,<br />${companyName} Support</div>`,
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

  private buildDefaultNotificationHtmlBody(details: QueuedEmailDetails) {
    const title = this.escapeHtml(this.notificationHeadline(details.eventType));
    const subject = this.escapeHtml(details.subject);
    const companyName = this.escapeHtml(this.companyName());
    const ticketUrl = details.ticketId
      ? this.escapeHtml(this.ticketLink(details.ticketId))
      : null;
    const contentBlocks = this.buildHtmlContentBlocks(
      details.body,
      details.ticketId,
    );

    return [
      '<!DOCTYPE html>',
      '<html>',
      '  <body style="margin:0;padding:0;background-color:#f4f6f8;font-family:Segoe UI, Arial, sans-serif;color:#1f2937;">',
      '    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f6f8;padding:24px 0;">',
      '      <tr>',
      '        <td align="center">',
      '          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:640px;max-width:640px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">',
      '            <tr>',
      '              <td style="padding:32px 32px 16px 32px;">',
      `                <div style="font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#2563eb;margin-bottom:12px;">${title}</div>`,
      `                <div style="font-size:24px;font-weight:700;color:#111827;margin-bottom:20px;">${subject}</div>`,
      '                <div style="background:#f8fafc;border:1px solid #dbe4ea;border-left:5px solid #2563eb;border-radius:10px;padding:20px;margin:0 0 24px 0;">',
      ...contentBlocks,
      '                </div>',
      ...(ticketUrl
        ? [
            '                <div style="font-size:15px;line-height:1.7;color:#374151;margin-bottom:20px;">Open the ticket for full details and replies.</div>',
            '                <div style="margin-bottom:28px;">',
            `                  <a href="${ticketUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:14px;font-weight:600;">View Ticket</a>`,
            '                </div>',
          ]
        : []),
      `                <div style="font-size:15px;line-height:1.7;color:#374151;">Best regards,<br />${companyName} Support</div>`,
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

  private buildHtmlContentBlocks(body: string, ticketId?: string) {
    const ticketUrl = ticketId ? this.ticketLink(ticketId) : null;
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

  private notificationHeadline(eventType: string) {
    switch (eventType) {
      case 'TICKET_CREATED':
        return 'Ticket created';
      case 'TICKET_ASSIGNED':
        return 'Assignment updated';
      case 'TICKET_TRANSFERRED':
        return 'Ticket transferred';
      case 'TICKET_STATUS_CHANGED':
        return 'Status updated';
      case 'MESSAGE_ADDED':
        return 'New reply';
      case 'SLA_BREACHED':
        return 'SLA breached';
      case 'SLA_AT_RISK':
        return 'SLA at risk';
      case 'INBOUND_EMAIL_ACKNOWLEDGED':
        return 'Request received';
      default:
        return 'Ticket update';
    }
  }

  private companyName() {
    const configured = this.config.get<string>('EMAIL_COMPANY_NAME')?.trim();
    if (configured) {
      return configured;
    }

    const address = this.ticketEmailThreads.getBaseReplyToAddress();
    const domain = address.split('@')[1]?.split('.')[0]?.trim();
    if (domain) {
      return domain.toUpperCase();
    }

    return 'Support';
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

  private ticketLink(ticketId: string) {
    const base = (
      this.config.get<string>('WEB_APP_URL') ?? 'http://localhost:5173'
    ).replace(/\/$/, '');
    return `${base}/tickets/${ticketId}`;
  }
}
