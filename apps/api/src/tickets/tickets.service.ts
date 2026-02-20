import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccessLevel,
  AttachmentScanStatus,
  MessageType,
  Prisma,
  TeamAssignmentStrategy,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import type { Express } from 'express';
import { createReadStream, promises as fs } from 'fs';
import path from 'path';
import { AuthUser } from '../auth/current-user.decorator';
import { AccessControlService } from '../common/access-control.service';
import { AutomationQueueService } from '../common/automation-queue.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SlaEngineService } from '../slas/sla-engine.service';
import { AddTicketMessageDto } from './dto/add-ticket-message.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { BulkAssignDto } from './dto/bulk-assign.dto';
import { BulkPriorityDto } from './dto/bulk-priority.dto';
import { BulkStatusDto } from './dto/bulk-status.dto';
import { BulkTransferDto } from './dto/bulk-transfer.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsDto } from './dto/list-tickets.dto';
import { TicketActivityDto } from './dto/ticket-activity.dto';
import { TicketStatusDto } from './dto/ticket-status.dto';
import { TransitionTicketDto } from './dto/transition-ticket.dto';
import { TransferTicketDto } from './dto/transfer-ticket.dto';

export type StatusTransitionTicketSnapshot = {
  id: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignedTeamId: string | null;
  dueAt: Date | null;
  slaPausedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  completedAt: Date | null;
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
  ) {}

  private defaultSlaConfig: Record<
    TicketPriority,
    { firstResponseHours: number; resolutionHours: number }
  > = {
    [TicketPriority.P1]: { firstResponseHours: 1, resolutionHours: 4 },
    [TicketPriority.P2]: { firstResponseHours: 4, resolutionHours: 24 },
    [TicketPriority.P3]: { firstResponseHours: 8, resolutionHours: 72 },
    [TicketPriority.P4]: { firstResponseHours: 24, resolutionHours: 168 },
  };

  private readonly WAITING_STATUSES = [
    TicketStatus.WAITING_ON_REQUESTER,
    TicketStatus.WAITING_ON_VENDOR,
  ];
  private readonly STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
    [TicketStatus.NEW]: [
      TicketStatus.TRIAGED,
      TicketStatus.ASSIGNED,
      TicketStatus.IN_PROGRESS,
      TicketStatus.WAITING_ON_REQUESTER,
      TicketStatus.WAITING_ON_VENDOR,
      TicketStatus.RESOLVED,
      TicketStatus.CLOSED,
    ],
    [TicketStatus.TRIAGED]: [
      TicketStatus.ASSIGNED,
      TicketStatus.IN_PROGRESS,
      TicketStatus.WAITING_ON_REQUESTER,
      TicketStatus.WAITING_ON_VENDOR,
      TicketStatus.RESOLVED,
      TicketStatus.CLOSED,
    ],
    [TicketStatus.ASSIGNED]: [
      TicketStatus.IN_PROGRESS,
      TicketStatus.WAITING_ON_REQUESTER,
      TicketStatus.WAITING_ON_VENDOR,
      TicketStatus.RESOLVED,
      TicketStatus.CLOSED,
    ],
    [TicketStatus.IN_PROGRESS]: [
      TicketStatus.WAITING_ON_REQUESTER,
      TicketStatus.WAITING_ON_VENDOR,
      TicketStatus.RESOLVED,
      TicketStatus.CLOSED,
    ],
    [TicketStatus.WAITING_ON_REQUESTER]: [
      TicketStatus.IN_PROGRESS,
      TicketStatus.RESOLVED,
      TicketStatus.CLOSED,
    ],
    [TicketStatus.WAITING_ON_VENDOR]: [
      TicketStatus.IN_PROGRESS,
      TicketStatus.RESOLVED,
      TicketStatus.CLOSED,
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
      TicketStatus.CLOSED,
    ],
  };

  private defaultActivityDays = 7;
  private routingAssigneeColumnCache: {
    exists: boolean;
    checkedAtMs: number;
  } | null = null;
  private readonly schemaCheckCacheTtlMs = this.parsePositiveIntEnv(
    process.env.SCHEMA_CHECK_CACHE_TTL_MS,
    300_000,
  );

  // ——— File upload security (4.1 fix) ———

  /** Allowed file extensions for attachments. */
  private static readonly ALLOWED_EXTENSIONS = new Set([
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.txt',
    '.csv',
    '.rtf',
    '.odt',
    '.ods',
    '.odp',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.bmp',
    '.svg',
    '.webp',
    '.ico',
    '.zip',
    '.rar',
    '.7z',
    '.tar',
    '.gz',
    '.eml',
    '.msg',
    '.json',
    '.xml',
    '.yaml',
    '.yml',
    '.mp4',
    '.mp3',
    '.wav',
    '.avi',
    '.mov',
    '.webm',
    '.log',
  ]);

  /** Map common MIME types to their expected file extensions. */
  private static readonly MIME_TO_EXTENSIONS: Record<string, string[]> = {
    'application/pdf': ['.pdf'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
      '.docx',
    ],
    'application/vnd.ms-excel': ['.xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
      '.xlsx',
    ],
    'application/vnd.ms-powerpoint': ['.ppt'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      ['.pptx'],
    'text/plain': ['.txt', '.csv', '.log', '.yaml', '.yml'],
    'text/csv': ['.csv'],
    'text/xml': ['.xml'],
    'application/json': ['.json'],
    'application/xml': ['.xml'],
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/gif': ['.gif'],
    'image/bmp': ['.bmp'],
    'image/svg+xml': ['.svg'],
    'image/webp': ['.webp'],
    'image/x-icon': ['.ico'],
    'application/zip': ['.zip'],
    'application/x-rar-compressed': ['.rar'],
    'application/x-7z-compressed': ['.7z'],
    'application/gzip': ['.gz'],
    'application/x-tar': ['.tar'],
    'video/mp4': ['.mp4'],
    'audio/mpeg': ['.mp3'],
    'audio/wav': ['.wav'],
    'video/x-msvideo': ['.avi'],
    'video/quicktime': ['.mov'],
    'video/webm': ['.webm'],
    'application/octet-stream': [], // generic fallback – allow if extension is whitelisted
  };

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

    const [total, data] = await Promise.all([
      this.prisma.ticket.count({ where }),
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

    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getCounts(user: AuthUser): Promise<{
    assignedToMe: number;
    triage: number;
    open: number;
    unassigned: number;
  }> {
    const accessCondition = this.accessConditionSql(user, 't');
    const rows = await this.prisma.$queryRaw<
      {
        assignedToMe: bigint;
        triage: bigint;
        open: bigint;
        unassigned: bigint;
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
      FROM "Ticket" t
      WHERE ${accessCondition}
    `;

    const row = rows[0] ?? {
      assignedToMe: 0n,
      triage: 0n,
      open: 0n,
      unassigned: 0n,
    };
    return {
      assignedToMe: Number(row.assignedToMe ?? 0),
      triage: Number(row.triage ?? 0),
      open: Number(row.open ?? 0),
      unassigned: Number(row.unassigned ?? 0),
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
      [TicketPriority.P1]: 0,
      [TicketPriority.P2]: 0,
      [TicketPriority.P3]: 0,
      [TicketPriority.P4]: 0,
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
        followers: {
          include: { user: true },
          orderBy: { createdAt: 'asc' },
        },
        attachments: {
          include: { uploadedBy: true },
          orderBy: { createdAt: 'asc' },
        },
        customFieldValues: {
          include: { customField: true },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (!this.canViewTicket(user, ticket)) {
      throw new ForbiddenException('No access to this ticket');
    }

    const { accessGrants, ...rest } = ticket;
    void accessGrants;
    return {
      ...rest,
      allowedTransitions: this.getAvailableTransitions(rest.status),
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

  async create(payload: CreateTicketDto, user: AuthUser) {
    const requesterId = payload.requesterId ?? user.id;

    if (user.role === UserRole.EMPLOYEE && requesterId !== user.id) {
      throw new ForbiddenException(
        'Requesters can only create their own tickets',
      );
    }

    const routedTarget = payload.assignedTeamId
      ? { teamId: payload.assignedTeamId, assigneeId: null }
      : await this.routeTarget(payload.subject, payload.description);
    const routedTeamId = routedTarget?.teamId ?? null;
    const routedAssigneeId = routedTarget?.assigneeId ?? null;

    const updatedTicket = await this.prisma.$transaction(async (tx) => {
      let resolvedAssigneeId = payload.assigneeId ?? routedAssigneeId;
      if (!payload.assigneeId && !resolvedAssigneeId) {
        resolvedAssigneeId = await this.resolveAssignee(routedTeamId, tx);
      }

      const validatedCustomValues =
        await this.customFieldsService.validateAndNormalizeValuesForTicket(
          payload.customFieldValues ?? [],
          routedTeamId,
          payload.categoryId ?? null,
          { requireAllRequired: true, tx },
        );

      const ticket = await tx.ticket.create({
        data: {
          subject: payload.subject,
          description: payload.description,
          priority: payload.priority,
          channel: payload.channel,
          requesterId,
          assignedTeamId: routedTeamId,
          assigneeId: resolvedAssigneeId,
          categoryId: payload.categoryId,
          status: TicketStatus.NEW,
        },
        include: {
          requester: true,
          assignee: true,
          assignedTeam: true,
        },
      });

      const displayId = this.buildDisplayId(
        ticket.assignedTeam?.name ?? null,
        ticket.createdAt,
        ticket.number,
      );
      const sla = await this.getSlaConfig(
        ticket.priority,
        ticket.assignedTeamId,
        tx,
      );
      const firstResponseDueAt = sla
        ? this.addHours(ticket.createdAt, sla.firstResponseHours)
        : null;
      const resolutionDueAt = sla
        ? this.addHours(ticket.createdAt, sla.resolutionHours)
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
      }

      for (const item of validatedCustomValues) {
        await tx.customFieldValue.create({
          data: {
            ticketId: ticket.id,
            customFieldId: item.customFieldId,
            value: item.value,
          },
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

    // Queue automation with retry via BullMQ instead of fire-and-forget
    void this.automationQueue.enqueue(updatedTicket.id, 'TICKET_CREATED');

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

    if (!this.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to this ticket');
    }

    const shouldSetFirstResponse =
      user.role !== UserRole.EMPLOYEE &&
      (payload.type ?? MessageType.PUBLIC) === MessageType.PUBLIC;

    const now = new Date();
    const message = await this.prisma.$transaction(async (tx) => {
      const createdMessage = await tx.ticketMessage.create({
        data: {
          ticketId,
          authorId: user.id,
          body: payload.body,
          type: payload.type,
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

    return message;
  }

  async assign(ticketId: string, payload: AssignTicketDto, user: AuthUser) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { assignedTeam: true },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (!this.canAssignTicket(user, ticket, payload.assigneeId)) {
      throw new ForbiddenException('Not allowed to assign this ticket');
    }

    const assigneeId = payload.assigneeId ?? user.id;
    if (ticket.assignedTeamId) {
      const membership = await this.prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: ticket.assignedTeamId,
            userId: assigneeId,
          },
        },
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
    const shouldSetAssignedStatus = assignStatusPromote.includes(ticket.status);
    const nextStatus = shouldSetAssignedStatus
      ? TicketStatus.ASSIGNED
      : ticket.status;

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedTicket = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          assigneeId,
          status: nextStatus,
        },
        include: {
          requester: true,
          assignee: true,
          assignedTeam: true,
        },
      });

      await tx.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          type: 'TICKET_ASSIGNED',
          payload: {
            assigneeId,
            assigneeName: updatedTicket.assignee?.displayName ?? null,
            assigneeEmail: updatedTicket.assignee?.email ?? null,
          },
          createdById: user.id,
        },
      });

      if (nextStatus !== ticket.status) {
        await tx.ticketEvent.create({
          data: {
            ticketId: ticket.id,
            type: 'TICKET_STATUS_CHANGED',
            payload: {
              from: ticket.status,
              to: nextStatus,
            },
            createdById: user.id,
          },
        });
      }

      await this.ensureFollower(ticketId, assigneeId, tx);
      return updatedTicket;
    });
    await this.safeNotify(() =>
      this.notifications.ticketAssigned(updated, user),
    );

    return updated;
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

    if (ticket.assignedTeamId && ticket.assignedTeamId === payload.newTeamId) {
      throw new BadRequestException('Ticket is already assigned to that team');
    }

    const targetTeam = await this.prisma.team.findUnique({
      where: { id: payload.newTeamId },
    });
    if (!targetTeam) {
      throw new BadRequestException('Target team not found');
    }

    if (payload.assigneeId) {
      const membership = await this.prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: payload.newTeamId,
            userId: payload.assigneeId,
          },
        },
      });
      if (!membership) {
        throw new BadRequestException(
          'Assignee must belong to the target team',
        );
      }
    }

    const priorTeamId = ticket.assignedTeamId;
    const oldSla = await this.getSlaConfig(ticket.priority, priorTeamId);
    const newSla = await this.getSlaConfig(ticket.priority, payload.newTeamId);

    const firstStart = ticket.firstResponseDueAt
      ? this.addHours(ticket.firstResponseDueAt, -oldSla.firstResponseHours)
      : ticket.createdAt;
    const resolutionStart = ticket.dueAt
      ? this.addHours(ticket.dueAt, -oldSla.resolutionHours)
      : ticket.createdAt;

    const firstResponseDueAt = this.addHours(
      firstStart,
      newSla.firstResponseHours,
    );
    const dueAt = this.addHours(resolutionStart, newSla.resolutionHours);

    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        assignedTeamId: payload.newTeamId,
        assigneeId: payload.assigneeId ?? null,
        firstResponseDueAt,
        dueAt,
      },
      include: {
        requester: true,
        assignee: true,
        assignedTeam: true,
      },
    });

    if (priorTeamId && priorTeamId !== payload.newTeamId) {
      await this.prisma.ticketAccess.upsert({
        where: {
          ticketId_teamId: {
            ticketId,
            teamId: priorTeamId,
          },
        },
        update: { accessLevel: AccessLevel.READ },
        create: {
          ticketId,
          teamId: priorTeamId,
          accessLevel: AccessLevel.READ,
        },
      });

      await this.prisma.ticketAccess.deleteMany({
        where: {
          ticketId,
          teamId: payload.newTeamId,
        },
      });
    }

    await this.prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'TICKET_TRANSFERRED',
        payload: {
          fromTeamId: priorTeamId,
          toTeamId: payload.newTeamId,
          toTeamName: updated.assignedTeam?.name ?? null,
          assigneeId: payload.assigneeId ?? null,
        },
        createdById: user.id,
      },
    });

    if (payload.assigneeId) {
      await this.ensureFollower(ticketId, payload.assigneeId);
    }
    await this.slaEngine.syncFromTicket(ticketId, {
      policyConfigId: newSla.policyConfigId ?? null,
    });
    await this.safeNotify(() =>
      this.notifications.ticketTransferred(updated, user, priorTeamId),
    );

    return updated;
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

    // Queue automation with retry via BullMQ instead of fire-and-forget
    void this.automationQueue.enqueue(ticketId, 'STATUS_CHANGED');

    return updated;
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
      const sla = await this.getSlaConfig(
        ticket.priority,
        ticket.assignedTeamId,
        tx,
      );
      updateData.dueAt = this.addHours(now, sla.resolutionHours);
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
    const results = {
      success: 0,
      failed: 0,
      errors: [] as { ticketId: string; message: string }[],
    };
    const executing = new Set<Promise<void>>();

    for (const ticketId of items) {
      const task = (async () => {
        try {
          await operation(ticketId);
          results.success++;
        } catch (err: unknown) {
          results.failed++;
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
      const oldSla = await this.getSlaConfig(
        ticket.priority,
        ticket.assignedTeamId,
      );
      const newSla = await this.getSlaConfig(
        payload.priority,
        ticket.assignedTeamId,
      );

      // Derive SLA start from current cycle so reopened/paused tickets and due dates are preserved
      const firstStart = ticket.firstResponseDueAt
        ? this.addHours(ticket.firstResponseDueAt, -oldSla.firstResponseHours)
        : ticket.createdAt;
      const resolutionStart = ticket.dueAt
        ? this.addHours(ticket.dueAt, -oldSla.resolutionHours)
        : ticket.createdAt;

      const firstResponseDueAt = this.addHours(
        firstStart,
        newSla.firstResponseHours,
      );
      const dueAt = this.addHours(resolutionStart, newSla.resolutionHours);

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

    return { id: targetUserId };
  }

  async addAttachment(
    ticketId: string,
    file: Express.Multer.File | undefined,
    user: AuthUser,
  ) {
    if (!file) {
      throw new BadRequestException('Attachment file is required');
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { accessGrants: true },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (!this.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to this ticket');
    }

    // ——— Validate file type before anything else (4.1 fix) ———
    this.validateFileUpload(file);

    const maxMb = Number(this.config.get<string>('ATTACHMENTS_MAX_MB') ?? '10');
    const maxBytes = maxMb * 1024 * 1024;
    if (Number.isFinite(maxBytes) && file.size > maxBytes) {
      throw new BadRequestException(`Attachment exceeds ${maxMb}MB limit`);
    }

    const attachmentId = randomUUID();
    const safeName = this.sanitizeFileName(file.originalname);
    const storageKey = path.posix.join(ticketId, `${attachmentId}-${safeName}`);
    const filePath = this.resolveAttachmentPath(storageKey);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.buffer);

    // scanStatus set to PENDING – a background scanning service should
    // transition it to CLEAN or INFECTED after analysis (4.1 fix).
    const attachment = await this.prisma.attachment.create({
      data: {
        id: attachmentId,
        ticketId,
        uploadedById: user.id,
        fileName: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        scanStatus: AttachmentScanStatus.PENDING,
        scanCheckedAt: null,
      },
      include: { uploadedBy: true },
    });

    await this.prisma.ticketEvent.create({
      data: {
        ticketId,
        type: 'ATTACHMENT_ADDED',
        payload: {
          attachmentId: attachment.id,
          fileName: attachment.fileName,
          sizeBytes: attachment.sizeBytes,
          contentType: attachment.contentType,
        },
        createdById: user.id,
      },
    });

    return attachment;
  }

  async getAttachmentFile(attachmentId: string, user: AuthUser) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        ticket: {
          include: { accessGrants: true },
        },
      },
    });

    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    if (!this.canViewTicket(user, attachment.ticket)) {
      throw new ForbiddenException('No access to this attachment');
    }

    const filePath = this.resolveAttachmentPath(attachment.storageKey);
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('Attachment file missing');
    }

    return {
      attachment,
      stream: createReadStream(filePath),
    };
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
    assigneeId?: string,
  ) {
    if (user.role === UserRole.OWNER) {
      return true;
    }

    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      return ticket.assignedTeamId === user.primaryTeamId;
    }

    if (!user.teamId || ticket.assignedTeamId !== user.teamId) {
      return false;
    }

    if (user.role === UserRole.LEAD) {
      return true;
    }

    const isSelfAssign = !assigneeId || assigneeId === user.id;

    if (!isSelfAssign) {
      return false;
    }

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

  private isPauseStatus(status: TicketStatus) {
    return (
      status === TicketStatus.WAITING_ON_REQUESTER ||
      status === TicketStatus.WAITING_ON_VENDOR
    );
  }

  private async getSlaConfig(
    priority: TicketPriority,
    teamId: string | null,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    if (teamId) {
      const assignedRows = await client.$queryRaw<
        Array<{
          policyConfigId: string;
          firstResponseHours: number;
          resolutionHours: number;
        }>
      >`
        SELECT
          p."id" AS "policyConfigId",
          t."firstResponseHours" AS "firstResponseHours",
          t."resolutionHours" AS "resolutionHours"
        FROM "SlaPolicyAssignment" a
        INNER JOIN "SlaPolicyConfig" p ON p."id" = a."policyConfigId"
        INNER JOIN "SlaPolicyConfigTarget" t
          ON t."policyConfigId" = p."id"
         AND t."priority" = ${priority}::"TicketPriority"
        WHERE a."teamId" = ${teamId}
          AND p."enabled" = true
        ORDER BY a."updatedAt" DESC
        LIMIT 1
      `;
      if (assignedRows[0]) {
        return assignedRows[0];
      }
    }

    const defaultRows = await client.$queryRaw<
      Array<{
        policyConfigId: string;
        firstResponseHours: number;
        resolutionHours: number;
      }>
    >`
      SELECT
        p."id" AS "policyConfigId",
        t."firstResponseHours" AS "firstResponseHours",
        t."resolutionHours" AS "resolutionHours"
      FROM "SlaPolicyConfig" p
      INNER JOIN "SlaPolicyConfigTarget" t
        ON t."policyConfigId" = p."id"
       AND t."priority" = ${priority}::"TicketPriority"
      WHERE p."isDefault" = true
        AND p."enabled" = true
      ORDER BY p."updatedAt" DESC
      LIMIT 1
    `;
    if (defaultRows[0]) {
      return defaultRows[0];
    }

    return {
      policyConfigId: null,
      ...this.defaultSlaConfig[priority],
    };
  }

  private addHours(date: Date, hours: number) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
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

  private async routeTarget(subject: string, description: string) {
    const text = `${subject} ${description}`.toLowerCase();
    const includeAssignee = await this.hasRoutingAssigneeColumn();
    const rules = includeAssignee
      ? await this.prisma.$queryRaw<
          Array<{
            teamId: string;
            assigneeId: string | null;
            name: string;
            keywords: string[];
          }>
        >`
          SELECT "teamId", "assigneeId", "name", "keywords"
          FROM "RoutingRule"
          WHERE "isActive" = true
          ORDER BY "priority" ASC, "name" ASC
        `
      : await this.prisma.$queryRaw<
          Array<{
            teamId: string;
            assigneeId: string | null;
            name: string;
            keywords: string[];
          }>
        >`
          SELECT "teamId", NULL::text AS "assigneeId", "name", "keywords"
          FROM "RoutingRule"
          WHERE "isActive" = true
          ORDER BY "priority" ASC, "name" ASC
        `;

    for (const rule of rules) {
      const matches = rule.keywords.some((keyword) =>
        text.includes(keyword.toLowerCase()),
      );
      if (matches) {
        let assigneeId = rule.assigneeId ?? null;
        if (assigneeId) {
          const membership = await this.prisma.teamMember.findFirst({
            where: { teamId: rule.teamId, userId: assigneeId },
            select: { id: true },
          });
          if (!membership) {
            assigneeId = null;
          }
        }
        return { teamId: rule.teamId, assigneeId };
      }
    }

    return null;
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

  private resolveAttachmentPath(storageKey: string) {
    const baseDir =
      this.config.get<string>('ATTACHMENTS_DIR') ??
      path.join(process.cwd(), 'uploads');
    return path.join(baseDir, storageKey);
  }

  private sanitizeFileName(fileName: string) {
    return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  /**
   * Validate the uploaded file's extension against the whitelist and ensure
   * the claimed MIME type is consistent with the file extension.
   * Throws BadRequestException on any mismatch.
   */
  private validateFileUpload(file: Express.Multer.File): void {
    const ext = path.extname(file.originalname).toLowerCase();

    // 1. Extension whitelist
    if (!ext || !TicketsService.ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(
        `File type "${ext || '(none)'}" is not allowed. Accepted extensions: ${[...TicketsService.ALLOWED_EXTENSIONS].join(', ')}`,
      );
    }

    // 2. MIME ↔ extension consistency
    const mime = (file.mimetype ?? '').toLowerCase();
    const allowed = TicketsService.MIME_TO_EXTENSIONS[mime];
    if (allowed && allowed.length > 0 && !allowed.includes(ext)) {
      throw new BadRequestException(
        `MIME type "${mime}" does not match file extension "${ext}". Possible extension mismatch or spoofed file.`,
      );
    }

    // 3. Block dangerous MIME types regardless of extension
    const blockedMimes = [
      'application/x-msdownload',
      'application/x-executable',
      'application/x-dosexec',
      'application/x-msdos-program',
    ];
    if (blockedMimes.includes(mime)) {
      throw new BadRequestException(
        `Files with MIME type "${mime}" are not allowed.`,
      );
    }
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

  private parsePositiveIntEnv(
    raw: string | undefined,
    fallback: number,
  ): number {
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
