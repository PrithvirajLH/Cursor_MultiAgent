import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

export type AuditEventType = string;

export type AuditLogEntry = {
  id: string;
  ticketId: string;
  ticketNumber: number;
  ticketDisplayId: string | null;
  type: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
  createdById: string | null;
  createdBy: { id: string; displayName: string; email: string } | null;
};

type AuditCategory = 'sla' | 'routing' | 'automation' | 'custom_fields';
type AuditCategoryCounts = Record<AuditCategory, number>;

type AdminAuditEventRow = {
  id: string;
  type: string;
  payload: unknown;
  createdAt: Date;
  createdById: string | null;
  userId: string | null;
  displayName: string | null;
  email: string | null;
};

type CombinedAuditRow = {
  entryId: string;
  ticketId: string | null;
  ticketNumber: number | null;
  ticketDisplayId: string | null;
  type: string;
  payload: unknown;
  createdAt: Date;
  createdById: string | null;
  createdByUserId: string | null;
  createdByDisplayName: string | null;
  createdByEmail: string | null;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  private adminAuditEventTableExists: boolean | null = null;

  async list(
    params: {
      dateFrom?: string;
      dateTo?: string;
      userId?: string;
      type?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
    user: AuthUser,
  ): Promise<{
    data: AuditLogEntry[];
    meta: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      categoryCounts: AuditCategoryCounts;
    };
  }> {
    this.ensureCanAccess(user);
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const offset = (page - 1) * pageSize;
    const { data, total, categoryCounts } =
      await this.listCombinedAuditEntriesPage(params, user, pageSize, offset);

    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        categoryCounts,
      },
    };
  }

  async exportCsv(
    params: {
      dateFrom?: string;
      dateTo?: string;
      userId?: string;
      type?: string;
      search?: string;
    },
    user: AuthUser,
  ): Promise<string> {
    this.ensureCanAccess(user);
    const data = await this.loadCombinedAuditEntries(params, user);

    const header = 'Date,User,Ticket,Action,Details';
    const rows = data.map((e) => {
      const date = e.createdAt.toISOString();
      const user = e.createdBy
        ? `"${(e.createdBy.displayName || e.createdBy.email).replace(/"/g, '""')}"`
        : 'System';
      const ticket =
        e.ticketDisplayId ??
        (e.ticketNumber > 0 ? `#${e.ticketNumber}` : 'N/A');
      const action = this.eventTypeLabel(e.type);
      const details = this.formatPayloadForCsv(e.type, e.payload);
      return `${date},${user},${ticket},${action},${details}`;
    });
    return [header, ...rows].join('\n');
  }

  private async listCombinedAuditEntriesPage(
    params: {
      dateFrom?: string;
      dateTo?: string;
      userId?: string;
      type?: string;
      search?: string;
    },
    user: AuthUser,
    limit: number,
    offset: number,
  ): Promise<{
    data: AuditLogEntry[];
    total: number;
    categoryCounts: AuditCategoryCounts;
  }> {
    const hasAdminTable = await this.hasAdminAuditEventTable();
    const ticketWhereClause = this.buildTicketAuditSqlWhereClause(params, user);
    const adminWhereClause = this.buildAdminAuditSqlWhereClause(params, user);

    const ticketQuery = Prisma.sql`
      SELECT
        te."id" AS "entryId",
        te."ticketId" AS "ticketId",
        t."number" AS "ticketNumber",
        t."displayId" AS "ticketDisplayId",
        te."type" AS "type",
        te."payload" AS "payload",
        te."createdAt" AS "createdAt",
        te."createdById" AS "createdById",
        u."id" AS "createdByUserId",
        u."displayName" AS "createdByDisplayName",
        u."email" AS "createdByEmail"
      FROM "TicketEvent" te
      INNER JOIN "Ticket" t ON t."id" = te."ticketId"
      LEFT JOIN "User" u ON u."id" = te."createdById"
      ${ticketWhereClause}
    `;

    const adminQuery = Prisma.sql`
      SELECT
        ('admin:' || a."id")::text AS "entryId",
        NULL::text AS "ticketId",
        NULL::int AS "ticketNumber",
        NULL::text AS "ticketDisplayId",
        a."type" AS "type",
        a."payload" AS "payload",
        a."createdAt" AS "createdAt",
        a."createdById" AS "createdById",
        u."id" AS "createdByUserId",
        u."displayName" AS "createdByDisplayName",
        u."email" AS "createdByEmail"
      FROM "AdminAuditEvent" a
      LEFT JOIN "User" u ON u."id" = a."createdById"
      ${adminWhereClause}
    `;

    const combinedQuery = hasAdminTable
      ? Prisma.sql`(${ticketQuery} UNION ALL ${adminQuery})`
      : Prisma.sql`(${ticketQuery})`;

    const [rows, totalRows, categoryRows] = await Promise.all([
      this.prisma.$queryRaw<CombinedAuditRow[]>`
        SELECT *
        FROM ${combinedQuery} AS "combined"
        ORDER BY "createdAt" DESC, "entryId" DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT count(*)::bigint AS "count"
        FROM ${combinedQuery} AS "combined"
      `,
      this.prisma.$queryRaw<Array<{ category: AuditCategory; count: bigint }>>`
        SELECT "category", count(*)::bigint AS "count"
        FROM (
          SELECT
            CASE
              WHEN lower("type") LIKE '%custom%'
                OR lower("type") LIKE '%field%'
                OR lower(COALESCE("payload"::text, '')) LIKE '%customfield%'
              THEN 'custom_fields'
              WHEN lower("type") LIKE '%automation%'
                OR lower("type") LIKE '%auto%'
                OR lower(COALESCE("payload"::text, '')) LIKE '%automation%'
              THEN 'automation'
              WHEN lower("type") LIKE '%assign%'
                OR lower("type") LIKE '%transfer%'
                OR lower("type") LIKE '%team%'
              THEN 'routing'
              ELSE 'sla'
            END AS "category"
          FROM ${combinedQuery} AS "combined"
        ) AS "categorized"
        GROUP BY "category"
      `,
    ]);

    const data = rows.map((row) => ({
      id: row.entryId,
      ticketId: row.ticketId ?? '',
      ticketNumber: row.ticketNumber ?? 0,
      ticketDisplayId: row.ticketDisplayId ?? null,
      type: row.type,
      payload: (row.payload as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt,
      createdById: row.createdById,
      createdBy:
        row.createdByUserId && row.createdByEmail
          ? {
              id: row.createdByUserId,
              displayName: row.createdByDisplayName ?? row.createdByEmail,
              email: row.createdByEmail,
            }
          : null,
    }));

    const categoryCounts: AuditCategoryCounts = {
      sla: 0,
      routing: 0,
      automation: 0,
      custom_fields: 0,
    };
    for (const row of categoryRows) {
      categoryCounts[row.category] = Number(row.count);
    }

    return {
      data,
      total: Number(totalRows[0]?.count ?? 0),
      categoryCounts,
    };
  }

  private buildTicketAuditSqlWhereClause(
    params: {
      dateFrom?: string;
      dateTo?: string;
      userId?: string;
      type?: string;
      search?: string;
    },
    user: AuthUser,
  ): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];

    if (params.dateFrom) {
      conditions.push(
        Prisma.sql`te."createdAt" >= ${new Date(params.dateFrom)}`,
      );
    }
    if (params.dateTo) {
      const to = new Date(params.dateTo);
      to.setUTCHours(23, 59, 59, 999);
      conditions.push(Prisma.sql`te."createdAt" <= ${to}`);
    }
    if (params.userId) {
      conditions.push(Prisma.sql`te."createdById" = ${params.userId}`);
    }
    if (params.type) {
      conditions.push(Prisma.sql`te."type" = ${params.type}`);
    }
    if (user.role === UserRole.TEAM_ADMIN) {
      conditions.push(Prisma.sql`t."assignedTeamId" = ${user.primaryTeamId}`);
    }

    const search = params.search?.trim();
    if (search) {
      const like = `%${search}%`;
      conditions.push(Prisma.sql`
        (
          te."type" ILIKE ${like}
          OR COALESCE(t."displayId", '') ILIKE ${like}
          OR CAST(t."number" AS TEXT) LIKE ${like}
          OR COALESCE(u."displayName", '') ILIKE ${like}
          OR COALESCE(u."email", '') ILIKE ${like}
          OR COALESCE(te."payload"::text, '') ILIKE ${like}
        )
      `);
    }

    return conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
  }

  private buildAdminAuditSqlWhereClause(
    params: {
      dateFrom?: string;
      dateTo?: string;
      userId?: string;
      type?: string;
      search?: string;
    },
    user: AuthUser,
  ): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];

    if (params.dateFrom) {
      conditions.push(
        Prisma.sql`a."createdAt" >= ${new Date(params.dateFrom)}`,
      );
    }
    if (params.dateTo) {
      const to = new Date(params.dateTo);
      to.setUTCHours(23, 59, 59, 999);
      conditions.push(Prisma.sql`a."createdAt" <= ${to}`);
    }
    if (params.userId) {
      conditions.push(Prisma.sql`a."createdById" = ${params.userId}`);
    }
    if (params.type) {
      conditions.push(Prisma.sql`a."type" = ${params.type}`);
    }
    if (user.role === UserRole.TEAM_ADMIN) {
      conditions.push(Prisma.sql`a."teamId" = ${user.primaryTeamId}`);
    }

    const search = params.search?.trim();
    if (search) {
      const like = `%${search}%`;
      conditions.push(Prisma.sql`
        (
          a."type" ILIKE ${like}
          OR COALESCE(u."displayName", '') ILIKE ${like}
          OR COALESCE(u."email", '') ILIKE ${like}
          OR COALESCE(a."payload"::text, '') ILIKE ${like}
        )
      `);
    }

    return conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
  }

  private async loadCombinedAuditEntries(
    params: {
      dateFrom?: string;
      dateTo?: string;
      userId?: string;
      type?: string;
      search?: string;
    },
    user: AuthUser,
    maxRows?: number,
  ): Promise<AuditLogEntry[]> {
    const ticketWhere = this.buildWhere({ ...params, search: undefined }, user);
    const [ticketData, adminData] = await Promise.all([
      this.prisma.ticketEvent.findMany({
        where: ticketWhere,
        orderBy: { createdAt: 'desc' },
        ...(typeof maxRows === 'number' ? { take: maxRows } : {}),
        include: {
          ticket: { select: { id: true, number: true, displayId: true } },
          createdBy: { select: { id: true, displayName: true, email: true } },
        },
      }),
      this.listAdminAuditEvents(params, user, maxRows),
    ]);

    const entries: AuditLogEntry[] = [
      ...ticketData.map((e) => ({
        id: e.id,
        ticketId: e.ticketId,
        ticketNumber: e.ticket.number,
        ticketDisplayId: e.ticket.displayId,
        type: e.type,
        payload: e.payload as Record<string, unknown> | null,
        createdAt: e.createdAt,
        createdById: e.createdById,
        createdBy: e.createdBy,
      })),
      ...adminData.map((e) => ({
        id: `admin:${e.id}`,
        ticketId: '',
        ticketNumber: 0,
        ticketDisplayId: null,
        type: e.type,
        payload: (e.payload as Record<string, unknown> | null) ?? null,
        createdAt: e.createdAt,
        createdById: e.createdById,
        createdBy:
          e.userId && e.email
            ? {
                id: e.userId,
                displayName: e.displayName ?? e.email,
                email: e.email,
              }
            : null,
      })),
    ];

    const filtered = params.search?.trim()
      ? entries.filter((entry) =>
          this.matchesSearch(entry, params.search!.trim()),
        )
      : entries;

    return filtered.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  /** Count ticket events matching filters (for DB-level pagination). */
  private async countTicketEvents(
    params: {
      dateFrom?: string;
      dateTo?: string;
      userId?: string;
      type?: string;
    },
    user: AuthUser,
  ): Promise<number> {
    const ticketWhere = this.buildWhere({ ...params, search: undefined }, user);
    return this.prisma.ticketEvent.count({ where: ticketWhere });
  }

  /** Load a page of ticket events (for DB-level pagination). */
  private async loadTicketEvents(
    params: {
      dateFrom?: string;
      dateTo?: string;
      userId?: string;
      type?: string;
    },
    user: AuthUser,
    take: number,
    skip: number,
  ) {
    const ticketWhere = this.buildWhere({ ...params, search: undefined }, user);
    return this.prisma.ticketEvent.findMany({
      where: ticketWhere,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: {
        ticket: { select: { id: true, number: true, displayId: true } },
        createdBy: { select: { id: true, displayName: true, email: true } },
      },
    });
  }

  /** Count admin audit events matching filters (for DB-level pagination). */
  private async countAdminAuditEvents(
    params: {
      dateFrom?: string;
      dateTo?: string;
      userId?: string;
      type?: string;
    },
    user: AuthUser,
  ): Promise<number> {
    const hasTable = await this.hasAdminAuditEventTable();
    if (!hasTable) return 0;

    const conditions: Prisma.Sql[] = [];
    if (params.dateFrom) {
      conditions.push(
        Prisma.sql`a."createdAt" >= ${new Date(params.dateFrom)}`,
      );
    }
    if (params.dateTo) {
      const to = new Date(params.dateTo);
      to.setUTCHours(23, 59, 59, 999);
      conditions.push(Prisma.sql`a."createdAt" <= ${to}`);
    }
    if (params.userId) {
      conditions.push(Prisma.sql`a."createdById" = ${params.userId}`);
    }
    if (params.type) {
      conditions.push(Prisma.sql`a."type" = ${params.type}`);
    }
    if (user.role === UserRole.TEAM_ADMIN) {
      conditions.push(Prisma.sql`a."teamId" = ${user.primaryTeamId}`);
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT count(*)::bigint as count FROM "AdminAuditEvent" a ${whereClause}
    `;
    return Number(rows[0]?.count ?? 0);
  }

  private matchesSearch(entry: AuditLogEntry, query: string) {
    const q = query.toLowerCase();
    if (entry.type.toLowerCase().includes(q)) return true;
    if ((entry.ticketDisplayId ?? '').toLowerCase().includes(q)) return true;
    if (entry.ticketNumber > 0 && String(entry.ticketNumber).includes(q))
      return true;
    if ((entry.createdBy?.displayName ?? '').toLowerCase().includes(q))
      return true;
    if ((entry.createdBy?.email ?? '').toLowerCase().includes(q)) return true;
    if (entry.payload) {
      const payloadText = JSON.stringify(entry.payload).toLowerCase();
      if (payloadText.includes(q)) return true;
    }
    return false;
  }

  private async listAdminAuditEvents(
    params: {
      dateFrom?: string;
      dateTo?: string;
      userId?: string;
      type?: string;
    },
    user: AuthUser,
    limit?: number,
    offset = 0,
  ): Promise<AdminAuditEventRow[]> {
    const hasTable = await this.hasAdminAuditEventTable();
    if (!hasTable) return [];

    const conditions: Prisma.Sql[] = [];
    if (params.dateFrom) {
      conditions.push(
        Prisma.sql`a."createdAt" >= ${new Date(params.dateFrom)}`,
      );
    }
    if (params.dateTo) {
      const to = new Date(params.dateTo);
      to.setUTCHours(23, 59, 59, 999);
      conditions.push(Prisma.sql`a."createdAt" <= ${to}`);
    }
    if (params.userId) {
      conditions.push(Prisma.sql`a."createdById" = ${params.userId}`);
    }
    if (params.type) {
      conditions.push(Prisma.sql`a."type" = ${params.type}`);
    }
    if (user.role === UserRole.TEAM_ADMIN) {
      conditions.push(Prisma.sql`a."teamId" = ${user.primaryTeamId}`);
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;

    const limitOffsetClause =
      typeof limit === 'number'
        ? Prisma.sql`LIMIT ${limit} OFFSET ${offset}`
        : Prisma.empty;

    return this.prisma.$queryRaw<AdminAuditEventRow[]>`
      SELECT
        a."id",
        a."type",
        a."payload",
        a."createdAt",
        a."createdById",
        u."id" AS "userId",
        u."displayName",
        u."email"
      FROM "AdminAuditEvent" a
      LEFT JOIN "User" u ON u."id" = a."createdById"
      ${whereClause}
      ORDER BY a."createdAt" DESC
      ${limitOffsetClause}
    `;
  }

  private async hasAdminAuditEventTable() {
    if (this.adminAuditEventTableExists !== null) {
      return this.adminAuditEventTableExists;
    }

    try {
      const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name = 'AdminAuditEvent'
        ) AS "exists"
      `;
      this.adminAuditEventTableExists = Boolean(rows[0]?.exists);
    } catch {
      this.adminAuditEventTableExists = false;
    }

    return this.adminAuditEventTableExists;
  }

  private buildWhere(
    params: {
      dateFrom?: string;
      dateTo?: string;
      userId?: string;
      type?: string;
      search?: string;
    },
    user: AuthUser,
  ): Prisma.TicketEventWhereInput {
    const conditions: Prisma.TicketEventWhereInput[] = [];

    if (params.dateFrom) {
      conditions.push({ createdAt: { gte: new Date(params.dateFrom) } });
    }
    if (params.dateTo) {
      const to = new Date(params.dateTo);
      to.setUTCHours(23, 59, 59, 999);
      conditions.push({ createdAt: { lte: to } });
    }
    if (params.userId) {
      conditions.push({ createdById: params.userId });
    }
    if (params.type) {
      conditions.push({ type: params.type });
    }
    if (params.search?.trim()) {
      const q = params.search.trim();
      const num = parseInt(q, 10);
      if (!Number.isNaN(num)) {
        // Numeric query: match ticket number only (and displayId e.g. IT-1234)
        conditions.push({
          OR: [
            { ticket: { number: num } },
            { ticket: { displayId: { contains: q, mode: 'insensitive' } } },
          ],
        });
      } else {
        // Text query: match displayId, user name, or user email
        conditions.push({
          OR: [
            { ticket: { displayId: { contains: q, mode: 'insensitive' } } },
            {
              createdBy: { displayName: { contains: q, mode: 'insensitive' } },
            },
            { createdBy: { email: { contains: q, mode: 'insensitive' } } },
          ],
        });
      }
    }

    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) {
      conditions.push({ ticket: { assignedTeamId: user.primaryTeamId } });
    }

    return conditions.length > 0 ? { AND: conditions } : {};
  }

  private ensureCanAccess(user: AuthUser) {
    if (user.role === UserRole.OWNER) return;
    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId) return;
    throw new ForbiddenException(
      'Audit log is restricted to owners and team administrators',
    );
  }

  private eventTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      TICKET_CREATED: 'Created ticket',
      TICKET_ASSIGNED: 'Assigned ticket',
      TICKET_TRANSFERRED: 'Transferred ticket',
      TICKET_STATUS_CHANGED: 'Changed status',
      TICKET_PRIORITY_CHANGED: 'Changed priority',
      MESSAGE_ADDED: 'Added message',
      ATTACHMENT_ADDED: 'Added attachment',
      AUTOMATION_RULE_CREATED: 'Created automation rule',
      AUTOMATION_RULE_UPDATED: 'Updated automation rule',
      AUTOMATION_RULE_DELETED: 'Deleted automation rule',
      AUTOMATION_RULE_EXECUTED: 'Automation rule executed',
      CUSTOM_FIELD_CREATED: 'Created custom field',
      CUSTOM_FIELD_UPDATED: 'Updated custom field',
      CUSTOM_FIELD_DELETED: 'Deleted custom field',
    };
    return labels[type] ?? type;
  }

  private countCategories(entries: AuditLogEntry[]): AuditCategoryCounts {
    const counts: AuditCategoryCounts = {
      sla: 0,
      routing: 0,
      automation: 0,
      custom_fields: 0,
    };
    for (const entry of entries) {
      counts[this.inferCategory(entry)] += 1;
    }
    return counts;
  }

  private inferCategory(entry: AuditLogEntry): AuditCategory {
    const type = entry.type.toLowerCase();
    const payloadKeys = Object.keys(entry.payload ?? {}).map((key) =>
      key.toLowerCase(),
    );

    if (
      type.includes('custom') ||
      type.includes('field') ||
      payloadKeys.some((key) => key.includes('customfield'))
    ) {
      return 'custom_fields';
    }
    if (
      type.includes('automation') ||
      type.includes('auto') ||
      payloadKeys.some((key) => key.includes('automation'))
    ) {
      return 'automation';
    }
    if (
      type.includes('assign') ||
      type.includes('transfer') ||
      type.includes('team')
    ) {
      return 'routing';
    }
    return 'sla';
  }

  private formatPayloadForCsv(
    type: string,
    payload: Record<string, unknown> | null,
  ): string {
    if (!payload) return '""';
    const parts: string[] = [];
    if (
      type === 'TICKET_STATUS_CHANGED' &&
      payload.from != null &&
      payload.to != null
    ) {
      parts.push(
        `from ${this.serializePayloadValue(payload.from)} to ${this.serializePayloadValue(payload.to)}`,
      );
    }
    if (
      type === 'TICKET_PRIORITY_CHANGED' &&
      payload.from != null &&
      payload.to != null
    ) {
      parts.push(
        `from ${this.serializePayloadValue(payload.from)} to ${this.serializePayloadValue(payload.to)}`,
      );
    }
    if (type === 'TICKET_TRANSFERRED' && payload.toTeamId) {
      parts.push(`to team ${this.serializePayloadValue(payload.toTeamId)}`);
    }
    const str = parts.length ? parts.join('; ') : JSON.stringify(payload);
    return `"${String(str).replace(/"/g, '""')}"`;
  }

  private serializePayloadValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    const serialized = JSON.stringify(value);
    return serialized ?? '';
  }
}
