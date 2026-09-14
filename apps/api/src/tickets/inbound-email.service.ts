import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessageType,
  TicketChannel,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { timingSafeEqual, randomUUID } from 'crypto';
import { AuthUser } from '../auth/current-user.decorator';
import {
  extractOutboxIdsFromThreadHeaders,
  extractReplyTokensFromThreadHeaders,
} from '../notifications/email-threading.util';
import { NotificationsService } from '../notifications/notifications.service';
import { isAutomatedEmail } from './auto-reply.util';
import { TicketEmailThreadService } from '../notifications/ticket-email-thread.service';
import { DuplicateAccountService } from '../common/duplicate-account.service';
import { UserIdentityService } from '../common/user-identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketAttachmentService } from './ticket-attachment.service';
import { TicketRealtimeService } from './ticket-realtime.service';
import { TicketsService } from './tickets.service';
import {
  InboundEmailAttachmentDto,
  IngestInboundEmailDto,
} from './dto/ingest-inbound-email.dto';
import { parsePositiveInt } from '../common/config.utils';

export type NormalizedInboundAttachment = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  buffer: Buffer;
};

type InboundThreadTarget = {
  ticketId: string;
  threadedByReplyToken: string | null;
  threadedByDisplayId: string | null;
  threadedByOutboxId: string | null;
};

type InboundEmailReceiptReservation =
  | { mode: 'reserved'; id: string }
  | { mode: 'replay'; ticketId: string; threaded: boolean };

type PersistedInboundEmailMutation = {
  ticketId: string;
  threaded: boolean;
};

/**
 * Handles all inbound email ingestion logic including:
 * - Webhook secret validation
 * - Idempotent receipt reservation
 * - Requester provisioning
 * - Thread detection and ticket creation
 * - Attachment normalization and download
 *
 * Uses TicketsService (via forwardRef) for ticket creation and message posting.
 */
