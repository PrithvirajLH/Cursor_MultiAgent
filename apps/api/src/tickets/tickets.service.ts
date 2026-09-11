import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import {
  AccessLevel,
  MessageType,
  NotificationType,
  OutboxStatus,
  Prisma,
  TagSource,
  TeamAssignmentStrategy,
  TicketCloseReason,
  TicketLinkType,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import type { Express } from 'express';
import { AuthUser } from '../auth/current-user.decorator';
import { toCsvRow } from '../common/csv.util';
import { AccessControlService } from '../common/access-control.service';
import {
  sameCountBoundaries,
  type TicketCountBoundaries,
} from './ticket-count-boundaries.util';
import { canManageOtherFollowers } from '../common/can-manage-followers.util';
import { AiObservabilityService } from '../common/ai-observability.service';
import { AutomationQueueService } from '../common/automation-queue.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { MessageRecipientsPreview } from '../notifications/message-recipients-preview.type';
import type { LinkTicketDto } from './dto/link-ticket.dto';
import type { TicketLinkView } from './ticket-link-view.type';
import { PrismaService } from '../prisma/prisma.service';
import { TicketAttachmentService } from './ticket-attachment.service';
import { TicketRealtimeService } from './ticket-realtime.service';
import { TicketSlaCalculationService } from './ticket-sla-calculation.service';
import { InboundEmailService } from './inbound-email.service';
import { OutboxService } from '../notifications/outbox.service';
import { inlineAttachmentIds } from './inline-attachment-ids.util';
import { runBulkWithConcurrency } from '../common/run-bulk-with-concurrency.util';
import { stripQuotedReply } from '../notifications/quoted-reply.util';
import { TagsService } from '../tags/tags.service';
import { SlaEngineService } from '../slas/sla-engine.service';
import { parsePositiveInt } from '../common/config.utils';
import { AddTicketMessageDto } from './dto/add-ticket-message.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { BulkAssignDto } from './dto/bulk-assign.dto';
import { BulkPriorityDto } from './dto/bulk-priority.dto';
import { BulkStatusDto } from './dto/bulk-status.dto';
import { BulkTagsDto } from './dto/bulk-tags.dto';
import { BulkTransferDto } from './dto/bulk-transfer.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { DeleteTicketDto } from './dto/delete-ticket.dto';
import { IngestInboundEmailDto } from './dto/ingest-inbound-email.dto';
import { ListTicketsDto } from './dto/list-tickets.dto';
import { TicketActivityDto } from './dto/ticket-activity.dto';
import { TicketStatusDto } from './dto/ticket-status.dto';
import { TransitionTicketDto } from './dto/transition-ticket.dto';
import { TransferTicketDto } from './dto/transfer-ticket.dto';
import { UpdateAttachmentScanDto } from './dto/update-attachment-scan.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

/** One field changed by PATCH /tickets/:id, recorded in the TICKET_EDITED event. */
type TicketEditChange = {
  field: 'subject' | 'description' | 'followUpAt';
  from: string | null;
  to: string | null;
};

export type StatusTransitionTicketSnapshot = {
  id: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignedTeamId: string | null;
  assigneeId: string | null;
  dueAt: Date | null;
  slaPausedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  completedAt: Date | null;
};

export type TeamTransferTicketSnapshot = {
  id: string;
  createdAt: Date;
  status: TicketStatus;
  priority: TicketPriority;
  assignedTeamId: string | null;
  assigneeId: string | null;
  firstResponseDueAt: Date | null;
  dueAt: Date | null;
};

export type TeamAssignmentTicketSnapshot = {
  id: string;
  status: TicketStatus;
  assignedTeamId: string | null;
  assigneeId: string | null;
};

/** Ticket CSV export (card 1.13): column order, batching and the hard row cap. */
const TICKET_EXPORT_COLUMNS = [
  'Ticket',
  'Subject',
  'Status',
  'Priority',
  'Department',
  'Assignee',
  'Requester',
  'Requester email',
  'Category',
  'Channel',
  'Tags',
  'Created',
  'Updated',
  'Resolved',
  'Closed',
  'Close reason',
  'First response due',
  'Resolution due',
  'SLA state',
] as const;
const TICKET_EXPORT_BATCH_SIZE = 500;
const TICKET_EXPORT_MAX_ROWS = 50_000;
const SLA_AT_RISK_WINDOW_MS = 4 * 60 * 60 * 1000;
const TICKET_EXPORT_SELECT = {
  id: true,
  number: true,
  displayId: true,
  subject: true,
  status: true,
  priority: true,
  channel: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  closedAt: true,
  closeReason: true,
  completedAt: true,
  dueAt: true,
  firstResponseDueAt: true,
  assignedTeam: { select: { name: true } },
  assignee: { select: { displayName: true } },
  requester: { select: { displayName: true, email: true } },
  category: { select: { name: true } },
  tags: { select: { tag: { select: { name: true } } } },
} satisfies Prisma.TicketSelect;

/** "WAITING_ON_REQUESTER" -> "Waiting on requester" for human-readable cells. */
function formatStatusLabel(value: string): string {
  const spaced = value.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * One `NotificationOutbox` row that belongs to a message (card 1.47).
 *
 * `reached` is `1 + cc.length`: since card 1.33 a public reply produces a
 * single row carrying `to` and `cc`, so the number of people it reaches lives
 * on the row rather than in a count of rows.
 */
/**
 * What the conversation is told about one message's delivery (card 1.73).
 *
 * ⚠️ `pending` WAS ALREADY COMPUTED AND THEN DROPPED ON THE FLOOR. The API
 * returned it, the client's type omitted it, and the fallback below spelled
 * `{ emailed: 0, refused: 0 }` - three shapes for one idea. A message whose
 * email is still queued therefore rendered NO label at all, which reads exactly
 * like an internal note that was never emailed. Production has no Redis, so the
 * sweeper runs on a 60-second interval and that state is real, not momentary.
 */
type MessageDeliveryLabel = {
  emailed: number;
  refused: number;
  pending: number;
  recipients: string[];
};

/** The shape a message with no outbox row reports. See MessageDeliveryLabel. */
const EMPTY_DELIVERY_LABEL: MessageDeliveryLabel = {
  emailed: 0,
  refused: 0,
  pending: 0,
  recipients: [],
};

type MessageOutboxRow = {
  id: string;
  status: OutboxStatus;
  reached: number;
  /**
   * Who this outbox row was addressed to (card 1.73).
   *
   * ⚠️ THESE WERE BEING READ AND THROWN AWAY. `messageOutboxRows` opened the
   * payload for `email.cc`, counted `1 + cc.length`, and kept only the number -
   * so the conversation could say "emailed to 2" and had no way to say who. The
   * owner asked for exactly that, and no new query or endpoint was needed: the
   * primary address is `NotificationOutbox.toEmail`, a top-level column, and
   * the copies are already in the payload.
   */
  recipients: string[];
};

/**
 * What `tickets:counts:<userId>` holds.
 *
 * The boundaries travel WITH the counts rather than in the key - see the note
 * in getCounts. Not exported: nothing outside this file may depend on the
 * cache's private shape.
 */
type CachedTicketCounts = {
  boundaries: TicketCountBoundaries | null;
  counts: Awaited<ReturnType<TicketsService['getCounts']>>;
};

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly slaEngine: SlaEngineService,
    private readonly customFieldsService: CustomFieldsService,
    @Inject(forwardRef(() => AutomationQueueService))
    private readonly automationQueue: AutomationQueueService,
    private readonly accessControl: AccessControlService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly attachmentService: TicketAttachmentService,
    private readonly ticketRealtime: TicketRealtimeService,
    private readonly slaCalc: TicketSlaCalculationService,
    private readonly aiObservability: AiObservabilityService,
    @Inject(forwardRef(() => InboundEmailService))
    private readonly inboundEmailService: InboundEmailService,
    private readonly tagsService: TagsService,
    // Card 1.47: redaction has to be able to stop a queued email. Exported by
    // NotificationsModule already, for readiness and the operations console.
    private readonly outbox: OutboxService,
  ) {
    const customTransitionsStr = this.config.get<string>(
      'TICKET_STATUS_TRANSITIONS',
    );
    if (customTransitionsStr) {
      try {
        this.STATUS_TRANSITIONS =
          this.parseStatusTransitions(customTransitionsStr);
      } catch (err) {
        this.logger.error(
          'Failed to parse TICKET_STATUS_TRANSITIONS from env. Using defaults.',
          err,
        );
        this.STATUS_TRANSITIONS = this.DEFAULT_STATUS_TRANSITIONS;
      }
    } else {
      this.STATUS_TRANSITIONS = this.DEFAULT_STATUS_TRANSITIONS;
    }
  }

  private readonly WAITING_STATUSES = [
    TicketStatus.WAITING_ON_REQUESTER,
    TicketStatus.WAITING_ON_VENDOR,
  ];
  private readonly STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]>;
  /**
   * The only moves a ticket's own requester may make (card 1.2): confirm a
   * resolution (RESOLVED -> CLOSED), reopen (RESOLVED|CLOSED -> REOPENED) and
   * cancel an untouched ticket (NEW|TRIAGED -> CLOSED).
   */
  private readonly REQUESTER_TRANSITIONS: ReadonlyArray<
    [TicketStatus, TicketStatus]
  > = [
    [TicketStatus.RESOLVED, TicketStatus.CLOSED],
    [TicketStatus.RESOLVED, TicketStatus.REOPENED],
    [TicketStatus.CLOSED, TicketStatus.REOPENED],
    [TicketStatus.NEW, TicketStatus.CLOSED],
    [TicketStatus.TRIAGED, TicketStatus.CLOSED],
  ];
  // NEW/TRIAGED -> CLOSED lets a requester cancel and an agent close an
  // untouched ticket directly ("duplicate, closing") — card 1.2.
  private readonly DEFAULT_STATUS_TRANSITIONS: Record<
    TicketStatus,
    TicketStatus[]
  > = {
    [TicketStatus.NEW]: [
      TicketStatus.TRIAGED,
      TicketStatus.ASSIGNED,
      TicketStatus.CLOSED,
    ],
    [TicketStatus.TRIAGED]: [TicketStatus.ASSIGNED, TicketStatus.CLOSED],
    [TicketStatus.ASSIGNED]: [
      TicketStatus.IN_PROGRESS,
      TicketStatus.WAITING_ON_REQUESTER,
      TicketStatus.WAITING_ON_VENDOR,
      TicketStatus.RESOLVED,
    ],
    [TicketStatus.IN_PROGRESS]: [
      TicketStatus.WAITING_ON_REQUESTER,
      TicketStatus.WAITING_ON_VENDOR,
      TicketStatus.RESOLVED,
    ],
    [TicketStatus.WAITING_ON_REQUESTER]: [
      TicketStatus.IN_PROGRESS,
      TicketStatus.WAITING_ON_VENDOR,
      TicketStatus.RESOLVED,
    ],
    [TicketStatus.WAITING_ON_VENDOR]: [
      TicketStatus.IN_PROGRESS,
      TicketStatus.WAITING_ON_REQUESTER,
      TicketStatus.RESOLVED,
    ],
    [TicketStatus.RESOLVED]: [TicketStatus.REOPENED, TicketStatus.CLOSED],
    [TicketStatus.CLOSED]: [TicketStatus.REOPENED],
    [TicketStatus.REOPENED]: [
      TicketStatus.TRIAGED,
      TicketStatus.ASSIGNED,
      TicketStatus.IN_PROGRESS,
      TicketStatus.WAITING_ON_REQUESTER,
      TicketStatus.WAITING_ON_VENDOR,
      TicketStatus.RESOLVED,
    ],
  };

  private readonly schemaCheckCacheTtlMs = (() => {
    const parsed = Number.parseInt(
      process.env.SCHEMA_CHECK_CACHE_TTL_MS ?? '',
      10,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
  })();
  private defaultActivityDays = 7;
  private routingAssigneeColumnCache: {
    exists: boolean;
    checkedAtMs: number;
  } | null = null;
  private routingExpandedColumnCache: {
    exists: boolean;
    checkedAtMs: number;
  } | null = null;

  /** For date-only "to" values (YYYY-MM-DD), return next day 00:00 UTC so lt includes the whole selected day. */
  private toEndExclusive(dateStr: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const d = new Date(`${dateStr}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d;
    }
    return new Date(dateStr);
  }

  /** Normalize query param that may be string or array (query params often arrive as strings). */
  private toArray<T>(value: T | T[] | string | undefined): T[] {
    if (value == null) return [];
    if (Array.isArray(value))
      return value.filter((v): v is T => v != null && v !== '');
    if (typeof value === 'string')
      return value
        .split(',')
        .map((s) => s.trim() as T)
        .filter(Boolean);
    return [];
  }

  private activityDateRange(from?: string, to?: string) {
    const now = new Date();
    const toBase = to ? new Date(to) : now;
    const toDateInclusive = new Date(
      Date.UTC(
        toBase.getUTCFullYear(),
        toBase.getUTCMonth(),
        toBase.getUTCDate(),
      ),
    );
    const toEndExclusive = this.toEndExclusive(
      to ?? toDateInclusive.toISOString().slice(0, 10),
    );
    const fromBase = from ? new Date(from) : new Date(toDateInclusive);
    if (!from) {
      fromBase.setUTCDate(
        fromBase.getUTCDate() - (this.defaultActivityDays - 1),
      );
    }
    const fromDate = new Date(
      Date.UTC(
        fromBase.getUTCFullYear(),
        fromBase.getUTCMonth(),
        fromBase.getUTCDate(),
      ),
    );
    return { fromDate, toEndExclusive, toDateInclusive };
  }

  /** Delegates to shared AccessControlService */
  /**
   * Minutes before a due date at which a ticket counts as at risk of breach.
   *
   * ⚠️ CARD 1.70 ② MADE THIS THE ONLY DEFINITION. There were three: this
   * setting (default 120) in `getCounts`, a hard-coded four hours in
   * `buildListWhere`, and the literal "1h" in the sidebar label. A badge, the
   * list it opens and the words on it disagreed - and had drifted twice
   * already, which is how three appeared. The value is also returned by
   * `getCounts` so the label is rendered from it rather than typed again.
   *
   * Read from `process.env` per call rather than cached at construction, so a
   * changed setting takes effect on restart without a code change and tests can
   * set it per case.
   */
  private atRiskThresholdMinutes(): number {
    return parsePositiveInt(process.env.SLA_AT_RISK_THRESHOLD_MINUTES, 120);
  }

  /**
   * "Not finished" — the single definition of it (card 1.72).
   *
   * ⚠️ THERE WERE TWO SPELLINGS AND THEY PICKED DIFFERENT HALVES. The counts
   * said `status NOT IN (RESOLVED, CLOSED)`; the list's `slaStatus` branches
   * said `completedAt IS NULL`. Those agree only while the invariant
   * "completedAt is set exactly when a ticket is finished" holds, and that
   * invariant has two holes:
   *
   *   - `20260123151500_add_completed_at` added the column with NO backfill, so
   *     anything finished before 2026-01-23 is RESOLVED with a null stamp. The
   *     count excludes it; the list counted it as breached.
   *   - nothing stops a row carrying a stamp while its status is open. The list
   *     excludes it; the count did not.
   *
   * So neither spelling alone is right, and this is why the handoff's
   * suggestion of `completedAt IS NULL` as the single form could not be taken:
   * its own required test asks that a legacy RESOLVED row with a null stamp be
   * excluded by BOTH, and `completedAt IS NULL` alone includes it. Finished
   * means EITHER signal; not finished means neither.
   *
   * The planner measured production on 2026-09-11 - 427 tickets, 6 finished, 0
   * missing the stamp - so this is a refactor today and a guard against the day
   * it is not. If any number moves, the measurement missed something.
   *
   * Expressed twice because the two call sites speak different languages - raw
   * SQL for the counts, a Prisma filter for the list - and `notFinishedFilter`
   * below is its counterpart. `sla-finished-parity.spec.ts` asserts they agree.
   */
  private notFinishedSql(alias = 't'): Prisma.Sql {
    const status = Prisma.raw(`(${alias}."status")::text`);
    const completedAt = Prisma.raw(`${alias}."completedAt"`);
    return Prisma.sql`(${status} NOT IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED}) AND ${completedAt} IS NULL)`;
  }

  /** The Prisma-filter counterpart of `notFinishedSql`. See its doc comment. */
  private notFinishedFilter(): Prisma.TicketWhereInput {
    return {
      status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
      completedAt: null,
    };
  }

  private accessConditionSql(user: AuthUser, alias = 't'): Prisma.Sql {
    return this.accessControl.accessConditionSql(user, alias);
  }

  /**
   * The `where` clause behind `GET /api/tickets` — every filter the list UI can
   * set, plus the caller's access filter. Shared with `exportCsv` so the export
   * and the list can never drift apart (card 1.13).
   */
  private buildListWhere(
    query: ListTicketsDto,
    user: AuthUser,
  ): Prisma.TicketWhereInput {
    if (query.includeDeleted && user.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only owners can list deleted tickets');
    }

    const statuses = this.toArray<string>(
      query.statuses as string | string[] | undefined,
    );
    const priorities = this.toArray<string>(
      query.priorities as string | string[] | undefined,
    );
    const teamIds = this.toArray<string>(
      query.teamIds as string | string[] | undefined,
    );
    const assigneeIds = this.toArray<string>(
      query.assigneeIds as string | string[] | undefined,
    );
    const requesterIds = this.toArray<string>(
      query.requesterIds as string | string[] | undefined,
    );
    const slaStatus = this.toArray<string>(
      query.slaStatus as string | string[] | undefined,
    );

    const filters: Prisma.TicketWhereInput[] = [];

    if (statuses.length) {
      filters.push({ status: { in: statuses as TicketStatus[] } });
    } else if (query.status) {
      filters.push({ status: query.status });
    } else if (query.statusGroup && query.statusGroup !== 'all') {
      if (query.statusGroup === 'open') {
        filters.push({
          status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
        });
      } else if (query.statusGroup === 'resolved') {
        filters.push({
          status: { in: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
        });
      }
    }

    if (priorities.length) {
      filters.push({ priority: { in: priorities as TicketPriority[] } });
    } else if (query.priority) {
      filters.push({ priority: query.priority });
    }

    if (query.scope === 'assigned') {
      filters.push({ assigneeId: user.id });
    } else if (query.scope === 'unassigned') {
      filters.push({ assigneeId: null });
    } else if (query.scope === 'created') {
      filters.push({ requesterId: user.id });
    } else if (query.scope === 'watching') {
      // Active tickets the user follows but is NOT the assignee or
      // requester for. Assigning a user (or being the requester) adds
      // a follower row automatically — Watching is for tickets the
      // user has explicitly subscribed to outside of those default
      // relationships, so we exclude both. Resolved/closed work falls
      // off the list; the follower row stays so reopens still notify.
      filters.push({
        followers: { some: { userId: user.id } },
        NOT: [{ assigneeId: user.id }, { requesterId: user.id }],
        status: {
          notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED],
        },
      });
    } else if (query.scope === 'followups') {
      // "Follow-ups due today" (card 1.10). Everything already due, plus the
      // rest of today, so the view is useful first thing in the morning rather
      // than only at the moment a reminder fires. Scoped to the user's own
      // tickets: a follow-up is the assignee's reminder, not a team-wide queue.
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      filters.push({
        assigneeId: user.id,
        followUpAt: { not: null, lte: endOfToday },
      });
    } else if (query.scope === 'mentions') {
      // Only tickets with an UNREAD mention notification for this user.
      // Marking the notification read drops the ticket from the list.
      filters.push({
        notifications: {
          some: {
            userId: user.id,
            type: NotificationType.TICKET_MENTIONED,
            isRead: false,
          },
        },
      });
    }

    if (teamIds.length) {
      filters.push({ assignedTeamId: { in: teamIds } });
    } else if (query.teamId) {
      filters.push({ assignedTeamId: query.teamId });
    }

    if (assigneeIds.length) {
      filters.push({ assigneeId: { in: assigneeIds } });
    } else if (query.assigneeId) {
      filters.push({ assigneeId: query.assigneeId });
    }

    if (requesterIds.length) {
      filters.push({ requesterId: { in: requesterIds } });
    } else if (query.requesterId) {
      filters.push({ requesterId: query.requesterId });
    }

    if (query.tags?.length) {
      // AND semantics: ticket must carry every requested tag.
      const tagNames = query.tags
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      for (const name of tagNames) {
        filters.push({ tags: { some: { tag: { name } } } });
      }
    }

    if (query.createdFrom) {
      filters.push({ createdAt: { gte: new Date(query.createdFrom) } });
    }
    if (query.createdTo) {
      filters.push({ createdAt: { lt: this.toEndExclusive(query.createdTo) } });
    }
    if (query.updatedFrom) {
      filters.push({ updatedAt: { gte: new Date(query.updatedFrom) } });
    }
    if (query.updatedTo) {
      filters.push({ updatedAt: { lt: this.toEndExclusive(query.updatedTo) } });
    }
    if (query.dueFrom) {
      filters.push({ dueAt: { gte: new Date(query.dueFrom) } });
    }
    if (query.dueTo) {
      filters.push({ dueAt: { lt: this.toEndExclusive(query.dueTo) } });
    }

    if (slaStatus.length) {
      const now = new Date();
      // ⚠️ CARD 1.70 ②. This was a HARD-CODED four hours while `getCounts`
      // used SLA_AT_RISK_THRESHOLD_MINUTES and the sidebar label said "1h" -
      // three numbers for one idea. The setting is now the single definition,
      // so the list, the count and the label cannot disagree again.
      const riskEnd = new Date(
        now.getTime() + this.atRiskThresholdMinutes() * 60_000,
      );
      const slaConditions: Prisma.TicketWhereInput[] = [];
      const notWaiting = { status: { notIn: this.WAITING_STATUSES } };
      // ⚠️ CARD 1.72: `notFinishedFilter()` rather than a bare
      // `{ completedAt: null }`. These three branches used the stamp alone,
      // which counts a pre-2026-01-23 RESOLVED ticket as breached forever - it
      // has no stamp because the column was added without a backfill.
      const notFinished = this.notFinishedFilter();
      if (slaStatus.includes('breached')) {
        slaConditions.push({
          AND: [notFinished, { dueAt: { not: null, lt: now } }, notWaiting],
        });
      }
      if (slaStatus.includes('at_risk')) {
        slaConditions.push({
          AND: [
            notFinished,
            { dueAt: { not: null, gte: now, lte: riskEnd } },
            notWaiting,
          ],
        });
      }
      if (slaStatus.includes('on_track')) {
        slaConditions.push({
          AND: [notFinished, { dueAt: { not: null, gt: riskEnd } }, notWaiting],
        });
      }
      if (slaConditions.length) {
        filters.push({ OR: slaConditions });
      }
    }

    if (query.q) {
      const term = query.q.trim();
      const searchFilters: Prisma.TicketWhereInput[] = [
        { subject: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { displayId: { contains: term, mode: 'insensitive' } },
      ];
      const numberMatch = term.match(/\d+/);
      if (numberMatch) {
        const parsed = Number(numberMatch[0]);
        // `Ticket.number` is a 32-bit Postgres Int. A term containing a larger
        // number (e.g. a Date.now() timestamp embedded in a subject) would
        // overflow the column comparison and crash the query with a DB error
        // ("integer out of range"). Only add the numeric filter when the value
        // fits the signed 32-bit range the column actually supports.
        if (
          Number.isSafeInteger(parsed) &&
          parsed >= -2_147_483_648 &&
          parsed <= 2_147_483_647
        ) {
          searchFilters.push({ number: parsed });
        }
      }
      filters.push({ OR: searchFilters });
    }

    filters.push(
      this.accessControl.buildTicketAccessFilter(user, {
        includeDeleted: query.includeDeleted,
      }),
    );

    const where = filters.length > 1 ? { AND: filters } : (filters[0] ?? {});
    return where;
  }

  async list(query: ListTicketsDto, user: AuthUser) {
    const where = this.buildListWhere(query, user);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const orderByField = query.sort ?? 'updatedAt';
    const orderByDirection = query.order ?? 'desc';
    const orderBy = {
      [orderByField]: orderByDirection,
    } as Prisma.TicketOrderByWithRelationInput;
    const includeTotal = query.includeTotal !== false;

    const [total, data] = await Promise.all([
      includeTotal
        ? this.prisma.ticket.count({ where })
        : Promise.resolve<number>(0),
      this.prisma.ticket.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        select: {
          id: true,
          number: true,
          displayId: true,
          subject: true,
          description: true,
          status: true,
          priority: true,
          channel: true,
          createdAt: true,
          updatedAt: true,
          resolvedAt: true,
          closedAt: true,
          closeReason: true,
          completedAt: true,
          dueAt: true,
          followUpAt: true,
          firstResponseDueAt: true,
          firstResponseAt: true,
          slaPausedAt: true,
          deletedAt: true,
          requester: {
            select: { id: true, email: true, displayName: true },
          },
          assignee: {
            select: { id: true, email: true, displayName: true },
          },
          assignedTeam: {
            select: { id: true, name: true, assignmentStrategy: true },
          },
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              isActive: true,
              parentId: true,
            },
          },
        },
      }),
    ]);
    const totalPages = includeTotal ? Math.ceil(total / pageSize) : 0;
    const awaitingAgentReply = await this.awaitingAgentReplyByTicket(data);

    return {
      data: data.map((ticket) => ({
        ...ticket,
        allowedTransitions: this.getAvailableTransitionsForTicket(
          ticket.status,
          ticket.assignee?.id ?? null,
        ),
        awaitingAgentReply: awaitingAgentReply.get(ticket.id) ?? false,
      })),
      meta: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  /**
   * Which of these tickets are waiting on US, because the requester spoke last
   * (card 1.29 Gap B).
   *
   * ONE query for the whole page. `DISTINCT ON` gives exactly one row per
   * ticket - the newest public message - so this is a single round trip
   * whatever the page size, and it rides the existing
   * `TicketMessage(ticketId, createdAt)` index. A per-row subquery would have
   * been 20 extra queries per page for a badge.
   *
   * Only PUBLIC messages count. An agent's internal note is not a reply to the
   * requester, so writing one must not clear the flag - otherwise the marker
   * would vanish the moment somebody made a private observation.
   *
   * Deliberately derived rather than stored. The status is the wrong place to
   * read this from: Gap A cannot move an unassigned ticket out of
   * WAITING_ON_REQUESTER (IN_PROGRESS needs an assignee), so on exactly those
   * tickets the status stays stale while this stays truthful.
   */
  private async awaitingAgentReplyByTicket(
    tickets: { id: string; requester?: { id: string } | null }[],
  ): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    const ids = tickets.map((ticket) => ticket.id);
    if (ids.length === 0) {
      return result;
    }
    const rows = await this.prisma.$queryRaw<
      { ticketId: string; authorId: string }[]
    >`
      SELECT DISTINCT ON (m."ticketId") m."ticketId", m."authorId"
      FROM "TicketMessage" m
      WHERE m."ticketId" IN (${Prisma.join(ids)})
        AND (m."type")::text = ${MessageType.PUBLIC}
      ORDER BY m."ticketId", m."createdAt" DESC
    `;
    const lastPublicAuthor = new Map(
      rows.map((row) => [row.ticketId, row.authorId]),
    );
    for (const ticket of tickets) {
      const requesterId = ticket.requester?.id ?? null;
      const authorId = lastPublicAuthor.get(ticket.id) ?? null;
      result.set(
        ticket.id,
        requesterId !== null && authorId !== null && authorId === requesterId,
      );
    }
    return result;
  }

  /**
   * Returns ticket counts for the user; result is cached briefly (PERF-02, see
   * CACHE_SUMMARY_TTL_MS).
   *
   * CARD 1.69 STEP 4 added eight counts so the sidebar can stop issuing nine
   * separate `GET /tickets?pageSize=1` calls. Every one of them goes through
   * `accessConditionSql` exactly as the original ten do - which is the whole
   * reason the sidebar could be moved onto this endpoint at all.
   *
   * NOT-A-FILTER-ENDPOINT, deliberately. `boundaries` carries three DATES and
   * nothing else, each one validated as `YYYY-MM-DD` by the DTO. It cannot
   * express a requester, an assignee or a team, so it cannot be used to count
   * tickets the caller may not read - the exfiltration oracle the card rules
   * out. The dates are here because the three counts that need them derive
   * their boundary in the BROWSER (`todayIso()`, `isoDaysAgo(1)`,
   * `isoDaysAgo(7)` in saved-views.ts) from the user's local clock. Recomputing
   * them server-side in UTC would have shifted three badge numbers, which is
   * the one outcome step 4 is not allowed to produce.
   *
   * @param user The caller; every count is scoped to what they may read.
   * @param boundaries Client-derived day boundaries, `YYYY-MM-DD`.
   */
  async getCounts(
    user: AuthUser,
    boundaries?: TicketCountBoundaries,
  ): Promise<{
    assignedToMe: number;
    triage: number;
    open: number;
    unassigned: number;
    resolved: number;
    resolvedByMe: number;
    createdByMeOpen: number;
    createdByMeResolved: number;
    atRisk: number;
    overdue: number;
    sev1Today: number;
    awaitingReplyOver24h: number;

    resolvedThisWeek: number;
    reopened: number;
    watching: number;
    mentions: number;
    followUpsDueToday: number;
    atRiskThresholdMinutes: number;
  }> {
    const ttlMs = parsePositiveInt(process.env.CACHE_SUMMARY_TTL_MS, 45_000);
    const key = `tickets:counts:${user.id}`;
    // The BOUNDARIES ARE STORED IN THE VALUE, not in the key, and that is the
    // whole reason `invalidateCountsCache` below needed no change. Three of
    // these counts depend on a day boundary the browser computed, so a key
    // that ignored them would serve one client's numbers to another; a key
    // that included them would multiply the entries per user, and
    // cache-manager exposes no prefix delete, so BUG-11's invalidation would
    // have silently started missing them. One entry per user, checked on
    // read: a mismatch is a miss, which is correct rather than merely cheap.
    const cached = await this.cache.get<CachedTicketCounts>(key);
    if (cached != null && sameCountBoundaries(cached.boundaries, boundaries)) {
      return cached.counts;
    }

    const counts = await this.getCountsUncached(user, boundaries);
    await this.cache.set(
      key,
      { boundaries: boundaries ?? null, counts } satisfies CachedTicketCounts,
      ttlMs,
    );
    return counts;
  }

  /**
   * BUG-11: getCounts caches per-user; mutations must invalidate the affected
   * users' entries so they see fresh sidebar counts. Best-effort — cache errors
   * are swallowed and never affect the mutation's transactional outcome.
   */
  private async invalidateCountsCache(userIds: (string | null | undefined)[]) {
    const distinct = [...new Set(userIds.filter((id): id is string => !!id))];
    await Promise.all(
      distinct.map((id) =>
        Promise.resolve(this.cache.del(`tickets:counts:${id}`)).catch(() => {
          // best-effort: stale counts are bounded by the TTL regardless
        }),
      ),
    );
  }

  private async getCountsUncached(
    user: AuthUser,
    boundaries?: TicketCountBoundaries,
  ): Promise<{
    assignedToMe: number;
    triage: number;
    open: number;
    unassigned: number;
    resolved: number;
    resolvedByMe: number;
    createdByMeOpen: number;
    createdByMeResolved: number;
    atRisk: number;
    overdue: number;
    sev1Today: number;
    awaitingReplyOver24h: number;

    resolvedThisWeek: number;
    reopened: number;
    watching: number;
    mentions: number;
    followUpsDueToday: number;
    atRiskThresholdMinutes: number;
  }> {
    const now = new Date();
    // ⚠️ CARD 1.70 ② REPLACED THE NOTE THAT WAS HERE. It used to record that
    // the list's window was a hard-coded four hours while this one used the
    // setting, and that only the list respected `completedAt` - a mismatch
    // card 1.69 step 4 was not allowed to resolve because either way round
    // moved a number somebody was already reading. The owner has now decided:
    // the setting wins, `completedAt` is respected, and the label is derived
    // from the same value. There is one definition, and `atRiskThresholdMinutes`
    // below is it.
    const atRiskThresholdMinutes = this.atRiskThresholdMinutes();
    const riskEnd = new Date(now.getTime() + atRiskThresholdMinutes * 60_000);
    // `scope=followups` computes this server-side in buildListWhere, so it is
    // reproduced the same way here rather than passed in.
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const todayFrom = boundaries?.todayFrom
      ? new Date(boundaries.todayFrom)
      : null;
    const awaitingBefore = boundaries?.awaitingUpdatedTo
      ? this.toEndExclusive(boundaries.awaitingUpdatedTo)
      : null;
    const resolvedFrom = boundaries?.resolvedUpdatedFrom
      ? new Date(boundaries.resolvedUpdatedFrom)
      : null;
    const notFinished = this.notFinishedSql('t');
    const accessCondition = this.accessConditionSql(user, 't');
    const rows = await this.prisma.$queryRaw<
      {
        assignedToMe: bigint;
        triage: bigint;
        open: bigint;
        unassigned: bigint;
        resolved: bigint;
        resolvedByMe: bigint;
        createdByMeOpen: bigint;
        createdByMeResolved: bigint;
        atRisk: bigint;
        overdue: bigint;
        sev1Today: bigint;
        awaitingReplyOver24h: bigint;

        resolvedThisWeek: bigint;
        reopened: bigint;
        watching: bigint;
        mentions: bigint;
        followUpsDueToday: bigint;
      }[]
    >`
      SELECT
        SUM(CASE
          WHEN (t."status")::text NOT IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
            AND t."assigneeId" = ${user.id}
          THEN 1 ELSE 0 END) AS "assignedToMe",
        SUM(CASE
          WHEN (t."status")::text = ${TicketStatus.NEW}
            AND t."assigneeId" IS NULL
          THEN 1 ELSE 0 END) AS "triage",
        SUM(CASE
          WHEN (t."status")::text NOT IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
          THEN 1 ELSE 0 END) AS "open",
        SUM(CASE
          WHEN (t."status")::text NOT IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
            AND t."assigneeId" IS NULL
          THEN 1 ELSE 0 END) AS "unassigned"
        ,
        SUM(CASE
          WHEN (t."status")::text IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
          THEN 1 ELSE 0 END) AS "resolved"
        ,
        SUM(CASE
          WHEN (t."status")::text IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
            AND t."assigneeId" = ${user.id}
          THEN 1 ELSE 0 END) AS "resolvedByMe"
        ,
        SUM(CASE
          WHEN (t."status")::text NOT IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
            AND t."requesterId" = ${user.id}
          THEN 1 ELSE 0 END) AS "createdByMeOpen"
        ,
        SUM(CASE
          WHEN (t."status")::text IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
            AND t."requesterId" = ${user.id}
          THEN 1 ELSE 0 END) AS "createdByMeResolved"
        ,
        SUM(CASE
          -- CARD 1.72: one definition of "not finished", shared with the list's
          -- slaStatus branches. Card 1.70 added the completedAt half here; this
          -- card made both sides say the same thing in the same place.
          WHEN ${notFinished}
            AND (t."status")::text NOT IN (${TicketStatus.WAITING_ON_REQUESTER}, ${TicketStatus.WAITING_ON_VENDOR})
            AND t."dueAt" IS NOT NULL
            AND t."dueAt" >= ${now}
            AND t."dueAt" <= ${riskEnd}
          THEN 1 ELSE 0 END) AS "atRisk"
        ,
        SUM(CASE
          -- CARD 1.72. This one used the STATUS alone, so a ticket carrying a
          -- completedAt stamp with an open status counted as overdue while the
          -- list excluded it. Same definition as everything else now.
          WHEN ${notFinished}
            AND (t."status")::text NOT IN (${TicketStatus.WAITING_ON_REQUESTER}, ${TicketStatus.WAITING_ON_VENDOR})
            AND t."dueAt" IS NOT NULL
            AND t."dueAt" < ${now}
          THEN 1 ELSE 0 END) AS "overdue"
        ,
        -- CARD 1.69 STEP 4. The nine below replace the sidebar's nine
        -- GET /tickets?pageSize=1 calls. Each mirrors the PRISMA predicate
        -- buildListWhere produces for the same query string, because the badge
        -- has to equal the number of rows you get when you click it.
        SUM(CASE
          WHEN (t."priority")::text = ${TicketPriority.SEV1}
            AND ${todayFrom === null ? Prisma.sql`FALSE` : Prisma.sql`t."createdAt" >= ${todayFrom}`}
          THEN 1 ELSE 0 END) AS "sev1Today"
        ,
        SUM(CASE
          WHEN (t."status")::text IN (${TicketStatus.WAITING_ON_REQUESTER}, ${TicketStatus.WAITING_ON_VENDOR})
            AND ${awaitingBefore === null ? Prisma.sql`FALSE` : Prisma.sql`t."updatedAt" < ${awaitingBefore}`}
          THEN 1 ELSE 0 END) AS "awaitingReplyOver24h"
        ,
        SUM(CASE
          WHEN (t."status")::text IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
            AND ${resolvedFrom === null ? Prisma.sql`FALSE` : Prisma.sql`t."updatedAt" >= ${resolvedFrom}`}
          THEN 1 ELSE 0 END) AS "resolvedThisWeek"
        ,
        SUM(CASE
          WHEN (t."status")::text = ${TicketStatus.REOPENED}
          THEN 1 ELSE 0 END) AS "reopened"
        ,
        -- ⚠️ The two NOT clauses are written null-safely on purpose. Prisma's
        -- NOT: [{ assigneeId: user.id }] is null-safe; a literal
        -- t."assigneeId" <> $1 is NOT - it evaluates to NULL for an
        -- unassigned ticket, so the row would silently drop out and this badge
        -- would read lower than the list it links to.
        SUM(CASE
          WHEN (t."status")::text NOT IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
            AND EXISTS (
              SELECT 1 FROM "TicketFollower" tf
              WHERE tf."ticketId" = t."id" AND tf."userId" = ${user.id}
            )
            AND (t."assigneeId" IS NULL OR t."assigneeId" <> ${user.id})
            AND (t."requesterId" IS NULL OR t."requesterId" <> ${user.id})
          THEN 1 ELSE 0 END) AS "watching"
        ,
        SUM(CASE
          WHEN EXISTS (
            SELECT 1 FROM "Notification" n
            WHERE n."ticketId" = t."id"
              AND n."userId" = ${user.id}
              AND (n."type")::text = ${NotificationType.TICKET_MENTIONED}
              AND n."isRead" = FALSE
          )
          THEN 1 ELSE 0 END) AS "mentions"
        ,
        SUM(CASE
          WHEN t."assigneeId" = ${user.id}
            AND t."followUpAt" IS NOT NULL
            AND t."followUpAt" <= ${endOfToday}
          THEN 1 ELSE 0 END) AS "followUpsDueToday"
      FROM "Ticket" t
      WHERE ${accessCondition}
    `;

    const row = rows[0] ?? {
      assignedToMe: 0n,
      triage: 0n,
      open: 0n,
      unassigned: 0n,
      resolved: 0n,
      resolvedByMe: 0n,
      createdByMeOpen: 0n,
      createdByMeResolved: 0n,
      atRisk: 0n,
      overdue: 0n,
      sev1Today: 0n,
      awaitingReplyOver24h: 0n,

      resolvedThisWeek: 0n,
      reopened: 0n,
      watching: 0n,
      mentions: 0n,
      followUpsDueToday: 0n,
    };
    const assignedToMe = Number(row.assignedToMe ?? 0);
    // Agents see their own triage board (scope=assigned), so the sidebar badge
    // should reflect their personal queue, not the full team's NEW-unassigned
    // count. Other roles keep the team-wide triage count.
    const triage =
      user.role === UserRole.AGENT ? assignedToMe : Number(row.triage ?? 0);
    return {
      assignedToMe,
      triage,
      open: Number(row.open ?? 0),
      unassigned: Number(row.unassigned ?? 0),
      resolved: Number(row.resolved ?? 0),
      resolvedByMe: Number(row.resolvedByMe ?? 0),
      createdByMeOpen: Number(row.createdByMeOpen ?? 0),
      createdByMeResolved: Number(row.createdByMeResolved ?? 0),
      atRisk: Number(row.atRisk ?? 0),
      overdue: Number(row.overdue ?? 0),
      sev1Today: Number(row.sev1Today ?? 0),
      awaitingReplyOver24h: Number(row.awaitingReplyOver24h ?? 0),

      resolvedThisWeek: Number(row.resolvedThisWeek ?? 0),
      reopened: Number(row.reopened ?? 0),
      watching: Number(row.watching ?? 0),
      mentions: Number(row.mentions ?? 0),
      followUpsDueToday: Number(row.followUpsDueToday ?? 0),
      // ⚠️ CARD 1.70 ②, AND THE PART MOST EASILY SKIPPED. The sidebar's
      // "Breach risk" label hard-coded "1h" beside a configurable threshold,
      // which is exactly how it drifted to a third value. Returning the number
      // the counts were computed with means the label is RENDERED from the
      // same value rather than typed again next to it. Carried on this
      // endpoint because the sidebar already calls it after card 1.69 step 4 -
      // no new request, no new endpoint.
      atRiskThresholdMinutes,
    };
  }

  async getMetrics(user: AuthUser): Promise<{
    total: number;
    open: number;
    resolved: number;
    byPriority: Record<TicketPriority, number>;
    byTeam: Array<{ teamId: string | null; total: number }>;
  }> {
    const accessFilter = this.buildAccessFilter(user);
    const openFilter: Prisma.TicketWhereInput = {
      status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
    };
    const resolvedFilter: Prisma.TicketWhereInput = {
      status: { in: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
    };

    const [total, open, resolved, priorityRows, teamRows] = await Promise.all([
      this.prisma.ticket.count({ where: accessFilter }),
      this.prisma.ticket.count({ where: { AND: [accessFilter, openFilter] } }),
      this.prisma.ticket.count({
        where: { AND: [accessFilter, resolvedFilter] },
      }),
      this.prisma.ticket.groupBy({
        by: ['priority'],
        where: accessFilter,
        _count: { _all: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['assignedTeamId'],
        where: accessFilter,
        _count: { _all: true },
      }),
    ]);

    const byPriority: Record<TicketPriority, number> = {
      [TicketPriority.SEV1]: 0,
      [TicketPriority.SEV2]: 0,
      [TicketPriority.SEV3]: 0,
      [TicketPriority.SEV4]: 0,
    };
    for (const row of priorityRows) {
      byPriority[row.priority] = row._count._all;
    }

    return {
      total,
      open,
      resolved,
      byPriority,
      byTeam: teamRows.map((row) => ({
        teamId: row.assignedTeamId,
        total: row._count._all,
      })),
    };
  }

  async getActivity(query: TicketActivityDto, user: AuthUser) {
    const { fromDate, toEndExclusive, toDateInclusive } =
      this.activityDateRange(query.from, query.to);
    const accessCondition = this.accessConditionSql(user, 't');
    const assigneeCondition =
      query.scope === 'assigned'
        ? Prisma.sql`AND t."assigneeId" = ${user.id}`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      { date: Date; open: bigint; resolved: bigint }[]
    >`
      SELECT d::date as date,
        coalesce(o.open_count, 0)::bigint as open,
        coalesce(r.resolved_count, 0)::bigint as resolved
      FROM generate_series(${fromDate}::date, ${toDateInclusive}::date, '1 day'::interval) d
      LEFT JOIN (
        SELECT date_trunc('day', t."createdAt")::date as day, count(*)::bigint as open_count
        FROM "Ticket" t
        WHERE ${accessCondition} ${assigneeCondition}
          AND t."createdAt" >= ${fromDate}
          AND t."createdAt" < ${toEndExclusive}
        GROUP BY 1
      ) o ON o.day = d::date
      LEFT JOIN (
        SELECT date_trunc('day', t."completedAt")::date as day, count(*)::bigint as resolved_count
        FROM "Ticket" t
        WHERE ${accessCondition} ${assigneeCondition}
          AND t."completedAt" IS NOT NULL
          AND t."completedAt" >= ${fromDate}
          AND t."completedAt" < ${toEndExclusive}
        GROUP BY 1
      ) r ON r.day = d::date
      ORDER BY 1
    `;

    return {
      data: rows.map((row) => ({
        date:
          row.date instanceof Date
            ? row.date.toISOString().slice(0, 10)
            : String(row.date).slice(0, 10),
        open: Number(row.open),
        resolved: Number(row.resolved),
      })),
    };
  }

  async getStatusBreakdown(query: TicketStatusDto, user: AuthUser) {
    const { fromDate, toEndExclusive } = this.activityDateRange(
      query.from,
      query.to,
    );
    const accessCondition = this.accessConditionSql(user, 't');
    const assigneeCondition =
      query.scope === 'assigned'
        ? Prisma.sql`AND t."assigneeId" = ${user.id}`
        : Prisma.empty;
    // 4.2 fix: strict allow-list prevents any chance of SQL injection via Prisma.raw()
    const SAFE_DATE_COLUMNS: Record<string, Prisma.Sql> = {
      createdAt: Prisma.raw('t."createdAt"'),
      updatedAt: Prisma.raw('t."updatedAt"'),
    };
    const dateColumn =
      SAFE_DATE_COLUMNS[query.dateField ?? ''] ?? SAFE_DATE_COLUMNS.createdAt;

    const rows = await this.prisma.$queryRaw<
      { status: TicketStatus; count: bigint }[]
    >`
      SELECT t."status" as status, count(*)::bigint as count
      FROM "Ticket" t
      WHERE ${accessCondition} ${assigneeCondition}
        AND ${dateColumn} >= ${fromDate}
        AND ${dateColumn} < ${toEndExclusive}
      GROUP BY t."status"
      ORDER BY t."status" ASC
    `;

    return {
      data: rows.map((row) => ({
        status: row.status,
        count: Number(row.count),
      })),
    };
  }

  async getById(id: string, user: AuthUser) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        requester: true,
        assignee: true,
        assignedTeam: true,
        category: true,
        accessGrants: true,
        tags: {
          include: { tag: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    // A soft-deleted ticket must not reveal its existence to anyone but OWNER.
    if (ticket.deletedAt && user.role !== UserRole.OWNER) {
      throw new NotFoundException('Ticket not found');
    }

    if (!this.canViewTicket(user, ticket)) {
      throw new ForbiddenException('No access to this ticket');
    }

    const [followers, attachments, customFieldValues, links] =
      await Promise.all([
        this.prisma.ticketFollower.findMany({
          where: { ticketId: id },
          include: { user: true },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.attachment.findMany({
          where: { ticketId: id },
          include: { uploadedBy: true },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.customFieldValue.findMany({
          where: { ticketId: id },
          include: { customField: true },
        }),
        this.loadTicketLinkViews(id, user),
      ]);

    const { accessGrants, tags: tagRows, ...rest } = ticket;
    void accessGrants;
    const tags = tagRows.map((row) => ({
      id: row.tag.id,
      name: row.tag.name,
      color: row.tag.color,
      source: row.source,
    }));
    return {
      ...rest,
      tags,
      followers,
      attachments,
      customFieldValues,
      links,
      allowedTransitions: rest.deletedAt
        ? []
        : this.getAvailableTransitionsForTicket(rest.status, rest.assigneeId),
    };
  }

  /**
   * List messages for a ticket. Access check and data query are combined
   * into a single query using buildTicketAccessFilter to eliminate an N+1 round trip.
   */
  /**
   * Who the message being composed would reach (card 1.28).
   *
   * Gated by the same `canPostMessage` that gates actually posting one: if you
   * cannot write here, you have no business reading the ticket's audience.
   * Since card 1.36 a staff requester CAN reach their own ticket, so this gate
   * is the thing that still keeps them out - `canPostMessage` is unchanged by
   * that card.
   */
  async previewMessageRecipients(
    ticketId: string,
    type: MessageType,
    user: AuthUser,
  ): Promise<MessageRecipientsPreview> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        requesterId: true,
        assignedTeamId: true,
        assigneeId: true,
        deletedAt: true,
      },
    });
    if (!ticket || (ticket.deletedAt && user.role !== UserRole.OWNER)) {
      throw new NotFoundException('Ticket not found');
    }
    if (!this.accessControl.canPostMessage(user, ticket)) {
      throw new ForbiddenException('No write access to this ticket');
    }
    return this.notifications.previewMessageRecipients(ticketId, type, user);
  }

  async listMessages(
    ticketId: string,
    user: AuthUser,
    take = 50,
    cursor?: string,
  ) {
    // Single query: verify ticket exists AND user has access. OWNER may read
    // the messages of a soft-deleted ticket (includeDeleted is ignored for
    // every other role); non-owners get 404, never 403, so the ticket's
    // existence is not revealed.
    const accessibleTicket = await this.prisma.ticket.findFirst({
      where: {
        id: ticketId,
        ...this.accessControl.buildTicketAccessFilter(user, {
          includeDeleted: true,
        }),
      },
      // requesterId comes back with it: the message filter below needs to know
      // whether this reader is the person who raised the ticket, and the card
      // is explicit that it must be that id and nothing looser.
      select: { id: true, requesterId: true },
    });

    if (!accessibleTicket) {
      // Distinguish "not found" from "forbidden"
      const exists = await this.prisma.ticket.count({
        where: { id: ticketId, deletedAt: null },
      });
      if (!exists) throw new NotFoundException('Ticket not found');
      throw new ForbiddenException('No access to this ticket');
    }

    const limit = Math.max(1, Math.min(100, take));
    // Rank decided this on its own, so any non-EMPLOYEE who could open a ticket
    // read every internal note on it - INCLUDING a ticket they raised
    // themselves. Payroll is the only department operationally taking tickets,
    // so a payroll lead with a problem about her own pay has nowhere else to
    // file it, and "staff will not raise tickets to their own department" is
    // not a mitigation that exists. Relationship now beats rank, the same way
    // card 1.22's guard works on the send path.
    const isRequester = accessibleTicket.requesterId === user.id;
    const where: Prisma.TicketMessageWhereInput = {
      ticketId,
      ...(user.role === UserRole.EMPLOYEE || isRequester
        ? { type: MessageType.PUBLIC }
        : {}),
    };

    const messages = await this.prisma.ticketMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { author: true },
    });

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;
    const delivery = await this.messageDeliveryLabels(ticketId);

    return {
      data: page.reverse().map((message) => ({
        ...message,
        // ⚠️ CARD 1.62. THE DISPLAY PATH, AND THE ONLY CALLER OF THIS UTIL.
        //
        // `stripQuotedReply` was written, given twelve passing tests and a
        // careful doc comment describing a two-part contract - "email.service
        // writes the marker, stripQuotedReply reads it" - and then never
        // wired to anything. Half the contract existed. A reply arrived
        // carrying our entire outbound email quoted underneath it, including
        // the pilot-mode notice, and an agent read all of it.
        //
        // ⚠️ DISPLAY ONLY, and that is deliberate: the whole body stays on the
        // record, so nothing an audit needs is discarded. Trimming before
        // storing would throw away the one copy.
        //
        // ⚠️ This does nothing useful unless the body is really TEXT. Every
        // marker is anchored `^...$` with the `m` flag, and a real Outlook
        // reply carries ours as `<p>----- Reply above this line -----</p>`.
        // Card 1.62's fault A - converting HTML at the Graph boundary - is
        // what makes this line have an effect at all.
        body: stripQuotedReply(message.body),
        delivery: {
          // ⚠️ CARD 1.73: the fallback used to be `{ emailed: 0, refused: 0 }` -
          // no `pending`, no `recipients` - so a message with no outbox row came
          // back a different shape from one that had them. Spelled from the type
          // now, so the two cannot drift apart again.
          ...(delivery.get(message.id) ?? EMPTY_DELIVERY_LABEL),
          internal: message.type === MessageType.INTERNAL,
        },
      })),
      nextCursor,
    };
  }

  /**
   * What actually happened to each message's email, per ticket (card 1.28, 6c).
   *
   * ONE query for the whole ticket, grouped in memory. Since card 1.33 a public
   * message produces a single outbox row carrying `to` and `cc`, so the number
   * of people reached is `1 + cc.length` on that row.
   *
   * Reports the OUTBOX, not the intent. A label reading "emailed to 3" when the
   * send failed is worse than no label at all, because the agent stops
   * chasing - so only a SENT row counts as emailed, and a FAILED one counts as
   * refused.
   *
   * ⚠️ A PENDING row contributes to neither, and the message carries no
   * "emailed" label yet. This comment used to add "with Redis off in production
   * the processor runs at queue time, so PENDING is momentary." THAT WAS WRONG,
   * and card 1.47 exists because of it: production has no Redis app setting, so
   * BullMQ never delivers and the SWEEPER does, on a 60-second interval
   * (`EMAIL_OUTBOX_SWEEP_INTERVAL_MS` unset). A queued email sits for up to a
   * minute - the exact window in which somebody spots their mistake and
   * redacts. The count is now returned separately as `pending` so the redaction
   * path can act on it.
   *
   * Recipients the outbound guard refused BEFORE composing (out-of-domain,
   * suppressed, no-reply) never produce a row here at all; they are recorded on
   * the ticket as an EMAIL_RECIPIENT_REFUSED event, which now carries the
   * messageId so they can be attributed. The compose-screen preview runs that
   * guard live, so an agent sees those before sending rather than after.
   */
  private async messageOutboxRows(
    ticketId: string,
  ): Promise<Map<string, MessageOutboxRow[]>> {
    const rows = await this.prisma.notificationOutbox.findMany({
      where: { ticketId, eventType: 'MESSAGE_ADDED' },
      select: { id: true, status: true, toEmail: true, payload: true },
    });
    const byMessage = new Map<string, MessageOutboxRow[]>();
    for (const row of rows) {
      const envelope = (row.payload ?? {}) as {
        event?: { messageId?: unknown };
        email?: { cc?: unknown };
      };
      const messageId = envelope.event?.messageId;
      if (typeof messageId !== 'string' || messageId === '') {
        continue;
      }
      const cc = envelope.email?.cc;
      // ⚠️ CARD 1.73. `reached` is still `1 + cc.length` and deliberately
      // NOT `recipients.length`: the two can differ if a payload ever carries a
      // malformed cc entry, and the displayed count has been that arithmetic
      // since card 1.47. Changing what the number means was not asked for.
      const ccAddresses = Array.isArray(cc)
        ? cc.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const reached = 1 + (Array.isArray(cc) ? cc.length : 0);
      const list = byMessage.get(messageId) ?? [];
      list.push({
        id: row.id,
        status: row.status,
        reached,
        recipients: [row.toEmail, ...ccAddresses].filter(
          (address) => typeof address === 'string' && address.trim() !== '',
        ),
      });
      byMessage.set(messageId, list);
    }
    return byMessage;
  }

  /**
   * The conversation's delivery labels, derived from the matcher above.
   *
   * `pending` is new in card 1.47 and is not cosmetic: production has no Redis,
   * so the sweeper delivers on a 60-second interval and a queued email really
   * can sit unsent for most of a minute. The comment here used to say "the
   * processor runs at queue time, so PENDING is momentary" - that was true of
   * the dev machine and false of production, and it is the reason nobody
   * noticed that redaction could be outrun by its own email. The composer's
   * label still shows only what happened; the redaction dialog needs to know
   * something is in the queue so it can promise to stop it.
   */
  private async messageDeliveryLabels(
    ticketId: string,
  ): Promise<Map<string, MessageDeliveryLabel>> {
    const byMessage = await this.messageOutboxRows(ticketId);
    const labels = new Map<string, MessageDeliveryLabel>();
    for (const [messageId, rows] of byMessage) {
      const label: MessageDeliveryLabel = {
        emailed: 0,
        refused: 0,
        pending: 0,
        recipients: [],
      };
      const seen = new Set<string>();
      for (const row of rows) {
        for (const address of row.recipients) {
          const key = address.trim().toLowerCase();
          if (key && !seen.has(key)) {
            seen.add(key);
            label.recipients.push(address.trim());
          }
        }
      }
      for (const row of rows) {
        if (row.status === OutboxStatus.SENT) {
          label.emailed += row.reached;
        } else if (row.status === OutboxStatus.FAILED) {
          label.refused += row.reached;
        } else {
          // PENDING or PROCESSING: on its way out, not yet gone.
          label.pending += row.reached;
        }
      }
      labels.set(messageId, label);
    }
    return labels;
  }

  /**
   * List events for a ticket. Access check and data query are combined
   * into a single query using buildTicketAccessFilter to eliminate an N+1 round trip.
   */
  async listEvents(
    ticketId: string,
    user: AuthUser,
    take = 50,
    cursor?: string,
  ) {
    // Single query: verify ticket exists AND user has access
    // OWNER may read the history of a soft-deleted ticket (includeDeleted is
    // ignored for every other role); non-owners get 404, never 403, so the
    // ticket's existence is not revealed.
    const accessibleTicket = await this.prisma.ticket.findFirst({
      where: {
        id: ticketId,
        ...this.accessControl.buildTicketAccessFilter(user, {
          includeDeleted: true,
        }),
      },
      select: { id: true },
    });

    if (!accessibleTicket) {
      const exists = await this.prisma.ticket.count({
        where: { id: ticketId, deletedAt: null },
      });
      if (!exists) throw new NotFoundException('Ticket not found');
      throw new ForbiddenException('No access to this ticket');
    }

    const limit = Math.max(1, Math.min(100, take));
    const where: Prisma.TicketEventWhereInput = {
      ticketId,
      ...(user.role === UserRole.EMPLOYEE
        ? {
            NOT: {
              AND: [
                { type: 'MESSAGE_ADDED' },
                { payload: { path: ['type'], equals: MessageType.INTERNAL } },
              ],
            },
          }
        : {}),
    };
    const events = await this.prisma.ticketEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { createdBy: true },
    });

    const hasMore = events.length > limit;
    const page = hasMore ? events.slice(0, limit) : events;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    return {
      data: page.reverse(),
      nextCursor,
    };
  }

  async create(
    payload: CreateTicketDto,
    user: AuthUser,
    options?: {
      skipRequiredCustomFields?: boolean;
      tagSource?: TagSource;
      /**
       * Do not email the requester that their ticket was created (card 1.42
       * §3). For the inbound path only, which sends its own and better
       * acknowledgement - without this one emailed-in request produced TWO
       * emails back, "Ticket created" and "We have received your request".
       *
       * The EMAIL only. The new-ticket bell for the assigned team still fires,
       * because an emailed-in ticket is exactly the kind nobody is watching a
       * queue for. Shaped like addMessage's `{ suppressNotifications }`.
       */
      suppressCreatedEmail?: boolean;
    },
  ) {
    const requesterId = payload.requesterId ?? user.id;

    if (user.role === UserRole.EMPLOYEE && requesterId !== user.id) {
      throw new ForbiddenException(
        'Requesters can only create their own tickets',
      );
    }

    const routedTarget = payload.assignedTeamId
      ? {
          teamId: payload.assignedTeamId,
          assigneeId: null,
          setPriority: null as TicketPriority | null,
          addTags: [] as string[],
        }
      : await this.routeTarget({
          subject: payload.subject,
          description: payload.description,
          priority: payload.priority ?? null,
          channel: payload.channel ?? null,
          categoryId: payload.categoryId ?? null,
          requesterId,
        });
    const routedTeamId = routedTarget?.teamId ?? null;
    const routedAssigneeId = routedTarget?.assigneeId ?? null;
    // Routing actions may override priority and add tags.
    const effectivePriority = routedTarget?.setPriority ?? payload.priority;
    const routedTags = routedTarget?.addTags ?? [];

    const updatedTicket = await this.prisma.$transaction(async (tx) => {
      if (payload.assigneeId) {
        if (!routedTeamId) {
          throw new BadRequestException(
            'Cannot assign a ticket without a target team',
          );
        }
        if (
          !this.canAssignTicket(user, {
            assignedTeamId: routedTeamId,
            assigneeId: null,
          })
        ) {
          throw new ForbiddenException(
            'Not allowed to assign this ticket on creation',
          );
        }
        const membership = await tx.teamMember.findUnique({
          where: {
            teamId_userId: {
              teamId: routedTeamId,
              userId: payload.assigneeId,
            },
          },
          select: { id: true },
        });
        if (!membership) {
          throw new BadRequestException(
            'Assignee must belong to the ticket team',
          );
        }
      }

      let resolvedAssigneeId = payload.assigneeId ?? routedAssigneeId;
      if (!payload.assigneeId && !resolvedAssigneeId) {
        resolvedAssigneeId = await this.resolveAssignee(routedTeamId, tx);
      }
      const initialStatus = resolvedAssigneeId
        ? TicketStatus.ASSIGNED
        : TicketStatus.NEW;

      const validatedCustomValues =
        await this.customFieldsService.validateAndNormalizeValuesForTicket(
          payload.customFieldValues ?? [],
          routedTeamId,
          payload.categoryId ?? null,
          { requireAllRequired: !options?.skipRequiredCustomFields, tx },
        );

      const ticket = await tx.ticket.create({
        data: {
          subject: payload.subject,
          description: payload.description,
          priority: effectivePriority,
          channel: payload.channel,
          requesterId,
          assignedTeamId: routedTeamId,
          assigneeId: resolvedAssigneeId,
          categoryId: payload.categoryId,
          status: initialStatus,
        },
        include: {
          requester: true,
          assignee: true,
          assignedTeam: true,
        },
      });

      const tagsToAttach = [...(payload.tags ?? []), ...routedTags];
      if (tagsToAttach.length) {
        await this.tagsService.attachManyToTicket(
          ticket.id,
          tagsToAttach,
          options?.tagSource ?? TagSource.MANUAL,
          user.id,
          tx,
        );
      }

      const displayId = this.buildDisplayId(
        ticket.assignedTeam?.name ?? null,
        ticket.createdAt,
        ticket.number,
      );
      const sla = await this.slaCalc.getSlaConfig(
        ticket.priority,
        ticket.assignedTeamId,
        tx,
      );
      const firstResponseDueAt = sla
        ? await this.slaCalc.addSlaHours(
            ticket.createdAt,
            sla.firstResponseHours,
            sla.businessHoursOnly,
            ticket.assignedTeamId,
            tx,
          )
        : null;
      const resolutionDueAt = sla
        ? await this.slaCalc.addSlaHours(
            ticket.createdAt,
            sla.resolutionHours,
            sla.businessHoursOnly,
            ticket.assignedTeamId,
            tx,
          )
        : null;

      const updated = await tx.ticket.update({
        where: { id: ticket.id },
        data: { displayId, firstResponseDueAt, dueAt: resolutionDueAt },
        include: {
          requester: true,
          assignee: true,
          assignedTeam: true,
          category: true,
        },
      });

      await tx.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          type: 'TICKET_CREATED',
          payload: {
            subject: ticket.subject,
            priority: ticket.priority,
            channel: ticket.channel,
          },
          createdById: requesterId,
        },
      });

      if (resolvedAssigneeId) {
        await tx.ticketEvent.create({
          data: {
            ticketId: ticket.id,
            type: 'TICKET_ASSIGNED',
            payload: {
              assigneeId: resolvedAssigneeId,
              assigneeName: updated.assignee?.displayName ?? null,
              assigneeEmail: updated.assignee?.email ?? null,
            },
            createdById: user.id,
          },
        });
        await tx.ticketEvent.create({
          data: {
            ticketId: ticket.id,
            type: 'TICKET_STATUS_CHANGED',
            payload: {
              from: TicketStatus.NEW,
              to: TicketStatus.ASSIGNED,
            },
            createdById: user.id,
          },
        });
      }

      if (validatedCustomValues.length > 0) {
        await tx.customFieldValue.createMany({
          data: validatedCustomValues.map((item) => ({
            ticketId: ticket.id,
            customFieldId: item.customFieldId,
            value: item.value,
          })),
        });
      }

      await tx.ticketFollower.upsert({
        where: {
          ticketId_userId: { ticketId: ticket.id, userId: requesterId },
        },
        update: {},
        create: { ticketId: ticket.id, userId: requesterId },
      });
      if (ticket.assigneeId) {
        await tx.ticketFollower.upsert({
          where: {
            ticketId_userId: { ticketId: ticket.id, userId: ticket.assigneeId },
          },
          update: {},
          create: { ticketId: ticket.id, userId: ticket.assigneeId },
        });
      }

      await this.slaEngine.syncFromTicket(
        ticket.id,
        { policyConfigId: sla.policyConfigId ?? null },
        tx,
      );

      return updated;
    });

    await this.invalidateCountsCache([
      user.id,
      requesterId,
      updatedTicket.assigneeId,
    ]);

    await this.safeNotify(() =>
      this.notifications.ticketCreated(updatedTicket, user, {
        suppressEmail: options?.suppressCreatedEmail === true,
      }),
    );
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId: updatedTicket.id,
        reason: 'ticket_created',
        actorId: user.id,
      }),
    );

    // Queue automation with retry via BullMQ instead of fire-and-forget
    this.automationQueue
      .enqueue(updatedTicket.id, 'TICKET_CREATED')
      .catch((err) =>
        this.logger.error(
          `Failed to enqueue automation for ticket ${updatedTicket.id}: ${(err as Error).message}`,
        ),
      );

    const result = await this.prisma.ticket.findUnique({
      where: { id: updatedTicket.id },
      include: {
        requester: true,
        assignee: true,
        assignedTeam: true,
        category: true,
        customFieldValues: { include: { customField: true } },
      },
    });
    return result ?? updatedTicket;
  }

  /**
   * Stream the filtered ticket list as CSV. Uses the very same `where` as
   * `list()`, so an export is exactly what the caller can see on screen — the
   * access filter and the soft-delete exclusion come with it (card 1.13).
   * Capped at TICKET_EXPORT_MAX_ROWS; a truncated file says so on its last line.
   */
  async *exportCsv(
    query: ListTicketsDto,
    user: AuthUser,
  ): AsyncGenerator<string> {
    const where = this.buildListWhere(query, user);
    const now = new Date();
    yield toCsvRow([...TICKET_EXPORT_COLUMNS]);
    let cursor: { id: string } | undefined;
    let emitted = 0;
    while (emitted < TICKET_EXPORT_MAX_ROWS) {
      const take = Math.min(
        TICKET_EXPORT_BATCH_SIZE,
        TICKET_EXPORT_MAX_ROWS - emitted,
      );
      const rows = await this.prisma.ticket.findMany({
        where,
        take,
        ...(cursor ? { cursor, skip: 1 } : {}),
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: TICKET_EXPORT_SELECT,
      });
      if (rows.length === 0) {
        return;
      }
      yield rows.map((row) => this.toTicketCsvRow(row, now)).join('');
      emitted += rows.length;
      cursor = { id: rows[rows.length - 1].id };
      if (rows.length < take) {
        return;
      }
    }
    const more = await this.prisma.ticket.findMany({
      where,
      take: 1,
      ...(cursor ? { cursor, skip: 1 } : {}),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (more.length > 0) {
      yield `# truncated at ${TICKET_EXPORT_MAX_ROWS} rows — narrow your filters
`;
    }
  }

  private toTicketCsvRow(
    ticket: Prisma.TicketGetPayload<{ select: typeof TICKET_EXPORT_SELECT }>,
    now: Date,
  ): string {
    return toCsvRow([
      ticket.displayId ?? `#${ticket.number}`,
      ticket.subject,
      formatStatusLabel(ticket.status),
      ticket.priority,
      ticket.assignedTeam?.name ?? null,
      ticket.assignee?.displayName ?? null,
      ticket.requester?.displayName ?? null,
      ticket.requester?.email ?? null,
      ticket.category?.name ?? null,
      ticket.channel,
      ticket.tags.map((row) => row.tag.name).join('; '),
      ticket.createdAt,
      ticket.updatedAt,
      ticket.resolvedAt,
      ticket.closedAt,
      ticket.closeReason ? formatStatusLabel(ticket.closeReason) : null,
      ticket.firstResponseDueAt,
      ticket.dueAt,
      this.slaStateLabel(ticket, now),
    ]);
  }

  /** Mirrors the `slaStatus` filter in `buildListWhere` so both agree. */
  private slaStateLabel(
    ticket: {
      completedAt: Date | null;
      dueAt: Date | null;
      status: TicketStatus;
    },
    now: Date,
  ): string {
    if (ticket.completedAt) {
      return 'Completed';
    }
    if ((this.WAITING_STATUSES as TicketStatus[]).includes(ticket.status)) {
      return 'Paused';
    }
    if (!ticket.dueAt) {
      return '';
    }
    if (ticket.dueAt.getTime() < now.getTime()) {
      return 'Breached';
    }
    return ticket.dueAt.getTime() <= now.getTime() + SLA_AT_RISK_WINDOW_MS
      ? 'At risk'
      : 'On track';
  }

  async addMessage(
    ticketId: string,
    payload: AddTicketMessageDto,
    user: AuthUser,
    // Card 1.22: an automated or rate-capped inbound email is still recorded on
    // the ticket - an agent should see the out-of-office arrived - but must not
    // set any outbound mail going. Realtime is deliberately NOT suppressed: the
    // message still belongs on the screen.
    options: {
      suppressNotifications?: boolean;
      /**
       * Card 1.40: the caller has already checked this sender is in the
       * ticket's EMAIL audience (AccessControlService.canReplyByEmail), so the
       * normal write gate does not apply to them.
       *
       * Only the inbound email path may set this, and only after that check.
       * It widens who may post BY EMAIL and changes nothing about the web: a
       * follower using the UI still needs write access, which is intended.
       * A sender admitted this way always posts PUBLIC - see below.
       */
      fromEmailAudience?: boolean;
    } = {},
  ) {
    if (payload.authorId && payload.authorId !== user.id) {
      throw new ForbiddenException('Message author must match current user');
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    // Hidden from non-owners; OWNER falls through to canPostMessage -> 403.
    if (ticket.deletedAt && user.role !== UserRole.OWNER) {
      throw new NotFoundException('Ticket not found');
    }

    if (user.role === UserRole.EMPLOYEE && !options.fromEmailAudience) {
      if (ticket.requesterId !== user.id) {
        throw new ForbiddenException(
          'Requesters can only reply to their own tickets',
        );
      }
      if (payload.type && payload.type !== 'PUBLIC') {
        throw new ForbiddenException('Requesters can only add public replies');
      }
    }

    if (
      !options.fromEmailAudience &&
      !this.accessControl.canPostMessage(user, ticket)
    ) {
      throw new ForbiddenException('No write access to this ticket');
    }

    // Peer agents (same team, not the assignee) can only leave INTERNAL notes.
    // We override silently regardless of what the client sent — the UI also
    // hides the toggle, but defense-in-depth.
    const isPeerAgent = this.accessControl.isPeerAgent(user, ticket);
    // Someone here purely because they raised the ticket replies in public,
    // whatever their rank. Card 1.36 stopped a staff requester reading the
    // internal notes on their own ticket; letting them WRITE one would leave a
    // note they cannot see, emailed to nobody, sitting where they expect their
    // reply to be.
    const isRequesterOnly =
      (ticket.requesterId === user.id || options.fromEmailAudience === true) &&
      !this.accessControl.canWriteTicket(user, ticket) &&
      !isPeerAgent;
    const effectiveType: MessageType = isPeerAgent
      ? MessageType.INTERNAL
      : isRequesterOnly
        ? MessageType.PUBLIC
        : (payload.type ?? MessageType.PUBLIC);

    const shouldSetFirstResponse =
      user.role !== UserRole.EMPLOYEE && effectiveType === MessageType.PUBLIC;

    const now = new Date();
    const message = await this.prisma.$transaction(async (tx) => {
      const createdMessage = await tx.ticketMessage.create({
        data: {
          ticketId,
          authorId: user.id,
          body: payload.body,
          type: effectiveType,
          createdAt: now,
        },
        include: {
          author: true,
        },
      });

      if (shouldSetFirstResponse) {
        const result = await tx.ticket.updateMany({
          where: { id: ticketId, firstResponseAt: null },
          data: { firstResponseAt: now },
        });

        if (result.count > 0) {
          await this.slaEngine.syncFromTicket(ticketId, undefined, tx);
        }
      }

      await tx.ticketEvent.create({
        data: {
          ticketId,
          type: 'MESSAGE_ADDED',
          payload: {
            messageId: createdMessage.id,
            type: createdMessage.type,
          },
          createdById: user.id,
        },
      });

      await this.ensureFollower(ticketId, user.id, tx);

      return createdMessage;
    });

    // Parse mentions: (user:uuid) from markdown or data-user-id="uuid" from HTML (WYSIWYG)
    const markdownMentions = [
      ...payload.body.matchAll(/\(user:([a-f0-9-]{36})\)/gi),
    ].map((m) => m[1]);
    const htmlMentions = [
      ...payload.body.matchAll(/data-user-id="([a-f0-9-]{36})"/gi),
    ].map((m) => m[1]);
    const mentionedIds = [...new Set([...markdownMentions, ...htmlMentions])];
    const isInternalMessage =
      (payload.type ?? MessageType.PUBLIC) === MessageType.INTERNAL;
    const allowedMentionedIds: string[] = [];
    if (mentionedIds.length > 0) {
      const fullTicket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { accessGrants: true },
      });
      if (fullTicket) {
        const mentionedUsers = await this.prisma.user.findMany({
          where: { id: { in: mentionedIds } },
          include: { teamMemberships: true },
        });
        const ticketForView = {
          requesterId: fullTicket.requesterId,
          assignedTeamId: fullTicket.assignedTeamId,
          assigneeId: fullTicket.assigneeId,
          accessGrants: fullTicket.accessGrants.map((g) => ({
            teamId: g.teamId,
          })),
        };
        for (const u of mentionedUsers) {
          // An internal note reaches staff only, and that is decided by
          // RELATIONSHIP as well as rank. The role test alone let a STAFF
          // requester through: card 1.36 made canViewTicket return true for a
          // ticket's own requester and stopped them reading its internal
          // notes, so a mentioned payroll lead was notified about a note on
          // her own ticket that she then could not open. Not a leak - the
          // notification carries only the subject, never the body - but a
          // dead end, and it also stopped them being added as a follower for
          // it, which is right.
          if (
            isInternalMessage &&
            (u.role === UserRole.EMPLOYEE || u.id === fullTicket.requesterId)
          ) {
            continue;
          }
          const teamIds = u.teamMemberships.map((m) => m.teamId);
          const canView =
            teamIds.length > 0
              ? teamIds.some((teamId) =>
                  this.canViewTicket(
                    {
                      id: u.id,
                      email: u.email,
                      displayName: u.displayName,
                      role: u.role,
                      teamId,
                    },
                    ticketForView,
                  ),
                )
              : this.canViewTicket(
                  {
                    id: u.id,
                    email: u.email,
                    displayName: u.displayName,
                    role: u.role,
                    teamId: null,
                  },
                  ticketForView,
                );
          if (canView) {
            allowedMentionedIds.push(u.id);
          }
        }
      }
      for (const mentionedId of allowedMentionedIds) {
        try {
          await this.ensureFollower(ticketId, mentionedId);
        } catch (err) {
          this.logger.error(
            `Failed to add mention follower ${mentionedId} for ticket ${ticketId}`,
            (err as Error).stack,
          );
        }
      }
      if (allowedMentionedIds.length > 0 && !options.suppressNotifications) {
        await this.safeNotify(() =>
          this.notifications.notifyMentioned(
            ticketId,
            allowedMentionedIds,
            user.id,
            ticket.subject,
          ),
        );
      }
    }
    if (!options.suppressNotifications) {
      await this.safeNotify(() =>
        this.notifications.messageAdded(ticketId, message, user),
      );
    }
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId,
        reason: 'message_added',
        actorId: user.id,
        extraUserIds: allowedMentionedIds,
        message:
          message.type === MessageType.PUBLIC
            ? this.ticketRealtime.toRealtimeMessagePayload(message)
            : null,
      }),
    );

    return message;
  }

  /**
   * Record that this user has the ticket open, so their colleagues can see it
   * (card 1.9). Cloned from setTyping, with one deliberate difference.
   *
   * THE GATE IS canViewTicket, NOT canWriteTicket. Announcing "I am reading
   * this" requires only that you may read it, and the people this feature
   * exists for are precisely those who cannot write: a peer agent opening a
   * teammate's ticket is the collision worth preventing, and canWriteTicket
   * would have excluded exactly them. The AUDIENCE is unchanged - it is still
   * the ticket.typing audience, the set of people who may open the ticket.
   */
  async setViewing(
    ticketId: string,
    payload: { isViewing: boolean },
    user: AuthUser,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        requesterId: true,
        assigneeId: true,
        assignedTeamId: true,
        deletedAt: true,
        followers: {
          select: { userId: true },
        },
        accessGrants: {
          select: { teamId: true },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (!this.accessControl.canViewTicket(user, ticket)) {
      throw new ForbiddenException('No access to this ticket');
    }

    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.publishTicketViewingForTicket({
        ticket,
        actor: user,
        isViewing: payload.isViewing,
      }),
    );

    return { ok: true };
  }

  async setTyping(
    ticketId: string,
    payload: { isTyping: boolean },
    user: AuthUser,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        requesterId: true,
        assigneeId: true,
        assignedTeamId: true,
        followers: {
          select: { userId: true },
        },
        accessGrants: {
          select: { teamId: true },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (!this.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to this ticket');
    }

    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.publishTicketTypingForTicket({
        ticket,
        actor: user,
        isTyping: payload.isTyping,
      }),
    );

    return { ok: true };
  }

  async assign(ticketId: string, payload: AssignTicketDto, user: AuthUser) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (!this.canAssignTicket(user, ticket)) {
      throw new ForbiddenException('Not allowed to assign this ticket');
    }

    const assigneeId = payload.assigneeId ?? user.id;
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.applyAssigneeInTx(
        tx,
        {
          id: ticket.id,
          status: ticket.status,
          assignedTeamId: ticket.assignedTeamId,
          assigneeId: ticket.assigneeId,
        },
        { assigneeId },
        user.id,
      );

      const updatedTicket = await tx.ticket.findUnique({
        where: { id: ticketId },
        include: {
          requester: true,
          assignee: true,
          assignedTeam: true,
        },
      });
      if (!updatedTicket) {
        throw new NotFoundException('Ticket not found');
      }

      return updatedTicket;
    });
    await this.invalidateCountsCache([
      user.id,
      updated.requesterId,
      ticket.assigneeId,
      updated.assigneeId,
    ]);
    await this.safeNotify(() =>
      this.notifications.ticketAssigned(updated, user),
    );
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId: updated.id,
        reason: 'assigned',
        actorId: user.id,
      }),
    );

    return updated;
  }

  async applyAssigneeInTx(
    tx: Prisma.TransactionClient,
    ticket: TeamAssignmentTicketSnapshot,
    payload: { assigneeId: string },
    actorId: string,
  ) {
    const assignee = await tx.user.findUnique({
      where: { id: payload.assigneeId },
      select: {
        id: true,
        displayName: true,
        email: true,
        role: true,
      },
    });
    if (!assignee) {
      throw new BadRequestException('Assignee not found');
    }

    // OWNERs have global write access and aren't required to hold an explicit
    // TeamMember record; skip the membership check for them so "assign to me"
    // works on tickets in teams they aren't formally a member of.
    if (ticket.assignedTeamId && assignee.role !== UserRole.OWNER) {
      const membership = await tx.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: ticket.assignedTeamId,
            userId: payload.assigneeId,
          },
        },
        select: { id: true },
      });
      if (!membership) {
        throw new BadRequestException(
          'Assignee must belong to the ticket team',
        );
      }
    }

    const assignStatusPromote: TicketStatus[] = [
      TicketStatus.NEW,
      TicketStatus.TRIAGED,
      TicketStatus.REOPENED,
    ];
    const nextStatus = assignStatusPromote.includes(ticket.status)
      ? TicketStatus.ASSIGNED
      : ticket.status;

    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        assigneeId: payload.assigneeId,
        status: nextStatus,
      },
    });

    await tx.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'TICKET_ASSIGNED',
        payload: {
          assigneeId: payload.assigneeId,
          assigneeName: assignee.displayName,
          assigneeEmail: assignee.email,
        },
        createdById: actorId,
      },
    });

    const statusChanged = nextStatus !== ticket.status;
    if (statusChanged) {
      await tx.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          type: 'TICKET_STATUS_CHANGED',
          payload: {
            from: ticket.status,
            to: nextStatus,
          },
          createdById: actorId,
        },
      });
    }

    await this.ensureFollower(ticket.id, payload.assigneeId, tx);

    return {
      assigneeId: payload.assigneeId,
      nextStatus,
      statusChanged,
    };
  }

  async transfer(ticketId: string, payload: TransferTicketDto, user: AuthUser) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (user.role === UserRole.EMPLOYEE) {
      throw new ForbiddenException('Requesters cannot transfer tickets');
    }

    if (!this.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to transfer this ticket');
    }

    const transfer = await this.prisma.$transaction(async (tx) => {
      const result = await this.applyTeamTransferInTx(
        tx,
        {
          id: ticket.id,
          createdAt: ticket.createdAt,
          status: ticket.status,
          priority: ticket.priority,
          assignedTeamId: ticket.assignedTeamId,
          assigneeId: ticket.assigneeId,
          firstResponseDueAt: ticket.firstResponseDueAt,
          dueAt: ticket.dueAt,
        },
        {
          newTeamId: payload.newTeamId,
          assigneeId: payload.assigneeId,
        },
        user.id,
      );
      const updatedTicket = await tx.ticket.findUnique({
        where: { id: ticketId },
        include: {
          requester: true,
          assignee: true,
          assignedTeam: true,
        },
      });
      if (!updatedTicket) {
        throw new NotFoundException('Ticket not found');
      }

      return { updatedTicket, result };
    });
    const updated = transfer.updatedTicket;

    await this.invalidateCountsCache([
      user.id,
      updated.requesterId,
      ticket.assigneeId,
      updated.assigneeId,
    ]);

    await this.safeNotify(() =>
      this.notifications.ticketTransferred(
        updated,
        user,
        transfer.result.priorTeamId,
      ),
    );
    if (transfer.result.statusChanged) {
      await this.safeNotify(() =>
        this.notifications.ticketStatusChanged(updated, ticket.status, user),
      );
    }
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId: updated.id,
        reason: 'transferred',
        actorId: user.id,
        extraTeamIds: [transfer.result.priorTeamId],
      }),
    );

    return updated;
  }

  /**
   * Edit a ticket's subject and/or description. Text only — routing rules, AI
   * classification and SLA maths are deliberately NOT re-run. Anyone
   * `canWriteTicket` allows may edit; an EMPLOYEE (the requester) only while the
   * ticket is still NEW — afterwards they add a reply instead. A no-op edit
   * (same trimmed values) writes nothing. Every real edit records one
   * TICKET_EDITED event with `{ changes: [{ field, from, to }] }` and notifies
   * open screens with reason 'edited'. Returns the same shape as getById.
   */
  async update(ticketId: string, payload: UpdateTicketDto, user: AuthUser) {
    if (
      payload.subject === undefined &&
      payload.description === undefined &&
      payload.followUpAt === undefined
    ) {
      throw new BadRequestException(
        'Provide subject, description and/or followUpAt',
      );
    }
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket || (ticket.deletedAt && user.role !== UserRole.OWNER)) {
      throw new NotFoundException('Ticket not found');
    }
    if (!this.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to edit this ticket');
    }
    if (user.role === UserRole.EMPLOYEE && ticket.status !== TicketStatus.NEW) {
      throw new ForbiddenException(
        'Requesters can edit a ticket only while it is new — add a reply instead',
      );
    }
    // A follow-up is an agent's own reminder about a ticket they are working.
    // A requester has no use for one and should not be able to set the field.
    if (payload.followUpAt !== undefined && user.role === UserRole.EMPLOYEE) {
      throw new ForbiddenException('Requesters cannot set a follow-up date');
    }
    const subject = payload.subject?.trim();
    const description = payload.description?.trim();
    if (subject === '' || description === '') {
      throw new BadRequestException('Subject and description cannot be blank');
    }
    const changes: TicketEditChange[] = [];
    if (subject !== undefined && subject !== ticket.subject) {
      changes.push({ field: 'subject', from: ticket.subject, to: subject });
    }
    if (description !== undefined && description !== ticket.description) {
      changes.push({
        field: 'description',
        from: ticket.description,
        to: description,
      });
    }
    if (payload.followUpAt !== undefined) {
      const nextFollowUp = payload.followUpAt
        ? new Date(payload.followUpAt).toISOString()
        : null;
      const currentFollowUp = ticket.followUpAt?.toISOString() ?? null;
      if (nextFollowUp !== currentFollowUp) {
        changes.push({
          field: 'followUpAt',
          from: currentFollowUp,
          to: nextFollowUp,
        });
      }
    }
    if (changes.length === 0) {
      return this.getById(ticketId, user);
    }
    const data: Prisma.TicketUpdateInput = {};
    for (const change of changes) {
      if (change.field === 'followUpAt') {
        data.followUpAt = change.to ? new Date(change.to) : null;
        continue;
      }
      // Narrowed by the branch above: only the two text fields remain, and
      // both are non-null whenever they appear in `changes`.
      data[change.field] = change.to as string;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id: ticketId }, data });
      await tx.ticketEvent.create({
        data: {
          ticketId,
          type: 'TICKET_EDITED',
          payload: { changes },
          createdById: user.id,
        },
      });
    });
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId,
        reason: 'edited',
        actorId: user.id,
      }),
    );
    return this.getById(ticketId, user);
  }

  async setCategory(
    ticketId: string,
    categoryId: string | null,
    user: AuthUser,
  ) {
    if (user.role === UserRole.EMPLOYEE) {
      throw new ForbiddenException('Requesters cannot change ticket category');
    }
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    if (!this.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to this ticket');
    }
    if (categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: categoryId },
      });
      if (!category) {
        throw new BadRequestException('Category not found');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.ticket.update({
        where: { id: ticketId },
        data: { categoryId },
        include: { requester: true, assignee: true, assignedTeam: true },
      });
      await tx.ticketEvent.create({
        data: {
          ticketId,
          type: 'TICKET_CATEGORY_CHANGED',
          payload: { from: ticket.categoryId, to: categoryId },
          createdById: user.id,
        },
      });
      return result;
    });

    // Ground truth for AI classification accuracy. No-ops unless AI-routed.
    this.aiObservability.recordCorrection(
      ticketId,
      'category',
      ticket.categoryId ?? null,
      categoryId,
      user.id,
    );

    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId,
        reason: 'category_changed',
        actorId: user.id,
      }),
    );

    return updated;
  }

  async applyTeamTransferInTx(
    tx: Prisma.TransactionClient,
    ticket: TeamTransferTicketSnapshot,
    payload: { newTeamId: string; assigneeId?: string | null },
    actorId: string,
    options?: { rejectSameTeam?: boolean },
  ) {
    const rejectSameTeam = options?.rejectSameTeam ?? true;
    if (ticket.assignedTeamId && ticket.assignedTeamId === payload.newTeamId) {
      if (rejectSameTeam) {
        throw new BadRequestException(
          'Ticket is already assigned to that team',
        );
      }
      return {
        priorTeamId: ticket.assignedTeamId,
        nextStatus: ticket.status,
        assigneeId: ticket.assigneeId,
        statusChanged: false,
      };
    }

    const targetTeam = await tx.team.findUnique({
      where: { id: payload.newTeamId },
      select: { id: true, name: true },
    });
    if (!targetTeam) {
      throw new BadRequestException('Target team not found');
    }

    if (payload.assigneeId) {
      const membership = await tx.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: payload.newTeamId,
            userId: payload.assigneeId,
          },
        },
        select: { id: true },
      });
      if (!membership) {
        throw new BadRequestException(
          'Assignee must belong to the target team',
        );
      }
    }

    const priorTeamId = ticket.assignedTeamId;
    const oldSla = await this.slaCalc.getSlaConfig(
      ticket.priority,
      priorTeamId,
      tx,
    );
    const newSla = await this.slaCalc.getSlaConfig(
      ticket.priority,
      payload.newTeamId,
      tx,
    );

    // Unwind on the source team's calendar, re-date on the destination's.
    // Using one calendar for both silently mis-dates every cross-team transfer.
    const firstStart = ticket.firstResponseDueAt
      ? await this.slaCalc.subtractSlaHours(
          ticket.firstResponseDueAt,
          oldSla.firstResponseHours,
          oldSla.businessHoursOnly,
          priorTeamId,
          tx,
        )
      : ticket.createdAt;
    const resolutionStart = ticket.dueAt
      ? await this.slaCalc.subtractSlaHours(
          ticket.dueAt,
          oldSla.resolutionHours,
          oldSla.businessHoursOnly,
          priorTeamId,
          tx,
        )
      : ticket.createdAt;

    const firstResponseDueAt = await this.slaCalc.addSlaHours(
      firstStart,
      newSla.firstResponseHours,
      newSla.businessHoursOnly,
      payload.newTeamId,
      tx,
    );
    const dueAt = await this.slaCalc.addSlaHours(
      resolutionStart,
      newSla.resolutionHours,
      newSla.businessHoursOnly,
      payload.newTeamId,
      tx,
    );
    const assigneeId = payload.assigneeId ?? null;
    const nextStatus = this.normalizeStatusAfterTransfer(
      ticket.status,
      assigneeId,
    );

    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        assignedTeamId: payload.newTeamId,
        assigneeId,
        status: nextStatus,
        firstResponseDueAt,
        dueAt,
      },
    });

    if (priorTeamId && priorTeamId !== payload.newTeamId) {
      await tx.ticketAccess.upsert({
        where: {
          ticketId_teamId: {
            ticketId: ticket.id,
            teamId: priorTeamId,
          },
        },
        update: { accessLevel: AccessLevel.READ },
        create: {
          ticketId: ticket.id,
          teamId: priorTeamId,
          accessLevel: AccessLevel.READ,
        },
      });

      await tx.ticketAccess.deleteMany({
        where: {
          ticketId: ticket.id,
          teamId: payload.newTeamId,
        },
      });
    }

    await tx.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'TICKET_TRANSFERRED',
        payload: {
          fromTeamId: priorTeamId,
          toTeamId: payload.newTeamId,
          toTeamName: targetTeam.name,
          assigneeId,
        },
        createdById: actorId,
      },
    });

    const statusChanged = nextStatus !== ticket.status;
    if (statusChanged) {
      await tx.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          type: 'TICKET_STATUS_CHANGED',
          payload: {
            from: ticket.status,
            to: nextStatus,
          },
          createdById: actorId,
        },
      });
    }

    if (assigneeId) {
      await this.ensureFollower(ticket.id, assigneeId, tx);
    }

    await this.slaEngine.syncFromTicket(
      ticket.id,
      { policyConfigId: newSla.policyConfigId ?? null },
      tx,
    );

    // Ground truth for AI routing accuracy: a human moved this ticket off the
    // team the AI chose. No-ops unless the ticket was AI-routed.
    this.aiObservability.recordCorrection(
      ticket.id,
      'department',
      priorTeamId ?? null,
      payload.newTeamId,
      actorId,
    );

    return {
      priorTeamId,
      nextStatus,
      assigneeId,
      statusChanged,
    };
  }

  async transition(
    ticketId: string,
    payload: TransitionTicketDto,
    user: AuthUser,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (user.role === UserRole.EMPLOYEE) {
      const allowed =
        ticket.requesterId === user.id &&
        this.REQUESTER_TRANSITIONS.some(
          ([from, to]) => from === ticket.status && to === payload.status,
        );
      if (!allowed) {
        throw new ForbiddenException(
          'Requesters can confirm, reopen or cancel their own ticket only',
        );
      }
    }

    if (!this.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to transition this ticket');
    }

    const closeReason = this.resolveCloseReason(
      user,
      ticket.status,
      payload.status,
    );

    const transitionTicket: StatusTransitionTicketSnapshot = {
      id: ticket.id,
      status: ticket.status,
      priority: ticket.priority,
      assignedTeamId: ticket.assignedTeamId,
      assigneeId: ticket.assigneeId,
      dueAt: ticket.dueAt,
      slaPausedAt: ticket.slaPausedAt,
      resolvedAt: ticket.resolvedAt,
      closedAt: ticket.closedAt,
      completedAt: ticket.completedAt,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.applyStatusTransitionInTx(
        tx,
        transitionTicket,
        payload.status,
        user.id,
        closeReason,
      );

      const updatedTicket = await tx.ticket.findUnique({
        where: { id: ticketId },
        include: {
          requester: true,
          assignee: true,
          assignedTeam: true,
        },
      });
      if (!updatedTicket) {
        throw new NotFoundException('Ticket not found');
      }

      return updatedTicket;
    });

    await this.invalidateCountsCache([
      user.id,
      updated.requesterId,
      updated.assigneeId,
    ]);

    await this.safeNotify(() =>
      this.notifications.ticketStatusChanged(updated, ticket.status, user),
    );
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId: updated.id,
        reason: 'status_changed',
        actorId: user.id,
      }),
    );

    // Queue automation with retry via BullMQ instead of fire-and-forget
    this.automationQueue
      .enqueue(ticketId, 'STATUS_CHANGED')
      .catch((err) =>
        this.logger.error(
          `Failed to enqueue automation for ticket ${ticketId}: ${(err as Error).message}`,
        ),
      );

    return {
      ...updated,
      allowedTransitions: this.getAvailableTransitionsForTicket(
        updated.status,
        updated.assigneeId,
      ),
    };
  }

  /** Why a ticket is closing; null unless the target status is CLOSED. */
  private resolveCloseReason(
    user: AuthUser,
    from: TicketStatus,
    to: TicketStatus,
  ): TicketCloseReason | null {
    if (to !== TicketStatus.CLOSED) return null;
    if (user.role !== UserRole.EMPLOYEE) return TicketCloseReason.AGENT_CLOSED;
    return from === TicketStatus.RESOLVED
      ? TicketCloseReason.REQUESTER_CONFIRMED
      : TicketCloseReason.REQUESTER_CANCELLED;
  }

  /**
   * Apply a status change inside a transaction. `closeReason` is recorded when
   * the ticket enters CLOSED (callers that pass nothing — automation, inbound
   * email — get AGENT_CLOSED) and cleared on REOPENED.
   */
  async applyStatusTransitionInTx(
    tx: Prisma.TransactionClient,
    ticket: StatusTransitionTicketSnapshot,
    newStatus: TicketStatus,
    actorId: string,
    closeReason?: TicketCloseReason | null,
  ) {
    if (!this.isValidTransition(ticket.status, newStatus)) {
      throw new ForbiddenException('Invalid status transition');
    }
    // No-op transition: status is unchanged, so skip writing a phantom
    // TICKET_STATUS_CHANGED event and re-running SLA sync (BUG-08).
    if (ticket.status === newStatus) {
      return;
    }
    if (this.transitionRequiresAssignee(newStatus) && !ticket.assigneeId) {
      throw new BadRequestException(
        `Cannot set status to ${newStatus} without an assignee`,
      );
    }

    const now = new Date();
    const enteringPause =
      this.isPauseStatus(newStatus) && !this.isPauseStatus(ticket.status);
    const leavingPause =
      this.isPauseStatus(ticket.status) && !this.isPauseStatus(newStatus);

    const resolvedAt =
      newStatus === TicketStatus.RESOLVED
        ? now
        : newStatus === TicketStatus.REOPENED
          ? null
          : ticket.resolvedAt;
    const closedAt =
      newStatus === TicketStatus.CLOSED
        ? now
        : newStatus === TicketStatus.REOPENED
          ? null
          : ticket.closedAt;
    const completedAt =
      newStatus === TicketStatus.RESOLVED || newStatus === TicketStatus.CLOSED
        ? now
        : newStatus === TicketStatus.REOPENED
          ? null
          : ticket.completedAt;

    const effectiveCloseReason: TicketCloseReason | null | undefined =
      newStatus === TicketStatus.CLOSED
        ? (closeReason ?? TicketCloseReason.AGENT_CLOSED)
        : newStatus === TicketStatus.REOPENED
          ? null
          : undefined;

    const updateData: Prisma.TicketUpdateInput = {
      status: newStatus,
      resolvedAt,
      closedAt,
      completedAt,
      ...(effectiveCloseReason !== undefined
        ? { closeReason: effectiveCloseReason }
        : {}),
    };

    if (enteringPause) {
      updateData.slaPausedAt = now;
    }

    if (leavingPause) {
      if (ticket.slaPausedAt && ticket.dueAt) {
        const pauseMs = now.getTime() - ticket.slaPausedAt.getTime();
        updateData.dueAt = new Date(ticket.dueAt.getTime() + pauseMs);
      }
      updateData.slaPausedAt = null;
    }

    const resetResolutionSla = newStatus === TicketStatus.REOPENED;
    if (resetResolutionSla) {
      const sla = await this.slaCalc.getSlaConfig(
        ticket.priority,
        ticket.assignedTeamId,
        tx,
      );
      updateData.dueAt = await this.slaCalc.addSlaHours(
        now,
        sla.resolutionHours,
        sla.businessHoursOnly,
        ticket.assignedTeamId,
        tx,
      );
    }

    await tx.ticket.update({
      where: { id: ticket.id },
      data: updateData,
    });
    await tx.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'TICKET_STATUS_CHANGED',
        payload: {
          from: ticket.status,
          to: newStatus,
          ...(effectiveCloseReason !== undefined
            ? { closeReason: effectiveCloseReason }
            : {}),
        },
        createdById: actorId,
      },
    });
    await this.slaEngine.syncFromTicket(
      ticket.id,
      { resetResolution: resetResolutionSla },
      tx,
    );
  }

  /*
   * The `BULK_CONCURRENCY = 5` that used to sit here is GONE (card 1.51).
   *
   * It had been dead since card 1.12 moved the runner into
   * `run-bulk-with-concurrency.util.ts`, which has its own copy - nothing
   * referenced this one any more. Two constants with the same name and one
   * with no readers is how the next person tunes the wrong number and cannot
   * work out why nothing changed. The live one is in that util.
   */

  /**
   * Per-ticket bulk runner.
   *
   * The body moved to `run-bulk-with-concurrency.util.ts` in card 1.12 so the
   * bulk macro endpoint - which lives in the canned-responses module, to avoid
   * a module cycle - reports in exactly this shape rather than growing a second
   * copy. Behaviour is unchanged; four existing bulk endpoints and the web
   * app's `failedTicketIdsFromBulkResult` depend on it.
   */
  private async runBulkWithConcurrency<T>(
    items: string[],
    operation: (ticketId: string) => Promise<T>,
  ) {
    return runBulkWithConcurrency(items, operation);
  }

  /**
   * Redact a message (card 1.11).
   *
   * Allowed for the AUTHOR within `MESSAGE_REDACT_WINDOW_MIN` (default 15), or
   * for a LEAD, TEAM_ADMIN or OWNER who can write the ticket, at any time. The
   * author's window covers the real case - "that was the wrong patient, undo
   * it" happens within a minute or two - while anything older is a decision
   * somebody senior should be making.
   *
   * ⚠️ THE ORIGINAL TEXT IS NOT KEPT. `body` is overwritten in place with
   * "[message removed by <name>]".
   *
   * The card's design stored the original in a TicketEvent, and I have
   * deliberately not done that. A healthcare desk redacts precisely because
   * something ended up where it should not be - another patient's details, a
   * credential typed into a reply - and copying that text into a TicketEvent
   * MOVES the PHI rather than removing it, into a row read by the timeline and
   * the reports rather than by card 1.36's message filter. A credential
   * preserved in an audit row is still a live credential. The repo already
   * takes this line for AiInferenceLog ("never store raw PHI"), and a
   * redaction that quietly retains what it claims to have removed is worse
   * than none, because people rely on it. So the audit event records that a
   * redaction happened, by whom, when, on which message, its type, and whether
   * it had already been emailed - the questions anyone would actually ask -
   * and not the content. That also settles "who may read the original": in
   * this application, nobody. A backup restore is a separate, deliberate,
   * off-application act, which is the right shape for that decision.
   *
   * ⚠️ Redacting does not unsend an email. A public message has already
   * reached the requester and everyone CC'd (card 1.42's surviving path); this
   * cleans up the ticket and nothing else. The UI says so before the click,
   * and `alreadyEmailed` on the response says it afterwards.
   *
   * Visibility is unchanged: `type` is not touched, so a redacted internal note
   * stays internal. A redacted message must not become more visible than the
   * original was (card 1.36).
   */
  async redactMessage(ticketId: string, messageId: string, user: AuthUser) {
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        id: ticketId,
        ...this.accessControl.buildTicketAccessFilter(user),
      },
      select: {
        id: true,
        requesterId: true,
        assignedTeamId: true,
        assigneeId: true,
      },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    const message = await this.prisma.ticketMessage.findFirst({
      where: { id: messageId, ticketId },
      select: {
        id: true,
        authorId: true,
        type: true,
        createdAt: true,
        redactedAt: true,
        // Card 1.48 needs the ORIGINAL body: the only record of which files
        // were pasted into this message is the `<img data-attachment-id>`
        // markers in its HTML, and the redaction is about to overwrite it.
        body: true,
      },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    if (message.redactedAt) {
      // Already gone. Not an error worth a 500 or a second event.
      throw new BadRequestException('That message has already been removed');
    }
    const isAuthor = message.authorId === user.id;
    const isSenior =
      user.role === UserRole.LEAD ||
      user.role === UserRole.TEAM_ADMIN ||
      user.role === UserRole.OWNER;
    const windowMinutes = this.messageRedactWindowMinutes();
    const withinWindow =
      Date.now() - message.createdAt.getTime() <= windowMinutes * 60_000;
    if (isSenior) {
      // Seniority is not a way past the team boundary: a LEAD of another team
      // has no business here, so the ticket must still be writable by them.
      if (!this.canWriteTicket(user, ticket)) {
        throw new ForbiddenException('No write access to this ticket');
      }
    } else if (!isAuthor) {
      throw new ForbiddenException(
        'Only the author, or a lead, can remove a message',
      );
    } else if (!withinWindow) {
      throw new ForbiddenException(
        `A message can only be removed by its author within ${windowMinutes} minutes. Ask a lead.`,
      );
    }
    const actor = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { displayName: true, email: true },
    });
    const actorName = actor?.displayName || actor?.email || 'a colleague';
    // Read BEFORE the write, so the answer describes the message that existed.
    //
    // Through `messageOutboxRows`, the SAME matcher the conversation's
    // "emailed to 3" label goes through, so the caveat, the label and the
    // cancel path can never disagree about which rows belong to this message.
    // The outbox has no messageId column - the id lives at
    // payload.event.messageId, which is why the matching happens in JS - and a
    // second copy of that lookup here is precisely the one-rule-in-two-places
    // drift that produced cards 1.36, 1.38 and 1.50.
    const outboxRows = (await this.messageOutboxRows(ticketId)).get(
      messageId,
    ) ?? [];
    const sentRows = outboxRows.filter(
      (row) => row.status === OutboxStatus.SENT,
    );
    // ⚠️ Rows that are DONE WITH, whether they went or not.
    //
    // Found in the browser pass: a FAILED row keeps the rendered text exactly
    // as long as a SENT one, and with no SMTP configured production marks
    // every message email FAILED - so scrubbing only SENT rows would leave
    // the words in the column on nearly every row that exists. FAILED is not
    // counted as emailed (it never went), it just gets cleaned out too.
    const terminalRows = outboxRows.filter(
      (row) =>
        row.status === OutboxStatus.SENT || row.status === OutboxStatus.FAILED,
    );
    const unsentRows = outboxRows.filter(
      (row) => row.status === OutboxStatus.PENDING,
    );
    // ⚠️ PROCESSING is out of our hands, and must be reported as gone.
    //
    // The sweeper has already claimed these and is sending them now; there is
    // no status we can set that recalls one. My first version of this filtered
    // only SENT and PENDING, so a PROCESSING row fell through both and the
    // response said nothing had been emailed - the exact false reassurance
    // this card removes, reintroduced in the fix for it. A test caught it.
    const inFlightRows = outboxRows.filter(
      (row) => row.status === OutboxStatus.PROCESSING,
    );
    // ⚠️ CARD 1.47. Stop the email before it leaves, and be honest about
    // whether we managed it.
    //
    // Production has no Redis, so the sweeper delivers on a 60-second interval
    // and the rendered text sits in `NotificationOutbox.body` until it fires -
    // read from the database at that moment, so overwriting TicketMessage.body
    // does nothing to it. Redact a reply a few seconds after sending it and the
    // original went out anyway, while the dialog said nothing had been emailed.
    //
    // The update is conditional on the row still being PENDING, so if the
    // sweeper claimed it first we do NOT get the row and we must not claim we
    // stopped anything. Anything we failed to claim is treated as gone.
    const stoppedIds = await this.outbox.cancelUnsentForRedaction(
      unsentRows.map((row) => row.id),
    );
    const stoppedRows = unsentRows.filter((row) =>
      stoppedIds.includes(row.id),
    );
    const escapedRows = unsentRows.filter(
      (row) => !stoppedIds.includes(row.id),
    );
    // The copy of the words in a row that really did send comes out too. The
    // email is gone; the transcript of it does not have to live for ever in a
    // column the retention job is not deleting (card 1.11's own argument).
    await this.outbox.scrubSentBodyForRedaction(
      terminalRows.map((row) => row.id),
    );
    // "Already emailed" means SENT, or in flight and out of our hands: a row
    // the sweeper is sending right now, or one that was PENDING when we read
    // it and had been claimed by the time we tried to stop it.
    const emailed = [...sentRows, ...inFlightRows, ...escapedRows].reduce(
      (sum, row) => sum + row.reached,
      0,
    );
    const stopped = stoppedRows.reduce((sum, row) => sum + row.reached, 0);
    // ⚠️ CARD 1.48. The image pasted into this message has to go with it.
    //
    // `Attachment` has no `messageId` - only `ticketId` - so redaction cannot
    // cascade to attachments through a relation, because there is no relation.
    // What it CAN do is read the ids back out of the body it is about to
    // overwrite. Without this the reference vanishes while the row and the blob
    // stay one click away on the Attachments tab: the picture that should not
    // have been sent is still there, and the conversation no longer shows any
    // sign it ever was.
    //
    // Scoped to THIS ticket, always. The ids come out of text an agent typed,
    // so an id belonging to another ticket must not be actionable here.
    const inlineIds = inlineAttachmentIds(message.body);
    const removableAttachments = await this.resolveRedactableInlineAttachments(
      ticketId,
      messageId,
      inlineIds,
    );
    const redactedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.ticketMessage.update({
        where: { id: messageId },
        data: {
          body: `[message removed by ${actorName}]`,
          redactedAt,
          redactedById: user.id,
        },
      }),
      ...(removableAttachments.length > 0
        ? [
            this.prisma.attachment.deleteMany({
              where: {
                id: { in: removableAttachments.map((row) => row.id) },
                // Belt and braces: the resolver already scoped by ticket.
                ticketId,
              },
            }),
          ]
        : []),
      this.prisma.ticketEvent.create({
        data: {
          ticketId,
          type: 'TICKET_MESSAGE_REDACTED',
          payload: {
            messageId,
            messageType: message.type,
            authorId: message.authorId,
            // Whether the words had already left the building. The one fact
            // that changes what somebody has to do about it.
            alreadyEmailed: emailed > 0,
            emailedCount: emailed,
            // Card 1.47: how many were caught in the queue. An agent reading
            // the timeline can tell "we caught it" from "we did not", which is
            // the difference between an awkward apology and a breach report.
            emailsStopped: stopped,
            // Card 1.48: inline images that went with the message.
            inlineAttachmentsRemoved: removableAttachments.length,
          },
          createdById: user.id,
        },
      }),
    ]);
    // AFTER the commit, never before: a blob deleted for a transaction that
    // then rolled back would be a file lost from a message that was never
    // redacted. `deleteAttachmentFile` handles Azure Blob and local disk and
    // logs rather than throws, so a storage failure leaves an orphaned object
    // - the same outcome the existing orphan-cleanup path accepts - rather
    // than failing a redaction that has already happened.
    for (const attachment of removableAttachments) {
      await this.attachmentService.deleteAttachmentFile(attachment.storageKey);
    }
    return {
      id: messageId,
      redactedAt,
      redactedBy: actorName,
      alreadyEmailed: emailed > 0,
      emailedCount: emailed,
      /** How many queued emails this redaction actually stopped (card 1.47). */
      emailsStopped: stopped,
      /** How many pasted-in images went with it (card 1.48). */
      inlineAttachmentsRemoved: removableAttachments.length,
    };
  }

  /**
   * Which of a message's inline attachments this redaction may remove (1.48).
   *
   * Three filters, and each one matters:
   *
   *  - **Scoped to the ticket.** The ids are read out of body HTML an agent
   *    authored, so an id naming another ticket's file must not be actionable.
   *  - **Only files still referenced by nothing else.** An agent can copy an
   *    image's markup into a second message; removing the first must not break
   *    the second. A file another live message still points at is left alone.
   *  - **Inline only.** A file attached to the TICKET rather than pasted into
   *    this message has no `data-attachment-id` marker in any body, so it never
   *    appears in `inlineIds` and is never a candidate. Removing an arbitrary
   *    ticket file is a separate action with its own permission question, not a
   *    side effect of redacting a message - deliberately out of scope.
   */
  private async resolveRedactableInlineAttachments(
    ticketId: string,
    messageId: string,
    inlineIds: string[],
  ): Promise<{ id: string; storageKey: string }[]> {
    if (inlineIds.length === 0) {
      return [];
    }
    const candidates = await this.prisma.attachment.findMany({
      where: { id: { in: inlineIds }, ticketId },
      select: { id: true, storageKey: true },
    });
    if (candidates.length === 0) {
      return [];
    }
    const otherMessages = await this.prisma.ticketMessage.findMany({
      where: { ticketId, id: { not: messageId }, redactedAt: null },
      select: { body: true },
    });
    const stillReferenced = new Set(
      otherMessages.flatMap((row) => inlineAttachmentIds(row.body)),
    );
    return candidates.filter((row) => !stillReferenced.has(row.id));
  }

  /** How long an author has to take their own message back. Default 15 minutes. */
  private messageRedactWindowMinutes(): number {
    const raw = this.config.get<string>('MESSAGE_REDACT_WINDOW_MIN');
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
  }

  /**
   * Add and remove tags across a selection (card 1.12).
   *
   * ⚠️ Permission is checked PER TICKET, not once for the caller. A selection
   * can span teams - the list is filtered to what someone can SEE, and seeing a
   * ticket is not writing to it - so a single check applied to twenty rows is
   * exactly the mistake a bulk endpoint invites. `attachManyToTicket` documents
   * itself as skipping access control because its caller is trusted, which
   * makes checking here not optional.
   *
   * Per ticket rather than all-or-nothing: one ticket the agent cannot write
   * must not block nineteen they can, and the result names every failure so
   * they can see which.
   */
  async bulkTags(payload: BulkTagsDto, user: AuthUser) {
    const add = payload.add ?? [];
    const remove = payload.remove ?? [];
    if (add.length === 0 && remove.length === 0) {
      throw new BadRequestException('Give at least one tag to add or remove');
    }
    if (user.role === UserRole.EMPLOYEE) {
      throw new ForbiddenException('Requesters cannot tag tickets');
    }
    // Normalised once, outside the loop: a malformed tag is the caller's
    // mistake and should be one 400, not a hundred identical per-ticket errors.
    const addNames = add.map((name: string) =>
      this.tagsService.normalize(name),
    );
    const removeNames = remove.map((name: string) =>
      this.tagsService.normalize(name),
    );
    return this.runBulkWithConcurrency(payload.ticketIds, async (ticketId) => {
      const ticket = await this.prisma.ticket.findFirst({
        where: {
          id: ticketId,
          ...this.accessControl.buildTicketAccessFilter(user),
        },
        select: {
          id: true,
          requesterId: true,
          assignedTeamId: true,
          assigneeId: true,
        },
      });
      if (!ticket) {
        throw new Error('Ticket not found');
      }
      if (!this.canWriteTicket(user, ticket)) {
        throw new Error('No write access');
      }
      if (addNames.length > 0) {
        await this.tagsService.attachManyToTicket(
          ticketId,
          addNames,
          TagSource.MANUAL,
          user.id,
        );
      }
      if (removeNames.length > 0) {
        const tags = await this.prisma.tag.findMany({
          where: { name: { in: removeNames } },
          select: { id: true },
        });
        if (tags.length > 0) {
          // A tag that is not on this ticket is simply not deleted. Removing
          // "vpn" from twenty tickets where only nine carry it is a success on
          // all twenty, not eleven failures.
          await this.prisma.ticketTag.deleteMany({
            where: { ticketId, tagId: { in: tags.map((tag) => tag.id) } },
          });
        }
      }
    });
  }

  /** Bulk assign tickets. assigneeId optional = assign to self. */
  async bulkAssign(payload: BulkAssignDto, user: AuthUser) {
    return this.runBulkWithConcurrency(payload.ticketIds, (ticketId) =>
      this.assign(ticketId, { assigneeId: payload.assigneeId }, user),
    );
  }

  /** Bulk transfer tickets to a team. */
  async bulkTransfer(payload: BulkTransferDto, user: AuthUser) {
    return this.runBulkWithConcurrency(payload.ticketIds, (ticketId) =>
      this.transfer(
        ticketId,
        { newTeamId: payload.newTeamId, assigneeId: payload.assigneeId },
        user,
      ),
    );
  }

  /** Bulk transition tickets to a status. */
  async bulkStatus(payload: BulkStatusDto, user: AuthUser) {
    return this.runBulkWithConcurrency(payload.ticketIds, (ticketId) =>
      this.transition(ticketId, { status: payload.status }, user),
    );
  }

  /** Bulk update ticket priority. Updates ticket, records event, and resyncs SLA instance. */
  async bulkPriority(payload: BulkPriorityDto, user: AuthUser) {
    if (user.role === UserRole.EMPLOYEE) {
      throw new ForbiddenException('Requesters cannot change ticket priority');
    }

    return this.runBulkWithConcurrency(payload.ticketIds, async (ticketId) => {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
      });
      if (!ticket) {
        throw new Error('Ticket not found');
      }
      if (!this.canWriteTicket(user, ticket)) {
        throw new Error('No write access');
      }
      // getSlaConfig always returns a config object (team policy or default); never null
      const oldSla = await this.slaCalc.getSlaConfig(
        ticket.priority,
        ticket.assignedTeamId,
      );
      const newSla = await this.slaCalc.getSlaConfig(
        payload.priority,
        ticket.assignedTeamId,
      );

      // Derive SLA start from current cycle so reopened/paused tickets and due dates are preserved
      const firstStart = ticket.firstResponseDueAt
        ? await this.slaCalc.subtractSlaHours(
            ticket.firstResponseDueAt,
            oldSla.firstResponseHours,
            oldSla.businessHoursOnly,
            ticket.assignedTeamId,
          )
        : ticket.createdAt;
      const resolutionStart = ticket.dueAt
        ? await this.slaCalc.subtractSlaHours(
            ticket.dueAt,
            oldSla.resolutionHours,
            oldSla.businessHoursOnly,
            ticket.assignedTeamId,
          )
        : ticket.createdAt;

      const firstResponseDueAt = await this.slaCalc.addSlaHours(
        firstStart,
        newSla.firstResponseHours,
        newSla.businessHoursOnly,
        ticket.assignedTeamId,
      );
      const dueAt = await this.slaCalc.addSlaHours(
        resolutionStart,
        newSla.resolutionHours,
        newSla.businessHoursOnly,
        ticket.assignedTeamId,
      );

      await this.prisma.$transaction(async (tx) => {
        await tx.ticket.update({
          where: { id: ticketId },
          data: {
            priority: payload.priority,
            firstResponseDueAt,
            dueAt,
          },
        });
        await tx.ticketEvent.create({
          data: {
            ticketId,
            type: 'TICKET_PRIORITY_CHANGED',
            payload: { from: ticket.priority, to: payload.priority },
            createdById: user.id,
          },
        });
        await this.slaEngine.syncFromTicket(
          ticketId,
          { policyConfigId: newSla.policyConfigId ?? null },
          tx,
        );
      });
      // Ground truth for AI priority accuracy. No-ops unless AI-routed.
      this.aiObservability.recordCorrection(
        ticketId,
        'priority',
        ticket.priority,
        payload.priority,
        user.id,
      );

      await this.invalidateCountsCache([
        user.id,
        ticket.requesterId,
        ticket.assigneeId,
      ]);
      await this.ticketRealtime.safeRealtime(() =>
        this.ticketRealtime.emitTicketRealtimeEvent({
          ticketId,
          reason: 'priority_changed',
          actorId: user.id,
        }),
      );
    });
  }

  async listFollowers(ticketId: string, user: AuthUser) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        followers: {
          include: { user: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (!this.canViewTicket(user, ticket)) {
      throw new ForbiddenException('No access to this ticket');
    }

    return { data: ticket.followers };
  }

  async followTicket(
    ticketId: string,
    payload: { userId?: string },
    user: AuthUser,
  ) {
    const targetUserId = payload.userId ?? user.id;
    const canManageFollowers = canManageOtherFollowers(user.role);

    if (targetUserId !== user.id && !canManageFollowers) {
      throw new ForbiddenException('Not allowed to follow for others');
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (!this.canViewTicket(user, ticket)) {
      throw new ForbiddenException('No access to this ticket');
    }

    await this.ensureFollower(ticketId, targetUserId);
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId,
        reason: 'followers_changed',
        actorId: user.id,
        extraUserIds: [targetUserId],
      }),
    );

    return this.listFollowers(ticketId, user);
  }

  async unfollowTicket(ticketId: string, userId: string, user: AuthUser) {
    const targetUserId = userId === 'me' ? user.id : userId;
    const canManageFollowers = canManageOtherFollowers(user.role);

    if (targetUserId !== user.id && !canManageFollowers) {
      throw new ForbiddenException('Not allowed to remove other followers');
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (!this.canViewTicket(user, ticket)) {
      throw new ForbiddenException('No access to this ticket');
    }

    await this.prisma.ticketFollower.deleteMany({
      where: { ticketId, userId: targetUserId },
    });
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId,
        reason: 'followers_changed',
        actorId: user.id,
        extraUserIds: [targetUserId],
      }),
    );

    return { id: targetUserId };
  }

  /**
   * Link two tickets (card 1.6).
   *
   * TWO different permissions, deliberately. You must be able to WRITE the
   * ticket you are linking from - linking is reversible in one click, so write
   * access is the right bar - and be able to VIEW the one you are linking to.
   * The second is the security-relevant half: without it, linking a ticket you
   * can open to one you cannot and then reading the link list back would hand
   * you the subject of a ticket you have no access to, and HR and payroll
   * subjects carry people's names.
   *
   * An unviewable target answers 404 rather than 403 on purpose. A 403 would
   * confirm that the id belongs to a real ticket, which is the same leak in a
   * smaller form.
   */
  async linkTicket(
    ticketId: string,
    payload: LinkTicketDto,
    user: AuthUser,
  ): Promise<{ data: TicketLinkView[] }> {
    if (payload.toTicketId === ticketId) {
      throw new BadRequestException('A ticket cannot be linked to itself');
    }
    const tickets = await this.prisma.ticket.findMany({
      where: { id: { in: [ticketId, payload.toTicketId] } },
      select: {
        id: true,
        requesterId: true,
        assignedTeamId: true,
        assigneeId: true,
        deletedAt: true,
        accessGrants: { select: { teamId: true } },
      },
    });
    const source = tickets.find((row) => row.id === ticketId);
    const target = tickets.find((row) => row.id === payload.toTicketId);
    if (!source || (source.deletedAt && user.role !== UserRole.OWNER)) {
      throw new NotFoundException('Ticket not found');
    }
    if (!this.accessControl.canWriteTicket(user, source)) {
      throw new ForbiddenException('No write access to this ticket');
    }
    if (!target || !this.accessControl.canViewTicket(user, target)) {
      throw new NotFoundException('Linked ticket not found');
    }
    await this.ensureNoParentCycle(ticketId, payload.toTicketId, payload.type);
    const link = await this.prisma.ticketLink
      .create({
        data: {
          fromTicketId: ticketId,
          toTicketId: payload.toTicketId,
          type: payload.type,
          createdById: user.id,
        },
        select: { id: true },
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new BadRequestException(
            'These tickets are already linked with that type',
          );
        }
        throw error;
      });
    await this.recordLinkEvents(
      'TICKET_LINKED',
      link.id,
      ticketId,
      payload.toTicketId,
      payload.type,
      user.id,
    );
    return { data: await this.loadTicketLinkViews(ticketId, user) };
  }

  /**
   * Remove a link from either end (card 1.6).
   *
   * A link belongs to both tickets, so either side may remove it. What is
   * checked is write access to the ticket named in the path AND that the link
   * actually touches that ticket - without the second check, a link id from an
   * unrelated pair could be deleted through a ticket the caller happens to own.
   */
  async unlinkTicket(
    ticketId: string,
    linkId: string,
    user: AuthUser,
  ): Promise<{ id: string }> {
    const link = await this.prisma.ticketLink.findUnique({
      where: { id: linkId },
      select: { id: true, fromTicketId: true, toTicketId: true, type: true },
    });
    if (
      !link ||
      (link.fromTicketId !== ticketId && link.toTicketId !== ticketId)
    ) {
      throw new NotFoundException('Link not found');
    }
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        requesterId: true,
        assignedTeamId: true,
        assigneeId: true,
        deletedAt: true,
      },
    });
    if (!ticket || (ticket.deletedAt && user.role !== UserRole.OWNER)) {
      throw new NotFoundException('Ticket not found');
    }
    if (!this.accessControl.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to this ticket');
    }
    await this.prisma.ticketLink.delete({ where: { id: linkId } });
    await this.recordLinkEvents(
      'TICKET_UNLINKED',
      link.id,
      link.fromTicketId,
      link.toTicketId,
      link.type,
      user.id,
    );
    return { id: linkId };
  }

  /**
   * Every link on a ticket, reduced to what this reader may see (card 1.6).
   *
   * One row is stored per relationship, so this reads both directions and
   * derives the inverse rather than storing it: a row where this ticket is the
   * `to` side comes back as `direction: 'incoming'`, and the web renders
   * "duplicated by" where the stored row says "duplicate of".
   */
  private async loadTicketLinkViews(
    ticketId: string,
    user: AuthUser,
  ): Promise<TicketLinkView[]> {
    const ticketSelect = {
      id: true,
      number: true,
      displayId: true,
      subject: true,
      status: true,
      priority: true,
      requesterId: true,
      assignedTeamId: true,
      assigneeId: true,
      deletedAt: true,
      accessGrants: { select: { teamId: true } },
    } as const;
    const links = await this.prisma.ticketLink.findMany({
      where: { OR: [{ fromTicketId: ticketId }, { toTicketId: ticketId }] },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        createdAt: true,
        fromTicketId: true,
        createdBy: { select: { id: true, displayName: true } },
        fromTicket: { select: ticketSelect },
        toTicket: { select: ticketSelect },
      },
    });
    return links.map((link) => {
      const isOutgoing = link.fromTicketId === ticketId;
      const other = isOutgoing ? link.toTicket : link.fromTicket;
      const visible = this.accessControl.canViewTicket(user, other);
      // A soft-deleted ticket is invisible to everyone but OWNER, so tell the
      // reader it was deleted only if they could have opened it while it was
      // live. Otherwise a link an agent made themselves reads as "no access".
      const couldSeeWhenLive = this.accessControl.canViewTicket(user, {
        ...other,
        deletedAt: null,
      });
      return {
        id: link.id,
        type: link.type,
        direction: isOutgoing ? ('outgoing' as const) : ('incoming' as const),
        createdAt: link.createdAt,
        createdBy: link.createdBy,
        otherTicket: {
          id: other.id,
          number: other.number,
          visible,
          deleted: other.deletedAt !== null && couldSeeWhenLive,
          displayId: visible ? other.displayId : null,
          subject: visible ? other.subject : null,
          status: visible ? other.status : null,
          priority: visible ? other.priority : null,
        },
      };
    });
  }

  /**
   * Refuse a PARENT_OF link that would make a ticket its own ancestor.
   *
   * Two levels only, which is what the card asks for: the direct inverse (the
   * target is already this ticket's parent) and one step above it (the target
   * is the parent of this ticket's parent). A full graph walker is not worth
   * building for a relationship an agent sets by hand, and an unbounded walk
   * over user-supplied data is its own hazard.
   */
  private async ensureNoParentCycle(
    fromTicketId: string,
    toTicketId: string,
    type: TicketLinkType,
  ): Promise<void> {
    if (type !== TicketLinkType.PARENT_OF) {
      return;
    }
    const parents = await this.prisma.ticketLink.findMany({
      where: { toTicketId: fromTicketId, type: TicketLinkType.PARENT_OF },
      select: { fromTicketId: true },
    });
    const parentIds = parents.map((row) => row.fromTicketId);
    if (parentIds.includes(toTicketId)) {
      throw new BadRequestException(
        'Those two tickets cannot be parents of each other',
      );
    }
    if (!parentIds.length) {
      return;
    }
    const loops = await this.prisma.ticketLink.count({
      where: {
        fromTicketId: toTicketId,
        toTicketId: { in: parentIds },
        type: TicketLinkType.PARENT_OF,
      },
    });
    if (loops > 0) {
      throw new BadRequestException('That would loop the parent chain');
    }
  }

  /**
   * Write the link event on BOTH tickets, so each timeline records it.
   *
   * The payload carries ids and the link type only - never the other ticket's
   * subject. A timeline entry is readable by anyone who can read the ticket it
   * sits on, so a subject in here would reopen the exact leak the link view
   * rules close.
   */
  private async recordLinkEvents(
    type: 'TICKET_LINKED' | 'TICKET_UNLINKED',
    linkId: string,
    fromTicketId: string,
    toTicketId: string,
    linkType: TicketLinkType,
    actorId: string,
  ): Promise<void> {
    await this.prisma.ticketEvent.createMany({
      data: [
        {
          ticketId: fromTicketId,
          type,
          payload: {
            linkId,
            linkType,
            direction: 'outgoing',
            otherTicketId: toTicketId,
          },
          createdById: actorId,
        },
        {
          ticketId: toTicketId,
          type,
          payload: {
            linkId,
            linkType,
            direction: 'incoming',
            otherTicketId: fromTicketId,
          },
          createdById: actorId,
        },
      ],
    });
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId: fromTicketId,
        reason: 'links_changed',
        actorId,
      }),
    );
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId: toTicketId,
        reason: 'links_changed',
        actorId,
      }),
    );
  }

  /**
   * Soft-delete a ticket. OWNER may delete any ticket; TEAM_ADMIN only tickets
   * assigned to their primary team. The row stays (restorable by OWNER) but
   * disappears from every list, count, report and lookup. Writes a
   * TICKET_DELETED ticket event and an admin audit event, then tells open
   * clients to refresh.
   */
  async softDelete(id: string, payload: DeleteTicketDto, user: AuthUser) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { assignedTeam: { select: { id: true, name: true } } },
    });
    if (!ticket || ticket.deletedAt) {
      throw new NotFoundException('Ticket not found');
    }
    const isTeamAdminOfTicket =
      user.role === UserRole.TEAM_ADMIN &&
      !!user.primaryTeamId &&
      ticket.assignedTeamId === user.primaryTeamId;
    if (user.role !== UserRole.OWNER && !isTeamAdminOfTicket) {
      throw new ForbiddenException(
        'Only owners or the team admin of the assigned team can delete a ticket',
      );
    }
    const reason = payload?.reason?.trim() || null;
    const deletedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id },
        data: { deletedAt, deletedById: user.id },
      });
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          type: 'TICKET_DELETED',
          payload: { reason },
          createdById: user.id,
        },
      });
      await tx.adminAuditEvent.create({
        data: {
          type: 'TICKET_DELETED',
          payload: { ticketId: id, displayId: ticket.displayId, reason },
          createdById: user.id,
          teamId: ticket.assignedTeamId,
          actorEmail: user.email,
          actorName: user.displayName,
          teamName: ticket.assignedTeam?.name ?? null,
        },
      });
    });
    await this.invalidateCountsCache([
      user.id,
      ticket.requesterId,
      ticket.assigneeId,
    ]);
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId: id,
        reason: 'deleted',
        actorId: user.id,
      }),
    );
    return { id, deletedAt };
  }

  /** Restore a soft-deleted ticket. OWNER only. */
  async restore(id: string, user: AuthUser) {
    if (user.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only owners can restore a ticket');
    }
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { assignedTeam: { select: { id: true, name: true } } },
    });
    if (!ticket || !ticket.deletedAt) {
      throw new NotFoundException('Deleted ticket not found');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id },
        data: { deletedAt: null, deletedById: null },
      });
      await tx.ticketEvent.create({
        data: {
          ticketId: id,
          type: 'TICKET_RESTORED',
          payload: {},
          createdById: user.id,
        },
      });
      await tx.adminAuditEvent.create({
        data: {
          type: 'TICKET_RESTORED',
          payload: { ticketId: id, displayId: ticket.displayId },
          createdById: user.id,
          teamId: ticket.assignedTeamId,
          actorEmail: user.email,
          actorName: user.displayName,
          teamName: ticket.assignedTeam?.name ?? null,
        },
      });
    });
    await this.invalidateCountsCache([
      user.id,
      ticket.requesterId,
      ticket.assigneeId,
    ]);
    await this.ticketRealtime.safeRealtime(() =>
      this.ticketRealtime.emitTicketRealtimeEvent({
        ticketId: id,
        reason: 'restored',
        actorId: user.id,
      }),
    );
    return { id, deletedAt: null };
  }

  /** Delegates to shared AccessControlService */
  private buildAccessFilter(user: AuthUser): Prisma.TicketWhereInput {
    return this.accessControl.buildTicketAccessFilter(user);
  }

  /** Delegates to shared AccessControlService */
  private canViewTicket(
    user: AuthUser,
    ticket: {
      requesterId: string;
      assignedTeamId: string | null;
      assigneeId: string | null;
      accessGrants?: { teamId: string }[];
    },
  ) {
    return this.accessControl.canViewTicket(user, ticket);
  }

  /** Delegates to shared AccessControlService */
  private canWriteTicket(
    user: AuthUser,
    ticket: {
      requesterId: string;
      assignedTeamId: string | null;
      assigneeId: string | null;
    },
  ) {
    return this.accessControl.canWriteTicket(user, ticket);
  }

  private canAssignTicket(
    user: AuthUser,
    ticket: { assignedTeamId: string | null; assigneeId: string | null },
  ) {
    if (user.role === UserRole.OWNER) {
      return true;
    }

    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      return ticket.assignedTeamId === user.primaryTeamId;
    }

    const assignTeamScope = this.accessControl.operationalTeamIds(user);
    if (
      !ticket.assignedTeamId ||
      !assignTeamScope.includes(ticket.assignedTeamId)
    ) {
      return false;
    }

    if (user.role === UserRole.LEAD) {
      return true;
    }

    // Agents can assign within their own team only when the ticket is in their
    // direct write scope: unassigned or currently assigned to them.
    return ticket.assigneeId === null || ticket.assigneeId === user.id;
  }

  /**
   * Card 1.40: may this sender's emailed reply go on this ticket?
   *
   * A thin pass-through to AccessControlService so the inbound service does not
   * hold its own copy of the audience rule - a fourth copy in a different file
   * is how card 1.36's Fault C and card 1.38 happened.
   */
  canReplyByEmailToTicket(
    userId: string,
    ticket: Parameters<AccessControlService['canReplyByEmail']>[1],
  ): boolean {
    return this.accessControl.canReplyByEmail(userId, ticket);
  }

  /**
   * Card 1.40: replying makes you a participant, so you receive the rest of the
   * thread. Public because the inbound path is the only caller that needs it
   * without an HTTP request behind it.
   */
  async ensureTicketFollower(ticketId: string, userId: string) {
    await this.ensureFollower(ticketId, userId);
  }

  private async ensureFollower(
    ticketId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    await client.ticketFollower.upsert({
      where: {
        ticketId_userId: {
          ticketId,
          userId,
        },
      },
      update: {},
      create: {
        ticketId,
        userId,
      },
    });
  }

  private async safeNotify(task: () => Promise<void>) {
    try {
      await task();
    } catch (error) {
      this.logger.error(
        `Notification failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
  private isValidTransition(from: TicketStatus, to: TicketStatus) {
    if (from === to) {
      return true;
    }
    return this.getAvailableTransitions(from).includes(to);
  }

  private getAvailableTransitions(status: TicketStatus) {
    return this.STATUS_TRANSITIONS[status] ?? [];
  }

  private parseStatusTransitions(raw: string) {
    const parsed: unknown = JSON.parse(raw);
    if (!this.isStatusTransitionMap(parsed)) {
      throw new Error('Invalid TICKET_STATUS_TRANSITIONS format');
    }
    return parsed;
  }

  private isStatusTransitionMap(
    value: unknown,
  ): value is Record<TicketStatus, TicketStatus[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    const ticketStatuses = Object.values(TicketStatus);

    return ticketStatuses.every((status) => {
      const transitions = candidate[status];
      return (
        Array.isArray(transitions) &&
        transitions.every(
          (transition): transition is TicketStatus =>
            typeof transition === 'string' &&
            ticketStatuses.includes(transition as TicketStatus),
        )
      );
    });
  }

  private getAvailableTransitionsForTicket(
    status: TicketStatus,
    assigneeId: string | null,
  ) {
    const transitions = this.getAvailableTransitions(status);
    if (assigneeId) {
      return transitions;
    }
    return transitions.filter(
      (nextStatus) => !this.transitionRequiresAssignee(nextStatus),
    );
  }

  private transitionRequiresAssignee(status: TicketStatus) {
    return (
      status === TicketStatus.ASSIGNED || status === TicketStatus.IN_PROGRESS
    );
  }

  private normalizeStatusAfterTransfer(
    status: TicketStatus,
    assigneeId: string | null,
  ) {
    if (assigneeId) {
      return status;
    }
    if (
      status === TicketStatus.ASSIGNED ||
      status === TicketStatus.IN_PROGRESS
    ) {
      return TicketStatus.TRIAGED;
    }
    return status;
  }

  private isPauseStatus(status: TicketStatus) {
    return (
      status === TicketStatus.WAITING_ON_REQUESTER ||
      status === TicketStatus.WAITING_ON_VENDOR
    );
  }

  private buildDisplayId(
    teamName: string | null,
    createdAt: Date,
    ticketNumber: number,
  ) {
    const departmentCode = this.getDepartmentCode(teamName);
    // Use UTC so the date prefix is stable regardless of server timezone (BUG-13).
    const yyyy = createdAt.getUTCFullYear();
    const mm = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(createdAt.getUTCDate()).padStart(2, '0');
    const sequence = String(ticketNumber).padStart(3, '0');
    return `${departmentCode}_${yyyy}${mm}${dd}_${sequence}`;
  }

  private getDepartmentCode(teamName: string | null) {
    if (!teamName) {
      return 'NA';
    }
    const words = teamName
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(' ')
      .map((word) => word.trim())
      .filter(Boolean);
    if (words.length === 0) {
      return 'NA';
    }
    if (words.length === 1) {
      return words[0].slice(0, 2).toUpperCase();
    }
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  private async routeTarget(ctx: {
    subject: string;
    description: string;
    priority?: TicketPriority | null;
    channel?: string | null;
    categoryId?: string | null;
    requesterId?: string | null;
  }) {
    const includeAssignee = await this.hasRoutingAssigneeColumn();
    const includeExpanded = await this.hasRoutingExpandedColumns();

    const assigneeCol = includeAssignee
      ? Prisma.sql`"assigneeId"`
      : Prisma.sql`NULL::text AS "assigneeId"`;
    const matchTypeCol = includeExpanded
      ? Prisma.sql`"matchType"`
      : Prisma.sql`'ALL' AS "matchType"`;
    const conditionsCol = includeExpanded
      ? Prisma.sql`"conditions"`
      : Prisma.sql`'[]'::jsonb AS "conditions"`;
    const actionsCol = includeExpanded
      ? Prisma.sql`"actions"`
      : Prisma.sql`'[]'::jsonb AS "actions"`;

    const rules = await this.prisma.$queryRaw<
      Array<{
        teamId: string;
        assigneeId: string | null;
        name: string;
        keywords: string[];
        matchType: string;
        conditions: Array<{ field: string; op: string; value: string }> | null;
        actions: Array<{ type: string; value: string }> | null;
      }>
    >`
      SELECT "teamId", ${assigneeCol}, "name", "keywords",
        ${matchTypeCol}, ${conditionsCol}, ${actionsCol}
      FROM "RoutingRule"
      WHERE "isActive" = true
      ORDER BY "priority" ASC, "name" ASC
    `;

    // Resolve the requester's email only if a rule actually tests the sender.
    let senderEmail: string | null = null;
    const needsSender = rules.some(
      (r) =>
        Array.isArray(r.conditions) &&
        r.conditions.some((c) => c.field === 'sender'),
    );
    if (needsSender && ctx.requesterId) {
      const requester = await this.prisma.user.findUnique({
        where: { id: ctx.requesterId },
        select: { email: true },
      });
      senderEmail = requester?.email ?? null;
    }

    const evalCtx = {
      subject: ctx.subject ?? '',
      description: ctx.description ?? '',
      priority: ctx.priority ?? null,
      channel: ctx.channel ?? null,
      categoryId: ctx.categoryId ?? null,
      senderEmail,
    };
    const legacyText =
      `${evalCtx.subject} ${evalCtx.description}`.toLowerCase();

    for (const rule of rules) {
      const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
      const matched =
        conditions.length > 0
          ? this.evaluateRoutingConditions(conditions, rule.matchType, evalCtx)
          : rule.keywords.some((keyword) =>
              legacyText.includes(keyword.toLowerCase()),
            );
      if (!matched) {
        continue;
      }

      let teamId = rule.teamId;
      let assigneeId = rule.assigneeId ?? null;
      let setPriority: TicketPriority | null = null;
      const addTags: string[] = [];
      const actions = Array.isArray(rule.actions) ? rule.actions : [];
      for (const action of actions) {
        if (action.type === 'assign_team' && action.value) {
          teamId = action.value;
        } else if (action.type === 'assign_member' && action.value) {
          assigneeId = action.value;
        } else if (action.type === 'set_priority' && action.value) {
          const candidate = action.value.toUpperCase();
          if ((Object.values(TicketPriority) as string[]).includes(candidate)) {
            setPriority = candidate as TicketPriority;
          }
        } else if (action.type === 'add_tag' && action.value) {
          addTags.push(action.value);
        }
      }

      if (assigneeId) {
        const membership = await this.prisma.teamMember.findFirst({
          where: { teamId, userId: assigneeId },
          select: { id: true },
        });
        if (!membership) {
          assigneeId = null;
        }
      }

      return { teamId, assigneeId, setPriority, addTags };
    }

    return null;
  }

  private evaluateRoutingConditions(
    conditions: Array<{ field: string; op: string; value: string }>,
    matchType: string,
    ctx: {
      subject: string;
      description: string;
      priority: TicketPriority | null;
      channel: string | null;
      categoryId: string | null;
      senderEmail: string | null;
    },
  ): boolean {
    const evalOne = (c: { field: string; op: string; value: string }) => {
      let hay: string;
      switch (c.field) {
        case 'subject':
          hay = ctx.subject;
          break;
        case 'message':
          hay = ctx.description;
          break;
        case 'priority':
          hay = ctx.priority ?? '';
          break;
        case 'channel':
          hay = ctx.channel ?? '';
          break;
        case 'category':
          hay = ctx.categoryId ?? '';
          break;
        case 'sender':
          hay = ctx.senderEmail ?? '';
          break;
        default:
          return false;
      }
      const needle = (c.value ?? '').toLowerCase().trim();
      const subject = hay.toLowerCase().trim();
      switch (c.op) {
        case 'contains':
          return subject.includes(needle);
        case 'not_contains':
          return !subject.includes(needle);
        case 'is':
          return subject === needle;
        case 'is_not':
          return subject !== needle;
        default:
          return false;
      }
    };
    return matchType === 'ANY'
      ? conditions.some(evalOne)
      : conditions.every(evalOne);
  }

  /**
   * Resolve the next assignee for round-robin assignment.
   * Uses SELECT FOR UPDATE inside a transaction to prevent race conditions
   * when multiple tickets are created simultaneously.
   */
  private async resolveAssignee(
    teamId: string | null,
    tx?: Prisma.TransactionClient,
  ) {
    if (!teamId) {
      return null;
    }

    const resolveWithClient = async (client: Prisma.TransactionClient) => {
      // Lock the team row to prevent concurrent round-robin reads
      const [team] = await client.$queryRaw<
        Array<{
          id: string;
          assignmentStrategy: string;
          lastAssignedUserId: string | null;
        }>
      >`SELECT "id", "assignmentStrategy"::text, "lastAssignedUserId"
        FROM "Team"
        WHERE "id" = ${teamId}
        FOR UPDATE`;

      if (!team) {
        return null;
      }

      if (team.assignmentStrategy !== TeamAssignmentStrategy.ROUND_ROBIN) {
        return null;
      }

      const members = await client.teamMember.findMany({
        where: { teamId },
        orderBy: { createdAt: 'asc' },
      });

      if (members.length === 0) {
        return null;
      }

      let nextMember = members[0];
      if (team.lastAssignedUserId) {
        const currentIndex = members.findIndex(
          (member) => member.userId === team.lastAssignedUserId,
        );
        if (currentIndex >= 0) {
          nextMember = members[(currentIndex + 1) % members.length];
        }
      }

      // Update round-robin state atomically within the same transaction
      await client.team.update({
        where: { id: teamId },
        data: { lastAssignedUserId: nextMember.userId },
      });

      return nextMember.userId;
    };

    if (tx) {
      return resolveWithClient(tx);
    }

    return this.prisma.$transaction(async (innerTx) =>
      resolveWithClient(innerTx),
    );
  }

  private async hasRoutingAssigneeColumn() {
    const now = Date.now();
    if (
      this.routingAssigneeColumnCache &&
      now - this.routingAssigneeColumnCache.checkedAtMs <=
        this.schemaCheckCacheTtlMs
    ) {
      return this.routingAssigneeColumnCache.exists;
    }

    const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'RoutingRule'
          AND column_name = 'assigneeId'
      ) AS "exists"
    `;

    this.routingAssigneeColumnCache = {
      exists: Boolean(rows[0]?.exists),
      checkedAtMs: now,
    };
    return this.routingAssigneeColumnCache.exists;
  }

  private async hasRoutingExpandedColumns() {
    const now = Date.now();
    if (
      this.routingExpandedColumnCache &&
      now - this.routingExpandedColumnCache.checkedAtMs <=
        this.schemaCheckCacheTtlMs
    ) {
      return this.routingExpandedColumnCache.exists;
    }

    const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'RoutingRule'
          AND column_name = 'conditions'
      ) AS "exists"
    `;

    this.routingExpandedColumnCache = {
      exists: Boolean(rows[0]?.exists),
      checkedAtMs: now,
    };
    return this.routingExpandedColumnCache.exists;
  }

  // ——— Delegations to extracted services ———

  async addAttachment(
    ticketId: string,
    file: Express.Multer.File | undefined,
    user: AuthUser,
  ) {
    return this.attachmentService.addAttachment(ticketId, file, user);
  }

  async getAttachmentFile(attachmentId: string, user: AuthUser) {
    return this.attachmentService.getAttachmentFile(attachmentId, user);
  }

  async updateAttachmentScanStatus(
    attachmentId: string,
    payload: UpdateAttachmentScanDto,
    scannerSecret: string | undefined,
  ) {
    return this.attachmentService.updateAttachmentScanStatus(
      attachmentId,
      payload,
      scannerSecret,
    );
  }

  async publishAutomationRealtimeUpdate(
    ticketId: string,
    actorId: string | null,
  ) {
    return this.ticketRealtime.publishAutomationRealtimeUpdate(
      ticketId,
      actorId,
    );
  }

  async ingestInboundEmail(
    payload: IngestInboundEmailDto,
    inboundSecret: string | undefined,
  ) {
    return this.inboundEmailService.ingestInboundEmail(payload, inboundSecret);
  }
}
