import { Injectable } from '@nestjs/common';
import { OutboxStatus } from '@prisma/client';
import { EmailService } from './email.service';
import { OutboxService } from './outbox.service';
import { buildOutboundMessageId } from './email-threading.util';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getEmailMetadata(payload: unknown) {
  if (!isRecord(payload)) {
    return {
      inReplyTo: undefined,
      references: undefined,
      html: undefined,
    };
  }

  const email = isRecord(payload.email) ? payload.email : {};
  const content = isRecord(payload.content) ? payload.content : {};

  const inReplyTo =
    typeof email.inReplyTo === 'string'
      ? email.inReplyTo
      : undefined;
  const references = Array.isArray(email.references)
    ? email.references.filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      )
    : undefined;
  const html = typeof content.html === 'string' ? content.html : undefined;

  return { inReplyTo, references, html };
}

@Injectable()
export class EmailProcessorService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly email: EmailService,
  ) {}

  async process(outboxId: string) {
    const record = await this.outbox.findById(outboxId);
    if (!record) {
      return;
    }

    if (record.status === OutboxStatus.SENT) {
      return;
    }

    await this.outbox.markProcessing(outboxId);

    if (!this.email.isConfigured()) {
      await this.outbox.markFailed(outboxId, 'SMTP not configured');
      return;
    }

    try {
      const metadata = getEmailMetadata(record.payload);
      const replyTo = this.email.getReplyToAddress();
      await this.email.sendEmail({
        to: record.toEmail,
        subject: record.subject,
        text: record.body,
        html: metadata.html,
        messageId: buildOutboundMessageId(record.id, replyTo),
        inReplyTo: metadata.inReplyTo,
        references: metadata.references,
      });
      await this.outbox.markSent(outboxId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.outbox.markFailed(outboxId, message);
      throw error;
    }
  }
}
