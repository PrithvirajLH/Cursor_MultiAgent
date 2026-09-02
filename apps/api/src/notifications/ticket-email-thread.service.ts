import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { OutboxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildOutboundMessageId,
  buildTicketRootMessageId,
  isUnroutableMessageId,
} from './email-threading.util';
import type { EmailOutboxMetadata } from './outbox.service';

/** RFC 5322 has no hard limit; 20 is what this codebase already used. */
const MAX_REFERENCES = 20;
/** How much prior ancestry to rebuild per side of the conversation. */
const ANCESTRY_LOOKBACK = 25;

type OutboundEmailContext = {
  subject: string;
  emailMetadata: EmailOutboxMetadata;
};

@Injectable()
export class TicketEmailThreadService {
  private readonly logger = new Logger(TicketEmailThreadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async buildOutboundEmailContext(params: {
    ticketId: string;
    ticketSubject: string;
    ticketDisplayId: string | null;
    ticketNumber: number;
    preferredInReplyTo?: string | null;
    additionalReferences?: string[] | null;
  }): Promise<OutboundEmailContext> {
    const thread = await this.getOrCreateThread(
      params.ticketId,
      params.ticketSubject,
    );
    const replyTo = this.buildReplyToAddress(thread.replyToken);
    // The one id that never changes for this ticket, and deliberately FIRST so
    // the cap below can never be the thing that drops it.
    const root = buildTicketRootMessageId(thread.replyToken, replyTo);
    const ancestry = await this.rebuildAncestry(params.ticketId, replyTo);
    const inReplyTo =
      params.preferredInReplyTo?.trim() ||
      this.pickInReplyTo(thread, root);
    const references = Array.from(
      new Set(
        [
          root,
          ...(params.additionalReferences ?? []),
          ...ancestry,
          params.preferredInReplyTo ?? undefined,
          thread.rootInboundMessageId ?? undefined,
          thread.lastInboundMessageId ?? undefined,
          thread.lastOutboundMessageId ?? undefined,
        ].filter(
          (value): value is string =>
            Boolean(value?.trim()) && !isUnroutableMessageId(value),
        ),
      ),
    ).slice(0, MAX_REFERENCES);

    return {
      subject: this.formatTicketSubject(
        thread.canonicalSubject,
        params.ticketDisplayId,
        params.ticketNumber,
      ),
      emailMetadata: {
        replyTo,
        inReplyTo: inReplyTo || null,
        references: references.length > 0 ? references : null,
      },
    };
  }

  /**
   * Every message id this conversation has really seen, oldest first.
   *
   * Recomputed rather than stored. `TicketEmailThread` has no column that could
   * hold a growing list - every field is a single VarChar(255) - and card 1.33
   * says stop rather than add one, so this rebuilds the same information from
   * rows that already exist.
   *
   * Two properties matter more than completeness:
   *  - Only SENT outbox rows count. A queued-but-never-delivered message is
   *    exactly what used to poison the chain, and it cannot get in here.
   *  - Anything without a routable domain is dropped, so historic
   *    `@localhost` ids stop being used as anchors without a data fixup.
   */
  private async rebuildAncestry(
    ticketId: string,
    replyAddress: string,
  ): Promise<string[]> {
    const [inbound, outbound] = await Promise.all([
      this.prisma.inboundEmailReceipt.findMany({
        where: { ticketId },
        orderBy: { createdAt: 'asc' },
        take: ANCESTRY_LOOKBACK,
        select: { messageId: true },
      }),
      this.prisma.notificationOutbox.findMany({
        where: { ticketId, status: OutboxStatus.SENT },
        orderBy: { createdAt: 'asc' },
        take: ANCESTRY_LOOKBACK,
        select: { id: true },
      }),
    ]);
    const ids = [
      ...inbound.map((row) => this.normalizeMessageId(row.messageId)),
      ...outbound.map((row) => buildOutboundMessageId(row.id, replyAddress)),
    ];
    return ids.filter(
      (id): id is string => Boolean(id) && !isUnroutableMessageId(id),
    );
  }

  /** Inbound ids arrive from other people's clients; bracket them if they are bare. */
  private normalizeMessageId(messageId: string | null | undefined) {
    const raw = messageId?.trim() ?? '';
    if (!raw) return '';
    return raw.startsWith('<') ? raw : `<${raw}>`;
  }

  async recordInboundEmail(params: {
    ticketId: string;
    ticketSubject: string;
    messageId: string;
    receivedAt?: Date;
  }) {
    const messageId = params.messageId.trim();
    if (!messageId) {
      return;
    }

    const thread = await this.getOrCreateThread(
      params.ticketId,
      params.ticketSubject,
    );

    await this.prisma.ticketEmailThread.update({
      where: { id: thread.id },
      data: {
        rootInboundMessageId: thread.rootInboundMessageId ?? messageId,
        lastInboundMessageId: messageId,
        lastInboundAt: params.receivedAt ?? new Date(),
      },
    });
  }

  async recordOutboundEmail(params: {
    ticketId: string;
    messageId: string;
    sentAt?: Date;
  }) {
    const messageId = params.messageId.trim();
    if (!messageId) {
      return;
    }
    // An id with no routable domain is worse than no id: it gets quoted forever
    // in every reply and can never be matched. Skip rather than persist it.
    if (isUnroutableMessageId(messageId)) {
      this.logger.warn(
        `Not recording an outbound message id for ticket ${params.ticketId}: no routable reply domain is configured`,
      );
      return;
    }

    const updated = await this.prisma.ticketEmailThread.updateMany({
      where: { ticketId: params.ticketId },
      data: {
        lastOutboundMessageId: messageId,
        lastOutboundAt: params.sentAt ?? new Date(),
      },
    });

    if (updated.count > 0) {
      return;
    }

    const thread = await this.getOrCreateThread(
      params.ticketId,
      'Ticket update',
    );
    await this.prisma.ticketEmailThread.update({
      where: { id: thread.id },
      data: {
        lastOutboundMessageId: messageId,
        lastOutboundAt: params.sentAt ?? new Date(),
      },
    });
  }

  async resolveTicketIdByReplyAddress(address: string | null | undefined) {
    const token = this.extractReplyToken(address);
    if (!token) {
      return null;
    }

    const thread = await this.prisma.ticketEmailThread.findUnique({
      where: { replyToken: token },
      select: { ticketId: true },
    });
    return thread?.ticketId ?? null;
  }

  extractReplyToken(address: string | null | undefined) {
    const email = this.extractEmailAddress(address);
    const atIndex = email.lastIndexOf('@');
    if (atIndex <= 0) {
      return null;
    }

    const localPart = email.slice(0, atIndex);
    const match = localPart.match(/\+ticket-([A-Za-z0-9_-]{16,128})$/i);
    return match?.[1]?.toLowerCase() ?? null;
  }

  getBaseReplyToAddress() {
    return (
      this.config.get<string>('SMTP_REPLY_TO') ??
      this.config.get<string>('SMTP_FROM') ??
      'no-reply@localhost'
    );
  }

  buildReplyToAddress(replyToken: string) {
    const base = this.extractEmailAddress(this.getBaseReplyToAddress());
    const atIndex = base.lastIndexOf('@');
    if (atIndex <= 0) {
      return base;
    }

    const localPart = base.slice(0, atIndex);
    const domain = base.slice(atIndex + 1);
    return `${localPart}+ticket-${replyToken}@${domain}`;
  }

  private async getOrCreateThread(ticketId: string, ticketSubject: string) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await this.prisma.ticketEmailThread.findUnique({
        where: { ticketId },
      });
      if (existing) {
        return existing;
      }

      try {
        return await this.prisma.ticketEmailThread.create({
          data: {
            ticketId,
            replyToken: this.generateReplyToken(),
            canonicalSubject: this.normalizeCanonicalSubject(ticketSubject),
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }

        throw error;
      }
    }

    const thread = await this.prisma.ticketEmailThread.findUnique({
      where: { ticketId },
    });
    if (thread) {
      return thread;
    }

    throw new Error(
      `Unable to create ticket email thread for ticket ${ticketId}`,
    );
  }

  private normalizeCanonicalSubject(subject: string) {
    const normalized = subject.trim();
    return normalized || 'Ticket update';
  }

  private formatTicketSubject(
    canonicalSubject: string,
    displayId: string | null,
    ticketNumber: number,
  ) {
    const label = displayId ?? (ticketNumber > 0 ? `#${ticketNumber}` : null);
    if (!label) {
      return canonicalSubject;
    }

    return `${canonicalSubject} [${label}]`;
  }

  /**
   * In-Reply-To should name a message the recipient actually holds.
   *
   * Their own last inbound message is the safest such thing: they sent it, so
   * it is in their sent items. Failing that, the synthetic root, which every
   * email about this ticket references.
   *
   * Deliberately NEVER `lastOutboundMessageId`. That field is shared across the
   * whole ticket while Message-IDs were per recipient, so it usually named
   * somebody else's copy - which is the fault that made at least one recipient
   * of every multi-recipient reply unable to thread.
   */
  private pickInReplyTo(
    thread: {
      rootInboundMessageId: string | null;
      lastInboundMessageId: string | null;
    },
    root: string,
  ) {
    const candidates = [
      thread.lastInboundMessageId,
      thread.rootInboundMessageId,
      root,
    ];
    for (const candidate of candidates) {
      const normalized = this.normalizeMessageId(candidate);
      if (normalized && !isUnroutableMessageId(normalized)) {
        return normalized;
      }
    }
    return undefined;
  }

  private extractEmailAddress(address: string | null | undefined) {
    const raw = address?.trim() ?? '';
    if (!raw) {
      return '';
    }

    const bracketMatch = raw.match(/<([^<>]+)>/);
    if (bracketMatch?.[1]) {
      return bracketMatch[1].trim().toLowerCase();
    }

    return raw.toLowerCase();
  }

  private generateReplyToken() {
    return randomBytes(18).toString('hex');
  }
}
