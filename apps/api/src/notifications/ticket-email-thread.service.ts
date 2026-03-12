import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { EmailOutboxMetadata } from './outbox.service';

type OutboundEmailContext = {
  subject: string;
  emailMetadata: EmailOutboxMetadata;
};

@Injectable()
export class TicketEmailThreadService {
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
    const inReplyTo =
      params.preferredInReplyTo?.trim() ||
      this.pickThreadAnchorMessageId(thread);
    const references = Array.from(
      new Set(
        [
          ...(params.additionalReferences ?? []),
          params.preferredInReplyTo ?? undefined,
          thread.rootInboundMessageId ?? undefined,
          thread.lastInboundMessageId ?? undefined,
          thread.lastOutboundMessageId ?? undefined,
        ].filter((value): value is string => Boolean(value?.trim())),
      ),
    ).slice(0, 20);

    return {
      subject: this.formatTicketSubject(
        thread.canonicalSubject,
        params.ticketDisplayId,
        params.ticketNumber,
      ),
      emailMetadata: {
        replyTo: this.buildReplyToAddress(thread.replyToken),
        inReplyTo: inReplyTo || null,
        references: references.length > 0 ? references : null,
      },
    };
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

  async reserveOutboundEmail(params: { ticketId: string; messageId: string }) {
    const messageId = params.messageId.trim();
    if (!messageId) {
      return;
    }

    const updated = await this.prisma.ticketEmailThread.updateMany({
      where: { ticketId: params.ticketId },
      data: {
        lastOutboundMessageId: messageId,
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

  private pickThreadAnchorMessageId(thread: {
    rootInboundMessageId: string | null;
    lastInboundMessageId: string | null;
    lastInboundAt: Date | null;
    lastOutboundMessageId: string | null;
    lastOutboundAt: Date | null;
  }) {
    // Keep the whole ticket anchored to the first inbound message whenever
    // possible. Outlook-style clients are much more reliable when follow-up
    // notifications reply to the root thread rather than hopping across the
    // latest outbound update.
    return (
      thread.rootInboundMessageId ??
      thread.lastInboundMessageId ??
      thread.lastOutboundMessageId ??
      undefined
    );
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
