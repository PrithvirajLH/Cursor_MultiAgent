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
import { INLINE_IMAGE_MARKER } from '../inbound-mailbox/inline-image-marker.util';
import { TicketRealtimeService } from './ticket-realtime.service';
import { TicketsService } from './tickets.service';
import {
  InboundEmailAttachmentDto,
  IngestInboundEmailDto,
} from './dto/ingest-inbound-email.dto';
import { parsePositiveInt } from '../common/config.utils';

/**
 * A file name, safe inside a double-quoted `alt`.
 *
 * The name comes from the sender's mail client, so it is not ours to trust:
 * this body is rendered as HTML in the app.
 */
function escapeAttachmentAlt(fileName: string): string {
  return fileName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type NormalizedInboundAttachment = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  buffer: Buffer;
  /**
   * The sender's `Content-ID`, for a file the body pasted inline
   * (card 1.129, fault B). Absent on an ordinary attached file.
   */
  contentId?: string;
};

/**
 * One inline image, once it has a row and therefore an id
 * (card 1.129, fault B).
 */
export type StoredInlineImage = {
  contentId: string;
  attachmentId: string;
  fileName: string;
};

/** What storing an email's attachments produced (card 1.105, card 1.129). */
export type InboundAttachmentOutcome = {
  rejected: RejectedInboundAttachment[];
  /** Only the files the body referred to as `cid:`; usually empty. */
  inlineImages: StoredInlineImage[];
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
/** One attachment that could not be stored, and why, in words for an agent. */
export type RejectedInboundAttachment = { fileName: string; reason: string };

/**
 * What the inbound payload's attachments turned into (card 1.105).
 *
 * ⚠️ Both halves matter. `accepted` is stored; `rejected` is written onto the
 * ticket so an agent can see a file is missing and ask for it again. Silently
 * dropping is barely better than losing the email.
 */
export type NormalizedInboundAttachmentResult = {
  accepted: NormalizedInboundAttachment[];
  rejected: RejectedInboundAttachment[];
};

// ⚠️ Card 1.108 moved this to `common/truncate-ticket-subject.util.ts` so the
// AI ticket path could reuse it without importing this service. Re-exported
// under its original name, so nothing that referenced it had to change.
export { truncateTicketSubject as truncateInboundSubject } from '../common/truncate-ticket-subject.util';
import { truncateTicketSubject as truncateInboundSubject } from '../common/truncate-ticket-subject.util';

@Injectable()
export class InboundEmailService {
  private readonly logger = new Logger(InboundEmailService.name);
  /** Layer two of loop protection: more than this from one sender on one
   *  ticket inside the window and we stop answering, without ever bouncing. */
  private static readonly INBOUND_RATE_LIMIT = 5;
  /**
   * How long a reservation may sit unfinished before another delivery may take
   * it over (card 1.84).
   *
   * ⚠️ CHOSEN DELIBERATELY, AND THE TRADE IS IN BOTH DIRECTIONS. Too short
   * and a message that is merely slow gets processed twice, producing a
   * duplicate ticket. Too long and a wedged message stays stuck, with the Graph
   * worker retrying it every 30 seconds to no effect.
   *
   * Ten minutes, for two reasons. The input is ingestion latency: one inbound
   * message reserves, classifies, creates the ticket, stores attachments and
   * queues notifications, and even a slow run of that is tens of seconds - so
   * ten minutes is more than an order of magnitude of headroom before anything
   * is called abandoned. And it is the SAME window
   * `email-outbox-sweeper.service.ts` already uses to reclaim an abandoned
   * PROCESSING row, so an operator has one number to remember rather than two.
   */
  private static readonly RESERVATION_STALE_MS = 10 * 60 * 1000;

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
    options?: {
      assignedTeamId?: string | null;
      /**
       * What the AI decided, when it is what chose the team (card 1.63).
       *
       * ⚠️ PRESENT ONLY WHEN THE AI ACTUALLY ROUTED IT. A plus-addressed email
       * never carries this, and neither does one that landed unrouted - so the
       * event below marks exactly the tickets whose team was a classification.
       */
      aiRouting?: {
        teamId: string;
        teamName: string;
        confidence: number;
        thresholdUsed: number;
      };
    },
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
      // ⚠️ CARD 1.105: THIS NO LONGER THROWS, WHICH IS THE ENTIRE CARD.
      // It is still the first call in the block, but an attachment problem now
      // produces a REPORT rather than an exception - so the requester's words
      // are stored either way and the dropped files are recorded on the ticket.
      const { accepted: inboundAttachments, rejected: droppedAttachments } =
        await this.normalizeInboundEmailAttachments(payload.attachments);
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
          const inboundMessage = await this.ticketsService.addMessage(
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
          // ⚠️ CARD 1.121: THE FILES BELONG TO THE MESSAGE THEY ARRIVED ON.
          // Until this card nothing anywhere set `Attachment.messageId`, so
          // card 1.83's rule - refuse a file on an INTERNAL note to anyone who
          // may not read internal notes - had no data to act on and had never
          // once run. `addMessage` already links attachments whose ids appear
          // in the message BODY, which is how the web composer's pasted images
          // work; an emailed body can never carry such an id, because the
          // HTML-to-text conversion drops the image tag. So the link is made
          // explicitly here, where it is known.
          const replyAttachOutcome = await this.attachInboundEmailAttachments(
            existing.id,
            inboundAttachments,
            requester.id,
            inboundMessage?.id,
          );
          // ⚠️ CARD 1.129 FAULT B. The body was stored carrying markers where
          // the sender's pasted images sat, because the files had no ids yet.
          // They do now, so the markers become the SAME `<img
          // data-attachment-id>` the web composer writes - and `MessageBody`
          // hydrates it with no new rendering code on either side.
          //
          // ⚠️ RUN UNCONDITIONALLY, INCLUDING WHEN NOTHING WAS STORED. An
          // unresolved marker is worse than a missing picture: it is `[[cid:...]]`
          // in front of a requester. This removes any that are left.
          await this.resolveInlineImageMarkers(
            inboundMessage?.id,
            replyAttachOutcome.inlineImages,
          );
          await this.recordDroppedInboundAttachments(existing.id, [
            ...droppedAttachments,
            ...replyAttachOutcome.rejected,
          ]);

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
          // ⚠️ CARD 1.105: TRUNCATE, DO NOT FAIL. `Ticket.subject` is
          // VarChar(200), so a long forwarded subject - "FW: RE: FW:" chains
          // reach this easily - raised Prisma P2000 and lost the email with it.
          subject: truncateInboundSubject(payload.subject),
          // ⚠️ CARD 1.129 FAULT B: MARKERS NEVER REACH A DESCRIPTION.
          // Creating a ticket writes no TicketMessage - the email's words
          // become the DESCRIPTION - and `TicketDescription.tsx` renders that
          // as TEXT, not through `MessageBody`. So an `<img>` here would be
          // markup on the page, and the column carries
          // `Ticket_description_trgm_idx` besides. The picture is named
          // instead, which is still more than the nothing it left before.
          description: this.describeInlineImageMarkers(
            payload.body,
            inboundAttachments,
          ),
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
      // ⚠️ NO messageId HERE, AND THAT IS CORRECT RATHER THAN AN OVERSIGHT.
      // Creating a ticket writes no TicketMessage at all - the first email's
      // words become the ticket DESCRIPTION - so there is no message for these
      // files to belong to. A null messageId reads as "not on an internal
      // note", which is the right answer for files the requester themselves
      // sent in.
      const newTicketAttachOutcome = await this.attachInboundEmailAttachments(
        created.id,
        inboundAttachments,
        requester.id,
      );
      await this.recordDroppedInboundAttachments(created.id, [
        ...droppedAttachments,
        ...newTicketAttachOutcome.rejected,
      ]);

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

      // ⚠️ CARD 1.63: SAY THAT THE AI CHOSE THE TEAM, AND WITH WHAT CONFIDENCE.
      // Without this nobody can ever tell how often it is right - which is the
      // one number that decides whether the threshold is set correctly. A
      // routing decision nobody can audit is not a decision, it is a guess with
      // better manners.
      //
      // ⚠️ BEST EFFORT, LIKE EVERY OTHER EVENT ON THIS PATH. The ticket exists
      // and the sender's words are stored; losing the annotation must not undo
      // that.
      if (options?.aiRouting) {
        await this.prisma.ticketEvent
          .create({
            data: {
              ticketId: created.id,
              type: 'TICKET_ROUTED_BY_AI',
              payload: {
                teamId: options.aiRouting.teamId,
                teamName: options.aiRouting.teamName,
                confidence: options.aiRouting.confidence,
                thresholdUsed: options.aiRouting.thresholdUsed,
                messageId,
              },
              createdById: null,
            },
          })
          .catch((error) =>
            this.logger.error(
              `Failed to record the AI routing decision for ticket ${created.id}`,
              (error as Error).stack,
            ),
          );
      }

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

  /**
   * Store what can be stored, and say what could not (card 1.105).
   *
   * Returns the files that failed rather than throwing, so a single unstorable
   * attachment cannot undo an email that has already been persisted.
   */
  async attachInboundEmailAttachments(
    ticketId: string,
    attachments: NormalizedInboundAttachment[],
    actorId: string,
    messageId?: string,
  ): Promise<InboundAttachmentOutcome> {
    if (attachments.length === 0) {
      return { rejected: [], inlineImages: [] };
    }

    // ⚠️ CARD 1.105, THE SECOND CLIFF. This was `Promise.all`, and
    // `createTicketAttachmentFromBuffer` calls `assertAttachmentWithinSizeLimit`,
    // which THROWS. So one oversized file rejected the whole batch - after the
    // ticket already existed, leaving a created ticket and a failed ingest that
    // the mailbox worker then retried into a reservation conflict. Making the
    // normalizer non-throwing alone would only have moved the cliff here.
    const failures: RejectedInboundAttachment[] = [];
    const inlineImages: StoredInlineImage[] = [];
    const created: Awaited<
      ReturnType<TicketAttachmentService['createTicketAttachmentFromBuffer']>
    >[] = [];
    for (const attachment of attachments) {
      try {
        const stored = await this.attachmentService.createTicketAttachmentFromBuffer(
          ticketId,
          {
            originalName: attachment.fileName,
            contentType: attachment.contentType,
            buffer: attachment.buffer,
          },
          actorId,
          messageId,
        );
        created.push(stored);
        // ⚠️ CARD 1.129 FAULT B. Only a file the BODY referred to as `cid:`
        // carries a contentId, so this stays empty for ordinary attachments -
        // which is every file this platform has ever received bar the pasted
        // ones.
        if (attachment.contentId) {
          inlineImages.push({
            contentId: attachment.contentId,
            attachmentId: stored.id,
            fileName: attachment.fileName,
          });
        }
      } catch (error) {
        failures.push({
          fileName: attachment.fileName,
          reason: error instanceof Error ? error.message : 'could not be stored',
        });
      }
    }

    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId,
        reason: 'attachment_added',
        actorId,
      }),
    );

    return { rejected: failures, inlineImages };
  }

  /**
   * Put the pasted images back where the sender had them (card 1.129, fault B).
   *
   * The body was stored carrying `[[cid:...]]` markers, because at that moment
   * the files had no ids. Now they do, so each marker becomes the SAME
   * `<img data-attachment-id>` the web composer writes - which `MessageBody`
   * already hydrates, and `redaction-caveat.ts` already counts. Nothing new
   * renders it.
   *
   * ⚠️ CALLED EVEN WHEN NOTHING WAS STORED, and that is the point. A marker
   * left in place is `[[cid:abc]]` in front of a requester, which is worse than
   * the missing picture it stands for. Anything unresolved is removed, leaving
   * exactly what the body looked like before this card.
   *
   * ⚠️ ONE UPDATE, AND ONLY WHEN THE TEXT ACTUALLY CHANGED. A body with no
   * markers - every message this platform has ever received bar the pasted
   * ones - costs a string scan and no database write.
   *
   * @param messageId The stored message, or undefined when there is none.
   * @param inlineImages The files the body referenced, now with ids.
   */
  private async resolveInlineImageMarkers(
    messageId: string | undefined,
    inlineImages: StoredInlineImage[],
  ): Promise<void> {
    if (!messageId) {
      return;
    }
    const message = await this.prisma.ticketMessage.findUnique({
      where: { id: messageId },
      select: { body: true },
    });
    if (!message?.body) {
      return;
    }
    const byContentId = new Map(
      inlineImages.map((image) => [image.contentId, image]),
    );
    const resolved = message.body.replace(
      INLINE_IMAGE_MARKER.findAll(),
      (_marker, contentId: string) => {
        const image = byContentId.get(contentId);
        if (!image) {
          return '';
        }
        return `<img data-attachment-id="${image.attachmentId}" alt="${escapeAttachmentAlt(image.fileName)}">`;
      },
    );
    if (resolved === message.body) {
      return;
    }
    await this.prisma.ticketMessage.update({
      where: { id: messageId },
      data: { body: resolved },
    });
  }

  /**
   * The same markers, for a body that will be read as TEXT (card 1.129).
   *
   * A new ticket's first email becomes the ticket description, which is
   * rendered as plain text - so a marker there becomes the file's NAME rather
   * than an image element. Unknown markers are removed.
   *
   * @param body The flattened email body, possibly carrying markers.
   * @param attachments The files normalized from the same email.
   * @returns The body with every marker resolved or removed.
   */
  private describeInlineImageMarkers(
    body: string,
    attachments: NormalizedInboundAttachment[],
  ): string {
    const byContentId = new Map(
      attachments
        .filter((attachment) => Boolean(attachment.contentId))
        .map((attachment) => [attachment.contentId as string, attachment]),
    );
    return body.replace(
      INLINE_IMAGE_MARKER.findAll(),
      (_marker, contentId: string) => {
        const attachment = byContentId.get(contentId);
        return attachment ? `[image: ${attachment.fileName}]` : '';
      },
    );
  }

  /**
   * Say on the ticket that some files did not make it, and why (card 1.105).
   *
   * ⚠️ AN AGENT MUST BE ABLE TO SEE THAT A FILE IS MISSING AND ASK FOR IT
   * AGAIN. Dropping silently is barely better than losing the email: the
   * requester believes they sent a screenshot, the agent never knows one
   * existed, and the ticket stalls on a misunderstanding.
   *
   * Never throws. The email is already stored by the time this runs, and a
   * failure to write the note must not undo it.
   */
  private async recordDroppedInboundAttachments(
    ticketId: string,
    dropped: RejectedInboundAttachment[],
  ): Promise<void> {
    if (dropped.length === 0) {
      return;
    }
    try {
      await this.prisma.ticketEvent.create({
        data: {
          ticketId,
          type: 'INBOUND_ATTACHMENTS_DROPPED',
          payload: {
            count: dropped.length,
            files: dropped.map((file) => ({
              fileName: file.fileName,
              reason: file.reason,
            })),
          },
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not record dropped attachments for ticket ${ticketId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /**
   * Turn the inbound payload's attachments into buffers we can store.
   *
   * ⚠️ CARD 1.105: THIS USED TO THROW, AND IT IS THE FIRST CALL IN THE TRY
   * BLOCK - ahead of the requester, the thread target and the ticket. So one
   * file over a limit discarded the entire email, the person's words included,
   * and on the mailbox path the message stayed in the Inbox and was re-offered
   * every thirty seconds, failing identically each time.
   *
   * It now REPORTS instead of throwing: everything usable comes back in
   * `accepted`, everything else in `rejected` with a reason a person can read.
   * The caller stores the email either way and records what was dropped.
   *
   * ⚠️ The limits are lower than they sound. Ten attachments is three to five
   * Outlook signature images plus a handful of screenshots, and one modern
   * phone photo can exceed 10 MB on its own.
   */
  async normalizeInboundEmailAttachments(
    attachments: InboundEmailAttachmentDto[] | undefined,
  ): Promise<NormalizedInboundAttachmentResult> {
    if (!attachments || attachments.length === 0) {
      return { accepted: [], rejected: [] };
    }

    const maxCount = parsePositiveInt(
      this.config.get<string>('INBOUND_EMAIL_MAX_ATTACHMENTS'),
      10,
    );
    // Over the count limit: keep the first `maxCount` and report the rest.
    // Dropping the overflow beats dropping the email.
    const rejected: RejectedInboundAttachment[] = [];
    const withinCount = attachments.slice(0, maxCount);
    for (const overflow of attachments.slice(maxCount)) {
      rejected.push({
        fileName: overflow.fileName?.trim() || '(unnamed)',
        reason: `more than ${maxCount} attachments on one email`,
      });
    }

    const maxBytes = this.attachmentService.getAttachmentMaxBytes();
    const maxAggregateBytes = maxBytes * maxCount;
    let totalBytes = 0;

    const normalized: NormalizedInboundAttachment[] = [];
    for (const [index, attachment] of withinCount.entries()) {
      const fileName = attachment.fileName.trim();
      const contentType = attachment.contentType.trim().toLowerCase();
      const declaredSize = attachment.sizeBytes;
      const hasBase64 = Boolean(attachment.contentBase64?.trim());
      const hasContentUrl = Boolean(attachment.contentUrl?.trim());

      if (hasBase64 === hasContentUrl) {
        rejected.push({
          fileName: fileName || `attachment ${index + 1}`,
          reason: 'the message did not carry the file content',
        });
        continue;
      }

      let buffer: Buffer;
      try {
        buffer = hasBase64
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
            `expected ${declaredSize} bytes, got ${buffer.length}`,
          );
        }
        this.attachmentService.assertAttachmentWithinSizeLimit(buffer.length);
      } catch (error) {
        // ⚠️ ONE BAD FILE IS ONE REJECTION, not a lost email. The reason is
        // kept human-readable because it is shown to an agent on the ticket.
        rejected.push({
          fileName: fileName || `attachment ${index + 1}`,
          reason:
            error instanceof Error ? error.message : 'could not be read',
        });
        continue;
      }

      totalBytes += buffer.length;
      if (totalBytes > maxAggregateBytes) {
        rejected.push({
          fileName,
          reason: `the email's attachments together exceed ${Math.round(maxAggregateBytes / (1024 * 1024))} MB`,
        });
        continue;
      }

      normalized.push({
        fileName,
        contentType,
        sizeBytes: buffer.length,
        buffer,
        // Card 1.129 fault B: absent for every attachment that is not a
        // pasted, body-referenced image.
        ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
      });
    }

    return { accepted: normalized, rejected };
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
      // ⚠️ CARD 1.84: A RESERVATION NOBODY CLEARED USED TO BLOCK THE MESSAGE
      // FOREVER.
      //
      // The row is inserted with a null `ticketId` to claim the message, and is
      // released only in the `catch`. A process exit between the INSERT and
      // completion - a deploy, an OOM, a killed container - leaves a row that
      // nothing clears. The Graph worker then re-offers that message every 30
      // seconds and every attempt conflicts here, forever. Recovery was editing
      // the database by hand.
      //
      // Reclaimed the way `outbox.service.ts:reclaimStaleProcessing` reclaims an
      // abandoned PROCESSING row, rather than inventing a second mechanism.
      //
      // The UPDATE is the lock: it is conditional on the row STILL being unowned
      // and STILL being stale, so two workers racing to reclaim cannot both win -
      // the loser matches nothing and falls through to the conflict below.
      const staleBefore = new Date(
        Date.now() - InboundEmailService.RESERVATION_STALE_MS,
      );
      const reclaimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE "InboundEmailReceipt"
        SET "updatedAt" = CURRENT_TIMESTAMP
        WHERE "messageId" = ${messageId}
          AND "ticketId" IS NULL
          AND "updatedAt" < ${staleBefore}
        RETURNING "id"
      `;
      if (reclaimed[0]?.id) {
        this.logger.warn(
          `Reclaimed a stale inbound reservation for messageId ${messageId}; a previous attempt did not finish`,
        );
        return { mode: 'reserved', id: reclaimed[0].id };
      }
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
