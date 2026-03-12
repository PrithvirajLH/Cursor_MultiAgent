import { Injectable } from '@nestjs/common';
import { NotificationChannel, OutboxStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type EmailOutboxMetadata = {
  replyTo?: string | null;
  inReplyTo?: string | null;
  references?: string[] | null;
};

export type EmailOutboxContent = {
  html?: string | null;
};

@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async createEmail(payload: {
    toEmail: string;
    toUserId?: string | null;
    ticketId?: string | null;
    subject: string;
    body: string;
    eventType: string;
    payload?: Prisma.InputJsonValue | null;
    emailMetadata?: EmailOutboxMetadata | null;
    emailContent?: EmailOutboxContent | null;
  }) {
    return this.prisma.notificationOutbox.create({
      data: {
        channel: NotificationChannel.EMAIL,
        status: OutboxStatus.PENDING,
        eventType: payload.eventType,
        toEmail: payload.toEmail,
        toUserId: payload.toUserId ?? null,
        ticketId: payload.ticketId ?? null,
        subject: payload.subject,
        body: payload.body,
        payload: this.buildPayloadEnvelope(
          payload.payload ?? null,
          payload.emailMetadata ?? null,
          payload.emailContent ?? null,
        ),
      },
    });
  }

  async claimPending(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.notificationOutbox.updateMany({
        where: {
          id,
          status: OutboxStatus.PENDING,
        },
        data: {
          status: OutboxStatus.PROCESSING,
          attempts: { increment: 1 },
        },
      });

      if (claimed.count !== 1) {
        return null;
      }

      return tx.notificationOutbox.findUnique({ where: { id } });
    });
  }

  async markSent(id: string) {
    return this.prisma.notificationOutbox.update({
      where: { id },
      data: {
        status: OutboxStatus.SENT,
        sentAt: new Date(),
        lastError: null,
      },
    });
  }

  async markFailed(id: string, error: string) {
    return this.prisma.notificationOutbox.update({
      where: { id },
      data: {
        status: OutboxStatus.FAILED,
        lastError: error,
      },
    });
  }

  private buildPayloadEnvelope(
    eventPayload: Prisma.InputJsonValue | null,
    emailMetadata: EmailOutboxMetadata | null,
    emailContent: EmailOutboxContent | null,
  ) {
    const envelope: Record<string, Prisma.InputJsonValue> = {};

    if (eventPayload !== null) {
      envelope.event = eventPayload;
    }

    if (emailMetadata) {
      const email: Record<string, Prisma.InputJsonValue> = {};
      if (emailMetadata.replyTo) {
        email.replyTo = emailMetadata.replyTo;
      }

      if (emailMetadata.inReplyTo) {
        email.inReplyTo = emailMetadata.inReplyTo;
      }

      const references =
        emailMetadata.references?.filter(Boolean).slice(0, 20) ?? [];
      if (references.length > 0) {
        email.references = references;
      }

      if (Object.keys(email).length > 0) {
        envelope.email = email;
      }
    }

    if (emailContent?.html) {
      envelope.content = {
        html: emailContent.html,
      };
    }

    return Object.keys(envelope).length > 0 ? envelope : undefined;
  }
}
