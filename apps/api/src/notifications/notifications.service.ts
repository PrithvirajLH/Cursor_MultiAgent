import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageType, Prisma, TicketStatus, UserRole } from '@prisma/client';
import type { TicketMessage, User } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from './email-queue.service';
import { InAppNotificationsService } from './in-app-notifications.service';
import { OutboxService } from './outbox.service';

type RecipientOptions = {
  includeRequester?: boolean;
  includeAssignee?: boolean;
  includeFollowers?: boolean;
  excludeUserId?: string;
  excludeEmployees?: boolean;
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

    const subject = `[Ticket ${this.ticketLabel(fullTicket)}] Created`;
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
      subject,
      body,
      ticketId: fullTicket.id,
      payload: {
        priority: fullTicket.priority,
        status: fullTicket.status,
      },
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

    const snippet =
      message.body.length > 160
        ? `${message.body.slice(0, 160)}…`
        : message.body;
    const subject = `[Ticket ${this.ticketLabel(fullTicket)}] ${isInternal ? 'Internal note' : 'New reply'}`;
    const body = [
      `${actor.email} added a ${isInternal ? 'internal note' : 'public reply'}.`,
      '',
      snippet,
      '',
      `View: ${this.ticketLink(fullTicket.id)}`,
    ].join('\n');

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
    const subject = `[Ticket ${this.ticketLabel(fullTicket)}] Assigned`;
    const body = [
      `Ticket assigned to ${assigneeName}.`,
      `Status: ${fullTicket.status}`,
      '',
      `View: ${this.ticketLink(fullTicket.id)}`,
    ].join('\n');

    // Queue email notifications
    await this.queueEmails(recipients, {
      eventType: 'TICKET_ASSIGNED',
      subject,
      body,
      ticketId: fullTicket.id,
      payload: {
        assigneeId: fullTicket.assigneeId,
      },
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
    const subject = `[Ticket ${this.ticketLabel(fullTicket)}] Transferred`;
    const body = [
      `Ticket transferred from ${priorTeam?.name ?? 'Unassigned'} to ${fullTicket.assignedTeam?.name ?? 'Unassigned'}.`,
      '',
      `View: ${this.ticketLink(fullTicket.id)}`,
    ].join('\n');

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

    const subject = `[Ticket ${this.ticketLabel(fullTicket)}] Status updated`;
    const body = [
      `Status changed from ${previousStatus} to ${fullTicket.status}.`,
      '',
      `View: ${this.ticketLink(fullTicket.id)}`,
    ].join('\n');

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

  async notifyUsers(
    recipients: User[],
    details: {
      subject: string;
      body: string;
      eventType: string;
      ticketId?: string;
      payload?: Prisma.InputJsonValue;
    },
  ) {
    await this.queueEmails(recipients, details);
  }

  async notifyAddresses(
    addresses: string[],
    details: {
      subject: string;
      body: string;
      eventType: string;
      ticketId?: string;
      payload?: Prisma.InputJsonValue;
    },
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
    details: {
      subject: string;
      body: string;
      eventType: string;
      ticketId?: string;
      payload?: Prisma.InputJsonValue;
    },
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
    details: {
      subject: string;
      body: string;
      eventType: string;
      ticketId?: string;
      payload?: Prisma.InputJsonValue;
    },
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
    });

    await this.emailQueue.enqueue(outbox.id);
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
