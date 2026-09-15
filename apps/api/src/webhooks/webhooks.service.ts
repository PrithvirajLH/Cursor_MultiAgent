import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationChannel, OutboxStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { MAX_EMAIL_OUTBOX_ATTEMPTS, OutboxService } from '../notifications/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildWebhookEnvelope,
  WEBHOOK_EVENTS,
  type WebhookEvent,
} from './webhook-payload.util';
import { sendWebhook } from './webhook-sender.util';
import { inspectWebhookUrl } from './webhook-url.util';

/** How many deliveries one sweep will attempt. Keeps a sweep bounded. */
const DELIVERY_BATCH = 25;

/** What an admin may see about a subscription. Never the signing secret. */
export interface WebhookSubscriptionSummary {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: Date;
}

/** A newly created subscription — the only time the secret is visible. */
export interface CreatedWebhookSubscription extends WebhookSubscriptionSummary {
  /** ⚠️ Shown once. The consumer needs it to verify signatures. */
  secret: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Register a destination.
   *
   * ⚠️ The URL is checked HERE as well as at send time, so an admin finds out
   * immediately rather than discovering it in a dead delivery an hour later.
   * The send-time check is the one that is actually load-bearing — see
   * `webhook-sender.util.ts`.
   */
  async createSubscription(input: {
    url: string;
    events: string[];
  }): Promise<CreatedWebhookSubscription> {
    const verdict = inspectWebhookUrl(input.url);
    if (!verdict.ok) {
      throw new BadRequestException(verdict.reason);
    }
    const unknown = input.events.filter(
      (event) => !WEBHOOK_EVENTS.includes(event as WebhookEvent),
    );
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown event(s): ${unknown.join(', ')}. Known events: ${WEBHOOK_EVENTS.join(', ')}`,
      );
    }
    if (input.events.length === 0) {
      throw new BadRequestException('Subscribe to at least one event');
    }
    const secret = randomBytes(32).toString('base64url');
    const row = await this.prisma.webhookSubscription.create({
      data: { url: verdict.url.toString(), secret, events: input.events },
    });
    return {
      id: row.id,
      url: row.url,
      events: row.events,
      isActive: row.isActive,
      createdAt: row.createdAt,
      secret,
    };
  }

  /** Every subscription, without its secret. */
  async listSubscriptions(): Promise<WebhookSubscriptionSummary[]> {
    const rows = await this.prisma.webhookSubscription.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      url: row.url,
      events: row.events,
      isActive: row.isActive,
      createdAt: row.createdAt,
    }));
  }

  /** Stop delivering to a destination without losing its history. */
  async deactivateSubscription(id: string): Promise<{ id: string }> {
    const existing = await this.prisma.webhookSubscription.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Webhook subscription not found');
    }
    await this.prisma.webhookSubscription.update({
      where: { id },
      data: { isActive: false },
    });
    return { id };
  }

  /**
   * The deliveries that have given up, so an admin can see them.
   *
   * ⚠️ A webhook that silently stopped delivering is worse than one that never
   * worked, which is why the dead state is queryable rather than only a status
   * column nobody reads.
   */
  async listDeadDeliveries(): Promise<
    { id: string; url: string; eventType: string; attempts: number; lastError: string | null }[]
  > {
    const rows = await this.prisma.notificationOutbox.findMany({
      where: { channel: NotificationChannel.WEBHOOK, status: OutboxStatus.FAILED },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        toEmail: true,
        eventType: true,
        attempts: true,
        lastError: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      url: row.toEmail,
      eventType: row.eventType,
      attempts: row.attempts,
      lastError: row.lastError,
    }));
  }

  /**
   * Queue one event for every subscription that asked for it (card 2.6).
   *
   * ⚠️ RIDES `NotificationOutbox` RATHER THAN A SECOND TABLE. That table already
   * carries PENDING / PROCESSING / SENT / FAILED, an attempt counter and the
   * "a failed send does not vanish" behaviour card 1.32 built, and every query
   * in `outbox.service.ts` filters `channel: EMAIL` — so the mail sender cannot
   * see these rows and nothing about email changes. A second, subtly different
   * delivery pipeline is the shape this project keeps paying for.
   *
   * ⚠️ The column names are email's. For a WEBHOOK row `toEmail` is the
   * destination URL and `subject` is the event name; both are read only by the
   * code in this file. That is the price of one pipeline instead of two, and it
   * is cheaper than the alternative: making three required email columns
   * nullable, which would turn them `string | null` across the live
   * notifications code for the benefit of a feature they have nothing to do with.
   *
   * Fire-and-forget: a webhook must never fail the ticket operation that caused
   * it.
   */
  async emit(
    event: WebhookEvent,
    payload: Parameters<typeof buildWebhookEnvelope>[0],
  ): Promise<void> {
    try {
      const subscriptions = await this.prisma.webhookSubscription.findMany({
        where: { isActive: true, events: { has: event } },
        select: { id: true, url: true },
      });
      if (subscriptions.length === 0) {
        return;
      }
      const envelope = buildWebhookEnvelope(payload);
      const body = JSON.stringify(envelope);
      await this.prisma.notificationOutbox.createMany({
        data: subscriptions.map((subscription) => ({
          channel: NotificationChannel.WEBHOOK,
          status: OutboxStatus.PENDING,
          eventType: event,
          toEmail: subscription.url,
          toUserId: null,
          ticketId: payload.ticketId,
          subject: event,
          body,
          payload: { subscriptionId: subscription.id },
        })),
      });
    } catch (error) {
      // Never let an outbound integration break intake.
      this.logger.error(
        `Failed to queue webhook ${event}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /**
   * Attempt the queued deliveries.
   *
   * Uses `OutboxService.claimPending` / `markSent` / `markFailed` unchanged —
   * those work by id and are channel-agnostic, so the retry budget, the backoff
   * through PENDING and the terminal FAILED state are literally the same code
   * email uses, not a copy that agrees today.
   */
  async deliverPending(): Promise<{ attempted: number; sent: number; failed: number }> {
    const due = await this.prisma.notificationOutbox.findMany({
      where: {
        channel: NotificationChannel.WEBHOOK,
        status: OutboxStatus.PENDING,
        attempts: { lt: MAX_EMAIL_OUTBOX_ATTEMPTS },
      },
      orderBy: { createdAt: 'asc' },
      take: DELIVERY_BATCH,
      select: { id: true },
    });
    let sent = 0;
    let failed = 0;
    for (const row of due) {
      const claimed = await this.outbox.claimPending(row.id);
      if (!claimed) {
        continue;
      }
      const subscriptionId = (claimed.payload as { subscriptionId?: string } | null)
        ?.subscriptionId;
      const subscription = subscriptionId
        ? await this.prisma.webhookSubscription.findUnique({
            where: { id: subscriptionId },
            select: { secret: true, isActive: true },
          })
        : null;
      if (!subscription || !subscription.isActive) {
        // Deactivated after queueing: stop trying, and say why.
        await this.outbox.markFailed(
          claimed.id,
          'Subscription is no longer active',
          false,
        );
        failed += 1;
        continue;
      }
      const result = await sendWebhook({
        url: claimed.toEmail,
        secret: subscription.secret,
        body: claimed.body,
      });
      if (result.ok) {
        await this.outbox.markSent(claimed.id);
        sent += 1;
      } else {
        // ⚠️ The error is recorded verbatim, and it must never contain the
        // signing secret - `sendWebhook` returns transport errors only.
        await this.outbox.markFailed(claimed.id, result.error);
        failed += 1;
      }
    }
    return { attempted: due.length, sent, failed };
  }
}
