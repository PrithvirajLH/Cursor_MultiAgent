import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { EmailSuppressionService } from './email-suppression.service';
import { buildFromIdentity } from './from-identity.util';
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

/** Longest reason we keep; an SMTP server can be very talkative. */
const MAX_REASON_LENGTH = 300;

function truncateReason(reason: string): string {
  const trimmed = reason.trim();
  return trimmed.length <= MAX_REASON_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MAX_REASON_LENGTH - 1)}…`;
}

/**
 * Permanent or temporary?
 *
 * SMTP says it in the first digit: 5xx is "do not try again" (no such mailbox),
 * 4xx is "not now" (full, greylisted). Anything we cannot read is treated as
 * SOFT on purpose - guessing HARD would permanently silence an address on one
 * unrecognised error, and losing real mail is the worse mistake.
 */
function classifyFailure(input: number | string | undefined): 'HARD' | 'SOFT' {
  const code =
    typeof input === 'number'
      ? input
      : Number(/\b([45]\d{2})\b/.exec(String(input ?? ''))?.[1]);
  if (Number.isFinite(code) && code >= 500 && code < 600) {
    return 'HARD';
  }
  return 'SOFT';
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private fromAddress: string;
  private replyToAddress: string;

  constructor(
    private readonly config: ConfigService,
    private readonly suppression: EmailSuppressionService,
  ) {
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
        // SMTP_SECURE=false + port 587 is STARTTLS, which is what SocketLabs
        // wants: `secure` means "TLS from the first byte" (port 465), and
        // setting it true on 587 hangs the handshake. The upgrade is still
        // MANDATORY - without requireTLS nodemailer falls back to plaintext when
        // STARTTLS negotiation fails, which would put the SMTP password on the
        // wire. So false here does not mean plaintext.
        requireTLS: !secure,
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
    /**
     * The agent whose reply this is. Absent means the generic desk identity,
     * which is every message today: the outbox row carries only the message id
     * and the reply headers, so no caller can supply this yet. See the card
     * 1.23 report - getting the agent's name here needs the actor and team to
     * travel with the outbox record, which is a decision, not a tidy-up.
     */
    fromDisplayName?: string | null;
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
    // Card 1.23: the suppressed list is durable now, so an address that hard
    // failed stays refused across a restart. Checked per candidate rather than
    // by loading the table - there is normally exactly one.
    const suppressed: string[] = [];
    for (const address of requested) {
      if (await this.suppression.isSuppressed(address)) {
        suppressed.push(address);
      }
    }
    const { allowed, refused } = resolveOutboundRecipients({
      recipients: requested.map((address) => ({ address })),
      suppressed,
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

    const info = await this.deliver({
      // Display name in code, address from SMTP_FROM - card 1.22 built the
      // formatter for exactly this and there must not be a second one.
      from: buildFromIdentity({
        agentDisplayName: payload.fromDisplayName,
        address: this.fromAddress,
      }),
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
    // Recipients the server named as rejected while still accepting the
    // message. Asynchronous bounces arrive later and by another route - a
    // SocketLabs webhook this card deliberately does not build.
    const rejected = Array.isArray(info?.rejected) ? info.rejected : [];
    for (const entry of rejected) {
      const address = typeof entry === 'string' ? entry : entry?.address;
      if (typeof address === 'string' && address !== '') {
        await this.suppression.recordFailure(
          address,
          classifyFailure(info?.response),
          truncateReason(String(info?.response ?? 'rejected by the server')),
        );
      }
    }
  }

  /**
   * The one call that touches the wire, wrapped so a synchronous rejection is
   * recorded before it is re-thrown. The outbox already retries and gives up
   * after a bounded number of attempts, so a hard failure here would otherwise
   * be retried five times against an address that will never accept.
   */
  private async deliver(
    message: Parameters<nodemailer.Transporter['sendMail']>[0] & {
      to: string[];
    },
  ) {
    try {
      return await this.transporter!.sendMail(message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const kind = classifyFailure(
        (error as { responseCode?: number })?.responseCode ?? reason,
      );
      for (const address of message.to) {
        await this.suppression.recordFailure(
          address,
          kind,
          truncateReason(reason),
        );
      }
      throw error;
    }
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
