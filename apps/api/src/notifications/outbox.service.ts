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
  /**
   * Everyone else on a public reply (card 1.33). Carried in the payload
   * envelope rather than a column: NotificationOutbox has no `cc` field and
   * this card adds no migration, and the envelope already carries the other
   * per-message headers.
   */
  cc?: string[] | null;
};

export type EmailOutboxContent = {
  html?: string | null;
};

/** How much mail is waiting, stuck, sent or given up on. Numbers only. */
export type OutboxCounts = {
  pending: number;
  processing: number;
  sent: number;
  failed: number;
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

  /**
   * One row per status, in a single groupBy rather than four counts.
   *
   * Numbers only, deliberately: this feeds /api/health/ready and the operations
   * console, and neither may carry a recipient, a subject or a body.
   */
  async counts(): Promise<OutboxCounts> {
    const grouped = await this.prisma.notificationOutbox.groupBy({
      by: ['status'],
      where: { channel: NotificationChannel.EMAIL },
      _count: { _all: true },
    });
    const counts: OutboxCounts = {
      pending: 0,
      processing: 0,
      sent: 0,
      failed: 0,
    };
    for (const row of grouped) {
      const total = row._count._all;
      if (row.status === OutboxStatus.PENDING) counts.pending = total;
      else if (row.status === OutboxStatus.PROCESSING) counts.processing = total;
      else if (row.status === OutboxStatus.SENT) counts.sent = total;
      else if (row.status === OutboxStatus.FAILED) counts.failed = total;
    }
    return counts;
  }

  /**
   * Rows still worth another attempt: PENDING with attempts left.
   *
   * FAILED is deliberately excluded. A row reaches FAILED either by exhausting
   * its attempts or because the failure was terminal ('SMTP not configured', a
   * suppressed address) - and retrying the latter would send mail somebody
   * decided should not be sent. Oldest first, so a backlog drains in order.
   */
  async listRetryablePending(
    limit: number,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<string[]> {
    const rows = await client.notificationOutbox.findMany({
      where: {
        channel: NotificationChannel.EMAIL,
        status: OutboxStatus.PENDING,
        attempts: { lt: MAX_EMAIL_OUTBOX_ATTEMPTS },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Rescue rows abandoned mid-send.
   *
   * `claimPending` moves a row to PROCESSING; a process that dies before
   * markSent or markFailed leaves it there forever, in a status nothing looks
   * at. Anything older than the cutoff goes back to PENDING - unless it has
   * already used its attempts, in which case it goes to FAILED rather than
   * round again.
   */
  async reclaimStaleProcessing(
    olderThan: Date,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<{ reclaimed: number; exhausted: number }> {
    const exhausted = await client.notificationOutbox.updateMany({
      where: {
        channel: NotificationChannel.EMAIL,
        status: OutboxStatus.PROCESSING,
        updatedAt: { lt: olderThan },
        attempts: { gte: MAX_EMAIL_OUTBOX_ATTEMPTS },
      },
      data: {
        status: OutboxStatus.FAILED,
        lastError: 'Abandoned mid-send and out of attempts',
      },
    });
    const reclaimed = await client.notificationOutbox.updateMany({
      where: {
        channel: NotificationChannel.EMAIL,
        status: OutboxStatus.PROCESSING,
        updatedAt: { lt: olderThan },
        attempts: { lt: MAX_EMAIL_OUTBOX_ATTEMPTS },
      },
      data: { status: OutboxStatus.PENDING },
    });
    return { reclaimed: reclaimed.count, exhausted: exhausted.count };
  }

  /**
   * How a specific batch of rows ended up, read from the rows themselves.
   *
   * The processor returns without throwing in cases where nothing was actually
   * sent - 'SMTP not configured' is recorded as a terminal failure and returns
   * normally - so counting its return values would report sends that never
   * happened. The row's own status is the only honest source.
   */
  async summariseOutcomes(
    ids: string[],
  ): Promise<{ sent: number; failed: number; pending: number }> {
    if (ids.length === 0) {
      return { sent: 0, failed: 0, pending: 0 };
    }
    const grouped = await this.prisma.notificationOutbox.groupBy({
      by: ['status'],
      where: { id: { in: ids } },
      _count: { _all: true },
    });
    const outcome = { sent: 0, failed: 0, pending: 0 };
    for (const row of grouped) {
      const total = row._count._all;
      if (row.status === OutboxStatus.SENT) outcome.sent = total;
      else if (row.status === OutboxStatus.FAILED) outcome.failed = total;
      else outcome.pending += total;
    }
    return outcome;
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
      if (emailMetadata.cc && emailMetadata.cc.length > 0) {
        email.cc = emailMetadata.cc;
      }
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
