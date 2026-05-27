import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuthUser } from '../auth/current-user.decorator';
import { Prisma, TeamAssignmentStrategy, UserRole } from '@prisma/client';
import { CreateRoutingRuleDto } from './dto/create-routing-rule.dto';
import { UpdateRoutingRuleDto } from './dto/update-routing-rule.dto';
import { parsePositiveInt } from '../common/config.utils';

type RoutingConditionRecord = { field: string; op: string; value: string };
type RoutingActionRecord = { type: string; value: string };

type RoutingRuleRow = {
  id: string;
  name: string;
  keywords: string[];
  teamId: string;
  assigneeId: string | null;
  priority: number;
  isActive: boolean;
  matchType: string;
  conditions: RoutingConditionRecord[] | null;
  actions: RoutingActionRecord[] | null;
  createdAt: Date;
  updatedAt: Date;
  teamName: string;
  teamAssignmentStrategy: TeamAssignmentStrategy;
  assigneeEmail: string | null;
  assigneeDisplayName: string | null;
  assigneeRole: string | null;
};

/**
 * Pull the legacy mirror fields (teamId / assigneeId / keywords) out of the
 * structured conditions+actions so the keyword executor and the AI advisory
 * tool keep working alongside the expanded engine.
 */
function deriveRoutingMirrors(payload: {
  conditions?: RoutingConditionRecord[];
  actions?: RoutingActionRecord[];
}) {
  const conditions = payload.conditions ?? [];
  const actions = payload.actions ?? [];
  const assignTeam = actions.find((a) => a.type === 'assign_team');
  const assignMember = actions.find((a) => a.type === 'assign_member');
  const keywordsFromConditions = conditions
    .filter((c) => c.field === 'subject' && c.op === 'contains')
    .map((c) => c.value);
  return {
    teamIdFromActions: assignTeam?.value,
    assigneeIdFromActions: assignMember?.value,
    keywordsFromConditions,
  };
}