@Injectable()
export class InboundEmailService {
  private readonly logger = new Logger(InboundEmailService.name);
  /** Layer two of loop protection: more than this from one sender on one
   *  ticket inside the window and we stop answering, without ever bouncing. */
  private static readonly INBOUND_RATE_LIMIT = 5;
  private static readonly INBOUND_RATE_WINDOW_MS = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly attachmentService: TicketAttachmentService,
    private readonly ticketRealtime: TicketRealtimeService,
    private readonly duplicateAccounts: DuplicateAccountService,
    private readonly userIdentity: UserIdentityService,
    private readonly notifications: NotificationsService,
    private readonly ticketEmailThreads: TicketEmailThreadService,
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService: TicketsService,
  ) {}

  /**
   * The HTTP entry point: check the shared secret, then ingest.
   *
   * Kept as the controller's method so nothing about the webhook contract
   * moves. The secret belongs at the HTTP edge and nowhere else.
   */
  async ingestInboundEmail(
    payload: IngestInboundEmailDto,
    inboundSecret: string | undefined,
  ) {
    this.assertInboundEmailWebhookSecret(inboundSecret);
    return this.ingestInboundEmailMessage(payload);
  }

  /**
   * Ingest one message. **THE ONE INGESTION PATH** (card 1.24).
   *
   * ⚠️ Split out of `ingestInboundEmail` so the mailbox worker can call
   * exactly this, in-process, rather than growing a second implementation.
   * One rule answered in two places is the drift behind cards 1.36, 1.38,
   * 1.47, 1.50 and 1.55 - and for inbound mail the two copies would disagree
   * about threading, idempotency and loop protection, which is the worst
   * possible place for it.
   *
   * The webhook secret is deliberately NOT checked here: it authenticates an
   * HTTP caller, and the worker is not one. Requiring it in-process would mean
   * the worker could not run until an unrelated secret was configured.
   *
   * @param payload The message, in the same shape the webhook accepts.
   * @param options `assignedTeamId` routes a NEW ticket to a department
   *   (card 1.24's plus-addressing). Ignored when the mail threads onto an
   *   existing ticket - department addressing is for the first message only.
   */
  async ingestInboundEmailMessage(
    payload: IngestInboundEmailDto,
    options?: { assignedTeamId?: string | null },
  ) {
    const messageId = payload.messageId.trim();
    const reservation = await this.reserveInboundEmailReceipt(
      messageId,
      payload.fromEmail,
      payload.subject,
    );
    if (reservation.mode === 'replay') {
      return this.buildInboundEmailReplayResponse(
        reservation.ticketId,
        reservation.threaded,
      );
    }
    let persistedMutation: PersistedInboundEmailMutation | null = null;

    try {
      const inboundAttachments = await this.normalizeInboundEmailAttachments(
        payload.attachments,
      );
      const requester = await this.findOrCreateInboundRequester(
        payload.fromEmail,
        payload.fromName,
      );
      const requesterAuth = this.toInboundRequesterAuthUser(requester);
      const threadTarget = await this.resolveThreadTarget(
        payload.toEmail,
        payload.subject,
        payload.inReplyTo,
        payload.references,
      );

      // Layer one: the sender told us this was machine-generated. Cheap,
      // header-only, and the reason an out-of-office cannot start a war with
      // our acknowledgement.
      const automated = isAutomatedEmail(payload);

      if (threadTarget) {
        // A reply that threads to a soft-deleted ticket is treated as "no
        // thread": `existing` stays null and a new ticket is created instead.
        const existing = await this.prisma.ticket.findFirst({
          where: { id: threadTarget.ticketId, deletedAt: null },
          select: {
            id: true,
            status: true,
            priority: true,
            assignedTeamId: true,
            assigneeId: true,
            dueAt: true,
            slaPausedAt: true,
            resolvedAt: true,
            closedAt: true,
            completedAt: true,
            // Card 1.40: the ticket's email audience - who we actually wrote to.
            requesterId: true,
            followers: { select: { userId: true } },
          },
        });

        if (existing) {
          // Layer two: a sender who is not flagged as automated but is
          // behaving like it. Counted from receipts already on this ticket, so
          // no new table and no state of our own to keep correct.
          const recentFromSender = await this.countRecentInboundFromSender(
            existing.id,
            payload.fromEmail,
          );
          const rateLimited =
            recentFromSender >= InboundEmailService.INBOUND_RATE_LIMIT;
          const suppressNotifications = automated || rateLimited;
          // Card 1.40: may this sender's reply go on this ticket?
          //
          // Everyone we emailed may answer: the requester, the assignee and the
          // followers - exactly the Cc list card 1.33 sends to. Until now only
          // the requester could, so a colleague we deliberately looped in got a
          // 403 and their reply was dropped on the floor with nobody told.
          //
          // The reply token in the address is NOT what authorises this. It is a
          // bearer token every participant can forward, so it only says which
          // ticket; the SENDER is what is matched.
          const mayReply = this.ticketsService.canReplyByEmailToTicket(
            requester.id,
            existing,
          );

          if (!mayReply) {
            // A sender in no relationship to the ticket. Their message is NOT
            // stored: silently ingesting mail from anyone who can guess a reply
            // address is how a stranger gets a foothold in a conversation. But
            // an agent should be able to see that somebody tried, so it is
            // recorded as an event carrying the address and the subject - never
            // the body.
            await this.recordUnknownSenderReply(existing.id, requester, payload);
            persistedMutation = { ticketId: existing.id, threaded: true };
            await this.completeInboundEmailReceipt(
              reservation.id,
              existing.id,
              true,
            );
            // 201, not an error: the mail HAS been handled, and a failure code
            // would only make the sender's server retry it forever.
            return {
              threaded: true,
              ticket: await this.getTicketForMutationResponse(existing.id),
            };
          }

          // Replying makes you a participant, so you get the rest of the
          // thread - and card 1.28's audience line then shows you to the agent.
          // Done before the message so the notification for it includes them.
          if (requester.id !== existing.requesterId) {
            await this.ticketsService
              .ensureTicketFollower(existing.id, requester.id)
              .catch((error: unknown) =>
                this.logger.error(
                  `Failed to add ${requester.id} as a follower of ${existing.id}`,
                  (error as Error).stack,
                ),
              );
          }
          await this.addLoopedInFollowers(existing.id, payload.ccEmails);

          // The message first, and only then the status.
          //
          // This ordering is load-bearing. addMessage REFUSES a reply from
          // anyone who is not the ticket's requester - an inbound sender is
          // provisioned as an EMPLOYEE, and EMPLOYEEs may only reply to their
          // own tickets - so a looped-in third party's reply answers 403. With
          // the transition running first, that 403 left the ticket already
          // moved on the strength of a message that was then thrown away: the
          // queue said somebody had answered while the answer did not exist.
          // Verified live on 2026-09-03, and the REOPENED case had the same
          // shape before this card touched it.
          //
          // A status derived from a message must not outlive the message.
          await this.ticketsService.addMessage(
            existing.id,
            { body: payload.body, type: MessageType.PUBLIC },
            requesterAuth,
            // fromEmailAudience: the check above has already decided this
            // sender may reply. It stays PUBLIC, and card 1.36's read filter
            // still governs what they can see - a third party gains no sight of
            // internal notes by replying.
            { suppressNotifications, fromEmailAudience: true },
          );

          // One transition per inbound message. The two cases are mutually
          // exclusive by status, so `else if` is honest rather than lazy.
          //
          // ⚠️ CARD 1.80: `!automated` GATES THE REOPEN TOO. It did not, and an
          // out-of-office bouncing off our "we have resolved this" reopened the
          // ticket - work that was finished came back to the board because a
          // mail server answered. The reasoning was already written one branch
          // below, for WAITING_ON_REQUESTER: "an out-of-office answering our
          // acknowledgement is not the requester answering our question, and
          // flipping the queue on it would make the board lie in the more
          // dangerous direction." It applies with more force to reopening
          // closed work. Card 1.29 added the gate only to the branch it
          // introduced.
          const finished =
            existing.status === TicketStatus.RESOLVED ||
            existing.status === TicketStatus.CLOSED;
          // Recorded on the inbound event below, so an agent reading the
          // timeline sees "we ignored an autoresponder" rather than wondering
          // why a reply changed nothing. A silent decision is a mystery.
          const statusChangeSkipped =
            finished && automated ? 'automated' : null;
          if (finished && !automated) {
            await this.applyInboundStatusTransition(
              existing,
              TicketStatus.REOPENED,
              requester.id,
            );
          } else if (
            existing.status === TicketStatus.WAITING_ON_REQUESTER &&
            !automated &&
            // IN_PROGRESS requires an assignee, and it is the ONLY non-pause
            // transition out of WAITING_ON_REQUESTER - so an unassigned ticket
            // has nowhere legal to go. See the method below for why skipping
            // beats attempting it.
            existing.assigneeId
          ) {
            // Card 1.29 Gap A: somebody answered, so the ball is back with us.
            // The queue said "Waiting on requester" until an agent noticed by
            // hand, which is exactly how a ticket sits in "Awaiting reply
            // > 24h" while the requester waits on US.
            //
            // Gated on `!automated` deliberately. An out-of-office answering
            // our acknowledgement is not the requester answering our question,
            // and flipping the queue on it would make the board lie in the
            // more dangerous direction: it would look like progress.
            //
            // WAITING_ON_VENDOR is untouched - a requester replying tells you
            // nothing about the vendor.
            await this.applyInboundStatusTransition(
              existing,
              TicketStatus.IN_PROGRESS,
              requester.id,
            );
          }

          if (suppressNotifications) {
            await this.recordInboundSuppression({
              ticketId: existing.id,
              requesterId: requester.id,
              fromEmail: requester.email,
              messageId,
              reason: automated ? 'automated' : 'rate_limited',
              recentFromSender,
            });
          }
          persistedMutation = {
            ticketId: existing.id,
            threaded: true,
          };
          await this.attachInboundEmailAttachments(
            existing.id,
            inboundAttachments,
            requester.id,
          );

          await this.prisma.ticketEvent.create({
            data: {
              ticketId: existing.id,
              type: 'INBOUND_EMAIL_RECEIVED',
              payload: {
                fromEmail: requester.email,
                messageId,
                subject: payload.subject,
                threadedByReplyToken: threadTarget.threadedByReplyToken,
                threadedByDisplayId: threadTarget.threadedByDisplayId,
                threadedByOutboxId: threadTarget.threadedByOutboxId,
                attachmentCount: inboundAttachments.length,
                // Card 1.80. Present only when a transition was actually
                // withheld, so every other inbound event keeps its old shape.
                ...(statusChangeSkipped
                  ? { statusChangeSkipped }
                  : {}),
              },
              createdById: requester.id,
            },
          });
          await this.ticketEmailThreads.recordInboundEmail({
            ticketId: existing.id,
            ticketSubject: payload.subject,
            messageId,
          });

          await this.completeInboundEmailReceipt(
            reservation.id,
            existing.id,
            true,
          );
          const ticket = await this.getTicketForMutationResponse(existing.id);
          return {
            threaded: true,
            ticket,
          };
        }
      }

      const created = await this.ticketsService.create(
        {
          subject: payload.subject,
          description: payload.body,
          priority: payload.priority ?? TicketPriority.SEV3,
          channel: TicketChannel.EMAIL,
          requesterId: requester.id,
          // Card 1.24: `helpdesk+payroll@` opens this in Payroll. Undefined
          // when the mail came to the bare address, which leaves routing to
          // the rules exactly as before.
          ...(options?.assignedTeamId
            ? { assignedTeamId: options.assignedTeamId }
            : {}),
        },
        requesterAuth,
        // Card 1.42 §3: the acknowledgement queued further down is the better
        // of the two emails, so the created-email is suppressed rather than the
        // acknowledgement dropped. The team's new-ticket bell still fires.
        //
        // ⚠️ CARD 1.24: `skipRequiredCustomFields` is DEFENCE IN DEPTH. An
        // email cannot supply a form field, so a required custom field on the
        // target team would reject the create and the ticket would never
        // exist - mail silently swallowed. Production has zero required custom
        // fields today (owner, verified 2026-09-04), so this changes nothing
        // now; it stops the next required field anybody adds from doing it.
        // `ai/tools/ticket-tools.service.ts:51` sets it for the same reason.
        { suppressCreatedEmail: true, skipRequiredCustomFields: true },
      );
      persistedMutation = {
        ticketId: created.id,
        threaded: false,
      };
      await this.addLoopedInFollowers(created.id, payload.ccEmails);
      await this.ticketEmailThreads.recordInboundEmail({
        ticketId: created.id,
        ticketSubject: created.subject ?? payload.subject,
        messageId,
      });
      await this.attachInboundEmailAttachments(
        created.id,
        inboundAttachments,
        requester.id,
      );

      await this.prisma.ticketEvent.create({
        data: {
          ticketId: created.id,
          type: 'INBOUND_EMAIL_RECEIVED',
          payload: {
            fromEmail: requester.email,
            messageId,
            subject: payload.subject,
            threadedByReplyToken: null,
            threadedByDisplayId: null,
            attachmentCount: inboundAttachments.length,
          },
          createdById: requester.id,
        },
      });

      await this.completeInboundEmailReceipt(reservation.id, created.id, false);
      if (automated) {
        // The acknowledgement is the one message this system sends without a
        // person asking it to, which makes it the one that can loop. A machine
        // gets a ticket and silence.
        await this.recordInboundSuppression({
          ticketId: created.id,
          requesterId: requester.id,
          fromEmail: requester.email,
          messageId,
          reason: 'automated',
          recentFromSender: 0,
        });
        return {
          threaded: false,
          ticket: created,
        };
      }
      await this.notifications
        .inboundEmailAcknowledged({
          ticketId: created.id,
          toEmail: requester.email,
          requesterName: requester.displayName,
          ticketDisplayId: created.displayId ?? null,
          ticketNumber: created.number ?? 0,
          ticketSubject: created.subject ?? payload.subject,
          inboundMessageId: messageId,
        })
        .catch((error) =>
          this.logger.error(
            'Failed to queue inbound email acknowledgment',
            (error as Error).stack,
          ),
        );
      return {
        threaded: false,
        ticket: created,
      };
    } catch (error) {
      if (persistedMutation) {
        await this.preserveInboundEmailReceiptAfterPartialSuccess(
          reservation.id,
          persistedMutation,
          error,
        );
      } else {
        await this.releaseInboundEmailReceipt(reservation.id);
      }
      throw error;
    }
  }

  /**
   * Move a ticket's status because of something that arrived by email.
   *
   * Always through `applyStatusTransitionInTx`, never a direct
   * `ticket.update({ status })`: the function owns the SLA pause/resume
   * accounting, the status-history row and the realtime emit, and a raw write
   * would skip all three while looking correct until somebody read an SLA
   * report.
   *
   * NOTE FOR THE READER: leaving WAITING_ON_REQUESTER counts as leaving a
   * paused state, so this RESUMES the resolution clock and pushes `dueAt` out
   * by however long the ticket sat parked. That is right - the ball is with us
   * again - but it means timers start moving on tickets that were still.
   */
  private async applyInboundStatusTransition(
    ticket: Parameters<TicketsService['applyStatusTransitionInTx']>[1],
    newStatus: TicketStatus,
    actorId: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.ticketsService.applyStatusTransitionInTx(
        tx,
        ticket,
        newStatus,
        actorId,
      );
    });
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId: ticket.id,
        reason: 'status_changed',
        actorId,
      }),
    );
  }

  /**
   * Say on the ticket that somebody outside the conversation replied to it.
   *
   * The body is deliberately NOT stored. An agent learning "a stranger replied"
   * is useful; ingesting the content of mail from anyone who can guess a reply
   * address is not, and the address is a forwardable bearer token.
   */
  private async recordUnknownSenderReply(
    ticketId: string,
    sender: { id: string; email: string },
    payload: IngestInboundEmailDto,
  ) {
    await this.prisma.ticketEvent
      .create({
        data: {
          ticketId,
          type: 'INBOUND_REPLY_FROM_UNKNOWN_SENDER',
          payload: {
            fromEmail: sender.email,
            subject: payload.subject,
          },
          createdById: null,
        },
      })
      .catch((error: unknown) =>
        this.logger.error(
          `Failed to record an unknown-sender reply on ticket ${ticketId}`,
          (error as Error).stack,
        ),
      );
  }

  async attachInboundEmailAttachments(
    ticketId: string,
    attachments: NormalizedInboundAttachment[],
    actorId: string,
  ) {
    if (attachments.length === 0) {
      return [];
    }

    const created = await Promise.all(
      attachments.map((attachment) =>
        this.attachmentService.createTicketAttachmentFromBuffer(
          ticketId,
          {
            originalName: attachment.fileName,
            contentType: attachment.contentType,
            buffer: attachment.buffer,
          },
          actorId,
        ),
      ),
    );

    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId,
        reason: 'attachment_added',
        actorId,
      }),
    );

    return created;
  }

  async normalizeInboundEmailAttachments(
    attachments: InboundEmailAttachmentDto[] | undefined,
  ): Promise<NormalizedInboundAttachment[]> {
    if (!attachments || attachments.length === 0) {
      return [];
    }

    const maxCount = parsePositiveInt(
      this.config.get<string>('INBOUND_EMAIL_MAX_ATTACHMENTS'),
      10,
    );
    if (attachments.length > maxCount) {
      throw new BadRequestException(
        `Inbound email includes ${attachments.length} attachments, which exceeds the limit of ${maxCount}`,
      );
    }

    const maxBytes = this.attachmentService.getAttachmentMaxBytes();
    const maxAggregateBytes = maxBytes * maxCount;
    let totalBytes = 0;

    const normalized: NormalizedInboundAttachment[] = [];
    for (const [index, attachment] of attachments.entries()) {
      const fileName = attachment.fileName.trim();
      const contentType = attachment.contentType.trim().toLowerCase();
      const declaredSize = attachment.sizeBytes;
      const hasBase64 = Boolean(attachment.contentBase64?.trim());
      const hasContentUrl = Boolean(attachment.contentUrl?.trim());

      if (hasBase64 === hasContentUrl) {
        throw new BadRequestException(
          `Inbound attachment ${index + 1} must include exactly one of contentBase64 or contentUrl`,
        );
      }

      const buffer = hasBase64
        ? this.decodeInboundAttachmentBase64(
            attachment.contentBase64 ?? '',
            fileName,
          )
        : await this.downloadInboundAttachmentBuffer(
            attachment.contentUrl ?? '',
            fileName,
            declaredSize,
          );

      if (buffer.length !== declaredSize) {
        throw new BadRequestException(
          `Inbound attachment "${fileName}" size mismatch: expected ${declaredSize} bytes, got ${buffer.length}`,
        );
      }

      this.attachmentService.assertAttachmentWithinSizeLimit(buffer.length);
      totalBytes += buffer.length;
      if (totalBytes > maxAggregateBytes) {
        throw new BadRequestException(
          `Inbound email attachments exceed the aggregate limit of ${maxAggregateBytes} bytes`,
        );
      }

      normalized.push({
        fileName,
        contentType,
        sizeBytes: buffer.length,
        buffer,
      });
    }

    return normalized;
  }

  decodeInboundAttachmentBase64(rawBase64: string, fileName: string) {
    const normalizedInput = rawBase64
      .trim()
      .replace(/^data:[^;]+;base64,/, '')
      .replace(/\s+/g, '');
    if (!normalizedInput) {
      throw new BadRequestException(
        `Inbound attachment "${fileName}" contentBase64 is empty`,
      );
    }
    if (
      normalizedInput.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(normalizedInput)
    ) {
      throw new BadRequestException(
        `Inbound attachment "${fileName}" contentBase64 is not valid base64`,
      );
    }

    const buffer = Buffer.from(normalizedInput, 'base64');
    if (buffer.length === 0) {
      throw new BadRequestException(
        `Inbound attachment "${fileName}" decoded to empty content`,
      );
    }
    return buffer;
  }

  async downloadInboundAttachmentBuffer(
    contentUrl: string,
    fileName: string,
    declaredSize: number,
  ) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(contentUrl);
    } catch {
      throw new BadRequestException(
        `Inbound attachment "${fileName}" has an invalid contentUrl`,
      );
    }

    if (parsedUrl.protocol !== 'https:') {
      throw new BadRequestException(
        `Inbound attachment "${fileName}" contentUrl must use https`,
      );
    }

    const allowedHosts = this.getInboundAttachmentAllowedHosts();
    if (allowedHosts.size === 0) {
      throw new BadRequestException(
        `Inbound attachment "${fileName}" contentUrl downloads are disabled until INBOUND_EMAIL_ATTACHMENT_ALLOWED_HOSTS is configured`,
      );
    }
    if (!allowedHosts.has(parsedUrl.hostname.toLowerCase())) {
      throw new BadRequestException(
        `Inbound attachment host "${parsedUrl.hostname}" is not allowed`,
      );
    }

    const maxBytes = this.attachmentService.getAttachmentMaxBytes();
    if (declaredSize > maxBytes) {
      throw new BadRequestException(
        `Inbound attachment "${fileName}" exceeds size limit`,
      );
    }

    const timeoutMs = parsePositiveInt(
      this.config.get<string>('INBOUND_EMAIL_ATTACHMENT_FETCH_TIMEOUT_MS'),
      15_000,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(parsedUrl.toString(), {
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new BadRequestException(
          `Inbound attachment "${fileName}" contentUrl returned ${response.status}`,
        );
      }

      const contentLengthRaw = response.headers.get('content-length');
      if (contentLengthRaw) {
        const contentLength = Number.parseInt(contentLengthRaw, 10);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          throw new BadRequestException(
            `Inbound attachment "${fileName}" exceeds size limit`,
          );
        }
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        throw new BadRequestException(
          `Inbound attachment "${fileName}" fetched empty content`,
        );
      }
      if (buffer.length > maxBytes) {
        throw new BadRequestException(
          `Inbound attachment "${fileName}" exceeds size limit`,
        );
      }

      return buffer;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Unable to download inbound attachment "${fileName}"`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  getInboundAttachmentAllowedHosts() {
    const raw = this.config.get<string>(
      'INBOUND_EMAIL_ATTACHMENT_ALLOWED_HOSTS',
    );
    if (!raw) {
      return new Set<string>();
    }
    return new Set(
      raw
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  assertInboundEmailWebhookSecret(inboundSecret: string | undefined) {
    const configuredSecret =
      this.config.get<string>('INBOUND_EMAIL_WEBHOOK_SECRET') ??
      this.config.get<string>('M365_INBOUND_WEBHOOK_SECRET');

    if (!configuredSecret) {
      throw new ForbiddenException(
        'Inbound email webhook secret is not configured',
      );
    }

    if (!inboundSecret) {
      throw new ForbiddenException('Missing inbound email webhook secret');
    }

    const expected = Buffer.from(configuredSecret, 'utf8');
    const received = Buffer.from(inboundSecret, 'utf8');
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new ForbiddenException('Invalid inbound email webhook secret');
    }
  }

  /**
   * Auto-watch the people copied on an inbound email (card 1.24).
   *
   * The owner's "auto-watching" ask. The SENDER is already handled - card 1.40
   * added `ensureTicketFollower` on the reply path (commit 2c76697), and on a
   * new ticket the sender is the requester - so what was actually missing is
   * everyone on `Cc`.
   *
   * ⚠️ **EXISTING USERS ONLY. This never provisions anybody**, and that is a
   * deliberate narrowing of "add any looped-in third party".
   * `findOrCreateInboundRequester` would happily mint a `User` row per Cc'd
   * address, which means every distribution list, every external vendor and
   * every mistyped address in a reply-all becomes an account. Card 1.30 is
   * open precisely because inbound mail is already the main creator of
   * duplicate users, so making it create one per Cc would make that worse in
   * the same week somebody is trying to fix it.
   *
   * A colleague who has emailed us before, or signed in, is therefore
   * auto-watched. One who is genuinely new is not - and the moment they REPLY,
   * card 1.40's path adds them properly, with a real identity behind it.
   *
   * ⚠️ Adding a follower is about VISIBILITY, not delivery. Card 1.42 removed
   * staff email and `notifications.service.ts:741` filters followers by
   * `isStaffRole`; nothing here touches that, so a staff follower still gets
   * no email.
   *
   * Never throws: a failure to auto-watch must not fail the ingestion of the
   * mail itself.
   */
  private async addLoopedInFollowers(
    ticketId: string,
    ccEmails: string[] | undefined,
  ): Promise<void> {
    if (!ccEmails?.length) {
      return;
    }
    const normalized = [
      ...new Set(
        ccEmails
          .map((address) => address.trim().toLowerCase())
          .filter((address) => address !== ''),
      ),
    ].slice(0, 50);
    if (normalized.length === 0) {
      return;
    }
    try {
      const existing = await this.prisma.user.findMany({
        where: { email: { in: normalized }, isActive: true },
        select: { id: true },
      });
      for (const user of existing) {
        await this.ticketsService
          .ensureTicketFollower(ticketId, user.id)
          .catch((error: unknown) =>
            this.logger.error(
              `Failed to auto-watch ${user.id} on ${ticketId}`,
              (error as Error).stack,
            ),
          );
      }
    } catch (error) {
      this.logger.error(
        `Failed to resolve looped-in followers for ${ticketId}`,
        (error as Error).stack,
      );
    }
  }

  async findOrCreateInboundRequester(email: string, name?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        primaryTeamId: true,
      },
    });
    if (existing) {
      return existing;
    }

    // Card 1.30: before creating anyone, ask whether the directory has told us
    // this address belongs to a human we already have. Entra hands out a UPN
    // and a `mail` that routinely differ, and this path only ever sees the
    // second one - which is how the duplicate account was made.
    //
    // The mapping was GIVEN to us at login, never inferred: nothing here
    // compares the shape of two addresses. An unrecognised address simply falls
    // through and provisions as before, because resolution must never be able
    // to block provisioning.
    const aliasUserId = await this.userIdentity.findUserIdByAlias(
      normalizedEmail,
    );
    if (aliasUserId) {
      const byAlias = await this.prisma.user.findUnique({
        where: { id: aliasUserId },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          primaryTeamId: true,
        },
      });
      if (byAlias) {
        return byAlias;
      }
    }

    const fallbackDisplayName =
      name?.trim() || normalizedEmail.split('@')[0] || 'Requester';
    try {
      const created = await this.prisma.user.create({
        data: {
          email: normalizedEmail,
          displayName: fallbackDisplayName,
          role: UserRole.EMPLOYEE,
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          primaryTeamId: true,
        },
      });
      // Card 1.30: say so if this looks like a second account for somebody we
      // already have. After the create, never before - flagging must not be
      // able to stop a user being provisioned. Dropping mail is the one
      // outcome worse than a duplicate row.
      await this.duplicateAccounts.flag(created.email, created.role);
      return created;
    } catch {
      const concurrentCreate = await this.prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          primaryTeamId: true,
        },
      });
      if (!concurrentCreate) {
        throw new BadRequestException(
          'Unable to resolve inbound email requester',
        );
      }
      return concurrentCreate;
    }
  }

  toInboundRequesterAuthUser(requester: {
    id: string;
    email: string;
    displayName: string;
    role: UserRole;
    primaryTeamId: string | null;
  }): AuthUser {
    return {
      id: requester.id,
      email: requester.email,
      displayName: requester.displayName,
      role: requester.role,
      primaryTeamId: requester.primaryTeamId,
      teamId: requester.primaryTeamId,
    };
  }

  extractDisplayIdFromSubject(subject: string) {
    const match = subject.trim().match(/\b([A-Za-z0-9]{2,12}_\d{8}_\d{3,})\b/);
    return match?.[1]?.toUpperCase() ?? null;
  }

  async resolveThreadTarget(
    toEmail: string | undefined,
    subject: string,
    inReplyTo?: string,
    references?: string,
  ): Promise<InboundThreadTarget | null> {
    const replyToken = this.ticketEmailThreads.extractReplyToken(toEmail);
    if (replyToken) {
      const ticketId =
        await this.ticketEmailThreads.resolveTicketIdByReplyAddress(toEmail);
      if (ticketId) {
        return {
          ticketId,
          threadedByReplyToken: replyToken,
          threadedByDisplayId: null,
          threadedByOutboxId: null,
        };
      }
    }

    // Card 1.33: every outbound email references <ticket.{replyToken}@domain>.
    // A reply that quotes only that root still has to land on the right ticket,
    // and the outbox-id matcher below cannot see it - it only matches
    // `outbox.<uuid>`. Checked before the outbox ids because the root is the
    // one id guaranteed to be present.
    const headerTokens = extractReplyTokensFromThreadHeaders(
      inReplyTo,
      references,
    );
    if (headerTokens.length > 0) {
      const thread = await this.prisma.ticketEmailThread.findFirst({
        where: {
          replyToken: { in: headerTokens },
          ticket: { deletedAt: null },
        },
        select: { ticketId: true, replyToken: true },
      });
      if (thread) {
        return {
          ticketId: thread.ticketId,
          threadedByReplyToken: thread.replyToken,
          threadedByDisplayId: null,
          threadedByOutboxId: null,
        };
      }
    }

    const outboxIds = extractOutboxIdsFromThreadHeaders(inReplyTo, references);
    if (outboxIds.length > 0) {
      const outboxes = await this.prisma.notificationOutbox.findMany({
        where: {
          id: { in: outboxIds },
          ticketId: { not: null },
        },
        select: {
          id: true,
          ticketId: true,
        },
      });
      const ticketIdByOutboxId = new Map(
        outboxes
          .filter((outbox): outbox is { id: string; ticketId: string } =>
            Boolean(outbox.ticketId),
          )
          .map((outbox) => [outbox.id, outbox.ticketId]),
      );

      for (const outboxId of outboxIds) {
        const ticketId = ticketIdByOutboxId.get(outboxId);
        if (ticketId) {
          return {
            ticketId,
            threadedByReplyToken: null,
            threadedByDisplayId: null,
            threadedByOutboxId: outboxId,
          };
        }
      }
    }

    const displayId = this.extractDisplayIdFromSubject(subject);
    if (!displayId) {
      return null;
    }

    const ticket = await this.prisma.ticket.findFirst({
      where: {
        displayId: { equals: displayId, mode: 'insensitive' },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!ticket) {
      return null;
    }

    return {
      ticketId: ticket.id,
      threadedByReplyToken: null,
      threadedByDisplayId: displayId,
      threadedByOutboxId: null,
    };
  }

  async reserveInboundEmailReceipt(
    messageIdRaw: string,
    fromEmailRaw: string,
    subjectRaw: string,
  ): Promise<InboundEmailReceiptReservation> {
    const messageId = messageIdRaw.trim();
    if (!messageId) {
      throw new BadRequestException('Inbound email messageId is required');
    }

    const fromEmail = fromEmailRaw.trim().toLowerCase();
    const subject = subjectRaw.trim();
    const reservationId = randomUUID();
    const inserted = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "InboundEmailReceipt" ("id", "messageId", "fromEmail", "subject", "createdAt", "updatedAt")
      VALUES (${reservationId}, ${messageId}, ${fromEmail}, ${subject}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("messageId") DO NOTHING
      RETURNING "id"
    `;
    if (inserted[0]?.id) {
      return { mode: 'reserved', id: inserted[0].id };
    }

    const existing = await this.prisma.$queryRaw<
      Array<{
        fromEmail: string;
        ticketId: string | null;
        threaded: boolean | null;
      }>
    >`
      SELECT "fromEmail", "ticketId", "threaded"
      FROM "InboundEmailReceipt"
      WHERE "messageId" = ${messageId}
      LIMIT 1
    `;
    if (!existing[0]) {
      throw new ConflictException(
        'Inbound email receipt conflicted and could not be resolved',
      );
    }

    if (existing[0].fromEmail !== fromEmail) {
      throw new ConflictException(
        'Inbound email messageId already exists for another sender',
      );
    }

    if (!existing[0].ticketId) {
      throw new ConflictException(
        'Inbound email with this messageId is still processing',
      );
    }

    return {
      mode: 'replay',
      ticketId: existing[0].ticketId,
      threaded: existing[0].threaded ?? false,
    };
  }

  /**
   * How many emails this sender has already put on this ticket inside the
   * window. Read from InboundEmailReceipt, which is written for every inbound
   * message and already unique on messageId, so the count cannot double-count a
   * retry of the same delivery.
   */
  private async countRecentInboundFromSender(
    ticketId: string,
    fromEmail: string,
  ): Promise<number> {
    const since = new Date(
      Date.now() - InboundEmailService.INBOUND_RATE_WINDOW_MS,
    );
    return this.prisma.inboundEmailReceipt.count({
      where: {
        ticketId,
        fromEmail: { equals: fromEmail, mode: 'insensitive' },
        createdAt: { gte: since },
      },
    });
  }

  /** Say on the ticket that a message arrived and deliberately answered nothing. */
  private async recordInboundSuppression(input: {
    ticketId: string;
    requesterId: string;
    fromEmail: string;
    messageId: string;
    reason: 'automated' | 'rate_limited';
    recentFromSender: number;
  }) {
    await this.prisma.ticketEvent
      .create({
        data: {
          ticketId: input.ticketId,
          type: 'INBOUND_EMAIL_SUPPRESSED',
          payload: {
            fromEmail: input.fromEmail,
            messageId: input.messageId,
            reason: input.reason,
            recentFromSender: input.recentFromSender,
            windowMinutes:
              InboundEmailService.INBOUND_RATE_WINDOW_MS / 60_000,
          },
          createdById: input.requesterId,
        },
      })
      .catch((error) =>
        this.logger.error(
          'Failed to record inbound email suppression',
          (error as Error).stack,
        ),
      );
  }

  async completeInboundEmailReceipt(
    receiptId: string,
    ticketId: string,
    threaded: boolean,
  ) {
    await this.prisma.$executeRaw`
      UPDATE "InboundEmailReceipt"
      SET "ticketId" = ${ticketId},
          "threaded" = ${threaded},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${receiptId}
    `;
  }

  async releaseInboundEmailReceipt(receiptId: string) {
    await this.prisma.$executeRaw`
      DELETE FROM "InboundEmailReceipt"
      WHERE "id" = ${receiptId}
    `.catch(() => {
      // no-op: if already finalized or removed, retries can proceed.
    });
  }

  private async preserveInboundEmailReceiptAfterPartialSuccess(
    receiptId: string,
    persistedMutation: PersistedInboundEmailMutation,
    error: unknown,
  ) {
    try {
      await this.completeInboundEmailReceipt(
        receiptId,
        persistedMutation.ticketId,
        persistedMutation.threaded,
      );
    } catch (receiptError) {
      this.logger.error(
        `Failed to finalize inbound email receipt ${receiptId} after partial success on ticket ${persistedMutation.ticketId}.`,
        (receiptError as Error).stack,
      );
    }

    this.logger.warn(
      `Inbound email receipt ${receiptId} was preserved after partial success on ticket ${persistedMutation.ticketId} to prevent duplicate retries.`,
    );
    this.logger.debug((error as Error).stack);
  }

  async buildInboundEmailReplayResponse(ticketId: string, threaded: boolean) {
    const ticket = await this.getTicketForMutationResponse(ticketId);
    return {
      threaded,
      ticket,
    };
  }

  async getTicketForMutationResponse(ticketId: string) {
    const result = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        requester: true,
        assignee: true,
        assignedTeam: true,
        category: true,
        customFieldValues: { include: { customField: true } },
      },
    });
    if (!result || result.deletedAt) {
      throw new BadRequestException('Ticket not found');
    }
    return result;
  }
}
