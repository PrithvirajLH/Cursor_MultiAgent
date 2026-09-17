import { Injectable } from '@nestjs/common';
import { EmailService } from './email.service';
import { OutboxService } from './outbox.service';
import { buildOutboundMessageId } from './email-threading.util';
import { TicketEmailThreadService } from './ticket-email-thread.service';
import { InlineEmailImagesService } from '../common/inline-email-images.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getEmailMetadata(payload: unknown) {
  if (!isRecord(payload)) {
    return {
      replyTo: undefined,
      inReplyTo: undefined,
      references: undefined,
      html: undefined,
      inlineImages: [],
    };
  }

  const email = isRecord(payload.email) ? payload.email : {};
  const content = isRecord(payload.content) ? payload.content : {};

  const replyTo = typeof email.replyTo === 'string' ? email.replyTo : undefined;
  const inReplyTo =
    typeof email.inReplyTo === 'string' ? email.inReplyTo : undefined;
  const references = Array.isArray(email.references)
    ? email.references.filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      )
    : undefined;
  const cc = Array.isArray(email.cc)
    ? email.cc.filter(
        (value): value is string => typeof value === 'string' && value !== '',
      )
    : undefined;
  const html = typeof content.html === 'string' ? content.html : undefined;
  // ⚠️ CARD 1.130: ids and cids only. The bytes are read at send time, because
  // a screenshot does not belong in a JSON column once per recipient.
  const inlineImages = Array.isArray(content.inlineImages)
    ? content.inlineImages.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const attachmentId = entry.attachmentId;
        const cid = entry.cid;
        return typeof attachmentId === 'string' && typeof cid === 'string'
          ? [{ attachmentId, cid }]
          : [];
      })
    : [];
  // Card 1.31: the agent's name rides on the event half of the envelope, put
  // there by NotificationsService.messageAdded. Absent for every other event,
  // which is what makes those keep the generic identity.
  const event = isRecord(payload.event) ? payload.event : {};
  const agentDisplayName =
    typeof event.agentDisplayName === 'string' &&
    event.agentDisplayName.trim() !== ''
      ? event.agentDisplayName
      : undefined;

  return {
    replyTo,
    inReplyTo,
    references,
    cc,
    html,
    agentDisplayName,
    inlineImages,
  };
}

@Injectable()
export class EmailProcessorService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly email: EmailService,
    private readonly ticketEmailThreads: TicketEmailThreadService,
    // ⚠️ CARD 1.130: from `common/`, which is @Global - `TicketsModule` imports
    // THIS module, so reaching the other way would close a cycle.
    private readonly inlineEmailImages: InlineEmailImagesService,
  ) {}

  async process(outboxId: string) {
    const record = await this.outbox.claimPending(outboxId);
    if (!record) {
      return;
    }

    if (!this.email.isConfigured()) {
      // Terminal config failure — retrying immediately cannot help.
      await this.outbox.markFailed(outboxId, 'SMTP not configured', false);
      return;
    }

    try {
      const metadata = getEmailMetadata(record.payload);
      const replyTo = metadata.replyTo ?? this.email.getReplyToAddress();
      const messageId = buildOutboundMessageId(record.id, replyTo);
      // ⚠️ CARD 1.130. NEVER FATAL: `readInlineImages` refuses and logs rather
      // than throwing, and an email that cannot be sent because a picture is
      // missing is strictly worse than one without the picture. Anything left
      // out is named by the renderer instead.
      const attachments =
        metadata.inlineImages.length > 0 && record.ticketId
          ? await this.inlineEmailImages.readInlineImages(
              record.ticketId,
              metadata.inlineImages,
            )
          : [];
      await this.email.sendEmail({
        to: record.toEmail,
        subject: record.subject,
        text: record.body,
        html: metadata.html,
        cc: metadata.cc,
        agentDisplayName: metadata.agentDisplayName,
        replyTo,
        messageId,
        inReplyTo: metadata.inReplyTo,
        references: metadata.references,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      await this.outbox.markSent(outboxId);
      if (record.ticketId) {
        await this.ticketEmailThreads
          .recordOutboundEmail({
            ticketId: record.ticketId,
            messageId,
          })
          .catch(() => undefined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.outbox.markFailed(outboxId, message);
      throw error;
    }
  }
}
