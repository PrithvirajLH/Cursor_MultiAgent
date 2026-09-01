import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { resolveOutboundRecipients } from './outbound-recipients.util';
import { REPLY_ABOVE_MARKER } from './quoted-reply.util';

/** A comma-separated env list to trimmed, de-duplicated addresses. */
function parseAddressList(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const address = part.trim();
    if (address !== '') seen.add(address);
  }
  return [...seen];
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private fromAddress: string;
  private replyToAddress: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT') ?? '587');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    const secure = this.config.get<string>('SMTP_SECURE') === 'true';
    this.fromAddress =
      this.config.get<string>('SMTP_FROM') ?? 'no-reply@localhost';
    this.replyToAddress =
      this.config.get<string>('SMTP_REPLY_TO') ?? this.fromAddress;

    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user && pass ? { user, pass } : undefined,
      });
    }
  }

  isConfigured() {
    return Boolean(this.transporter);
  }

  getReplyToAddress() {
    return this.replyToAddress;
  }

  /**
   * The pilot list, read from the environment on **every** call rather than
   * captured in the constructor.
   *
   * ConfigService snapshots the environment when the module loads, so a value
   * read through it would need a restart to take effect - exactly the trap this
   * switch exists to avoid, since it is the thing an operator flips when a test
   * send is about to go somewhere it should not.
   */
  private pilotRecipients(): string[] {
    return parseAddressList(process.env.EMAIL_TEST_RECIPIENTS);
  }

  /**
   * Send one email.
   *
   * Three things happen here that did not before card 1.22, in this order:
   *
   * 1. **The pilot switch.** While EMAIL_TEST_RECIPIENTS is set the intended
   *    recipient list is REPLACED - never merged, appended to, or fallen back
   *    on. There is deliberately no branch below that can put `payload.to` on
   *    the wire while the pilot list is non-empty, and a test pins that.
   * 2. **The recipient guard**, applied here as well as at the composing end so
   *    a future caller cannot reach the transport with an outside address by
   *    building its own payload. Refusals are dropped and counted, never
   *    logged as addresses.
   * 3. **The reply-above marker**, so an eventual reply has a reliable line to
   *    be trimmed at.
   */
  async sendEmail(payload: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    replyTo?: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string[];
  }) {
    if (!this.transporter) {
      throw new Error('SMTP not configured');
    }

    const intended = parseAddressList(payload.to);
    const pilot = this.pilotRecipients();
    const isPilot = pilot.length > 0;
    const requested = isPilot ? pilot : intended;
    const { allowed, refused } = resolveOutboundRecipients({
      recipients: requested.map((address) => ({ address })),
    });
    if (refused.length > 0) {
      // Count and reason only: addresses do not go in the log.
      this.logger.warn(
        `Outbound guard refused ${refused.length} recipient(s): ${refused
          .map((entry) => entry.reason)
          .join(', ')}`,
      );
    }
    if (allowed.length === 0) {
      throw new Error('No allowed recipients after the outbound guard');
    }

    await this.transporter.sendMail({
      from: this.fromAddress,
      replyTo: payload.replyTo ?? this.replyToAddress,
      to: allowed,
      subject: payload.subject,
      text: this.decorateBody(payload.text, isPilot ? intended : null),
      html: this.decorateHtmlBody(payload.html, isPilot ? intended : null),
      messageId: payload.messageId,
      inReplyTo: payload.inReplyTo,
      references: payload.references,
      headers: {
        'Thread-Topic': payload.subject,
      },
    });
  }

  /**
   * Marker first, then the pilot note, then the body.
   *
   * That order matters: a reply quotes everything from the marker down, so a
   * note placed above it would survive the trim and show up in the agent's view
   * of the customer's reply.
   */
  private decorateBody(text: string, intended: string[] | null): string {
    const parts = [REPLY_ABOVE_MARKER, ''];
    if (intended !== null) {
      parts.push(this.pilotNotice(intended), '');
    }
    parts.push(text);
    return parts.join('\n');
  }

  private decorateHtmlBody(
    html: string | undefined,
    intended: string[] | null,
  ): string | undefined {
    if (html === undefined) {
      return undefined;
    }
    const header = [`<p>${REPLY_ABOVE_MARKER}</p>`];
    if (intended !== null) {
      header.push(`<p>${this.pilotNotice(intended)}</p>`);
    }
    return `${header.join('')}${html}`;
  }

  private pilotNotice(intended: string[]): string {
    const audience = intended.length > 0 ? intended.join(', ') : '(nobody)';
    return `[pilot mode] EMAIL_TEST_RECIPIENTS is set, so this was delivered to the pilot list. It would otherwise have gone to: ${audience}`;
  }
}
