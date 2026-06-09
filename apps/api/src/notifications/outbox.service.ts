import { Injectable } from '@nestjs/common';
import { NotificationChannel, OutboxStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Maximum delivery attempts for an email outbox row. Must stay in sync with the
 * BullMQ job `attempts` in EmailQueueService — `claimPending` increments the row's
 * `attempts` on each try, and `markFailed` keeps the row retryable (PENDING) until
 * this budget is exhausted.
 */
export const MAX_EMAIL_OUTBOX_ATTEMPTS = 5;

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

  /**
   * Record a failed delivery attempt. For retryable failures the row is returned
   * to PENDING (so the queue's next retry can re-claim it via `claimPending`) until
   * the attempt budget is exhausted, after which it is marked terminally FAILED.
   * Non-retryable failures (e.g. SMTP not configured) are marked FAILED immediately.
   */
  async markFailed(id: string, error: string, retryable = true) {
    let nextStatus: OutboxStatus = OutboxStatus.FAILED;

    if (retryable) {
      const record = await this.prisma.notificationOutbox.findUnique({
        where: { id },
        select: { attempts: true },
      });
      // `attempts` is incremented by claimPending on every delivery attempt.
      if (
        (record?.attempts ?? MAX_EMAIL_OUTBOX_ATTEMPTS) <
        MAX_EMAIL_OUTBOX_ATTEMPTS
      ) {
        nextStatus = OutboxStatus.PENDING;
      }
    }

    return this.prisma.notificationOutbox.update({
      where: { id },
      data: {
        status: nextStatus,
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
