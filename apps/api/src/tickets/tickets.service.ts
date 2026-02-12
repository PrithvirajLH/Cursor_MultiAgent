import {
  BadRequestException,
  ForbiddenException,
  Injectable,
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
import { RuleEngineService } from '../automation/rule-engine.service';
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

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly slaEngine: SlaEngineService,
    private readonly customFieldsService: CustomFieldsService,
    private readonly ruleEngine: RuleEngineService,
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

  private defaultActivityDays = 7;

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
    if (Array.isArray(value)) return value.filter((v): v is T => v != null && v !== '');
    if (typeof value === 'string') return value.split(',').map((s) => s.trim() as T).filter(Boolean);
    return [];
  }

  private activityDateRange(from?: string, to?: string) {
    const now = new Date();
    const toBase = to ? new Date(to) : now;
    const toDateInclusive = new Date(Date.UTC(toBase.getUTCFullYear(), toBase.getUTCMonth(), toBase.getUTCDate()));
    const toEndExclusive = this.toEndExclusive(to ?? toDateInclusive.toISOString().slice(0, 10));
    const fromBase = from ? new Date(from) : new Date(toDateInclusive);
    if (!from) {
      fromBase.setUTCDate(fromBase.getUTCDate() - (this.defaultActivityDays - 1));
    }
    const fromDate = new Date(Date.UTC(fromBase.getUTCFullYear(), fromBase.getUTCMonth(), fromBase.getUTCDate()));
    return { fromDate, toEndExclusive, toDateInclusive };
  }

  private accessConditionSql(user: AuthUser, alias = 't'): Prisma.Sql {
    const col = (name: string) => Prisma.raw(`${alias}."${name}"`);
    const accessGrant = (teamId: string) =>
      Prisma.sql`EXISTS (SELECT 1 FROM "TicketAccess" ta WHERE ta."ticketId" = ${col('id')} AND ta."teamId" = ${teamId})`;

    if (user.role === UserRole.OWNER) {
      return Prisma.sql`TRUE`;
    }

    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      return Prisma.sql`(${col('assignedTeamId')} = ${user.primaryTeamId} OR ${accessGrant(user.primaryTeamId)})`;
    }

    if (user.role === UserRole.EMPLOYEE) {
      return Prisma.sql`${col('requesterId')} = ${user.id}`;
    }

    if (!user.teamId) {
      return Prisma.sql`${col('requesterId')} = ${user.id}`;
    }

    if (user.role === UserRole.LEAD) {
      return Prisma.sql`(${col('assignedTeamId')} = ${user.teamId} OR ${accessGrant(user.teamId)})`;
    }

    return Prisma.sql`((${col('assignedTeamId')} = ${user.teamId} AND (${col('assigneeId')} = ${user.id} OR ${col('assigneeId')} IS NULL)) OR ${accessGrant(user.teamId)})`;
  }

  async list(query: ListTicketsDto, user: AuthUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const statuses = this.toArray<string>(query.statuses as string | string[] | undefined);
    const priorities = this.toArray<string>(query.priorities as string | string[] | undefined);
    const teamIds = this.toArray<string>(query.teamIds as string | string[] | undefined);
    const assigneeIds = this.toArray<string>(query.assigneeIds as string | string[] | undefined);
    const requesterIds = this.toArray<string>(query.requesterIds as string | string[] | undefined);
    const slaStatus = this.toArray<string>(query.slaStatus as string | string[] | undefined);

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
      { assignedToMe: bigint; triage: bigint; open: bigint; unassigned: bigint }[]
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

    const row = rows[0] ?? { assignedToMe: 0n, triage: 0n, open: 0n, unassigned: 0n };
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
      this.prisma.ticket.count({ where: { AND: [accessFilter, resolvedFilter] } }),
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
    const { fromDate, toEndExclusive, toDateInclusive } = this.activityDateRange(query.from, query.to);
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
        date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10),
        open: Number(row.open),
        resolved: Number(row.resolved),
      })),
    };
  }

  async getStatusBreakdown(query: TicketStatusDto, user: AuthUser) {
    const { fromDate, toEndExclusive } = this.activityDateRange(query.from, query.to);
    const accessCondition = this.accessConditionSql(user, 't');
    const assigneeCondition =
      query.scope === 'assigned'
        ? Prisma.sql`AND t."assigneeId" = ${user.id}`
        : Prisma.empty;
    const dateField = query.dateField === 'updatedAt' ? 'updatedAt' : 'createdAt';
    const dateColumn = Prisma.raw(`t."${dateField}"`);

    const rows = await this.prisma.$queryRaw<{ status: TicketStatus; count: bigint }[]>`
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
    return rest;
  }

  async listMessages(ticketId: string, user: AuthUser, take = 50, cursor?: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { accessGrants: true },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (!this.canViewTicket(user, ticket)) {
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
    const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

    return {
      data: page.reverse(),
      nextCursor,
    };
  }

  async listEvents(ticketId: string, user: AuthUser, take = 50, cursor?: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { accessGrants: true },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (!this.canViewTicket(user, ticket)) {
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
    const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

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

    const routedTeamId =
      payload.assignedTeamId ??
      (await this.routeTeam(payload.subject, payload.description));
    const autoAssigneeId = payload.assigneeId
      ? null
      : await this.resolveAssignee(routedTeamId);
    const assigneeId = payload.assigneeId ?? autoAssigneeId;

    const updatedTicket = await this.prisma.$transaction(async (tx) => {
      const validatedCustomValues = await this.customFieldsService.validateAndNormalizeValuesForTicket(
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
          assigneeId,
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

      return updated;
    });

    const sla = await this.getSlaConfig(
      updatedTicket.priority,
      updatedTicket.assignedTeamId,
    );
    await this.slaEngine.syncFromTicket(updatedTicket.id, {
      policyId: sla?.policyId ?? null,
    });

    if (autoAssigneeId && routedTeamId) {
      try {
        await this.prisma.team.update({
          where: { id: routedTeamId },
          data: { lastAssignedUserId: autoAssigneeId },
        });
      } catch (error) {
        console.error('Failed to update round-robin state', error);
      }
    }

    if (assigneeId) {
      await this.prisma.ticketEvent.create({
        data: {
          ticketId: updatedTicket.id,
          type: 'TICKET_ASSIGNED',
          payload: {
            assigneeId,
            assigneeName: updatedTicket.assignee?.displayName ?? null,
            assigneeEmail: updatedTicket.assignee?.email ?? null,
          },
          createdById: user.id,
        },
      });
    }

    await this.safeNotify(() =>
      this.notifications.ticketCreated(updatedTicket, user),
    );

    this.ruleEngine.runForTicket(updatedTicket.id, 'TICKET_CREATED').catch((err) =>
      console.error('Automation TICKET_CREATED failed', err),
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

    if (!this.canWriteTicket(user, ticket)) {
      throw new ForbiddenException('No write access to this ticket');
    }

    const shouldSetFirstResponse =
      user.role !== UserRole.EMPLOYEE &&
      ticket.firstResponseAt === null &&
      (payload.type ?? MessageType.PUBLIC) === MessageType.PUBLIC;

    const now = new Date();

    const message = await this.prisma.ticketMessage.create({
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
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { firstResponseAt: now },
      });

      await this.slaEngine.syncFromTicket(ticketId);
    }

    await this.prisma.ticketEvent.create({
      data: {
        ticketId,
        type: 'MESSAGE_ADDED',
        payload: {
          messageId: message.id,
          type: message.type,
        },
        createdById: user.id,
      },
    });

    await this.ensureFollower(ticketId, user.id);

    // Parse mentions: (user:uuid) from markdown or data-user-id="uuid" from HTML (WYSIWYG)
    const markdownMentions = [...payload.body.matchAll(/\(user:([a-f0-9-]{36})\)/gi)].map((m) => m[1]);
    const htmlMentions = [...payload.body.matchAll(/data-user-id="([a-f0-9-]{36})"/gi)].map((m) => m[1]);
    const mentionedIds = [...new Set([...markdownMentions, ...htmlMentions])];
    const isInternalMessage = (payload.type ?? MessageType.PUBLIC) === MessageType.INTERNAL;
    let allowedMentionedIds: string[] = [];
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
          accessGrants: fullTicket.accessGrants.map((g) => ({ teamId: g.teamId })),
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
                    { id: u.id, email: u.email, role: u.role, teamId },
                    ticketForView,
                  ),
                )
              : this.canViewTicket(
                  { id: u.id, email: u.email, role: u.role, teamId: null },
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
          console.error(`Failed to add mention follower ${mentionedId} for ticket ${ticketId}`, err);
        }
      }
      if (allowedMentionedIds.length > 0) {
        await this.safeNotify(() =>
          this.notifications.notifyMentioned(ticketId, allowedMentionedIds, user.id, ticket.subject),
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
    const assignStatusPromote: TicketStatus[] = [
      TicketStatus.NEW,
      TicketStatus.TRIAGED,
      TicketStatus.REOPENED,
    ];
    const shouldSetAssignedStatus = assignStatusPromote.includes(ticket.status);
    const nextStatus = shouldSetAssignedStatus
      ? TicketStatus.ASSIGNED
      : ticket.status;

    const updated = await this.prisma.ticket.update({
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

    await this.prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'TICKET_ASSIGNED',
        payload: {
          assigneeId,
          assigneeName: updated.assignee?.displayName ?? null,
          assigneeEmail: updated.assignee?.email ?? null,
        },
        createdById: user.id,
      },
    });

    if (nextStatus !== ticket.status) {
      await this.prisma.ticketEvent.create({
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

    await this.ensureFollower(ticketId, assigneeId);
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

    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        assignedTeamId: payload.newTeamId,
        assigneeId: payload.assigneeId ?? null,
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

    if (!this.isValidTransition(ticket.status, payload.status)) {
      throw new ForbiddenException('Invalid status transition');
    }

    const now = new Date();
    const enteringPause =
      this.isPauseStatus(payload.status) && !this.isPauseStatus(ticket.status);
    const leavingPause =
      this.isPauseStatus(ticket.status) && !this.isPauseStatus(payload.status);

    const resolvedAt =
      payload.status === TicketStatus.RESOLVED
        ? new Date()
        : payload.status === TicketStatus.REOPENED
          ? null
          : ticket.resolvedAt;
    const closedAt =
      payload.status === TicketStatus.CLOSED
        ? new Date()
        : payload.status === TicketStatus.REOPENED
          ? null
          : ticket.closedAt;
    const completedAt =
      payload.status === TicketStatus.RESOLVED ||
      payload.status === TicketStatus.CLOSED
        ? new Date()
        : payload.status === TicketStatus.REOPENED
          ? null
          : (ticket.completedAt ?? null);

    const updateData: Prisma.TicketUpdateInput = {
      status: payload.status,
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

    const resetResolutionSla = payload.status === TicketStatus.REOPENED;
    if (resetResolutionSla) {
      const sla = await this.getSlaConfig(
        ticket.priority,
        ticket.assignedTeamId,
      );
      if (sla) {
        updateData.dueAt = this.addHours(now, sla.resolutionHours);
      }
    }

    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: updateData,
      include: {
        requester: true,
        assignee: true,
        assignedTeam: true,
      },
    });

    await this.prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'TICKET_STATUS_CHANGED',
        payload: {
          from: ticket.status,
          to: payload.status,
        },
        createdById: user.id,
      },
    });

    await this.slaEngine.syncFromTicket(ticket.id, {
      resetResolution: resetResolutionSla,
    });

    await this.safeNotify(() =>
      this.notifications.ticketStatusChanged(updated, ticket.status, user),
    );

    this.ruleEngine.runForTicket(ticketId, 'STATUS_CHANGED').catch((err) =>
      console.error('Automation STATUS_CHANGED failed', err),
    );

    return updated;
  }

  /** Bulk assign tickets. assigneeId optional = assign to self. */
  async bulkAssign(payload: BulkAssignDto, user: AuthUser) {
    const results = { success: 0, failed: 0, errors: [] as { ticketId: string; message: string }[] };
    for (const ticketId of payload.ticketIds) {
      try {
        await this.assign(ticketId, { assigneeId: payload.assigneeId }, user);
        results.success++;
      } catch (err: unknown) {
        results.failed++;
        const message = err instanceof Error ? err.message : 'Unknown error';
        results.errors.push({ ticketId, message });
      }
    }
    return results;
  }

  /** Bulk transfer tickets to a team. */
  async bulkTransfer(payload: BulkTransferDto, user: AuthUser) {
    const results = { success: 0, failed: 0, errors: [] as { ticketId: string; message: string }[] };
    for (const ticketId of payload.ticketIds) {
      try {
        await this.transfer(ticketId, { newTeamId: payload.newTeamId, assigneeId: payload.assigneeId }, user);
        results.success++;
      } catch (err: unknown) {
        results.failed++;
        const message = err instanceof Error ? err.message : 'Unknown error';
        results.errors.push({ ticketId, message });
      }
    }
    return results;
  }

  /** Bulk transition tickets to a status. */
  async bulkStatus(payload: BulkStatusDto, user: AuthUser) {
    const results = { success: 0, failed: 0, errors: [] as { ticketId: string; message: string }[] };
    for (const ticketId of payload.ticketIds) {
      try {
        await this.transition(ticketId, { status: payload.status }, user);
        results.success++;
      } catch (err: unknown) {
        results.failed++;
        const message = err instanceof Error ? err.message : 'Unknown error';
        results.errors.push({ ticketId, message });
      }
    }
    return results;
  }

  /** Bulk update ticket priority. Updates ticket, records event, and resyncs SLA instance. */
  async bulkPriority(payload: BulkPriorityDto, user: AuthUser) {
    if (user.role === UserRole.EMPLOYEE) {
      throw new ForbiddenException('Requesters cannot change ticket priority');
    }

    const results = { success: 0, failed: 0, errors: [] as { ticketId: string; message: string }[] };
    for (const ticketId of payload.ticketIds) {
      const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) {
        results.failed++;
        results.errors.push({ ticketId, message: 'Ticket not found' });
        continue;
      }
      if (!this.canWriteTicket(user, ticket)) {
        results.failed++;
        results.errors.push({ ticketId, message: 'No write access' });
        continue;
      }
      // getSlaConfig always returns a config object (team policy or default); never null
      const oldSla = await this.getSlaConfig(ticket.priority, ticket.assignedTeamId);
      const newSla = await this.getSlaConfig(payload.priority, ticket.assignedTeamId);

      // Derive SLA start from current cycle so reopened/paused tickets and due dates are preserved
      const firstStart =
        ticket.firstResponseDueAt
          ? this.addHours(ticket.firstResponseDueAt, -oldSla.firstResponseHours)
          : ticket.createdAt;
      const resolutionStart =
        ticket.dueAt
          ? this.addHours(ticket.dueAt, -oldSla.resolutionHours)
          : ticket.createdAt;

      const firstResponseDueAt = this.addHours(firstStart, newSla.firstResponseHours);
      const dueAt = this.addHours(resolutionStart, newSla.resolutionHours);

      try {
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
            { policyId: newSla.policyId ?? null },
            tx,
          );
        });
        results.success++;
      } catch (err: unknown) {
        results.failed++;
        const message = err instanceof Error ? err.message : 'Unknown error';
        results.errors.push({ ticketId, message });
      }
    }
    return results;
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

    const maxMb = Number(this.config.get<string>('ATTACHMENTS_MAX_MB') ?? '10');
    const maxBytes = maxMb * 1024 * 1024;
    if (Number.isFinite(maxBytes) && file.size > maxBytes) {
      throw new BadRequestException(
        `Attachment exceeds ${maxMb}MB limit`,
      );
    }

    const attachmentId = randomUUID();
    const safeName = this.sanitizeFileName(file.originalname);
    const storageKey = path.posix.join(ticketId, `${attachmentId}-${safeName}`);
    const filePath = this.resolveAttachmentPath(storageKey);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.buffer);

    const attachment = await this.prisma.attachment.create({
      data: {
        id: attachmentId,
        ticketId,
        uploadedById: user.id,
        fileName: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        scanStatus: AttachmentScanStatus.CLEAN,
        scanCheckedAt: new Date(),
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

  private buildAccessFilter(user: AuthUser): Prisma.TicketWhereInput {
    if (user.role === UserRole.OWNER) {
      return {};
    }

    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      return {
        OR: [
          { assignedTeamId: user.primaryTeamId },
          { accessGrants: { some: { teamId: user.primaryTeamId } } },
        ],
      };
    }

    if (user.role === UserRole.EMPLOYEE) {
      return { requesterId: user.id };
    }

    if (!user.teamId) {
      return { requesterId: user.id };
    }

    if (user.role === UserRole.LEAD) {
      return {
        OR: [
          { assignedTeamId: user.teamId },
          { accessGrants: { some: { teamId: user.teamId } } },
        ],
      };
    }

    return {
      OR: [
        { assignedTeamId: user.teamId, assigneeId: user.id },
        { assignedTeamId: user.teamId, assigneeId: null },
        { accessGrants: { some: { teamId: user.teamId } } },
      ],
    };
  }

  private canViewTicket(
    user: AuthUser,
    ticket: {
      requesterId: string;
      assignedTeamId: string | null;
      assigneeId: string | null;
      accessGrants?: { teamId: string }[];
    },
  ) {
    if (user.role === UserRole.OWNER) {
      return true;
    }

    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      const grant = ticket.accessGrants?.some((g) => g.teamId === user.primaryTeamId) ?? false;
      return ticket.assignedTeamId === user.primaryTeamId || grant;
    }

    if (user.role === UserRole.EMPLOYEE) {
      return ticket.requesterId === user.id;
    }

    if (!user.teamId) {
      return ticket.requesterId === user.id;
    }

    const hasReadGrant =
      ticket.accessGrants?.some((grant) => grant.teamId === user.teamId) ??
      false;

    if (user.role === UserRole.LEAD) {
      return ticket.assignedTeamId === user.teamId || hasReadGrant;
    }

    const isAgentAccess =
      ticket.assignedTeamId === user.teamId &&
      (ticket.assigneeId === user.id || ticket.assigneeId === null);

    return isAgentAccess || hasReadGrant;
  }

  private canWriteTicket(
    user: AuthUser,
    ticket: {
      requesterId: string;
      assignedTeamId: string | null;
      assigneeId: string | null;
    },
  ) {
    if (user.role === UserRole.OWNER) {
      return true;
    }

    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      return ticket.assignedTeamId === user.primaryTeamId;
    }

    if (user.role === UserRole.EMPLOYEE) {
      return ticket.requesterId === user.id;
    }

    if (!user.teamId) {
      return false;
    }

    if (user.role === UserRole.LEAD) {
      return ticket.assignedTeamId === user.teamId;
    }

    return (
      ticket.assignedTeamId === user.teamId &&
      (ticket.assigneeId === user.id || ticket.assigneeId === null)
    );
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

  private async ensureFollower(ticketId: string, userId: string) {
    await this.prisma.ticketFollower.upsert({
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
      console.error('Notification failed', error);
    }
  }

  private isValidTransition(from: TicketStatus, to: TicketStatus) {
    if (from === to) {
      return true;
    }

    const allowed: Record<TicketStatus, TicketStatus[]> = {
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

    return allowed[from].includes(to);
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
      const policy = await client.slaPolicy.findUnique({
        where: {
          teamId_priority: {
            teamId,
            priority,
          },
        },
      });
      if (policy) {
        return {
          policyId: policy.id,
          firstResponseHours: policy.firstResponseHours,
          resolutionHours: policy.resolutionHours,
        };
      }
    }

    return {
      policyId: null,
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

  private async routeTeam(subject: string, description: string) {
    const text = `${subject} ${description}`.toLowerCase();
    const rules = await this.prisma.routingRule.findMany({
      where: { isActive: true },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    });

    for (const rule of rules) {
      const matches = rule.keywords.some((keyword) =>
        text.includes(keyword.toLowerCase()),
      );
      if (matches) {
        return rule.teamId;
      }
    }

    let slug: string | null = null;

    if (
      text.includes('hr') ||
      text.includes('onboard') ||
      text.includes('benefits')
    ) {
      slug = 'hr-operations';
    } else if (
      text.includes('vpn') ||
      text.includes('laptop') ||
      text.includes('device') ||
      text.includes('it ')
    ) {
      slug = 'it-service-desk';
    }

    if (!slug) {
      return null;
    }

    const team = await this.prisma.team.findUnique({ where: { slug } });
    return team?.id ?? null;
  }

  private async resolveAssignee(teamId: string | null) {
    if (!teamId) {
      return null;
    }

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: { members: { orderBy: { createdAt: 'asc' } } },
    });

    if (!team) {
      return null;
    }

    if (team.assignmentStrategy !== TeamAssignmentStrategy.ROUND_ROBIN) {
      return null;
    }

    const members = team.members;
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

    return nextMember.userId;
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
}
