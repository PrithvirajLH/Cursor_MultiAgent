import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  ticketId?: string;
  actorId?: string;
};

@Injectable()
export class InAppNotificationsService {
  private readonly logger = new Logger(InAppNotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new in-app notification
   */
  async create(input: CreateNotificationInput) {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        ticketId: input.ticketId,
        actorId: input.actorId,
      },
      include: {
        ticket: {
          select: {
            id: true,
            number: true,
            displayId: true,
            subject: true,
          },
        },
        actor: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
    });
  }

  /**
   * Create notifications for multiple users
   */
  async createMany(
    userIds: string[],
    notification: Omit<CreateNotificationInput, 'userId'>,
  ) {
    const uniqueUserIds = [...new Set(userIds)];
    const tasks = uniqueUserIds.map((userId) =>
      this.create({ ...notification, userId }).catch((error) => {
        this.logger.error(
          `Failed to create notification for user ${userId}`,
          (error as Error).stack,
        );
        return null;
      }),
    );
    return Promise.all(tasks);
  }

  /**
   * Get notifications for a user with pagination
   */
  async findForUser(
    userId: string,
    options: {
      page?: number;
      pageSize?: number;
      unreadOnly?: boolean;
    } = {},
  ) {
    const { page = 1, pageSize = 20, unreadOnly = false } = options;
    const skip = (page - 1) * pageSize;

    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          ticket: {
            select: {
              id: true,
              number: true,
              displayId: true,
              subject: true,
            },
          },
          actor: {
            select: {
              id: true,
              email: true,
              displayName: true,
            },
          },
        },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { userId, isRead: false },
      }),
    ]);

    return {
      data: notifications,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        unreadCount,
      },
    };
  }

  /**
   * Get unread count for a user
   */
  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(notificationId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId, // Ensure user can only mark their own notifications
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  /**
   * Delete old notifications (older than specified days)
   */
  async deleteOldNotifications(daysOld: number = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    return this.prisma.notification.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        isRead: true, // Only delete read notifications
      },
    });
  }

  // ============================================
  // Helper methods to create specific notifications
  // ============================================

  async notifyTicketAssigned(
    ticketId: string,
    assigneeId: string,
    actorId: string,
    ticketSubject: string,
  ) {
    if (assigneeId === actorId) return; // Don't notify self

    return this.create({
      userId: assigneeId,
      type: NotificationType.TICKET_ASSIGNED,
      title: 'Ticket assigned to you',
      body: ticketSubject,
      ticketId,
      actorId,
    });
  }

  async notifyNewMessage(
    ticketId: string,
    recipientIds: string[],
    actorId: string,
    ticketSubject: string,
    isInternal: boolean,
  ) {
    const filteredRecipients = recipientIds.filter((id) => id !== actorId);
    if (filteredRecipients.length === 0) return;

    return this.createMany(filteredRecipients, {
      type: NotificationType.NEW_MESSAGE,
      title: isInternal ? 'New internal note' : 'New reply on ticket',
      body: ticketSubject,
      ticketId,
      actorId,
    });
  }

  async notifyTicketResolved(
    ticketId: string,
    recipientIds: string[],
    actorId: string,
    ticketSubject: string,
  ) {
    const filteredRecipients = recipientIds.filter((id) => id !== actorId);
    if (filteredRecipients.length === 0) return;

    return this.createMany(filteredRecipients, {
      type: NotificationType.TICKET_RESOLVED,
      title: 'Ticket resolved',
      body: ticketSubject,
      ticketId,
      actorId,
    });
  }

  async notifyTicketTransferred(
    ticketId: string,
    recipientIds: string[],
    actorId: string,
    ticketSubject: string,
    toTeamName: string,
  ) {
    const filteredRecipients = recipientIds.filter((id) => id !== actorId);
    if (filteredRecipients.length === 0) return;

    return this.createMany(filteredRecipients, {
      type: NotificationType.TICKET_TRANSFERRED,
      title: `Ticket transferred to ${toTeamName}`,
      body: ticketSubject,
      ticketId,
      actorId,
    });
  }

  async notifySlaAtRisk(
    ticketId: string,
    recipientIds: string[],
    ticketSubject: string,
    timeRemaining: string,
  ) {
    return this.createMany(recipientIds, {
      type: NotificationType.SLA_AT_RISK,
      title: 'SLA at risk',
      body: `${ticketSubject} - ${timeRemaining} remaining`,
      ticketId,
    });
  }

  async notifySlaBreached(
    ticketId: string,
    recipientIds: string[],
    ticketSubject: string,
  ) {
    return this.createMany(recipientIds, {
      type: NotificationType.SLA_BREACHED,
      title: 'SLA breached',
      body: ticketSubject,
      ticketId,
    });
  }

  async notifyMentioned(
    ticketId: string,
    mentionedUserIds: string[],
    actorId: string,
    ticketSubject: string,
  ) {
    const filtered = mentionedUserIds.filter((id) => id !== actorId);
    if (filtered.length === 0) return;

    return this.createMany(filtered, {
      type: NotificationType.TICKET_MENTIONED,
      title: 'You were mentioned on a ticket',
      body: ticketSubject,
      ticketId,
      actorId,
    });
  }
}