@Injectable()
export class RoutingRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}
  private routingAssigneeColumnCache: {
    exists: boolean;
    checkedAtMs: number;
  } | null = null;
  private routingExpandedColumnCache: {
    exists: boolean;
    checkedAtMs: number;
  } | null = null;
  private readonly schemaCheckCacheTtlMs = parsePositiveInt(
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
    const scopeTeamId =
      user.role === UserRole.TEAM_ADMIN
        ? (user.primaryTeamId ?? undefined)
        : undefined;
    const rows = await this.listRuleRows(scopeTeamId);
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

    const hasExpanded = await this.hasRoutingExpandedColumns();
    const mirrors = deriveRoutingMirrors(payload);
    const teamId = this.resolveTeamIdForCreate(
      user,
      mirrors.teamIdFromActions ?? payload.teamId,
    );
    const assigneeId = await this.resolveAssigneeIdForCreate(
      user,
      mirrors.assigneeIdFromActions ?? payload.assigneeId,
      teamId,
    );
    const keywords = this.normalizeKeywords(
      (payload.conditions?.length ?? 0) > 0
        ? mirrors.keywordsFromConditions
        : (payload.keywords ?? []),
    );

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
    if (hasExpanded) {
      await this.writeExpandedColumns(
        created.id,
        payload.matchType,
        payload.conditions,
        payload.actions,
      );
    }

    const row = await this.findRuleRowById(created.id);
    if (!row) {
      throw new NotFoundException('Routing rule not found');
    }
    const createdRule = this.mapRuleRow(row);
    await this.safePublishAdminChanged({
      scope: 'routing_rule',
      action: 'created',
      entityId: createdRule.id,
      teamId: createdRule.teamId,
      actorId: user.id,
    });
    return createdRule;
  }

  async update(id: string, payload: UpdateRoutingRuleDto, user: AuthUser) {
    const hasAssigneeColumn = await this.hasRoutingAssigneeColumn();
    const hasExpanded = await this.hasRoutingExpandedColumns();
    const rule = await this.findRuleRowById(id);

    if (!rule) {
      throw new NotFoundException('Routing rule not found');
    }
    if (user.role === UserRole.TEAM_ADMIN && !hasAssigneeColumn) {
      throw new BadRequestException(
        'Member routing requires database migration. Please apply migration 20260211190000_add_routing_rule_assignee.',
      );
    }

    this.ensureTeamAdminOrOwner(user, rule.teamId);
    const mirrors = deriveRoutingMirrors(payload);
    const requestedTeamId = mirrors.teamIdFromActions ?? payload.teamId;
    const requestedAssigneeId =
      mirrors.assigneeIdFromActions ?? payload.assigneeId;
    const teamId = this.resolveTeamIdForUpdate(
      user,
      requestedTeamId,
      rule.teamId,
    );
    const assigneeId = await this.resolveAssigneeIdForUpdate(
      user,
      requestedAssigneeId,
      teamId,
      rule.assigneeId ?? null,
      requestedTeamId !== undefined,
    );

    const nextKeywords =
      (payload.conditions?.length ?? 0) > 0
        ? this.normalizeKeywords(mirrors.keywordsFromConditions)
        : payload.keywords
          ? this.normalizeKeywords(payload.keywords)
          : undefined;

    await this.prisma.routingRule.update({
      where: { id },
      data: {
        name: payload.name,
        teamId,
        keywords: nextKeywords,
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
    if (
      hasExpanded &&
      (payload.matchType !== undefined ||
        payload.conditions !== undefined ||
        payload.actions !== undefined)
    ) {
      await this.writeExpandedColumns(
        id,
        payload.matchType ?? rule.matchType,
        payload.conditions ?? rule.conditions ?? [],
        payload.actions ?? rule.actions ?? [],
      );
    }

    const updated = await this.findRuleRowById(id);
    if (!updated) {
      throw new NotFoundException('Routing rule not found');
    }
    const updatedRule = this.mapRuleRow(updated);
    await this.safePublishAdminChanged({
      scope: 'routing_rule',
      action: 'updated',
      entityId: updatedRule.id,
      teamId: updatedRule.teamId,
      actorId: user.id,
    });
    return updatedRule;
  }

  async remove(id: string, user: AuthUser) {
    const rule = await this.findRuleRowById(id);

    if (!rule) {
      throw new NotFoundException('Routing rule not found');
    }

    this.ensureTeamAdminOrOwner(user, rule.teamId);

    await this.prisma.routingRule.delete({ where: { id } });
    await this.safePublishAdminChanged({
      scope: 'routing_rule',
      action: 'deleted',
      entityId: id,
      teamId: rule.teamId,
      actorId: user.id,
    });
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
      matchType: row.matchType ?? 'ALL',
      conditions: Array.isArray(row.conditions) ? row.conditions : [],
      actions: Array.isArray(row.actions) ? row.actions : [],
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

  /**
   * Build the SELECT/FROM/JOIN fragment shared by list + findById, with columns
   * conditionally included based on which migrations have been applied (assignee
   * column, expanded condition/action columns). Falls back to safe defaults so
   * the API never crashes against a not-yet-migrated database.
   */
  private async buildRuleRowSelect() {
    const includeAssignee = await this.hasRoutingAssigneeColumn();
    const includeExpanded = await this.hasRoutingExpandedColumns();

    const assigneeIdCol = includeAssignee
      ? Prisma.sql`rr."assigneeId"`
      : Prisma.sql`NULL::text AS "assigneeId"`;
    const assigneeDetailCols = includeAssignee
      ? Prisma.sql`u."email" AS "assigneeEmail", u."displayName" AS "assigneeDisplayName", u."role" AS "assigneeRole"`
      : Prisma.sql`NULL::text AS "assigneeEmail", NULL::text AS "assigneeDisplayName", NULL::text AS "assigneeRole"`;
    const assigneeJoin = includeAssignee
      ? Prisma.sql`LEFT JOIN "User" u ON u."id" = rr."assigneeId"`
      : Prisma.empty;
    const matchTypeCol = includeExpanded
      ? Prisma.sql`rr."matchType"`
      : Prisma.sql`'ALL' AS "matchType"`;
    const conditionsCol = includeExpanded
      ? Prisma.sql`rr."conditions"`
      : Prisma.sql`'[]'::jsonb AS "conditions"`;
    const actionsCol = includeExpanded
      ? Prisma.sql`rr."actions"`
      : Prisma.sql`'[]'::jsonb AS "actions"`;

    return Prisma.sql`
      SELECT
        rr."id",
        rr."name",
        rr."keywords",
        rr."teamId",
        ${assigneeIdCol},
        rr."priority",
        rr."isActive",
        ${matchTypeCol},
        ${conditionsCol},
        ${actionsCol},
        rr."createdAt",
        rr."updatedAt",
        t."name" AS "teamName",
        t."assignmentStrategy" AS "teamAssignmentStrategy",
        ${assigneeDetailCols}
      FROM "RoutingRule" rr
      INNER JOIN "Team" t ON t."id" = rr."teamId"
      ${assigneeJoin}
    `;
  }

  private async listRuleRows(teamId?: string) {
    const select = await this.buildRuleRowSelect();
    const whereClause = teamId
      ? Prisma.sql`WHERE rr."teamId" = ${teamId}`
      : Prisma.empty;
    return this.prisma.$queryRaw<RoutingRuleRow[]>`
      ${select}
      ${whereClause}
      ORDER BY rr."priority" ASC, rr."name" ASC
    `;
  }

  private async findRuleRowById(id: string) {
    const select = await this.buildRuleRowSelect();
    const rows = await this.prisma.$queryRaw<RoutingRuleRow[]>`
      ${select}
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

  /** Persist the structured columns (guarded; only called when they exist). */
  private async writeExpandedColumns(
    id: string,
    matchType: string | undefined,
    conditions: RoutingConditionRecord[] | undefined,
    actions: RoutingActionRecord[] | undefined,
  ) {
    const normalizedMatch = matchType === 'ANY' ? 'ANY' : 'ALL';
    await this.prisma.$executeRaw`
      UPDATE "RoutingRule"
      SET "matchType" = ${normalizedMatch},
          "conditions" = ${JSON.stringify(conditions ?? [])}::jsonb,
          "actions" = ${JSON.stringify(actions ?? [])}::jsonb
      WHERE "id" = ${id}
    `;
  }

  private async safePublishAdminChanged(payload: {
    scope: string;
    action: string;
    entityId: string | null;
    teamId: string | null;
    actorId: string | null;
  }) {
    try {
      await this.realtime.publishAdminChanged(payload);
    } catch {
      // Best-effort realtime publish.
    }
  }
}
