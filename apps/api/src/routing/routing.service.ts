import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/current-user.decorator';
import { Prisma, TeamAssignmentStrategy, UserRole } from '@prisma/client';
import { CreateRoutingRuleDto } from './dto/create-routing-rule.dto';
import { UpdateRoutingRuleDto } from './dto/update-routing-rule.dto';

type RoutingRuleRow = {
  id: string;
  name: string;
  keywords: string[];
  teamId: string;
  assigneeId: string | null;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  teamName: string;
  teamAssignmentStrategy: TeamAssignmentStrategy;
  assigneeEmail: string | null;
  assigneeDisplayName: string | null;
  assigneeRole: string | null;
};

@Injectable()
export class RoutingRulesService {
  constructor(private readonly prisma: PrismaService) {}
  private routingAssigneeColumnCache: {
    exists: boolean;
    checkedAtMs: number;
  } | null = null;
  private readonly schemaCheckCacheTtlMs = this.parsePositiveIntEnv(
    process.env.SCHEMA_CHECK_CACHE_TTL_MS,
    300_000,
  );

  async list(user: AuthUser) {
    this.ensureRoutingReadAccess(user);
    if (user.role === UserRole.TEAM_ADMIN && !user.primaryTeamId) {
      throw new ForbiddenException(
        'Team administrator must have a primary team set',
      );
    }
    const hasAssigneeColumn = await this.hasRoutingAssigneeColumn();
    const scopeTeamId =
      user.role === UserRole.TEAM_ADMIN
        ? (user.primaryTeamId ?? undefined)
        : undefined;
    const rows = await this.listRuleRows(scopeTeamId, hasAssigneeColumn);
    const data = rows.map((row) => this.mapRuleRow(row));

    return { data };
  }

  async create(payload: CreateRoutingRuleDto, user: AuthUser) {
    const hasAssigneeColumn = await this.hasRoutingAssigneeColumn();
    if (user.role === UserRole.TEAM_ADMIN && !hasAssigneeColumn) {
      throw new BadRequestException(
        'Member routing requires database migration. Please apply migration 20260211190000_add_routing_rule_assignee.',
      );
    }

    const teamId = this.resolveTeamIdForCreate(user, payload.teamId);
    const assigneeId = await this.resolveAssigneeIdForCreate(
      user,
      payload.assigneeId,
      teamId,
    );
    const keywords = this.normalizeKeywords(payload.keywords);

    const created = await this.prisma.routingRule.create({
      data: {
        name: payload.name,
        teamId,
        keywords,
        priority: payload.priority ?? 100,
        isActive: payload.isActive ?? true,
      },
    });

    if (hasAssigneeColumn) {
      await this.prisma.$executeRaw`
        UPDATE "RoutingRule"
        SET "assigneeId" = ${assigneeId}
        WHERE "id" = ${created.id}
      `;
    }

    const row = await this.findRuleRowById(created.id, hasAssigneeColumn);
    if (!row) {
      throw new NotFoundException('Routing rule not found');
    }
    return this.mapRuleRow(row);
  }

  async update(id: string, payload: UpdateRoutingRuleDto, user: AuthUser) {
    const hasAssigneeColumn = await this.hasRoutingAssigneeColumn();
    const rule = await this.findRuleRowById(id, hasAssigneeColumn);

    if (!rule) {
      throw new NotFoundException('Routing rule not found');
    }
    if (user.role === UserRole.TEAM_ADMIN && !hasAssigneeColumn) {
      throw new BadRequestException(
        'Member routing requires database migration. Please apply migration 20260211190000_add_routing_rule_assignee.',
      );
    }

    this.ensureTeamAdminOrOwner(user, rule.teamId);
    const teamId = this.resolveTeamIdForUpdate(
      user,
      payload.teamId,
      rule.teamId,
    );
    const assigneeId = await this.resolveAssigneeIdForUpdate(
      user,
      payload.assigneeId,
      teamId,
      rule.assigneeId ?? null,
      payload.teamId !== undefined,
    );

    await this.prisma.routingRule.update({
      where: { id },
      data: {
        name: payload.name,
        teamId,
        keywords: payload.keywords
          ? this.normalizeKeywords(payload.keywords)
          : undefined,
        priority: payload.priority,
        isActive: payload.isActive,
      },
    });

    if (hasAssigneeColumn) {
      await this.prisma.$executeRaw`
        UPDATE "RoutingRule"
        SET "assigneeId" = ${assigneeId}
        WHERE "id" = ${id}
      `;
    }

    const updated = await this.findRuleRowById(id, hasAssigneeColumn);
    if (!updated) {
      throw new NotFoundException('Routing rule not found');
    }
    return this.mapRuleRow(updated);
  }

