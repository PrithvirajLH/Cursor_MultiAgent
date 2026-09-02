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

/** An opening <body> tag, however it is attributed. */
const BODY_OPEN_TAG = /<body[^>]*>/i;

/**
 * A hidden preheader element, by the signature every preheader uses.
 *
 * EmailService knows this much about the body it is given on purpose: the
 * marker has to land AFTER the preheader, and only the thing doing the
 * inserting can enforce that ordering.
 */
const HIDDEN_PREHEADER = /<div[^>]*mso-hide:all[^>]*>[\s\S]*?<\/div>/i;

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
     * The agent whose reply this is (card 1.31). Absent means the generic desk
     * identity, which is correct for every worker- and system-raised
     * notification and for the teams listed in EMAIL_GENERIC_IDENTITY_TEAMS.
     * `buildFromIdentity` picks the shape from whether this is set.
     */
    agentDisplayName?: string | null;
    /** Everyone else who should see a public reply (card 1.33). */
    cc?: string[] | null;
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

    const intendedTo = parseAddressList(payload.to);
    const intendedCc = parseAddressList((payload.cc ?? []).join(','));
    // Everyone the message was meant for, To and CC alike: the pilot notice
    // names all of them and the pilot invariant is about all of them.
    const intended = [...new Set([...intendedTo, ...intendedCc])];
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

    // THE PILOT INVARIANT, restated for CC: in pilot mode the allowed list IS
    // the pilot list, so To takes it and CC is emptied. There is no branch here
    // that can put an intended address in either field.
    const toAddresses = isPilot ? allowed : this.pickTo(intendedTo, allowed);
    const ccAddresses = isPilot
      ? []
      : allowed.filter((address) => !toAddresses.includes(address));
    const info = await this.deliver({
      // Display name in code, address from SMTP_FROM - card 1.22 built the
      // formatter for exactly this and there must not be a second one.
      from: buildFromIdentity({
        agentDisplayName: payload.agentDisplayName,
        address: this.fromAddress,
      }),
      replyTo: payload.replyTo ?? this.replyToAddress,
      to: toAddresses,
      ...(ccAddresses.length > 0 ? { cc: ccAddresses } : {}),
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

  /**
   * The HTML half, with the marker placed INSIDE the document.
   *
   * It used to be prepended to the whole thing, producing
   * `<p>marker</p><!DOCTYPE html><html>...`. Two faults in one line: content
   * before the doctype drops clients into quirks mode and leaves the marker
   * outside `<html>`, where Outlook is least predictable - and the marker,
   * being the first text in the message, led the inbox preview. It took about
   * a third of the ~90 characters that decide whether the email is opened,
   * which the pre-1.34 evidence shows verbatim: "----- Reply above this line
   * ----- Update on your request Hello...".
   */
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
    return this.insertIntoBody(html, header.join(''));
  }

  /**
   * Put a block just inside `<body>`, but after a hidden preheader if there is
   * one.
   *
   * ORDER MATTERS, AND IT IS A TRADE-OFF. The preheader has to come first or
   * the marker leads the inbox preview again, which is the whole point of this
   * change. But `stripQuotedReply` cuts at the marker and keeps everything
   * above it - so in a reply quoted by a client that adds NO attribution line
   * of its own, the preheader text can survive into the agent's view of the
   * requester's reply.
   *
   * Measured rather than assumed: of the five quoting layouts in
   * email.service.spec, the four that any mainstream client produces (Gmail's
   * "On ... wrote:", Outlook's From:/Sent: block, its underscore rule, and
   * "-----Original Message-----") all sit ABOVE the preheader in the quote, so
   * the trimmer cuts there and the preheader never appears. Only a bare
   * verbatim quote leaves it, and what leaks is the agent's own previous words
   * to a person who already received them - confusing, not a disclosure, and
   * the stored body is untouched either way. Both behaviours are pinned by
   * tests; reverse the order in this one method if that trade lands
   * differently for someone.
   */
  private insertIntoBody(html: string, block: string): string {
    const bodyOpen = BODY_OPEN_TAG.exec(html);
    if (!bodyOpen) {
      // A fragment rather than a whole document. Fall back to prepending: a
      // missing marker would silently stop every reply from being trimmed,
      // which is worse than a malformed fragment.
      return `${block}${html}`;
    }
    let at = bodyOpen.index + bodyOpen[0].length;
    const rest = html.slice(at);
    const preheader = HIDDEN_PREHEADER.exec(rest);
    // Only skip a preheader that really is the first thing in the body; a
    // hidden element further down is something else entirely.
    if (preheader && rest.slice(0, preheader.index).trim() === '') {
      at += preheader.index + preheader[0].length;
    }
    return `${html.slice(0, at)}${block}${html.slice(at)}`;
  }

  /**
   * Who goes in `To:`.
   *
   * The intended To addresses that survived the guard, or - when every one of
   * them was refused - the first surviving CC promoted up. A message with an
   * empty To and only CC recipients is a spam signal, and an intake ticket
   * whose requester never resolved is a real case.
   */
  private pickTo(intendedTo: string[], allowed: string[]): string[] {
    const lowerTo = new Set(intendedTo.map((address) => address.toLowerCase()));
    const survivingTo = allowed.filter((address) =>
      lowerTo.has(address.toLowerCase()),
    );
    return survivingTo.length > 0 ? survivingTo : allowed.slice(0, 1);
  }

  private pilotNotice(intended: string[]): string {
    const audience = intended.length > 0 ? intended.join(', ') : '(nobody)';
    return `[pilot mode] EMAIL_TEST_RECIPIENTS is set, so this was delivered to the pilot list. It would otherwise have gone to: ${audience}`;
  }
}
