import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { InboundEmailService } from '../tickets/inbound-email.service';
import { TicketEmailThreadService } from '../notifications/ticket-email-thread.service';
import {
  IngestInboundEmailDto,
  InboundEmailAttachmentDto,
} from '../tickets/dto/ingest-inbound-email.dto';
import { parsePositiveInt } from '../common/config.utils';
import {
  GraphAttachmentMeta,
  GraphMailClient,
  GraphMailMessage,
} from './graph-mail.client';
import {
  DEFAULT_INLINE_IMAGE_MIN_BYTES,
  isSignatureImage,
} from './is-signature-image.util';
import {
  classifyInboundAddress,
  RecipientCandidate,
} from './classify-inbound-address.util';

/**
 * How often to poll when the switch is on.
 *
 * ⚠️ THIRTY SECONDS, and this comment is the truth. The board specified "every
 * ~30 s". `EmailOutboxSweeperService` is the model for this file's SHAPE, but
 * its interval comment misled a diagnosis for a whole day, so: this is the
 * real default, it is overridable by `INBOUND_MAILBOX_POLL_INTERVAL_MS`, and
 * the effective value is reported on the Operations console rather than only
 * living here.
 */
const DEFAULT_INTERVAL_MS = 30_000;
/** Messages per poll. A helpdesk mailbox sees a few hundred a day. */
const DEFAULT_BATCH_SIZE = 50;
/** Stop chasing `nextLink` after this many pages in one run. */
const MAX_PAGES_PER_RUN = 10;

/** What one poll did, for the Operations console. */
export type InboundMailboxRunSummary = {
  ranAt: string;
  enabled: boolean;
  /** Null when the run could not start; the reason is in `error`. */
  fetched: number | null;
  ingested: number;
  movedToProcessed: number;
  skippedNotAddressedToUs: number;
  failed: number;
  error: string | null;
};

/**
 * Poll one shared mailbox and feed each new message into ticket ingestion
 * (card 1.24).
 *
 * **Why polling and not a webhook.** The Graph delta link is a durable cursor:
 * if the app is down for a deploy or an outage, the next poll collects
 * everything that arrived meanwhile. A push subscription fires once into a
 * dead endpoint and that mail is gone - and Graph mail subscriptions expire
 * every few days, so a missed renewal stops inbound silently until a requester
 * complains. Polling has nothing to renew and opens no new public endpoint.
 *
 * ⚠️ **THE ORDER OF THE LAST TWO STEPS IS THE WHOLE CARD.** Store first, move
 * second. Moving a message to Processed and then failing to store it loses
 * mail with no trace: the message is out of the Inbox, the delta cursor has
 * advanced past it, and nobody knows. Storing first means the worst case is a
 * message that is stored but left in the Inbox, which the next poll re-offers
 * and inbound idempotency then discards.
 *
 * ⚠️ **Idempotency is the EXISTING one.** `InboundEmailReceipt` is unique on
 * the RFC `Message-ID`, and `reserveInboundEmailReceipt` already handles the
 * replay case. A second scheme here would be a second answer to "have we seen
 * this?", and the two would disagree the first time a message was retried
 * mid-flight. See `repo-landmines.md`, *"A status transition can lose inbound
 * mail"*, for what the reservation window already cost once.
 */
