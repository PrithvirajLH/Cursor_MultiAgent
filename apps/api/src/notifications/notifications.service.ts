import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageType, Prisma, TicketStatus, UserRole } from '@prisma/client';
import type { TicketMessage, User } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from './email-queue.service';
import { buildOutboundMessageId } from './email-threading.util';
import { InAppNotificationsService } from './in-app-notifications.service';
import {
  type EmailOutboxContent,
  type EmailOutboxMetadata,
  OutboxService,
} from './outbox.service';

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

    const subject = this.ticketEmailSubject(fullTicket);
    const body = [
      'A new ticket has been created.',
      `Subject: ${fullTicket.subject}`,
      `Priority: ${fullTicket.priority}`,
      `Status: ${fullTicket.status}`,
      `Team: ${fullTicket.assignedTeam?.name ?? 'Unassigned'}`,
      '',
      `View: ${this.ticketLink(fullTicket.id)}`,
    ].join('\n');
    const emailMetadata = await this.buildTicketEmailMetadata(fullTicket.id);

    await this.queueEmails(recipients, {
      eventType: 'TICKET_CREATED',
      subject,
      body,
      ticketId: fullTicket.id,
      payload: {
        priority: fullTicket.priority,
        status: fullTicket.status,
      },
      emailMetadata,
    });
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
    const recipients = this.buildRecipients(fullTicket, {
      includeRequester: true,
      includeAssignee: true,
      includeFollowers: true,
      excludeUserId: actor.id,
      excludeEmployees: isInternal,
    });

    const subject = isInternal
      ? `[Ticket ${this.ticketLabel(fullTicket)}] Internal note`
      : this.ticketEmailSubject(fullTicket);
    const body = isInternal
      ? [
          `${actor.email} added an internal note.`,
          '',
          message.body,
          '',
          `View: ${this.ticketLink(fullTicket.id)}`,
        ].join('\n')
      : this.buildPublicReplyTextBody(fullTicket, actor, message.body);
    const emailContent = isInternal
      ? undefined
      : {
          html: this.buildPublicReplyHtmlBody(fullTicket, actor, message.body),
        };
    const emailMetadata = await this.buildTicketEmailMetadata(fullTicket.id);

    // Queue email notifications
    await this.queueEmails(recipients, {
      eventType: 'MESSAGE_ADDED',
      subject,
      body,
      ticketId: fullTicket.id,
      payload: {
        messageId: message.id,
        type: message.type,
      },
      emailMetadata,
      emailContent,
    });

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
    const subject = this.ticketEmailSubject(fullTicket);
    const body = [
      `Ticket assigned to ${assigneeName}.`,
      `Status: ${fullTicket.status}`,
      '',
      `View: ${this.ticketLink(fullTicket.id)}`,
    ].join('\n');
    const emailMetadata = await this.buildTicketEmailMetadata(fullTicket.id);

    // Queue email notifications
    await this.queueEmails(recipients, {
      eventType: 'TICKET_ASSIGNED',
      subject,
      body,
      ticketId: fullTicket.id,
      payload: {
        assigneeId: fullTicket.assigneeId,
      },
      emailMetadata,
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
    const subject = this.ticketEmailSubject(fullTicket);
    const body = [
      `Ticket transferred from ${priorTeam?.name ?? 'Unassigned'} to ${fullTicket.assignedTeam?.name ?? 'Unassigned'}.`,
      '',
      `View: ${this.ticketLink(fullTicket.id)}`,
    ].join('\n');
    const emailMetadata = await this.buildTicketEmailMetadata(fullTicket.id);

    // Queue email notifications
    await this.queueEmails(recipients, {
      eventType: 'TICKET_TRANSFERRED',
      subject,
      body,
      ticketId: fullTicket.id,
      payload: {
        fromTeamId: priorTeamId,
        toTeamId: fullTicket.assignedTeamId,
      },
      emailMetadata,
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

    const subject = this.ticketEmailSubject(fullTicket);
    const body = [
      `Status changed from ${previousStatus} to ${fullTicket.status}.`,
      '',
      'If you need anything else, reply to this email and the ticket will update automatically.',
      '',
      `View: ${this.ticketLink(fullTicket.id)}`,
    ].join('\n');
    const emailMetadata = await this.buildTicketEmailMetadata(fullTicket.id);

    // Queue email notifications
    await this.queueEmails(recipients, {
      eventType: 'TICKET_STATUS_CHANGED',
      subject,
      body,
      ticketId: fullTicket.id,
      payload: {
        from: previousStatus,
        to: fullTicket.status,
      },
      emailMetadata,
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
    ticketSubject: string;
    inboundMessageId: string;
  }) {
    const subject = this.ticketEmailSubject({
      displayId: details.ticketDisplayId,
      number: 0,
      subject: details.ticketSubject,
    });
    const body = this.buildInboundAcknowledgementTextBody(details);
    const emailContent = {
      html: this.buildInboundAcknowledgementHtmlBody(details),
    };

    await this.notifyAddresses([details.toEmail], {
      eventType: 'INBOUND_EMAIL_ACKNOWLEDGED',
      subject,
      body,
      ticketId: details.ticketId,
      payload: {
        inboundMessageId: details.inboundMessageId,
      },
      emailMetadata: {
        inReplyTo: details.inboundMessageId,
        references: [details.inboundMessageId],
      },
      emailContent,
    });
  }

  async notifyUsers(
    recipients: User[],
    details: QueuedEmailDetails,
  ) {
    await this.queueEmails(recipients, details);
  }

  async notifyAddresses(
    addresses: string[],
    details: QueuedEmailDetails,
  ) {
    const deduped = Array.from(
      new Set(addresses.map((address) => address.trim()).filter(Boolean)),
    );

    const tasks = deduped.map((email) =>
      this.outbox
        .createEmail({
          toEmail: email,
          toUserId: null,
          ticketId: details.ticketId,
          subject: details.subject,
          body: details.body,
          eventType: details.eventType,
          payload: details.payload ?? null,
          emailMetadata: details.emailMetadata ?? null,
          emailContent: details.emailContent ?? null,
        })
        .then((outbox) => this.emailQueue.enqueue(outbox.id))
        .catch((error) => {
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

  private async queueEmails(
    recipients: User[],
    details: QueuedEmailDetails,
  ) {
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

  private async queueEmail(
    user: User,
    details: QueuedEmailDetails,
  ) {
    if (!user.email) {
      return;
    }

    const outbox = await this.outbox.createEmail({
      toEmail: user.email,
      toUserId: user.id,
      ticketId: details.ticketId,
      subject: details.subject,
      body: details.body,
      eventType: details.eventType,
      payload: details.payload ?? null,
      emailMetadata: details.emailMetadata ?? null,
      emailContent: details.emailContent ?? null,
    });

    await this.emailQueue.enqueue(outbox.id);
  }

  private async buildTicketEmailMetadata(
    ticketId: string,
    preferredInReplyTo?: string | null,
  ) {
    const latestInbound = await this.prisma.ticketEvent.findFirst({
      where: {
        ticketId,
        type: 'INBOUND_EMAIL_RECEIVED',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        payload: true,
      },
    });
    const latestInboundMessageId = this.extractStringFromPayload(
      latestInbound?.payload,
      'messageId',
    );

    const latestOutbound = await this.prisma.notificationOutbox.findFirst({
      where: {
        ticketId,
        sentAt: { not: null },
      },
      orderBy: { sentAt: 'desc' },
      select: {
        id: true,
        sentAt: true,
      },
    });
    const latestOutboundMessageId = latestOutbound
      ? buildOutboundMessageId(latestOutbound.id, this.getReplyToAddress())
      : null;

    const inboundAt = latestInbound?.createdAt?.getTime() ?? 0;
    const outboundAt = latestOutbound?.sentAt?.getTime() ?? 0;
    const fallbackInReplyTo =
      inboundAt >= outboundAt
        ? latestInboundMessageId ?? latestOutboundMessageId
        : latestOutboundMessageId ?? latestInboundMessageId;

    const references = Array.from(
      new Set(
        [
          preferredInReplyTo ?? undefined,
          latestInboundMessageId ?? undefined,
          latestOutboundMessageId ?? undefined,
        ].filter((value): value is string => Boolean(value)),
      ),
    );

    const inReplyTo = preferredInReplyTo ?? fallbackInReplyTo ?? undefined;
    if (!inReplyTo && references.length === 0) {
      return undefined;
    }

    return {
      inReplyTo,
      references,
    } satisfies EmailOutboxMetadata;
  }

  private extractStringFromPayload(
    payload: Prisma.JsonValue | null | undefined,
    key: string,
  ) {
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
      return null;
    }

    const value = (payload as Prisma.JsonObject)[key];
    return typeof value === 'string' ? value : null;
  }

  private getReplyToAddress() {
    return (
      this.config.get<string>('SMTP_REPLY_TO') ??
      this.config.get<string>('SMTP_FROM') ??
      'no-reply@localhost'
    );
  }

  private buildPublicReplyTextBody(
    ticket: {
      id: string;
      displayId: string | null;
      number: number;
      subject: string;
      status: TicketStatus;
      requester?: User | null;
    },
    actor: AuthUser,
    messageBody: string,
  ) {
    const requesterName =
      ticket.requester?.displayName ?? ticket.requester?.email ?? 'there';
    const ticketId = this.ticketLabel(ticket);
    const companyName = this.companyName();

    return [
      `Hello ${requesterName},`,
      '',
      'We have an update on your request.',
      '',
      `${actor.displayName || actor.email} wrote:`,
      '',
      messageBody,
      '',
      'Ticket details',
      `Ticket ID: ${ticketId}`,
      `Subject: ${ticket.subject}`,
      `Status: ${ticket.status}`,
      '',
      'Reply to this email if you need anything else, or view the ticket here:',
      this.ticketLink(ticket.id),
      '',
      'Best regards,',
      `${companyName} Support`,
    ].join('\n');
  }

  private buildPublicReplyHtmlBody(
    ticket: {
      id: string;
      displayId: string | null;
      number: number;
      subject: string;
      status: TicketStatus;
      requester?: User | null;
    },
    actor: AuthUser,
    messageBody: string,
  ) {
    const requesterName = this.escapeHtml(
      ticket.requester?.displayName ?? ticket.requester?.email ?? 'there',
    );
    const actorName = this.escapeHtml(actor.displayName || actor.email);
    const escapedMessage = this.escapeHtml(messageBody).replace(/\n/g, '<br />');
    const ticketId = this.escapeHtml(this.ticketLabel(ticket));
    const ticketSubject = this.escapeHtml(ticket.subject);
    const ticketStatus = this.escapeHtml(ticket.status);
    const ticketUrl = this.escapeHtml(this.ticketLink(ticket.id));
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
      '                  Update on your request',
      '                </div>',
      `                <div style="font-size:15px;line-height:1.7;color:#374151;margin-bottom:20px;">Hello ${requesterName},</div>`,
      '                <div style="font-size:15px;line-height:1.7;color:#374151;margin-bottom:20px;">',
      '                  We have an update on your request.',
      '                </div>',
      '                <div style="background:#f8fafc;border:1px solid #dbe4ea;border-left:5px solid #2563eb;border-radius:10px;padding:20px;margin:0 0 24px 0;">',
      `                  <div style="font-size:13px;font-weight:700;letter-spacing:0.02em;text-transform:uppercase;color:#2563eb;margin-bottom:10px;">${actorName} wrote</div>`,
      `                  <div style="font-size:15px;line-height:1.8;color:#111827;white-space:normal;">${escapedMessage}</div>`,
      '                </div>',
      '                <div style="font-size:16px;font-weight:700;color:#111827;margin-bottom:12px;">Ticket details</div>',
      '                <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin-bottom:24px;">',
      '                  <div style="font-size:14px;line-height:1.8;color:#374151;">',
      `                    <div><strong>Ticket ID:</strong> ${ticketId}</div>`,
      `                    <div><strong>Subject:</strong> ${ticketSubject}</div>`,
      `                    <div><strong>Status:</strong> ${ticketStatus}</div>`,
      '                  </div>',
      '                </div>',
      '                <div style="font-size:15px;line-height:1.7;color:#374151;margin-bottom:20px;">',
      '                  Reply to this email if you need anything else, or view the ticket here:',
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
    const requesterName = this.escapeHtml(details.requesterName?.trim() || 'there');
    const ticketId = this.escapeHtml(details.ticketDisplayId ?? details.ticketId);
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

  private companyName() {
    const configured = this.config.get<string>('EMAIL_COMPANY_NAME')?.trim();
    if (configured) {
      return configured;
    }

    const address = this.getReplyToAddress();
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

  private ticketEmailSubject(ticket: {
    displayId: string | null;
    number: number;
    subject: string;
  }) {
    const normalizedSubject = ticket.subject.trim() || 'Ticket update';
    const label =
      ticket.displayId ?? (ticket.number > 0 ? `#${ticket.number}` : null);

    if (!label) {
      return normalizedSubject;
    }

    return `${normalizedSubject} [${label}]`;
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
