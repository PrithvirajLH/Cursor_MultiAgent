import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TicketStatus, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

const RESOLVED_STATUSES = [TicketStatus.RESOLVED, TicketStatus.CLOSED];

@Injectable()
export class AgentsAdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns a list of all AGENT/LEAD/TEAM_ADMIN users with headline metrics.
   * Computed as a single aggregate query per row source for efficiency.
   */
  async list(actor: AuthUser) {
    if (
      actor.role !== UserRole.OWNER &&
      actor.role !== UserRole.TEAM_ADMIN
    ) {
      throw new ForbiddenException('Only admins can view agent analytics');
    }

    const isTeamAdmin = actor.role === UserRole.TEAM_ADMIN;
    if (isTeamAdmin && !actor.primaryTeamId) {
      return [];
    }
    const teamScopeId = isTeamAdmin ? actor.primaryTeamId! : null;

    const supportRoles: UserRole[] = [
      UserRole.AGENT,
      UserRole.LEAD,
      UserRole.TEAM_ADMIN,
    ];

    const userTeamFilter = teamScopeId
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM "TeamMember" tmem WHERE tmem."userId" = u.id AND tmem."teamId" = ${teamScopeId})`
      : Prisma.empty;
    const ticketTeamFilter = teamScopeId
      ? Prisma.sql`AND t."assignedTeamId" = ${teamScopeId}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        display_name: string;
        email: string;
        role: UserRole;
        is_active: boolean;
        primary_team_name: string | null;
        open_count: bigint;
        resolved_count: bigint;
        median_resolution_hours: number | null;
        last_activity: Date | null;
      }>
    >`
      SELECT
        u.id,
        u."displayName" AS display_name,
        u.email,
        u.role,
        u."isActive" AS is_active,
        tm.name AS primary_team_name,
        COALESCE(stats.open_count, 0)::bigint AS open_count,
        COALESCE(stats.resolved_count, 0)::bigint AS resolved_count,
        stats.median_resolution_hours,
        stats.last_activity
      FROM "User" u
      LEFT JOIN "Team" tm ON tm.id = u."primaryTeamId"
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (
            WHERE (t.status)::text NOT IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
          )::bigint AS open_count,
          COUNT(*) FILTER (
            WHERE (t.status)::text IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
          )::bigint AS resolved_count,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (t."resolvedAt" - t."createdAt")) / 3600
          ) FILTER (WHERE t."resolvedAt" IS NOT NULL)::float8 AS median_resolution_hours,
          MAX(t."updatedAt") AS last_activity
        FROM "Ticket" t
        WHERE t."assigneeId" = u.id
          ${ticketTeamFilter}
      ) stats ON true
      WHERE (u.role)::text IN (${Prisma.join(supportRoles)})
        ${userTeamFilter}
      ORDER BY COALESCE(stats.resolved_count, 0) DESC, u."displayName" ASC
    `;

    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      email: r.email,
      role: r.role,
      isActive: r.is_active,
      primaryTeamName: r.primary_team_name,
      openCount: Number(r.open_count),
      resolvedCount: Number(r.resolved_count),
      medianResolutionHours:
        r.median_resolution_hours != null
          ? Number(r.median_resolution_hours)
          : null,
      lastActivityAt: r.last_activity ? r.last_activity.toISOString() : null,
    }));
  }

  async getProfile(userId: string, actor: AuthUser) {
    if (
      actor.role !== UserRole.OWNER &&
      actor.role !== UserRole.TEAM_ADMIN
    ) {
      throw new ForbiddenException('Only admins can view agent profiles');
    }

    const isTeamAdmin = actor.role === UserRole.TEAM_ADMIN;
    if (isTeamAdmin && !actor.primaryTeamId) {
      throw new ForbiddenException('Not authorized for this team');
    }
    const teamScopeId = isTeamAdmin ? actor.primaryTeamId! : null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        email: true,
        role: true,
        department: true,
        location: true,
        isActive: true,
        deactivatedAt: true,
        primaryTeam: { select: { name: true } },
        teamMemberships: {
          select: { team: { select: { id: true, name: true } }, role: true },
        },
      },
    });
    if (!user) throw new NotFoundException('Agent not found');

    if (teamScopeId) {
      const isMember = user.teamMemberships.some(
        (m) => m.team.id === teamScopeId,
      );
      if (!isMember) {
        throw new ForbiddenException('Agent is not in your team');
      }
    }

    const ticketTeamFilter = teamScopeId
      ? Prisma.sql`AND t."assignedTeamId" = ${teamScopeId}`
      : Prisma.empty;

    // 1) Aggregate counts + median resolution
    const [aggRow] = await this.prisma.$queryRaw<
      Array<{
        open_count: bigint;
        resolved_count: bigint;
        reopened_count: bigint;
        sev1_open: bigint;
        sev2_open: bigint;
        sev3_open: bigint;
        sev4_open: bigint;
        sev1_resolved: bigint;
        sev2_resolved: bigint;
        sev3_resolved: bigint;
        sev4_resolved: bigint;
        median_resolution_hours: number | null;
        median_first_response_hours: number | null;
        sla_met_count: bigint;
        sla_total_count: bigint;
        last_activity: Date | null;
      }>
    >`
      SELECT
        COUNT(*) FILTER (
          WHERE (t.status)::text NOT IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
        )::bigint AS open_count,
        COUNT(*) FILTER (
          WHERE (t.status)::text IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED})
        )::bigint AS resolved_count,
        COUNT(*) FILTER (
          WHERE (t.status)::text = ${TicketStatus.REOPENED}
        )::bigint AS reopened_count,
        COUNT(*) FILTER (WHERE (t.priority)::text = 'SEV1' AND (t.status)::text NOT IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED}))::bigint AS sev1_open,
        COUNT(*) FILTER (WHERE (t.priority)::text = 'SEV2' AND (t.status)::text NOT IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED}))::bigint AS sev2_open,
        COUNT(*) FILTER (WHERE (t.priority)::text = 'SEV3' AND (t.status)::text NOT IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED}))::bigint AS sev3_open,
        COUNT(*) FILTER (WHERE (t.priority)::text = 'SEV4' AND (t.status)::text NOT IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED}))::bigint AS sev4_open,
        COUNT(*) FILTER (WHERE (t.priority)::text = 'SEV1' AND (t.status)::text IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED}))::bigint AS sev1_resolved,
        COUNT(*) FILTER (WHERE (t.priority)::text = 'SEV2' AND (t.status)::text IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED}))::bigint AS sev2_resolved,
        COUNT(*) FILTER (WHERE (t.priority)::text = 'SEV3' AND (t.status)::text IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED}))::bigint AS sev3_resolved,
        COUNT(*) FILTER (WHERE (t.priority)::text = 'SEV4' AND (t.status)::text IN (${TicketStatus.RESOLVED}, ${TicketStatus.CLOSED}))::bigint AS sev4_resolved,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (t."resolvedAt" - t."createdAt")) / 3600
        ) FILTER (WHERE t."resolvedAt" IS NOT NULL)::float8 AS median_resolution_hours,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (t."firstResponseAt" - t."createdAt")) / 3600
        ) FILTER (WHERE t."firstResponseAt" IS NOT NULL)::float8 AS median_first_response_hours,
        COUNT(*) FILTER (
          WHERE t."resolvedAt" IS NOT NULL
            AND t."dueAt" IS NOT NULL
            AND t."resolvedAt" <= t."dueAt"
        )::bigint AS sla_met_count,
        COUNT(*) FILTER (
          WHERE t."resolvedAt" IS NOT NULL AND t."dueAt" IS NOT NULL
        )::bigint AS sla_total_count,
        MAX(t."updatedAt") AS last_activity
      FROM "Ticket" t
      WHERE t."assigneeId" = ${userId}
        ${ticketTeamFilter}
    `;

    // 2) Daily resolved volume, last 30 days
    const dailyRows = await this.prisma.$queryRaw<
      Array<{ day: Date; count: bigint }>
    >`
      SELECT
        date_trunc('day', t."resolvedAt")::date AS day,
        COUNT(*)::bigint AS count
      FROM "Ticket" t
      WHERE t."assigneeId" = ${userId}
        AND t."resolvedAt" IS NOT NULL
        AND t."resolvedAt" >= NOW() - INTERVAL '30 days'
        ${ticketTeamFilter}
      GROUP BY day
      ORDER BY day ASC
    `;

    // 3) Recent tickets (last 10 they touched)
    const recentTickets = await this.prisma.ticket.findMany({
      where: {
        assigneeId: userId,
        ...(teamScopeId ? { assignedTeamId: teamScopeId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        displayId: true,
        number: true,
        subject: true,
        status: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
      },
    });

    // 4) Top tags worked
    const tagRows = await this.prisma.$queryRaw<
      Array<{ name: string; count: bigint }>
    >`
      SELECT tg.name, COUNT(*)::bigint AS count
      FROM "TicketTag" tt
      JOIN "Tag" tg ON tg.id = tt."tagId"
      JOIN "Ticket" t ON t.id = tt."ticketId"
      WHERE t."assigneeId" = ${userId}
        ${ticketTeamFilter}
      GROUP BY tg.name
      ORDER BY count DESC, tg.name ASC
      LIMIT 10
    `;

    const slaTotal = aggRow ? Number(aggRow.sla_total_count) : 0;
    const slaMet = aggRow ? Number(aggRow.sla_met_count) : 0;

    return {
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        department: user.department,
        location: user.location,
        isActive: user.isActive,
        deactivatedAt: user.deactivatedAt
          ? user.deactivatedAt.toISOString()
          : null,
        primaryTeamName: user.primaryTeam?.name ?? null,
        teamMemberships: user.teamMemberships.map((m) => ({
          teamId: m.team.id,
          teamName: m.team.name,
          role: m.role,
        })),
      },
      counts: {
        open: aggRow ? Number(aggRow.open_count) : 0,
        resolved: aggRow ? Number(aggRow.resolved_count) : 0,
        reopened: aggRow ? Number(aggRow.reopened_count) : 0,
      },
      bySev: {
        SEV1: {
          open: aggRow ? Number(aggRow.sev1_open) : 0,
          resolved: aggRow ? Number(aggRow.sev1_resolved) : 0,
        },
        SEV2: {
          open: aggRow ? Number(aggRow.sev2_open) : 0,
          resolved: aggRow ? Number(aggRow.sev2_resolved) : 0,
        },
        SEV3: {
          open: aggRow ? Number(aggRow.sev3_open) : 0,
          resolved: aggRow ? Number(aggRow.sev3_resolved) : 0,
        },
        SEV4: {
          open: aggRow ? Number(aggRow.sev4_open) : 0,
          resolved: aggRow ? Number(aggRow.sev4_resolved) : 0,
        },
      },
      timings: {
        medianResolutionHours:
          aggRow?.median_resolution_hours != null
            ? Number(aggRow.median_resolution_hours)
            : null,
        medianFirstResponseHours:
          aggRow?.median_first_response_hours != null
            ? Number(aggRow.median_first_response_hours)
            : null,
        slaCompliancePct:
          slaTotal > 0 ? Math.round((slaMet / slaTotal) * 1000) / 10 : null,
        slaSampleSize: slaTotal,
        lastActivityAt: aggRow?.last_activity
          ? aggRow.last_activity.toISOString()
          : null,
      },
      dailyResolved: dailyRows.map((r) => ({
        date: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
        count: Number(r.count),
      })),
      recentTickets: recentTickets.map((t) => ({
        id: t.id,
        displayId: t.displayId,
        number: t.number,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
      })),
      topTags: tagRows.map((r) => ({
        name: r.name,
        count: Number(r.count),
      })),
    };
  }
}

void RESOLVED_STATUSES; // referenced via TicketStatus enum