@Injectable()
export class InboundMailboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InboundMailboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastRunAt: string | null = null;
  private lastSummary: InboundMailboxRunSummary | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly graph: GraphMailClient,
    private readonly inboundEmail: InboundEmailService,
    private readonly ticketEmailThreads: TicketEmailThreadService,
  ) {}

  /** `INBOUND_MAILBOX_ENABLED`. Off unless explicitly "true". */
  isEnabled(): boolean {
    return this.config.get<string>('INBOUND_MAILBOX_ENABLED') === 'true';
  }

  /** The mailbox to poll, defaulting to the address outbound already replies from. */
  getMailbox(): string {
    const configured = this.config.get<string>('INBOUND_MAILBOX_ADDRESS');
    if (configured?.trim()) {
      return configured.trim().toLowerCase();
    }
    return this.ticketEmailThreads.getBaseReplyToAddress().toLowerCase();
  }

  getIntervalMs(): number {
    const parsed = Number.parseInt(
      this.config.get<string>('INBOUND_MAILBOX_POLL_INTERVAL_MS') ?? '',
      10,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
  }

  getBatchSize(): number {
    const parsed = Number.parseInt(
      this.config.get<string>('INBOUND_MAILBOX_BATCH_SIZE') ?? '',
      10,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
  }

  /** Last-run state for the Operations console. In memory only. */
  getLastRun(): {
    at: string | null;
    summary: InboundMailboxRunSummary | null;
  } {
    return { at: this.lastRunAt, summary: this.lastSummary };
  }

  /** Whether Graph could be reached at all, for the console's switch row. */
  describeGraph(): string {
    return this.graph.describeConfiguration();
  }

  onModuleInit(): void {
    if (!this.isEnabled()) {
      this.logger.log(
        'Inbound mailbox worker disabled (INBOUND_MAILBOX_ENABLED is not true)',
      );
      return;
    }
    const intervalMs = this.getIntervalMs();
    this.logger.log(
      `Inbound mailbox worker enabled (${this.getMailbox()}, every ${intervalMs} ms)`,
    );
    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        this.logger.error(
          'Inbound mailbox poll failed',
          (error as Error).stack,
        );
      });
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One poll: fetch, ingest, move, advance the cursor.
   *
   * Never throws. A Graph failure is reported on the summary and logged - a
   * worker that dies on its first bad response stops polling for ever, and the
   * mail keeps arriving.
   */
  async runOnce(): Promise<InboundMailboxRunSummary> {
    const enabled = this.isEnabled();
    const summary: InboundMailboxRunSummary = {
      ranAt: new Date().toISOString(),
      enabled,
      fetched: null,
      ingested: 0,
      movedToProcessed: 0,
      skippedNotAddressedToUs: 0,
      failed: 0,
      error: null,
    };
    if (!enabled) {
      summary.error = 'Switch is off (INBOUND_MAILBOX_ENABLED is not true)';
      return this.record(summary);
    }
    // ⚠️ No "pretend it worked" mode. If Graph is unreachable the run FAILS
    // loudly and says so on the console, because mail is still arriving and a
    // silent no-op would hide that.
    if (!this.graph.isConfigured()) {
      summary.error = `Graph is not configured: ${this.graph.describeConfiguration()}`;
      this.logger.error(summary.error);
      return this.record(summary);
    }
    if (this.running) {
      summary.error = 'A poll is already in progress; this run was skipped';
      return this.record(summary);
    }
    this.running = true;
    const mailbox = this.getMailbox();
    try {
      summary.fetched = 0;
      let link = await this.readCursor(mailbox);
      for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
        const result = await this.graph.fetchDelta(mailbox, link);
        summary.fetched += result.messages.length;
        for (const message of result.messages) {
          await this.handleMessage(mailbox, message, summary);
          if (summary.ingested + summary.skippedNotAddressedToUs >= this.getBatchSize()) {
            break;
          }
        }
        // ⚠️ The cursor advances ONLY to a deltaLink. A nextLink means the run
        // is mid-page and resuming from it later is fine, but storing it as
        // the durable cursor would strand the worker mid-history if the app
        // restarted before the final page.
        if (result.deltaLink) {
          await this.writeCursor(mailbox, result.deltaLink);
          break;
        }
        if (!result.nextLink) {
          break;
        }
        link = result.nextLink;
      }
    } catch (error) {
      summary.error = (error as Error).message;
      this.logger.error(
        `Inbound mailbox poll failed for ${mailbox}`,
        (error as Error).stack,
      );
    } finally {
      this.running = false;
    }
    return this.record(summary);
  }

  /**
   * Ingest one message, then move it.
   *
   * ⚠️ STORE FIRST, MOVE SECOND. If `ingestInboundEmailMessage` throws, the
   * message is left exactly where it is and the next poll offers it again.
   * The reverse order loses mail permanently.
   */
  private async handleMessage(
    mailbox: string,
    message: GraphMailMessage,
    summary: InboundMailboxRunSummary,
  ): Promise<void> {
    const addressing = classifyInboundAddress(
      this.candidatesFrom(message),
      mailbox,
    );
    if (addressing.kind === 'none') {
      // Not addressed to us at all: a bcc-only copy, or a rule that dropped
      // something unrelated into the mailbox. Left in place on purpose - the
      // worker does not tidy a mailbox it does not understand.
      summary.skippedNotAddressedToUs += 1;
      return;
    }
    let assignedTeamId: string | null = null;
    if (addressing.kind === 'department') {
      assignedTeamId = await this.resolveActiveTeamIdBySlug(addressing.slug);
      if (!assignedTeamId) {
        // ⚠️ An unknown suffix is NOT an error and NOT a guess. The mail is
        // ingested as an ordinary unrouted ticket, so it lands in the
        // Unassigned queue rather than being dropped or sent to a team that
        // happens to sort first. Guessing here would put one department's
        // mail in front of another.
        this.logger.warn(
          `Inbound mail addressed to an unknown department suffix ` +
            `"${addressing.slug}" (${addressing.matchedAddress}); ingesting unrouted`,
        );
      }
    } else if (addressing.kind === 'unknown') {
      this.logger.warn(
        `Inbound mail carried an unusable suffix "${addressing.suffix}"; ingesting unrouted`,
      );
    }
    // Every surviving kind carries the address we matched; `none` returned
    // above. The ingestion path pulls the reply token out of this field, so it
    // has to be OUR address rather than whatever sorted first in `To`.
    // ⚠️ CARD 1.116: FETCHED HERE, AFTER THE ADDRESSING CHECK, NOT IN THE
    // DELTA PAGE. Mail that is not ours returned above without costing a single
    // download, and one message's attachment trouble cannot stall the page.
    const attachments = await this.collectAttachments(mailbox, message);
    const payload = this.toIngestPayload(
      message,
      addressing.matchedAddress,
      attachments,
    );
    try {
      await this.inboundEmail.ingestInboundEmailMessage(payload, {
        assignedTeamId,
      });
      summary.ingested += 1;
    } catch (error) {
      // Stored nothing, so move nothing. The next poll retries it.
      summary.failed += 1;
      this.logger.error(
        `Failed to ingest ${message.internetMessageId}; leaving it in the mailbox`,
        (error as Error).stack,
      );
      return;
    }
    try {
      await this.graph.moveToProcessed(mailbox, message.id);
      summary.movedToProcessed += 1;
    } catch (error) {
      // Stored but not moved. Harmless: the next poll re-offers it and the
      // existing receipt makes the second ingestion a replay, not a duplicate.
      this.logger.warn(
        `Ingested ${message.internetMessageId} but could not move it to ` +
          `Processed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * The files on one message, ready for ingestion (card 1.116).
   *
   * ⚠️ THIS IS THE WHOLE CARD. The worker used to read `message.attachments`
   * off the delta page, and a delta query never returns that collection - so it
   * was empty on every message ever received and every emailed image was left
   * in the mailbox. Nothing downstream was broken; nothing downstream was ever
   * reached.
   *
   * ⚠️ METADATA FIRST, CONTENT SECOND, AND THAT ORDER IS THE DESIGN. Listing
   * is cheap. It lets the signature logos and the overflow be discarded before
   * anything is downloaded, instead of paying for files that card 1.105's
   * normalizer would only reject on arrival.
   *
   * ⚠️ AN ATTACHMENT PROBLEM MUST NEVER LOSE THE EMAIL - card 1.105's
   * principle, one layer up. A failed listing ingests the mail with no files. A
   * failed download emits the entry WITHOUT content, so the existing normalizer
   * rejects it and `INBOUND_ATTACHMENTS_DROPPED` names the file on the ticket.
   * Reusing that path rather than inventing a second way to report the same
   * thing.
   */
  private async collectAttachments(
    mailbox: string,
    message: GraphMailMessage,
  ): Promise<InboundEmailAttachmentDto[]> {
    if (!message.hasAttachments) {
      return [];
    }
    let described: GraphAttachmentMeta[];
    try {
      described = await this.graph.listAttachments(mailbox, message.id);
    } catch (error) {
      this.logger.warn(
        `Could not list attachments for ${message.internetMessageId}; ` +
          `ingesting the email without them: ${(error as Error).message}`,
      );
      return [];
    }
    const minInlineBytes = parsePositiveInt(
      this.config.get<string>('INBOUND_INLINE_IMAGE_MIN_BYTES'),
      DEFAULT_INLINE_IMAGE_MIN_BYTES,
    );
    const wanted = described.filter(
      (attachment) => !isSignatureImage(attachment, minInlineBytes),
    );
    // The normalizer applies this same ceiling and reports the overflow in its
    // own words. Content is fetched only for the files that will survive it.
    const maxWithContent = parsePositiveInt(
      this.config.get<string>('INBOUND_EMAIL_MAX_ATTACHMENTS'),
      10,
    );
    const out: InboundEmailAttachmentDto[] = [];
    for (const [index, attachment] of wanted.entries()) {
      if (index >= maxWithContent) {
        out.push({
          fileName: attachment.name,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes || 1,
        } as InboundEmailAttachmentDto);
        continue;
      }
      try {
        const contentBase64 = await this.graph.fetchAttachmentContent(
          mailbox,
          message.id,
          attachment.id,
        );
        out.push({
          fileName: attachment.name,
          contentType: attachment.contentType,
          // ⚠️ THE DECODED LENGTH, NOT GRAPH'S `size`. `sizeBytes` means "the
          // size of the file I am handing you", and the normalizer checks it
          // for an EXACT match to catch a truncated download. Graph's `size` is
          // the wire size - base64 and MIME overhead included - so passing it
          // rejected every single attachment with "expected N bytes, got M".
          // The check is right; the caller was wrong.
          sizeBytes: Buffer.byteLength(contentBase64, 'base64'),
          contentBase64,
        });
      } catch (error) {
        this.logger.warn(
          `Could not download "${attachment.name}" from ` +
            `${message.internetMessageId}: ${(error as Error).message}`,
        );
        out.push({
          fileName: attachment.name,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes || 1,
        } as InboundEmailAttachmentDto);
      }
    }
    return out;
  }

  /**
   * Every address worth checking, in priority order.
   *
   * ⚠️ To, CC **and** Delivered-To. On a reply-all our plus address is usually
   * not in `To`; on a forward it may be only in `Delivered-To`. Card 1.40
   * exists because a looped-in person's reply was being lost, and parsing only
   * `To` is how that happens again.
   */
  private candidatesFrom(message: GraphMailMessage): RecipientCandidate[] {
    return [
      ...message.toRecipients.map((r) => ({
        address: r.address,
        source: 'to' as const,
      })),
      ...message.ccRecipients.map((r) => ({
        address: r.address,
        source: 'cc' as const,
      })),
      ...message.deliveredTo.map((address) => ({
        address,
        source: 'delivered-to' as const,
      })),
    ];
  }

  /** Graph's message in the shape the ingestion path already accepts. */
  private toIngestPayload(
    message: GraphMailMessage,
    matchedAddress: string | undefined,
    attachments: InboundEmailAttachmentDto[],
  ): IngestInboundEmailDto {
    return {
      fromEmail: message.from.address,
      fromName: message.from.name ?? undefined,
      // ⚠️ The address WE matched, not `toRecipients[0]`. The ingestion path
      // extracts the reply token from this field, and on a reply-all the first
      // `To` is usually a human.
      toEmail: matchedAddress,
      // Card 1.24's auto-watching: everyone else on the message, so existing
      // colleagues copied in are followed onto the ticket. Our own mailbox is
      // stripped - the helpdesk is not a participant.
      ccEmails: [
        ...message.toRecipients.map((r) => r.address),
        ...message.ccRecipients.map((r) => r.address),
      ]
        .map((address) => address.trim().toLowerCase())
        .filter(
          (address) =>
            address !== '' &&
            address !== matchedAddress &&
            address !== message.from.address.trim().toLowerCase(),
        ),
      subject: message.subject,
      body: message.bodyText,
      messageId: message.internetMessageId,
      inReplyTo: message.inReplyTo ?? undefined,
      references: message.references ?? undefined,
      autoSubmitted: message.autoSubmitted ?? undefined,
      autoResponseSuppress: message.autoResponseSuppress ?? undefined,
      precedence: message.precedence ?? undefined,
      listId: message.listId ?? undefined,
      returnPath: message.returnPath ?? undefined,
      attachments,
    } as IngestInboundEmailDto;
  }

  /**
   * An ACTIVE team by slug, or null.
   *
   * ⚠️ Lifted from `IntakeService.resolveTeamIdBySlug`, which is private to
   * that class - so this is the same lookup rather than a second one. It
   * differs deliberately in one way: intake THROWS on an unknown slug because
   * a form submission can be rejected to the sender's face, whereas rejecting
   * an email means dropping it. This returns null and the caller ingests the
   * mail unrouted.
   *
   * `isActive` matters: `hr-operations` is inactive and must never be a target.
   */
  private async resolveActiveTeamIdBySlug(slug: string): Promise<string | null> {
    const team = await this.prisma.team.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
    });
    return team?.id ?? null;
  }

  /** The stored delta link, or null on a mailbox never synced. */
  private async readCursor(mailbox: string): Promise<string | null> {
    const row = await this.prisma.inboundMailboxCursor.findUnique({
      where: { mailbox },
      select: { deltaLink: true },
    });
    return row?.deltaLink ?? null;
  }

  /** Persist the cursor. This is what makes a restart lossless. */
  private async writeCursor(mailbox: string, deltaLink: string): Promise<void> {
    await this.prisma.inboundMailboxCursor.upsert({
      where: { mailbox },
      create: { mailbox, deltaLink, lastSyncedAt: new Date() },
      update: { deltaLink, lastSyncedAt: new Date() },
    });
  }

  private record(summary: InboundMailboxRunSummary): InboundMailboxRunSummary {
    this.lastRunAt = summary.ranAt;
    this.lastSummary = summary;
    this.logger.log(JSON.stringify(summary));
    return summary;
  }
}
