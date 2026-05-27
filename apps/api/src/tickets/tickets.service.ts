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
  Prisma,
  TagSource,
  TeamAssignmentStrategy,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import type { Express } from 'express';
import { AuthUser } from '../auth/current-user.decorator';
import { AccessControlService } from '../common/access-control.service';
import { AutomationQueueService } from '../common/automation-queue.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TicketAttachmentService } from './ticket-attachment.service';
import { TicketRealtimeService } from './ticket-realtime.service';
import { TicketSlaCalculationService } from './ticket-sla-calculation.service';
import { InboundEmailService } from './inbound-email.service';
import { TagsService } from '../tags/tags.service';
import { SlaEngineService } from '../slas/sla-engine.service';
import { parsePositiveInt } from '../common/config.utils';
import { AddTicketMessageDto } from './dto/add-ticket-message.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { BulkAssignDto } from './dto/bulk-assign.dto';
import { BulkPriorityDto } from './dto/bulk-priority.dto';
import { BulkStatusDto } from './dto/bulk-status.dto';
import { BulkTransferDto } from './dto/bulk-transfer.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { IngestInboundEmailDto } from './dto/ingest-inbound-email.dto';
import { ListTicketsDto } from './dto/list-tickets.dto';
import { TicketActivityDto } from './dto/ticket-activity.dto';
import { TicketStatusDto } from './dto/ticket-status.dto';
import { TransitionTicketDto } from './dto/transition-ticket.dto';
import { TransferTicketDto } from './dto/transfer-ticket.dto';
import { UpdateAttachmentScanDto } from './dto/update-attachment-scan.dto';

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
    @Inject(forwardRef(() => InboundEmailService))
    private readonly inboundEmailService: InboundEmailService,
    private readonly tagsService: TagsService,
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
  private readonly DEFAULT_STATUS_TRANSITIONS: Record<
    TicketStatus,
    TicketStatus[]
  > = {
    [TicketStatus.NEW]: [TicketStatus.TRIAGED, TicketStatus.ASSIGNED],
    [TicketStatus.TRIAGED]: [TicketStatus.ASSIGNED],
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
  private accessConditionSql(user: AuthUser, alias = 't'): Prisma.Sql {
    return this.accessControl.accessConditionSql(user, alias);
  }

  async list(query: ListTicketsDto, user: AuthUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

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
      const riskEnd = new Date(now.getTime() + 4 * 60 * 60 * 1000);
      const slaConditions: Prisma.TicketWhereInput[] = [];
      const notWaiting = { status: { notIn: this.WAITING_STATUSES } };
      if (slaStatus.includes('breached')) {
        slaConditions.push({
          AND: [
            { completedAt: null },
            { dueAt: { not: null, lt: now } },
            notWaiting,
          ],
        });
      }
      if (slaStatus.includes('at_risk')) {
        slaConditions.push({
          AND: [
            { completedAt: null },
            { dueAt: { not: null, gte: now, lte: riskEnd } },
            notWaiting,
          ],
        });
      }
      if (slaStatus.includes('on_track')) {
        slaConditions.push({
          AND: [
            { completedAt: null },
            { dueAt: { not: null, gt: riskEnd } },
            notWaiting,
          ],
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
        if (Number.isSafeInteger(parsed)) {
          searchFilters.push({ number: parsed });
        }
      }
      filters.push({ OR: searchFilters });
    }

    filters.push(this.buildAccessFilter(user));

    const where = filters.length > 1 ? { AND: filters } : (filters[0] ?? {});

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
          completedAt: true,
          dueAt: true,
          firstResponseDueAt: true,
          firstResponseAt: true,
          slaPausedAt: true,
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

    return {
      data: data.map((ticket) => ({
        ...ticket,
        allowedTransitions: this.getAvailableTransitionsForTicket(
          ticket.status,
          ticket.assignee?.id ?? null,
        ),
      })),
      meta: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  /** Returns ticket counts for the user; result is cached briefly (PERF-02, see CACHE_SUMMARY_TTL_MS). */
  async getCounts(user: AuthUser): Promise<{
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
  }> {
    const ttlMs = parsePositiveInt(process.env.CACHE_SUMMARY_TTL_MS, 45_000);
    const key = `tickets:counts:${user.id}`;
    const cached =
      await this.cache.get<Awaited<ReturnType<TicketsService['getCounts']>>>(
        key,
      );
    if (cached != null) return cached;

    const result = await this.getCountsUncached(user);
    await this.cache.set(key, result, ttlMs);
    return result;
  }

  private async getCountsUncached(user: AuthUser): Promise<{
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
  }> {
    const now = new Date();
    const atRiskThresholdMinutes = parsePositiveInt(
      process.env.SLA_AT_RISK_THRESHOLD_MINUTES,
      120,
    );
    const riskEnd = new Date(now.getTime() + atRiskThresholdMinutes * 60_000);
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
          WHEN (t."status")::text NOT IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
            AND (t."status")::text NOT IN (${TicketStatus.WAITING_ON_REQUESTER}, ${TicketStatus.WAITING_ON_VENDOR})
            AND t."dueAt" IS NOT NULL
            AND t."dueAt" >= ${now}
            AND t."dueAt" <= ${riskEnd}
          THEN 1 ELSE 0 END) AS "atRisk"
        ,
        SUM(CASE
          WHEN (t."status")::text NOT IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
            AND (t."status")::text NOT IN (${TicketStatus.WAITING_ON_REQUESTER}, ${TicketStatus.WAITING_ON_VENDOR})
            AND t."dueAt" IS NOT NULL
            AND t."dueAt" < ${now}
          THEN 1 ELSE 0 END) AS "overdue"
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

    if (!this.canViewTicket(user, ticket)) {
      throw new ForbiddenException('No access to this ticket');
    }

    const [followers, attachments, customFieldValues] = await Promise.all([
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
      allowedTransitions: this.getAvailableTransitionsForTicket(
        rest.status,
        rest.assigneeId,
      ),
    };
  }

  /**
   * List messages for a ticket. Access check and data query are combined
   * into a single query using buildTicketAccessFilter to eliminate an N+1 round trip.
   */
  async listMessages(
    ticketId: string,
    user: AuthUser,
    take = 50,
    cursor?: string,
  ) {
    // Single query: verify ticket exists AND user has access
    const accessibleTicket = await this.prisma.ticket.findFirst({
      where: {
        id: ticketId,
        ...this.accessControl.buildTicketAccessFilter(user),
      },
      select: { id: true },
    });

    if (!accessibleTicket) {
      // Distinguish "not found" from "forbidden"
      const exists = await this.prisma.ticket.count({
        where: { id: ticketId },
      });
      if (!exists) throw new NotFoundException('Ticket not found');
      throw new ForbiddenException('No access to this ticket');
    }

    const limit = Math.max(1, Math.min(100, take));
    const where: Prisma.TicketMessageWhereInput = {
      ticketId,
      ...(user.role === UserRole.EMPLOYEE ? { type: MessageType.PUBLIC } : {}),
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

    return {
      data: page.reverse(),
      nextCursor,
    };
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
    const accessibleTicket = await this.prisma.ticket.findFirst({
      where: {
        id: ticketId,
        ...this.accessControl.buildTicketAccessFilter(user),
      },
      select: { id: true },
    });

    if (!accessibleTicket) {
      const exists = await this.prisma.ticket.count({
        where: { id: ticketId },
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
    options?: { skipRequiredCustomFields?: boolean; tagSource?: TagSource },
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
            tx,
          )
        : null;
      const resolutionDueAt = sla
        ? await this.slaCalc.addSlaHours(
            ticket.createdAt,
            sla.resolutionHours,
            sla.businessHoursOnly,
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

    await this.safeNotify(() =>
      this.notifications.ticketCreated(updatedTicket, user),
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

  async addMessage(
    ticketId: string,
    payload: AddTicketMessageDto,
    user: AuthUser,
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

    if (user.role === UserRole.EMPLOYEE) {
      if (ticket.requesterId !== user.id) {
        throw new ForbiddenException(
          'Requesters can only reply to their own tickets',
        );
      }
      if (payload.type && payload.type !== 'PUBLIC') {
        throw new ForbiddenException('Requesters can only add public replies');
      }
    }

    if (!this.accessControl.canPostMessage(user, ticket)) {
      throw new ForbiddenException('No write access to this ticket');
    }

    // Peer agents (same team, not the assignee) can only leave INTERNAL notes.
    // We override silently regardless of what the client sent — the UI also
    // hides the toggle, but defense-in-depth.
    const isPeerAgent = this.accessControl.isPeerAgent(user, ticket);
    const effectiveType: MessageType = isPeerAgent
      ? MessageType.INTERNAL
      : (payload.type ?? MessageType.PUBLIC);

    const shouldSetFirstResponse =
      user.role !== UserRole.EMPLOYEE &&
      effectiveType === MessageType.PUBLIC;

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
          if (isInternalMessage && u.role === UserRole.EMPLOYEE) {
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
      if (allowedMentionedIds.length > 0) {
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
    await this.safeNotify(() =>
      this.notifications.messageAdded(ticketId, message, user),
    );
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

    const firstStart = ticket.firstResponseDueAt
      ? await this.slaCalc.subtractSlaHours(
          ticket.firstResponseDueAt,
          oldSla.firstResponseHours,
          oldSla.businessHoursOnly,
          tx,
        )
      : ticket.createdAt;
    const resolutionStart = ticket.dueAt
      ? await this.slaCalc.subtractSlaHours(
          ticket.dueAt,
          oldSla.resolutionHours,
          oldSla.businessHoursOnly,
          tx,
        )
      : ticket.createdAt;

    const firstResponseDueAt = await this.slaCalc.addSlaHours(
      firstStart,
      newSla.firstResponseHours,
      newSla.businessHoursOnly,
      tx,
    );
    const dueAt = await this.slaCalc.addSlaHours(
      resolutionStart,
      newSla.resolutionHours,
      newSla.businessHoursOnly,
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
      throw new ForbiddenException('Requesters cannot transition tickets');
    }

    if (!this.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to transition this ticket');
    }

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

  async applyStatusTransitionInTx(
    tx: Prisma.TransactionClient,
    ticket: StatusTransitionTicketSnapshot,
    newStatus: TicketStatus,
    actorId: string,
  ) {
    if (!this.isValidTransition(ticket.status, newStatus)) {
      throw new ForbiddenException('Invalid status transition');
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

    const updateData: Prisma.TicketUpdateInput = {
      status: newStatus,
      resolvedAt,
      closedAt,
      completedAt,
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

  /** Concurrency limit for bulk operations to avoid overwhelming the database. */
  private static readonly BULK_CONCURRENCY = 5;

  private async runBulkWithConcurrency<T>(
    items: string[],
    operation: (ticketId: string) => Promise<T>,
  ) {
    // Deduplicate to prevent concurrent mutations on the same ticket (TICKET-005)
    const uniqueItems = [...new Set(items)];

    const results = {
      success: 0,
      failed: 0,
      succeededTicketIds: [] as string[],
      failedTicketIds: [] as string[],
      errors: [] as { ticketId: string; message: string }[],
    };
    const executing = new Set<Promise<void>>();

    for (const ticketId of uniqueItems) {
      const task = (async () => {
        try {
          await operation(ticketId);
          results.success++;
          results.succeededTicketIds.push(ticketId);
        } catch (err: unknown) {
          results.failed++;
          results.failedTicketIds.push(ticketId);
          const message = err instanceof Error ? err.message : 'Unknown error';
          results.errors.push({ ticketId, message });
        }
      })();

      executing.add(task);
      void task.finally(() => executing.delete(task));

      if (executing.size >= TicketsService.BULK_CONCURRENCY) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return { data: results };
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
          )
        : ticket.createdAt;
      const resolutionStart = ticket.dueAt
        ? await this.slaCalc.subtractSlaHours(
            ticket.dueAt,
            oldSla.resolutionHours,
            oldSla.businessHoursOnly,
          )
        : ticket.createdAt;

      const firstResponseDueAt = await this.slaCalc.addSlaHours(
        firstStart,
        newSla.firstResponseHours,
        newSla.businessHoursOnly,
      );
      const dueAt = await this.slaCalc.addSlaHours(
        resolutionStart,
        newSla.resolutionHours,
        newSla.businessHoursOnly,
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
    const canManageFollowers =
      user.role === UserRole.OWNER ||
      user.role === UserRole.TEAM_ADMIN ||
      user.role === UserRole.LEAD;

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
    const canManageFollowers =
      user.role === UserRole.OWNER ||
      user.role === UserRole.TEAM_ADMIN ||
      user.role === UserRole.LEAD;

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
    const yyyy = createdAt.getFullYear();
    const mm = String(createdAt.getMonth() + 1).padStart(2, '0');
    const dd = String(createdAt.getDate()).padStart(2, '0');
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
    const legacyText = `${evalCtx.subject} ${evalCtx.description}`.toLowerCase();

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
