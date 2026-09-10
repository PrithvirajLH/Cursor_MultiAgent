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

/**
 * Why a row was stopped, written into `lastError` (card 1.47).
 *
 * Exported so a test can assert the reason rather than matching a string
 * literal in two places.
 */
export const REDACTION_CANCELLED_REASON =
  'Cancelled: the message was removed before this email was sent';

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
  /**
   * The CANONICAL ticket subject, without the `[PA_…]` tag (card 1.66).
   *
   * Outlook derives its ConversationTopic from `Thread-Topic`, and it strips
   * `RE:`/`FW:` prefixes but NOT a bracketed suffix. Sending the tagged subject
   * put our replies in a different conversation from the requester's own
   * original mail, which carries the untagged one. `Subject` keeps the tag; only
   * the topic drops it.
   */
  threadTopic?: string | null;
  /** Stable per-ticket ConversationIndex (card 1.66). */
  threadIndex?: string | null;
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


  /**
   * Stop still-unsent email for a message that has just been redacted (1.47).
   *
   * ⚠️ THIS IS A RACE AND IS WRITTEN AS ONE. Production has no Redis, so the
   * sweeper delivers on a 60-second interval - a PENDING row can sit for most
   * of a minute, which is exactly the window in which somebody notices they
   * sent the wrong thing. The sweeper can claim a row (PENDING -> PROCESSING)
   * between the caller's read and this write, so every update is conditional on
   * the status STILL being PENDING and the caller is told which ones it won.
   * An unconditional `update` by id - what `markFailed` does - would silently
   * overwrite a row the sweeper was already sending, and the caller would
   * report a stop that never happened.
   *
   * One row at a time rather than one `updateMany` over all of them, because
   * the caller needs to know WHICH ids it claimed: it has to blank their stored
   * text, and it has to be able to say honestly that the rest got away. A
   * public reply produces a single outbox row (card 1.33), so this loop is
   * one iteration in practice.
   *
   * FAILED, not a new CANCELLED status: `OutboxStatus` has no such value and
   * adding one needs a migration that cannot use the value in its own
   * transaction (migrations 54 and 56). `attempts` is pushed to the ceiling so
   * the budget rule in `markFailed` can never make it retryable again.
   */
  async cancelUnsentForRedaction(ids: string[]): Promise<string[]> {
    const stopped: string[] = [];
    for (const id of ids) {
      const result = await this.prisma.notificationOutbox.updateMany({
        where: { id, status: OutboxStatus.PENDING },
        data: {
          status: OutboxStatus.FAILED,
          lastError: REDACTION_CANCELLED_REASON,
          attempts: MAX_EMAIL_OUTBOX_ATTEMPTS,
          // The rendered email carried the message text. The processor reads
          // this column at send time, so blanking it is what actually stops
          // the words going out even if something later flips the status back.
          body: '',
        },
      });
      if (result.count === 1) {
        stopped.push(id);
      }
    }
    if (stopped.length > 0) {
      await this.blankStoredHtml(stopped);
    }
    return stopped;
  }

  /**
   * Take the redacted text out of rows that are done with (card 1.47).
   *
   * `NotificationOutbox.body` holds the fully rendered message for ever,
   * because the retention job that would delete it is off. Card 1.11 refused
   * to preserve redacted text in a `TicketEvent` on the grounds that it moves
   * PHI into a row with weaker read rules than the message it came from; that
   * argument applies to this column word for word.
   *
   * ⚠️ SENT **AND** FAILED, and the second half was a gap the browser pass
   * found. A FAILED row was never delivered, but it keeps the text just as
   * long - and with no SMTP configured, production marks EVERY message email
   * "SMTP not configured" and FAILED, so that is not the rare case, it is the
   * only case. Scrubbing only SENT rows would have left the words sitting in
   * the column on nearly every row there is.
   *
   * `subject`, `toEmail` and the timestamps stay, so "did we email this, to
   * whom, when" still has an answer. Only the words go.
   */
  async scrubSentBodyForRedaction(ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const result = await this.prisma.notificationOutbox.updateMany({
      where: { id: { in: ids } },
      data: { body: '' },
    });
    await this.blankStoredHtml(ids);
    return result.count;
  }

  /**
   * Blank `payload.content.html`, which is the other half of the text.
   *
   * The processor sends `text: record.body` AND `html: metadata.html`, and that
   * html is read from `payload.content.html` (email-processor.service.ts's
   * `getEmailMetadata`). Blanking the column alone would leave the message
   * sitting in the JSON envelope and, mid-window, still deliverable.
   *
   * Raw SQL because this is per-row JSON surgery: `jsonb_set` with
   * create_missing = false leaves a payload that has no `content` key exactly
   * as it was, and a NULL payload stays NULL.
   */
  private async blankStoredHtml(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.prisma.$executeRaw`
      UPDATE "NotificationOutbox"
      SET "payload" = jsonb_set("payload", '{content,html}', '""'::jsonb, false)
      WHERE "id" IN (${Prisma.join(ids)})
    `;
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
