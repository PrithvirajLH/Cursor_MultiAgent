import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  Prisma,
  TicketChannel,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ReportQueryDto, ResolutionTimeQueryDto } from './dto/report-query.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly priorities: TicketPriority[] = [
    TicketPriority.P1,
    TicketPriority.P2,
    TicketPriority.P3,
    TicketPriority.P4,
  ];

  private readonly csatEventTypes = [
    'CSAT_SUBMITTED',
    'TICKET_CSAT_SUBMITTED',
    'CSAT_RESPONSE_RECEIVED',
    'TICKET_RATED',
    'CSAT_RATED',
  ];

  /**
   * Scope report query by role:
   * - LEAD: scope to the lead's team (user.teamId from membership).
   * - TEAM_ADMIN: scope to the admin's primary team (user.primaryTeamId).
   * - OWNER: platform-wide; ignore any teamId so SLA/reports are across all teams.
   */
  private scopeReportQuery(
    query: ReportQueryDto,
    user: AuthUser,
  ): ReportQueryDto {
    if (user.role === UserRole.TEAM_ADMIN) {
      if (!user.primaryTeamId) {
        throw new ForbiddenException(
          'Team administrator must have a primary team set',
        );
      }
      return { ...query, teamId: user.primaryTeamId };
    }
    if (user.role === UserRole.LEAD) {
      if (!user.teamId) {
        throw new ForbiddenException('Lead must belong to a team');
      }
      return { ...query, teamId: user.teamId };
    }
    if (user.role === UserRole.OWNER) {
      const rest = { ...query };
      delete rest.teamId;
      return rest;
    }
    return query;
  }

  /** For date-only "to" values (YYYY-MM-DD), return next day 00:00 UTC so lt includes the whole selected day. */
  private toEndExclusive(to?: string): Date {
    if (!to) return new Date();
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      const d = new Date(`${to}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d;
    }
    return new Date(to);
  }

  /** Base where and date range for reports (admin-only; no access filter). */
  private reportWhere(
    query: ReportQueryDto,
    fromDate: Date,
    toEndExclusive: Date,
    user?: AuthUser,
  ): Prisma.TicketWhereInput {
    const dateField =
      query.dateField === 'updatedAt' ? 'updatedAt' : 'createdAt';
    const conditions: Prisma.TicketWhereInput[] = [
      {
        [dateField]: { gte: fromDate, lt: toEndExclusive },
      } as Prisma.TicketWhereInput,
    ];

    if (query.teamId) conditions.push({ assignedTeamId: query.teamId });
    if (query.priority) conditions.push({ priority: query.priority });
    if (query.categoryId) conditions.push({ categoryId: query.categoryId });
    if (query.channel) conditions.push({ channel: query.channel });
    if (query.status) conditions.push({ status: query.status });
    if (query.assigneeId) {
      conditions.push({ assigneeId: query.assigneeId });
    } else if (query.scope === 'assigned' && user) {
      conditions.push({ assigneeId: user.id });
    }

    if (query.statusGroup === 'open') {
      conditions.push({
        status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
      });
    } else if (query.statusGroup === 'resolved') {
      conditions.push({
        status: { in: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
      });
    }

    return conditions.length === 1 ? conditions[0] : { AND: conditions };
  }

  private dateRange(
    from?: string,
    to?: string,
  ): { fromDate: Date; toEndExclusive: Date; toDateInclusive: Date } {
    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    const fromDate = from ? new Date(from) : defaultFrom;
    const toEndExclusive = this.toEndExclusive(to);
    const toDateInclusive = to ? new Date(to) : now;
    return { fromDate, toEndExclusive, toDateInclusive };
  }

  /** Build raw SQL conditions for date + optional filters (parameterized). End is exclusive (lt). Use tableAlias (e.g. 't') when query joins multiple tables that have these columns. */
  private rawConditions(
    fromDate: Date,
    toEndExclusive: Date,
    teamId?: string,
    priority?: TicketPriority,
    categoryId?: string,
    channel?: TicketChannel,
    status?: TicketStatus,
    assigneeId?: string,
    tableAlias?: string,
    dateField: 'createdAt' | 'updatedAt' = 'createdAt',
  ): Prisma.Sql[] {
    const pre = tableAlias ? `${tableAlias}."` : '"';
    const dateCol = `${pre}${dateField}"`;
    const conditions: Prisma.Sql[] = [
      Prisma.sql`${Prisma.raw(dateCol)} >= ${fromDate}`,
      Prisma.sql`${Prisma.raw(dateCol)} < ${toEndExclusive}`,
    ];
    if (teamId)
      conditions.push(
        Prisma.sql`${Prisma.raw(pre + 'assignedTeamId"')} = ${teamId}`,
      );
    if (priority)
      conditions.push(
        Prisma.sql`${Prisma.raw(pre + 'priority"::text')} = ${priority}`,
      );
    if (categoryId)
      conditions.push(
        Prisma.sql`${Prisma.raw(pre + 'categoryId"')} = ${categoryId}`,
      );
    if (channel)
      conditions.push(
        Prisma.sql`${Prisma.raw(pre + 'channel"::text')} = ${channel}`,
      );
    if (status)
      conditions.push(
        Prisma.sql`${Prisma.raw(pre + 'status"::text')} = ${status}`,
      );
    if (assigneeId)
      conditions.push(
        Prisma.sql`${Prisma.raw(pre + 'assigneeId"')} = ${assigneeId}`,
      );
    return conditions;
  }

  /** Optional Ticket filters used by raw SQL report queries that already define date conditions. */
  private applyTicketFilterConditions(
    conditions: Prisma.Sql[],
    scoped: ReportQueryDto,
    user: AuthUser,
    tableAlias = 't',
  ) {
    const col = (name: string) => Prisma.raw(`${tableAlias}."${name}"`);
    const statusText = Prisma.raw(`${tableAlias}."status"::text`);

    if (scoped.teamId) {
      conditions.push(Prisma.sql`${col('assignedTeamId')} = ${scoped.teamId}`);
    }
    if (scoped.priority) {
      conditions.push(
        Prisma.sql`${Prisma.raw(`${tableAlias}."priority"::text`)} = ${scoped.priority}`,
      );
    }
    if (scoped.categoryId) {
      conditions.push(Prisma.sql`${col('categoryId')} = ${scoped.categoryId}`);
    }
    if (scoped.channel) {
      conditions.push(
        Prisma.sql`${Prisma.raw(`${tableAlias}."channel"::text`)} = ${scoped.channel}`,
      );
    }
    if (scoped.status) {
      conditions.push(Prisma.sql`${statusText} = ${scoped.status}`);
    } else if (scoped.statusGroup === 'open') {
      conditions.push(
        Prisma.sql`${statusText} NOT IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    } else if (scoped.statusGroup === 'resolved') {
      conditions.push(
        Prisma.sql`${statusText} IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    }
    if (scoped.assigneeId) {
      conditions.push(Prisma.sql`${col('assigneeId')} = ${scoped.assigneeId}`);
    } else if (scoped.scope === 'assigned') {
      conditions.push(Prisma.sql`${col('assigneeId')} = ${user.id}`);
    }
  }

  /** Extract CSAT rating from event payload keys: rating | score | csat (numeric or numeric-string). */
  private csatRatingSql(eventAlias = 'e') {
    const payload = Prisma.raw(`${eventAlias}."payload"`);
    return Prisma.sql`
      coalesce(
        CASE
          WHEN jsonb_typeof(${payload}->'rating') = 'number' THEN (${payload}->>'rating')::numeric
          WHEN jsonb_typeof(${payload}->'rating') = 'string'
            AND (${payload}->>'rating') ~ '^[0-9]+(\\.[0-9]+)?$'
          THEN (${payload}->>'rating')::numeric
        END,
        CASE
          WHEN jsonb_typeof(${payload}->'score') = 'number' THEN (${payload}->>'score')::numeric
          WHEN jsonb_typeof(${payload}->'score') = 'string'
            AND (${payload}->>'score') ~ '^[0-9]+(\\.[0-9]+)?$'
          THEN (${payload}->>'score')::numeric
        END,
        CASE
          WHEN jsonb_typeof(${payload}->'csat') = 'number' THEN (${payload}->>'csat')::numeric
          WHEN jsonb_typeof(${payload}->'csat') = 'string'
            AND (${payload}->>'csat') ~ '^[0-9]+(\\.[0-9]+)?$'
          THEN (${payload}->>'csat')::numeric
        END
      )
    `;
  }

  async getSummary(query: ReportQueryDto, user: AuthUser) {
    // Note: keep the response "shaped" for the frontend so it can hydrate multiple charts with one request.
    const resolutionQuery: ResolutionTimeQueryDto = {
      ...query,
      groupBy: 'team',
    };

    const [
      ticketVolume,
      slaCompliance,
      resolutionTime,
      ticketsByPriority,
      ticketsByStatus,
      agentPerformance,
    ] = await Promise.all([
      this.getTicketVolume(query, user),
      this.getSlaCompliance(query, user),
      this.getResolutionTime(resolutionQuery, user),
      this.getTicketsByPriority(query, user),
      this.getTicketsByStatus(query, user),
      this.getAgentPerformance(query, user),
    ]);

    return {
      ticketVolume,
      slaCompliance,
      resolutionTime,
      ticketsByPriority,
      ticketsByStatus,
      agentPerformance,
    };
  }

  async getTicketVolume(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive, toDateInclusive } = this.dateRange(
      scoped.from,
      scoped.to,
    );
    const dateField =
      scoped.dateField === 'updatedAt' ? 'updatedAt' : 'createdAt';
    const conditions = this.rawConditions(
      fromDate,
      toEndExclusive,
      scoped.teamId,
      scoped.priority,
      scoped.categoryId,
      scoped.channel,
      scoped.status,
      scoped.assigneeId,
      undefined,
      dateField,
    );
    const statusText = Prisma.raw('"status"::text');
    if (scoped.statusGroup === 'open') {
      conditions.push(
        Prisma.sql`${statusText} NOT IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    } else if (scoped.statusGroup === 'resolved') {
      conditions.push(
        Prisma.sql`${statusText} IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    }
    const rows = await this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
      SELECT d::date as date, coalesce(c.cnt, 0)::bigint as count
      FROM generate_series(${fromDate}::date, ${toDateInclusive}::date, '1 day'::interval) d
      LEFT JOIN (
        SELECT date_trunc('day', ${Prisma.raw(`"${dateField}"`)})::date as day, count(*)::bigint as cnt
        FROM "Ticket"
        WHERE ${Prisma.join(conditions, ' AND ')}
        GROUP BY 1
      ) c ON c.day = d::date
      ORDER BY 1
    `;
    return {
      data: rows.map((r) => ({
        date:
          r.date instanceof Date
            ? r.date.toISOString().slice(0, 10)
            : String(r.date).slice(0, 10),
        count: Number(r.count),
      })),
    };
  }

  async getSlaCompliance(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive } = this.dateRange(scoped.from, scoped.to);
    const dateField =
      scoped.dateField === 'updatedAt' ? 'updatedAt' : 'createdAt';
    const conditions = this.rawConditions(
      fromDate,
      toEndExclusive,
      scoped.teamId,
      scoped.priority,
      scoped.categoryId,
      scoped.channel,
      scoped.status,
      scoped.assigneeId,
      undefined,
      dateField,
    );
    conditions.push(
      Prisma.sql`("firstResponseDueAt" IS NOT NULL OR "dueAt" IS NOT NULL)`,
    );
    // Count distinct tickets: a ticket is "breached" if it breached first response OR resolution (or both).
    // "met" = had SLA in range and did not breach either. No double-counting.
    const row = await this.prisma.$queryRaw<
      {
        met: bigint;
        breached: bigint;
        first_response_met: bigint;
        first_response_breached: bigint;
        resolution_met: bigint;
        resolution_breached: bigint;
      }[]
    >`
      WITH base AS (
        SELECT id,
          ("firstResponseDueAt" IS NOT NULL) AS has_fr,
          ("dueAt" IS NOT NULL) AS has_res,
          ("firstResponseDueAt" IS NOT NULL AND (
            ("firstResponseAt" IS NULL AND now() > "firstResponseDueAt") OR
            ("firstResponseAt" IS NOT NULL AND "firstResponseAt" > "firstResponseDueAt")
          )) AS fr_breached,
          ("dueAt" IS NOT NULL AND (
            ("resolvedAt" IS NULL AND now() > "dueAt") OR
            ("resolvedAt" IS NOT NULL AND "resolvedAt" > "dueAt")
          )) AS res_breached
        FROM "Ticket"
        WHERE ${Prisma.join(conditions, ' AND ')}
      )
      SELECT
        count(*) FILTER (WHERE NOT fr_breached AND NOT res_breached)::bigint AS met,
        count(*) FILTER (WHERE fr_breached OR res_breached)::bigint AS breached,
        count(*) FILTER (WHERE has_fr AND NOT fr_breached)::bigint AS first_response_met,
        count(*) FILTER (WHERE has_fr AND fr_breached)::bigint AS first_response_breached,
        count(*) FILTER (WHERE has_res AND NOT res_breached)::bigint AS resolution_met,
        count(*) FILTER (WHERE has_res AND res_breached)::bigint AS resolution_breached
      FROM base
    `;
    const r = row[0];
    const met = Number(r?.met ?? 0);
    const breached = Number(r?.breached ?? 0);
    const total = met + breached;
    const firstResponseMet = Number(r?.first_response_met ?? 0);
    const firstResponseBreached = Number(r?.first_response_breached ?? 0);
    const resolutionMet = Number(r?.resolution_met ?? 0);
    const resolutionBreached = Number(r?.resolution_breached ?? 0);
    return {
      data: {
        met,
        breached,
        total,
        firstResponseMet,
        firstResponseBreached,
        resolutionMet,
        resolutionBreached,
      },
    };
  }

  async getSlaComplianceByPriority(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive } = this.dateRange(scoped.from, scoped.to);
    const dateField =
      scoped.dateField === 'updatedAt' ? 'updatedAt' : 'createdAt';
    const conditions = this.rawConditions(
      fromDate,
      toEndExclusive,
      scoped.teamId,
      scoped.priority,
      scoped.categoryId,
      scoped.channel,
      scoped.status,
      scoped.assigneeId,
      undefined,
      dateField,
    );
    conditions.push(
      Prisma.sql`("firstResponseDueAt" IS NOT NULL OR "dueAt" IS NOT NULL)`,
    );

    const rows = await this.prisma.$queryRaw<
      {
        priority: TicketPriority;
        met: bigint;
        breached: bigint;
        first_response_met: bigint;
        first_response_breached: bigint;
        resolution_met: bigint;
        resolution_breached: bigint;
      }[]
    >`
      WITH base AS (
        SELECT
          "priority",
          ("firstResponseDueAt" IS NOT NULL) AS has_fr,
          ("dueAt" IS NOT NULL) AS has_res,
          ("firstResponseDueAt" IS NOT NULL AND (
            ("firstResponseAt" IS NULL AND now() > "firstResponseDueAt") OR
            ("firstResponseAt" IS NOT NULL AND "firstResponseAt" > "firstResponseDueAt")
          )) AS fr_breached,
          ("dueAt" IS NOT NULL AND (
            ("resolvedAt" IS NULL AND now() > "dueAt") OR
            ("resolvedAt" IS NOT NULL AND "resolvedAt" > "dueAt")
          )) AS res_breached
        FROM "Ticket"
        WHERE ${Prisma.join(conditions, ' AND ')}
      )
      SELECT
        "priority",
        count(*) FILTER (WHERE NOT fr_breached AND NOT res_breached)::bigint AS met,
        count(*) FILTER (WHERE fr_breached OR res_breached)::bigint AS breached,
        count(*) FILTER (WHERE has_fr AND NOT fr_breached)::bigint AS first_response_met,
        count(*) FILTER (WHERE has_fr AND fr_breached)::bigint AS first_response_breached,
        count(*) FILTER (WHERE has_res AND NOT res_breached)::bigint AS resolution_met,
        count(*) FILTER (WHERE has_res AND res_breached)::bigint AS resolution_breached
      FROM base
      GROUP BY "priority"
    `;

    const byPriority = new Map(rows.map((row) => [row.priority, row]));
    return {
      data: this.priorities.map((priority) => {
        const row = byPriority.get(priority);
        const met = Number(row?.met ?? 0);
        const breached = Number(row?.breached ?? 0);
        return {
          priority,
          met,
          breached,
          total: met + breached,
          firstResponseMet: Number(row?.first_response_met ?? 0),
          firstResponseBreached: Number(row?.first_response_breached ?? 0),
          resolutionMet: Number(row?.resolution_met ?? 0),
          resolutionBreached: Number(row?.resolution_breached ?? 0),
        };
      }),
    };
  }

  async getResolutionTime(query: ResolutionTimeQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive } = this.dateRange(scoped.from, scoped.to);
    const dateField =
      scoped.dateField === 'updatedAt' ? 'updatedAt' : 'createdAt';
    const conditions = this.rawConditions(
      fromDate,
      toEndExclusive,
      scoped.teamId,
      scoped.priority,
      scoped.categoryId,
      scoped.channel,
      scoped.status,
      scoped.assigneeId,
      undefined,
      dateField,
    );
    conditions.push(Prisma.sql`"resolvedAt" IS NOT NULL`);
    const groupBy = query.groupBy === 'priority' ? 'priority' : 'team';

    if (groupBy === 'priority') {
      const rows = await this.prisma.$queryRaw<
        { priority: string; avg_hours: number; count: bigint }[]
      >`
        SELECT "priority", round(avg(EXTRACT(epoch FROM ("resolvedAt" - "createdAt"))/3600)::numeric, 1)::float as avg_hours, count(*)::bigint as count
        FROM "Ticket"
        WHERE ${Prisma.join(conditions, ' AND ')}
        GROUP BY "priority"
        ORDER BY "priority"
      `;
      return {
        data: rows.map((r) => ({
          label: r.priority,
          avgHours: r.avg_hours,
          count: Number(r.count),
        })),
      };
    }

    const rows = await this.prisma.$queryRaw<
      {
        assigned_team_id: string | null;
        team_name: string | null;
        avg_hours: number;
        count: bigint;
      }[]
    >`
      SELECT sub."assignedTeamId" as assigned_team_id, tm."name" as team_name,
        round(avg(EXTRACT(epoch FROM (sub."resolvedAt" - sub."createdAt"))/3600)::numeric, 1)::float as avg_hours,
        count(*)::bigint as count
      FROM (
        SELECT "assignedTeamId", "createdAt", "resolvedAt"
        FROM "Ticket"
        WHERE ${Prisma.join(conditions, ' AND ')}
      ) sub
      LEFT JOIN "Team" tm ON tm.id = sub."assignedTeamId"
      GROUP BY sub."assignedTeamId", tm."name"
      ORDER BY tm."name" NULLS LAST
    `;
    return {
      data: rows.map((r) => ({
        id: r.assigned_team_id ?? 'unassigned',
        label: r.team_name ?? 'Unassigned',
        avgHours: r.avg_hours,
        count: Number(r.count),
      })),
    };
  }

  async getTicketsByStatus(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive } = this.dateRange(scoped.from, scoped.to);
    const where = this.reportWhere(scoped, fromDate, toEndExclusive, user);
    const groups = await this.prisma.ticket.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
      orderBy: { status: 'asc' },
    });
    return {
      data: groups.map((g) => ({
        status: g.status,
        count: g._count.id,
      })),
    };
  }

  async getTicketsByPriority(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive } = this.dateRange(scoped.from, scoped.to);
    const where = this.reportWhere(scoped, fromDate, toEndExclusive, user);
    const groups = await this.prisma.ticket.groupBy({
      by: ['priority'],
      where,
      _count: { id: true },
      orderBy: { priority: 'asc' },
    });
    return {
      data: groups.map((g) => ({
        priority: g.priority,
        count: g._count.id,
      })),
    };
  }

  async getAgentPerformance(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive } = this.dateRange(scoped.from, scoped.to);
    const dateField =
      scoped.dateField === 'updatedAt' ? 'updatedAt' : 'createdAt';
    const conditions = this.rawConditions(
      fromDate,
      toEndExclusive,
      scoped.teamId,
      scoped.priority,
      scoped.categoryId,
      scoped.channel,
      scoped.status,
      scoped.assigneeId,
      't',
      dateField,
    );
    conditions.push(Prisma.sql`t."assigneeId" IS NOT NULL`);
    const rows = await this.prisma.$queryRaw<
      {
        user_id: string;
        display_name: string | null;
        email: string;
        resolved: bigint;
        total_resolution_sec: number;
        first_responses: bigint;
        total_first_response_sec: number;
      }[]
    >`
      SELECT
        t."assigneeId" as user_id,
        u."displayName" as display_name,
        u."email" as email,
        count(*) FILTER (WHERE t."resolvedAt" IS NOT NULL)::bigint as resolved,
        coalesce(sum(EXTRACT(epoch FROM (t."resolvedAt" - t."createdAt"))) FILTER (WHERE t."resolvedAt" IS NOT NULL), 0)::float as total_resolution_sec,
        count(*) FILTER (WHERE t."firstResponseAt" IS NOT NULL)::bigint as first_responses,
        coalesce(sum(EXTRACT(epoch FROM (t."firstResponseAt" - t."createdAt"))) FILTER (WHERE t."firstResponseAt" IS NOT NULL), 0)::float as total_first_response_sec
      FROM "Ticket" t
      INNER JOIN "User" u ON u.id = t."assigneeId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY t."assigneeId", u."displayName", u."email"
      ORDER BY resolved DESC
    `;
    return {
      data: rows.map((r) => ({
        userId: r.user_id,
        name: r.display_name ?? r.email ?? 'Unknown',
        email: r.email,
        ticketsResolved: Number(r.resolved),
        avgResolutionHours:
          Number(r.resolved) > 0
            ? Math.round(
                (r.total_resolution_sec / 3600 / Number(r.resolved)) * 10,
              ) / 10
            : null,
        firstResponses: Number(r.first_responses),
        avgFirstResponseHours:
          Number(r.first_responses) > 0
            ? Math.round(
                (r.total_first_response_sec /
                  3600 /
                  Number(r.first_responses)) *
                  10,
              ) / 10
            : null,
      })),
    };
  }

  async getAgentWorkload(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const statusText = Prisma.raw('t."status"::text');
    const conditions: Prisma.Sql[] = [Prisma.sql`t."assigneeId" IS NOT NULL`];

    if (scoped.status) {
      conditions.push(Prisma.sql`t."status"::text = ${scoped.status}`);
    } else if (scoped.statusGroup === 'resolved') {
      conditions.push(
        Prisma.sql`${statusText} IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    } else if (scoped.statusGroup !== 'all') {
      conditions.push(
        Prisma.sql`${statusText} NOT IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    }

    if (scoped.teamId) {
      conditions.push(Prisma.sql`t."assignedTeamId" = ${scoped.teamId}`);
    }
    if (scoped.priority) {
      conditions.push(Prisma.sql`t."priority"::text = ${scoped.priority}`);
    }
    if (scoped.categoryId) {
      conditions.push(Prisma.sql`t."categoryId" = ${scoped.categoryId}`);
    }
    if (scoped.channel) {
      conditions.push(Prisma.sql`t."channel"::text = ${scoped.channel}`);
    }
    if (scoped.assigneeId) {
      conditions.push(Prisma.sql`t."assigneeId" = ${scoped.assigneeId}`);
    } else if (scoped.scope === 'assigned') {
      conditions.push(Prisma.sql`t."assigneeId" = ${user.id}`);
    }

    const rows = await this.prisma.$queryRaw<
      {
        user_id: string;
        display_name: string | null;
        email: string;
        assigned_open: bigint;
        in_progress: bigint;
      }[]
    >`
      SELECT
        t."assigneeId" as user_id,
        u."displayName" as display_name,
        u."email" as email,
        count(*)::bigint as assigned_open,
        count(*) FILTER (WHERE ${statusText} = ${TicketStatus.IN_PROGRESS})::bigint as in_progress
      FROM "Ticket" t
      INNER JOIN "User" u ON u.id = t."assigneeId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY t."assigneeId", u."displayName", u."email"
      ORDER BY assigned_open DESC, u."displayName" ASC
    `;

    return {
      data: rows.map((row) => ({
        userId: row.user_id,
        name: row.display_name ?? row.email ?? 'Unknown',
        email: row.email,
        assignedOpen: Number(row.assigned_open),
        inProgress: Number(row.in_progress),
      })),
    };
  }

  async getTicketsByAge(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive } = this.dateRange(scoped.from, scoped.to);
    const statusText = Prisma.raw('t."status"::text');
    const dateField =
      scoped.dateField === 'updatedAt' ? 'updatedAt' : 'createdAt';
    const dateColumn = Prisma.raw(`t."${dateField}"`);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`${dateColumn} >= ${fromDate}`,
      Prisma.sql`${dateColumn} < ${toEndExclusive}`,
    ];
    if (scoped.status) {
      conditions.push(Prisma.sql`t."status"::text = ${scoped.status}`);
    } else if (scoped.statusGroup === 'resolved') {
      conditions.push(
        Prisma.sql`${statusText} IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    } else if (scoped.statusGroup !== 'all') {
      conditions.push(
        Prisma.sql`${statusText} NOT IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    }
    if (scoped.teamId) {
      conditions.push(Prisma.sql`t."assignedTeamId" = ${scoped.teamId}`);
    }
    if (scoped.priority) {
      conditions.push(Prisma.sql`t."priority"::text = ${scoped.priority}`);
    }
    if (scoped.categoryId) {
      conditions.push(Prisma.sql`t."categoryId" = ${scoped.categoryId}`);
    }
    if (scoped.channel) {
      conditions.push(Prisma.sql`t."channel"::text = ${scoped.channel}`);
    }
    if (scoped.assigneeId) {
      conditions.push(Prisma.sql`t."assigneeId" = ${scoped.assigneeId}`);
    } else if (scoped.scope === 'assigned') {
      conditions.push(Prisma.sql`t."assigneeId" = ${user.id}`);
    }

    const rows = await this.prisma.$queryRaw<
      { bucket: string; count: bigint }[]
    >`
      SELECT bucket, count(*)::bigint as count
      FROM (
        SELECT
          CASE
            WHEN age_hours < 1 THEN '0-1 hr'
            WHEN age_hours < 4 THEN '1-4 hrs'
            WHEN age_hours < 8 THEN '4-8 hrs'
            WHEN age_hours < 24 THEN '8-24 hrs'
            ELSE '24+ hrs'
          END as bucket
        FROM (
          SELECT EXTRACT(epoch FROM (now() - t."createdAt"))/3600 as age_hours
          FROM "Ticket" t
          WHERE ${Prisma.join(conditions, ' AND ')}
        ) ages
      ) buckets
      GROUP BY bucket
    `;

    const order = ['0-1 hr', '1-4 hrs', '4-8 hrs', '8-24 hrs', '24+ hrs'];
    const sorted = order.map((bucket) => ({
      bucket,
      count: Number(rows.find((row) => row.bucket === bucket)?.count ?? 0),
    }));

    return { data: sorted };
  }

  async getReopenRate(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive, toDateInclusive } = this.dateRange(
      scoped.from,
      scoped.to,
    );
    const conditions: Prisma.Sql[] = [
      Prisma.sql`e."type" = 'TICKET_STATUS_CHANGED'`,
      Prisma.sql`e."payload"->>'to' = 'REOPENED'`,
      Prisma.sql`e."createdAt" >= ${fromDate}`,
      Prisma.sql`e."createdAt" < ${toEndExclusive}`,
    ];
    if (scoped.teamId) {
      conditions.push(Prisma.sql`t."assignedTeamId" = ${scoped.teamId}`);
    }
    if (scoped.priority) {
      conditions.push(Prisma.sql`t."priority"::text = ${scoped.priority}`);
    }
    if (scoped.categoryId) {
      conditions.push(Prisma.sql`t."categoryId" = ${scoped.categoryId}`);
    }
    if (scoped.channel) {
      conditions.push(Prisma.sql`t."channel"::text = ${scoped.channel}`);
    }
    if (scoped.status) {
      conditions.push(Prisma.sql`t."status"::text = ${scoped.status}`);
    } else if (scoped.statusGroup === 'open') {
      conditions.push(
        Prisma.sql`t."status"::text NOT IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    } else if (scoped.statusGroup === 'resolved') {
      conditions.push(
        Prisma.sql`t."status"::text IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    }
    if (scoped.assigneeId) {
      conditions.push(Prisma.sql`t."assigneeId" = ${scoped.assigneeId}`);
    } else if (scoped.scope === 'assigned') {
      conditions.push(Prisma.sql`t."assigneeId" = ${user.id}`);
    }

    const rows = await this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
      SELECT d::date as date, coalesce(r.cnt, 0)::bigint as count
      FROM generate_series(${fromDate}::date, ${toDateInclusive}::date, '1 day'::interval) d
      LEFT JOIN (
        SELECT date_trunc('day', e."createdAt")::date as day, count(*)::bigint as cnt
        FROM "TicketEvent" e
        INNER JOIN "Ticket" t ON t.id = e."ticketId"
        WHERE ${Prisma.join(conditions, ' AND ')}
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
        count: Number(row.count),
      })),
    };
  }

  async getCsatTrend(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive, toDateInclusive } = this.dateRange(
      scoped.from,
      scoped.to,
    );
    const ratingExpr = this.csatRatingSql('e');
    const conditions: Prisma.Sql[] = [
      Prisma.sql`e."createdAt" >= ${fromDate}`,
      Prisma.sql`e."createdAt" < ${toEndExclusive}`,
      Prisma.sql`e."type" IN (${Prisma.join(this.csatEventTypes)})`,
      Prisma.sql`${ratingExpr} BETWEEN 1 AND 5`,
    ];
    this.applyTicketFilterConditions(conditions, scoped, user, 't');

    const rows = await this.prisma.$queryRaw<
      { date: Date; avg_rating: number; response_count: bigint }[]
    >`
      SELECT d::date as date, coalesce(s.avg_rating, 0)::float as avg_rating, coalesce(s.response_count, 0)::bigint as response_count
      FROM generate_series(${fromDate}::date, ${toDateInclusive}::date, '1 day'::interval) d
      LEFT JOIN (
        SELECT
          date_trunc('day', e."createdAt")::date as day,
          round(avg(${ratingExpr})::numeric, 2)::float as avg_rating,
          count(*)::bigint as response_count
        FROM "TicketEvent" e
        INNER JOIN "Ticket" t ON t.id = e."ticketId"
        WHERE ${Prisma.join(conditions, ' AND ')}
        GROUP BY 1
      ) s ON s.day = d::date
      ORDER BY 1
    `;

    const series = rows.map((row) => ({
      date:
        row.date instanceof Date
          ? row.date.toISOString().slice(0, 10)
          : String(row.date).slice(0, 10),
      average: Number(row.avg_rating ?? 0),
      count: Number(row.response_count ?? 0),
    }));
    const responses = series.reduce((sum, row) => sum + row.count, 0);
    const weighted = series.reduce(
      (sum, row) => sum + row.average * row.count,
      0,
    );
    const average =
      responses > 0 ? Number((weighted / responses).toFixed(2)) : null;

    return {
      data: series,
      summary: {
        average,
        responses,
      },
    };
  }

  async getCsatDrivers(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive } = this.dateRange(scoped.from, scoped.to);
    const ratingExpr = this.csatRatingSql('e');
    const conditions: Prisma.Sql[] = [
      Prisma.sql`e."createdAt" >= ${fromDate}`,
      Prisma.sql`e."createdAt" < ${toEndExclusive}`,
      Prisma.sql`e."type" IN (${Prisma.join(this.csatEventTypes)})`,
      Prisma.sql`${ratingExpr} BETWEEN 1 AND 5`,
    ];
    this.applyTicketFilterConditions(conditions, scoped, user, 't');

    const rows = await this.prisma.$queryRaw<
      { label: string; count: bigint }[]
    >`
      SELECT
        rated.label as label,
        count(*)::bigint as count
      FROM (
        SELECT
          coalesce(
            nullif(trim(coalesce(
              e."payload"->>'reason',
              e."payload"->>'driver',
              e."payload"->>'category',
              e."payload"->>'commentReason',
              ''
            )), ''),
            'Unspecified'
          ) as label,
          ${ratingExpr} as rating
        FROM "TicketEvent" e
        INNER JOIN "Ticket" t ON t.id = e."ticketId"
        WHERE ${Prisma.join(conditions, ' AND ')}
      ) rated
      WHERE rated.rating <= 3
      GROUP BY rated.label
      ORDER BY count DESC, rated.label ASC
      LIMIT 8
    `;

    const total = rows.reduce((sum, row) => sum + Number(row.count), 0);
    return {
      data: rows.map((row) => ({
        label: row.label,
        count: Number(row.count),
        percent:
          total > 0
            ? Number(((Number(row.count) / total) * 100).toFixed(1))
            : 0,
      })),
      total,
    };
  }

  async getCsatLowTags(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive } = this.dateRange(scoped.from, scoped.to);
    const ratingExpr = this.csatRatingSql('e');
    const conditions: Prisma.Sql[] = [
      Prisma.sql`e."createdAt" >= ${fromDate}`,
      Prisma.sql`e."createdAt" < ${toEndExclusive}`,
      Prisma.sql`e."type" IN (${Prisma.join(this.csatEventTypes)})`,
      Prisma.sql`${ratingExpr} BETWEEN 1 AND 5`,
    ];
    this.applyTicketFilterConditions(conditions, scoped, user, 't');

    const rows = await this.prisma.$queryRaw<{ tag: string; count: bigint }[]>`
      WITH rated AS (
        SELECT
          e."payload" as payload,
          ${ratingExpr} as rating
        FROM "TicketEvent" e
        INNER JOIN "Ticket" t ON t.id = e."ticketId"
        WHERE ${Prisma.join(conditions, ' AND ')}
      ),
      low_tags AS (
        SELECT lower(trim(tag_values.tag)) as tag
        FROM rated r
        CROSS JOIN LATERAL (
          SELECT value as tag
          FROM jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(r.payload->'tags') = 'array' THEN r.payload->'tags'
              ELSE '[]'::jsonb
            END
          )
          UNION ALL
          SELECT r.payload->>'tag'
        ) tag_values
        WHERE r.rating <= 3
      )
      SELECT
        tag,
        count(*)::bigint as count
      FROM low_tags
      WHERE tag IS NOT NULL AND tag <> ''
      GROUP BY tag
      ORDER BY count DESC, tag ASC
      LIMIT 12
    `;

    return {
      data: rows.map((row) => ({
        tag: row.tag,
        count: Number(row.count),
      })),
    };
  }

  async getSlaBreaches(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive } = this.dateRange(scoped.from, scoped.to);
    const dateField =
      scoped.dateField === 'updatedAt' ? 'updatedAt' : 'createdAt';
    const conditions = this.rawConditions(
      fromDate,
      toEndExclusive,
      scoped.teamId,
      scoped.priority,
      scoped.categoryId,
      scoped.channel,
      scoped.status,
      scoped.assigneeId,
      't',
      dateField,
    );

    const rows = await this.prisma.$queryRaw<
      {
        ticket_id: string;
        ticket_label: string;
        team_name: string | null;
        priority: string;
        stage: 'FIRST_RESPONSE' | 'RESOLUTION';
        breach_seconds: bigint;
      }[]
    >`
      WITH scoped_tickets AS (
        SELECT
          t.id,
          t."displayId",
          t."number",
          t."assignedTeamId",
          t."priority"::text as priority,
          greatest(
            0,
            CASE
              WHEN t."firstResponseDueAt" IS NULL THEN 0
              WHEN t."firstResponseAt" IS NOT NULL THEN extract(epoch from (t."firstResponseAt" - t."firstResponseDueAt"))
              ELSE extract(epoch from (now() - t."firstResponseDueAt"))
            END
          )::bigint as fr_breach_seconds,
          greatest(
            0,
            CASE
              WHEN t."dueAt" IS NULL THEN 0
              WHEN t."resolvedAt" IS NOT NULL THEN extract(epoch from (t."resolvedAt" - t."dueAt"))
              WHEN t."status"::text IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])}) THEN 0
              ELSE extract(epoch from (now() - t."dueAt"))
            END
          )::bigint as res_breach_seconds
        FROM "Ticket" t
        WHERE ${Prisma.join(conditions, ' AND ')}
      )
      SELECT
        st.id as ticket_id,
        coalesce(st."displayId", concat('TKT-', st."number"::text)) as ticket_label,
        tm."name" as team_name,
        st.priority,
        CASE
          WHEN st.fr_breach_seconds >= st.res_breach_seconds THEN 'FIRST_RESPONSE'
          ELSE 'RESOLUTION'
        END as stage,
        greatest(st.fr_breach_seconds, st.res_breach_seconds)::bigint as breach_seconds
      FROM scoped_tickets st
      LEFT JOIN "Team" tm ON tm.id = st."assignedTeamId"
      WHERE greatest(st.fr_breach_seconds, st.res_breach_seconds) > 0
      ORDER BY breach_seconds DESC
      LIMIT 25
    `;

    return {
      data: rows.map((row) => ({
        ticketId: row.ticket_id,
        ticket: row.ticket_label,
        team: row.team_name ?? 'Unassigned',
        priority: row.priority,
        stage: row.stage === 'FIRST_RESPONSE' ? 'First response' : 'Resolution',
        breachSeconds: Number(row.breach_seconds),
        reason:
          row.stage === 'FIRST_RESPONSE'
            ? 'First response due time missed'
            : 'Resolution due time missed',
      })),
    };
  }

  async getChannelBreakdown(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive } = this.dateRange(scoped.from, scoped.to);
    const where = this.reportWhere(scoped, fromDate, toEndExclusive, user);
    const groups = await this.prisma.ticket.groupBy({
      by: ['channel'],
      where,
      _count: { id: true },
      orderBy: { channel: 'asc' },
    });

    const byChannel = new Map(
      groups.map((group) => [group.channel, group._count.id]),
    );
    const total = groups.reduce((sum, group) => sum + group._count.id, 0);
    const rows = Object.values(TicketChannel).map((channel) => {
      const count = byChannel.get(channel) ?? 0;
      return {
        channel,
        label: channel === TicketChannel.PORTAL ? 'Portal' : 'Email',
        count,
        percent: total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0,
      };
    });

    return {
      data: rows,
      total,
    };
  }

  /**
   * Tickets by category – uses a single raw SQL query with LEFT JOIN to Category
   * to avoid the N+1 of groupBy + separate category fetch.
   */
  async getTicketsByCategory(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive } = this.dateRange(scoped.from, scoped.to);
    const dateField =
      scoped.dateField === 'updatedAt' ? 'updatedAt' : 'createdAt';
    const conditions = this.rawConditions(
      fromDate,
      toEndExclusive,
      scoped.teamId,
      scoped.priority,
      scoped.categoryId,
      scoped.channel,
      scoped.status,
      scoped.assigneeId,
      't',
      dateField,
    );

    if (scoped.statusGroup === 'open') {
      conditions.push(
        Prisma.sql`t."status"::text NOT IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    } else if (scoped.statusGroup === 'resolved') {
      conditions.push(
        Prisma.sql`t."status"::text IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    }
    if (scoped.assigneeId) {
      // already handled above
    } else if (scoped.scope === 'assigned' && user) {
      conditions.push(Prisma.sql`t."assigneeId" = ${user.id}`);
    }

    const rows = await this.prisma.$queryRaw<
      {
        category_id: string | null;
        category_name: string | null;
        count: bigint;
      }[]
    >`
      SELECT
        t."categoryId" AS category_id,
        c."name" AS category_name,
        count(*)::bigint AS count
      FROM "Ticket" t
      LEFT JOIN "Category" c ON c."id" = t."categoryId"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY t."categoryId", c."name"
      ORDER BY count DESC
    `;

    return {
      data: rows.map((r) => ({
        id: r.category_id ?? 'uncategorized',
        name: r.category_name ?? 'Uncategorized',
        count: Number(r.count),
      })),
    };
  }

  async getTeamSummary(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive } = this.dateRange(scoped.from, scoped.to);
    const dateField =
      scoped.dateField === 'updatedAt' ? 'updatedAt' : 'createdAt';
    const dateColumn = Prisma.raw(`t."${dateField}"`);
    const statusText = Prisma.raw('t."status"::text');
    const conditions: Prisma.Sql[] = [
      Prisma.sql`${dateColumn} >= ${fromDate}`,
      Prisma.sql`${dateColumn} < ${toEndExclusive}`,
    ];
    if (scoped.teamId) {
      conditions.push(Prisma.sql`t."assignedTeamId" = ${scoped.teamId}`);
    }
    if (scoped.priority) {
      conditions.push(Prisma.sql`t."priority"::text = ${scoped.priority}`);
    }
    if (scoped.categoryId) {
      conditions.push(Prisma.sql`t."categoryId" = ${scoped.categoryId}`);
    }
    if (scoped.channel) {
      conditions.push(Prisma.sql`t."channel"::text = ${scoped.channel}`);
    }
    if (scoped.status) {
      conditions.push(Prisma.sql`t."status"::text = ${scoped.status}`);
    } else if (scoped.statusGroup === 'open') {
      conditions.push(
        Prisma.sql`${statusText} NOT IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    } else if (scoped.statusGroup === 'resolved') {
      conditions.push(
        Prisma.sql`${statusText} IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    }
    if (scoped.assigneeId) {
      conditions.push(Prisma.sql`t."assigneeId" = ${scoped.assigneeId}`);
    } else if (scoped.scope === 'assigned') {
      conditions.push(Prisma.sql`t."assigneeId" = ${user.id}`);
    }

    const rows = await this.prisma.$queryRaw<
      {
        team_id: string | null;
        open_count: bigint;
        resolved_count: bigint;
        total_count: bigint;
      }[]
    >`
      SELECT
        t."assignedTeamId" as team_id,
        count(*) FILTER (WHERE ${statusText} NOT IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])}))::bigint as open_count,
        count(*) FILTER (WHERE ${statusText} IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])}))::bigint as resolved_count,
        count(*)::bigint as total_count
      FROM "Ticket" t
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY t."assignedTeamId"
      ORDER BY total_count DESC
    `;

    const teamIds = rows
      .map((row) => row.team_id)
      .filter((id): id is string => Boolean(id));
    const teams = await this.prisma.team.findMany({
      where: { id: { in: teamIds } },
      select: { id: true, name: true },
    });
    const teamMap = new Map(teams.map((t) => [t.id, t.name]));

    return {
      data: rows.map((row) => ({
        id: row.team_id ?? 'unassigned',
        name: row.team_id
          ? (teamMap.get(row.team_id) ?? 'Unknown team')
          : 'Unassigned',
        open: Number(row.open_count),
        resolved: Number(row.resolved_count),
        total: Number(row.total_count),
      })),
    };
  }

  async getTransfers(query: ReportQueryDto, user: AuthUser) {
    const scoped = this.scopeReportQuery(query, user);
    const { fromDate, toEndExclusive, toDateInclusive } = this.dateRange(
      scoped.from,
      scoped.to,
    );
    const eventConditions: Prisma.Sql[] = [
      Prisma.sql`e."type" = 'TICKET_TRANSFERRED'`,
      Prisma.sql`e."createdAt" >= ${fromDate}`,
      Prisma.sql`e."createdAt" < ${toEndExclusive}`,
    ];
    const ticketConditions: Prisma.Sql[] = [];
    if (scoped.teamId) {
      eventConditions.push(
        Prisma.sql`(e.payload->>'fromTeamId' = ${scoped.teamId} OR e.payload->>'toTeamId' = ${scoped.teamId})`,
      );
    }
    if (scoped.priority) {
      ticketConditions.push(
        Prisma.sql`t."priority"::text = ${scoped.priority}`,
      );
    }
    if (scoped.categoryId) {
      ticketConditions.push(Prisma.sql`t."categoryId" = ${scoped.categoryId}`);
    }
    if (scoped.channel) {
      ticketConditions.push(Prisma.sql`t."channel"::text = ${scoped.channel}`);
    }
    if (scoped.status) {
      ticketConditions.push(Prisma.sql`t."status"::text = ${scoped.status}`);
    } else if (scoped.statusGroup === 'open') {
      ticketConditions.push(
        Prisma.sql`t."status"::text NOT IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    } else if (scoped.statusGroup === 'resolved') {
      ticketConditions.push(
        Prisma.sql`t."status"::text IN (${Prisma.join([TicketStatus.RESOLVED, TicketStatus.CLOSED])})`,
      );
    }
    if (scoped.assigneeId) {
      ticketConditions.push(Prisma.sql`t."assigneeId" = ${scoped.assigneeId}`);
    } else if (scoped.scope === 'assigned') {
      ticketConditions.push(Prisma.sql`t."assigneeId" = ${user.id}`);
    }

    const rows = await this.prisma.$queryRaw<{ date: Date; count: bigint }[]>`
      SELECT d::date as date, coalesce(tr.cnt, 0)::bigint as count
      FROM generate_series(${fromDate}::date, ${toDateInclusive}::date, '1 day'::interval) d
      LEFT JOIN (
        SELECT date_trunc('day', e."createdAt")::date as day, count(*)::bigint as cnt
        FROM "TicketEvent" e
        INNER JOIN "Ticket" t ON t.id = e."ticketId"
        WHERE ${Prisma.join(eventConditions, ' AND ')}
        ${ticketConditions.length ? Prisma.sql`AND ${Prisma.join(ticketConditions, ' AND ')}` : Prisma.empty}
        GROUP BY 1
      ) tr ON tr.day = d::date
      ORDER BY 1
    `;

    const total = rows.reduce((sum, row) => sum + Number(row.count), 0);
    return {
      data: {
        total,
        series: rows.map((row) => ({
          date:
            row.date instanceof Date
              ? row.date.toISOString().slice(0, 10)
              : String(row.date).slice(0, 10),
          count: Number(row.count),
        })),
      },
    };
  }
}