  async remove(id: string, user: AuthUser) {
    const hasAssigneeColumn = await this.hasRoutingAssigneeColumn();
    const rule = await this.findRuleRowById(id, hasAssigneeColumn);

    if (!rule) {
      throw new NotFoundException('Routing rule not found');
    }

    this.ensureTeamAdminOrOwner(user, rule.teamId);

    await this.prisma.routingRule.delete({ where: { id } });

    return { id };
  }

  private ensureTeamAdminOrOwner(user: AuthUser, teamId: string) {
    if (user.role === UserRole.OWNER) return;
    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId === teamId)
      return;
    throw new ForbiddenException('Team admin or owner access required');
  }

  private ensureRoutingReadAccess(user: AuthUser) {
    if (user.role === UserRole.OWNER || user.role === UserRole.TEAM_ADMIN) {
      return;
    }
    throw new ForbiddenException(
      'Routing rules access is restricted to owner or team admin',
    );
  }

  private resolveTeamIdForCreate(user: AuthUser, requestedTeamId?: string) {
    if (user.role === UserRole.OWNER) {
      if (!requestedTeamId) {
        throw new BadRequestException(
          'teamId is required for owner routing rules',
        );
      }
      return requestedTeamId;
    }
    if (user.role === UserRole.TEAM_ADMIN) {
      if (!user.primaryTeamId) {
        throw new ForbiddenException(
          'Team administrator must have a primary team set',
        );
      }
      if (requestedTeamId && requestedTeamId !== user.primaryTeamId) {
        throw new ForbiddenException('Team admin can only target primary team');
      }
      return user.primaryTeamId;
    }
    throw new ForbiddenException('Team admin or owner access required');
  }

  private resolveTeamIdForUpdate(
    user: AuthUser,
    requestedTeamId: string | undefined,
    currentTeamId: string,
  ) {
    if (user.role === UserRole.OWNER) {
      return requestedTeamId ?? currentTeamId;
    }
    if (user.role === UserRole.TEAM_ADMIN) {
      if (!user.primaryTeamId) {
        throw new ForbiddenException(
          'Team administrator must have a primary team set',
        );
      }
      if (currentTeamId !== user.primaryTeamId) {
        throw new ForbiddenException(
          'Team admin can only manage routing rules for primary team',
        );
      }
      if (requestedTeamId && requestedTeamId !== user.primaryTeamId) {
        throw new ForbiddenException('Team admin can only target primary team');
      }
      return user.primaryTeamId;
    }
    throw new ForbiddenException('Team admin or owner access required');
  }

  private async resolveAssigneeIdForCreate(
    user: AuthUser,
    requestedAssigneeId: string | undefined,
    teamId: string,
  ) {
    if (user.role === UserRole.OWNER) {
      if (requestedAssigneeId) {
        throw new ForbiddenException(
          'Owner routing rules can only target teams',
        );
      }
      return null;
    }
    if (user.role === UserRole.TEAM_ADMIN) {
      if (!requestedAssigneeId) {
        throw new BadRequestException(
          'assigneeId is required for team admin routing rules',
        );
      }
      await this.ensureAssigneeInTeam(requestedAssigneeId, teamId);
      return requestedAssigneeId;
    }
    throw new ForbiddenException('Team admin or owner access required');
  }

  private async resolveAssigneeIdForUpdate(
    user: AuthUser,
    requestedAssigneeId: string | undefined,
    teamId: string,
    currentAssigneeId: string | null,
    teamChanged: boolean,
  ) {
    if (user.role === UserRole.OWNER) {
      if (requestedAssigneeId) {
        throw new ForbiddenException(
          'Owner routing rules can only target teams',
        );
      }
      return teamChanged ? null : currentAssigneeId;
    }
    if (user.role === UserRole.TEAM_ADMIN) {
      const nextAssigneeId = requestedAssigneeId ?? currentAssigneeId;
      if (!nextAssigneeId) {
        return null;
      }
      await this.ensureAssigneeInTeam(nextAssigneeId, teamId);
      return nextAssigneeId;
    }
    throw new ForbiddenException('Team admin or owner access required');
  }

  private async ensureAssigneeInTeam(assigneeId: string, teamId: string) {
    const member = await this.prisma.teamMember.findFirst({
      where: { teamId, userId: assigneeId },
      select: { id: true },
    });
    if (!member) {
      throw new BadRequestException(
        'assigneeId must be a member of the selected team',
      );
    }
  }

  private normalizeKeywords(keywords: string[]) {
    return keywords
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0)
      .map((keyword) => keyword.toLowerCase());
  }

  private mapRuleRow(row: RoutingRuleRow) {
    return {
      id: row.id,
      name: row.name,
      keywords: row.keywords,
      teamId: row.teamId,
      assigneeId: row.assigneeId,
      priority: row.priority,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      team: {
        id: row.teamId,
        name: row.teamName,
        assignmentStrategy: row.teamAssignmentStrategy,
      },
      assignee: row.assigneeId
        ? {
            id: row.assigneeId,
            email: row.assigneeEmail ?? '',
            displayName: row.assigneeDisplayName ?? row.assigneeEmail ?? '',
            role: row.assigneeRole ?? undefined,
          }
        : null,
    };
  }

  private async listRuleRows(teamId?: string, includeAssignee = true) {
    const whereClause = teamId
      ? Prisma.sql`WHERE rr."teamId" = ${teamId}`
      : Prisma.empty;

    if (!includeAssignee) {
      return this.prisma.$queryRaw<RoutingRuleRow[]>`
        SELECT
          rr."id",
          rr."name",
          rr."keywords",
          rr."teamId",
          NULL::text AS "assigneeId",
          rr."priority",
          rr."isActive",
          rr."createdAt",
          rr."updatedAt",
          t."name" AS "teamName",
          t."assignmentStrategy" AS "teamAssignmentStrategy",
          NULL::text AS "assigneeEmail",
          NULL::text AS "assigneeDisplayName",
          NULL::text AS "assigneeRole"
        FROM "RoutingRule" rr
        INNER JOIN "Team" t ON t."id" = rr."teamId"
        ${whereClause}
        ORDER BY rr."priority" ASC, rr."name" ASC
      `;
    }

    return this.prisma.$queryRaw<RoutingRuleRow[]>`
      SELECT
        rr."id",
        rr."name",
        rr."keywords",
        rr."teamId",
        rr."assigneeId",
        rr."priority",
        rr."isActive",
        rr."createdAt",
        rr."updatedAt",
        t."name" AS "teamName",
        t."assignmentStrategy" AS "teamAssignmentStrategy",
        u."email" AS "assigneeEmail",
        u."displayName" AS "assigneeDisplayName",
        u."role" AS "assigneeRole"
      FROM "RoutingRule" rr
      INNER JOIN "Team" t ON t."id" = rr."teamId"
      LEFT JOIN "User" u ON u."id" = rr."assigneeId"
      ${whereClause}
      ORDER BY rr."priority" ASC, rr."name" ASC
    `;
  }

  private async findRuleRowById(id: string, includeAssignee = true) {
    if (!includeAssignee) {
      const rows = await this.prisma.$queryRaw<RoutingRuleRow[]>`
        SELECT
          rr."id",
          rr."name",
          rr."keywords",
          rr."teamId",
          NULL::text AS "assigneeId",
          rr."priority",
          rr."isActive",
          rr."createdAt",
          rr."updatedAt",
          t."name" AS "teamName",
          t."assignmentStrategy" AS "teamAssignmentStrategy",
          NULL::text AS "assigneeEmail",
          NULL::text AS "assigneeDisplayName",
          NULL::text AS "assigneeRole"
        FROM "RoutingRule" rr
        INNER JOIN "Team" t ON t."id" = rr."teamId"
        WHERE rr."id" = ${id}
        LIMIT 1
      `;

      return rows[0] ?? null;
    }

    const rows = await this.prisma.$queryRaw<RoutingRuleRow[]>`
      SELECT
        rr."id",
        rr."name",
        rr."keywords",
        rr."teamId",
        rr."assigneeId",
        rr."priority",
        rr."isActive",
        rr."createdAt",
        rr."updatedAt",
        t."name" AS "teamName",
        t."assignmentStrategy" AS "teamAssignmentStrategy",
        u."email" AS "assigneeEmail",
        u."displayName" AS "assigneeDisplayName",
        u."role" AS "assigneeRole"
      FROM "RoutingRule" rr
      INNER JOIN "Team" t ON t."id" = rr."teamId"
      LEFT JOIN "User" u ON u."id" = rr."assigneeId"
      WHERE rr."id" = ${id}
      LIMIT 1
    `;

    return rows[0] ?? null;
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
