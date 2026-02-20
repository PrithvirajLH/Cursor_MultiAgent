import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, TicketPriority, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ListSlasDto } from './dto/list-slas.dto';
import {
  CreateSlaPolicyConfigDto,
  UpdateSlaPolicyConfigDto,
} from './dto/policy-config.dto';
import { UpdateSlaBusinessHoursDto } from './dto/sla-business-hours.dto';
import { UpdateSlaPolicyDto } from './dto/update-sla.dto';

const PRIORITIES: TicketPriority[] = [
  TicketPriority.P1,
  TicketPriority.P2,
  TicketPriority.P3,
  TicketPriority.P4,
];

const WEEK_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

type WeekDay = (typeof WEEK_DAYS)[number];

type BusinessDay = {
  day: WeekDay;
  enabled: boolean;
  start: string;
  end: string;
};

type Holiday = {
  name: string;
  date: string;
};

type PolicyRow = {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  enabled: boolean;
  businessHoursOnly: boolean;
  escalationEnabled: boolean;
  escalationAfterPercent: number;
  breachNotifyRoles: string[];
  createdAt: Date;
  updatedAt: Date;
};

type PolicyTargetRow = {
  policyConfigId: string;
  priority: TicketPriority;
  firstResponseHours: number;
  resolutionHours: number;
};

type PolicyAssignmentRow = {
  policyConfigId: string;
  teamId: string;
  teamName: string;
};

type PolicyGraph = PolicyRow & {
  targets: Array<{
    priority: TicketPriority;
    firstResponseHours: number;
    resolutionHours: number;
  }>;
  assignments: Array<{
    teamId: string;
    teamName: string;
  }>;
};

type BusinessSettingsRow = {
  id: string;
  timezone: string;
  schedule: Prisma.JsonValue;
  holidays: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

type PrismaTx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class SlasService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly defaultSlaConfig: Record<
    TicketPriority,
    { firstResponseHours: number; resolutionHours: number }
  > = {
    [TicketPriority.P1]: { firstResponseHours: 1, resolutionHours: 4 },
    [TicketPriority.P2]: { firstResponseHours: 4, resolutionHours: 24 },
    [TicketPriority.P3]: { firstResponseHours: 8, resolutionHours: 72 },
    [TicketPriority.P4]: { firstResponseHours: 24, resolutionHours: 168 },
  };

  private readonly defaultSchedule: BusinessDay[] = [
    { day: 'Monday', enabled: true, start: '09:00', end: '18:00' },
    { day: 'Tuesday', enabled: true, start: '09:00', end: '18:00' },
    { day: 'Wednesday', enabled: true, start: '09:00', end: '18:00' },
    { day: 'Thursday', enabled: true, start: '09:00', end: '18:00' },
    { day: 'Friday', enabled: true, start: '09:00', end: '17:00' },
    { day: 'Saturday', enabled: false, start: '10:00', end: '14:00' },
    { day: 'Sunday', enabled: false, start: '10:00', end: '14:00' },
  ];

  // Legacy endpoints used by older admin pages.
  async list(query: ListSlasDto, user: AuthUser) {
    this.ensureTeamReadAccess(user, query.teamId);
    await this.ensureTeam(query.teamId);
    await this.ensurePolicyConfigsSeeded();
    const effective = await this.resolveEffectivePolicyForTeam(
      query.teamId,
      this.prisma,
    );
    const policyMap =
      effective.policyId != null
        ? await this.loadPolicyTargetMap(effective.policyId, this.prisma)
        : new Map<
            TicketPriority,
            { firstResponseHours: number; resolutionHours: number }
          >();

    return {
      data: PRIORITIES.map((priority) => {
        const target = policyMap.get(priority);
        const defaults = this.defaultSlaConfig[priority];
        return {
          priority,
          firstResponseHours:
            target?.firstResponseHours ?? defaults.firstResponseHours,
          resolutionHours: target?.resolutionHours ?? defaults.resolutionHours,
          source: target ? effective.source : 'default',
        };
      }),
    };
  }

  // Legacy endpoint used by older admin pages.
  async update(teamId: string, payload: UpdateSlaPolicyDto, user: AuthUser) {
    this.ensureTeamAdminOrOwner(user, teamId);
    await this.ensureTeam(teamId);
    await this.ensurePolicyConfigsSeeded();

    const byPriority = new Map(
      (payload.policies ?? []).map((policy) => [policy.priority, policy]),
    );
    const effective = await this.resolveEffectivePolicyForTeam(
      teamId,
      this.prisma,
    );
    const currentTargets =
      effective.policyId != null
        ? await this.loadPolicyTargetMap(effective.policyId, this.prisma)
        : new Map<
            TicketPriority,
            { firstResponseHours: number; resolutionHours: number }
          >();

    const nextTargets = PRIORITIES.map((priority) => {
      const incoming = byPriority.get(priority);
      if (incoming) {
        return {
          priority,
          firstResponseHours: incoming.firstResponseHours,
          resolutionHours: incoming.resolutionHours,
        };
      }
      const current =
        currentTargets.get(priority) ?? this.defaultSlaConfig[priority];
      return {
        priority,
        firstResponseHours: current.firstResponseHours,
        resolutionHours: current.resolutionHours,
      };
    });

    await this.prisma.$transaction(async (tx) => {
      let targetPolicyId: string | null = null;
      if (effective.source === 'team' && effective.policyId) {
        const usageRows = await tx.$queryRaw<
          Array<{ isDefault: boolean; assignmentCount: bigint }>
        >`
          SELECT
            p."isDefault" AS "isDefault",
            (
              SELECT count(*)::bigint
              FROM "SlaPolicyAssignment" a
              WHERE a."policyConfigId" = p."id"
            ) AS "assignmentCount"
          FROM "SlaPolicyConfig" p
          WHERE p."id" = ${effective.policyId}
          LIMIT 1
        `;
        const usage = usageRows[0];
        if (usage && !usage.isDefault && Number(usage.assignmentCount) === 1) {
          targetPolicyId = effective.policyId;
        }
      }

      if (targetPolicyId) {
        await tx.$executeRaw`
          DELETE FROM "SlaPolicyConfigTarget"
          WHERE "policyConfigId" = ${targetPolicyId}
        `;
        for (const target of nextTargets) {
          await tx.$executeRaw`
            INSERT INTO "SlaPolicyConfigTarget"
              ("id", "policyConfigId", "priority", "firstResponseHours", "resolutionHours", "createdAt", "updatedAt")
            VALUES
              (${randomUUID()}, ${targetPolicyId}, ${target.priority}::"TicketPriority", ${target.firstResponseHours}, ${target.resolutionHours}, NOW(), NOW())
          `;
        }
        await tx.$executeRaw`
          UPDATE "SlaPolicyConfig"
          SET "updatedAt" = NOW()
          WHERE "id" = ${targetPolicyId}
        `;
        return;
      }

      const settingsRows = effective.policyId
        ? await tx.$queryRaw<
            Array<{
              enabled: boolean;
              businessHoursOnly: boolean;
              escalationEnabled: boolean;
              escalationAfterPercent: number;
              breachNotifyRoles: string[];
            }>
          >`
            SELECT
              p."enabled" AS "enabled",
              p."businessHoursOnly" AS "businessHoursOnly",
              p."escalationEnabled" AS "escalationEnabled",
              p."escalationAfterPercent" AS "escalationAfterPercent",
              p."breachNotifyRoles" AS "breachNotifyRoles"
            FROM "SlaPolicyConfig" p
            WHERE p."id" = ${effective.policyId}
            LIMIT 1
          `
        : [];
      const settings = settingsRows[0];

      await tx.$executeRaw`
        DELETE FROM "SlaPolicyAssignment"
        WHERE "teamId" = ${teamId}
      `;

      await this.insertPolicyConfig(tx, {
        policyId: randomUUID(),
        name: `Team ${teamId} SLA`,
        description: 'Managed via legacy SLA endpoint.',
        isDefault: false,
        enabled: settings?.enabled ?? true,
        businessHoursOnly: settings?.businessHoursOnly ?? true,
        escalationEnabled: settings?.escalationEnabled ?? true,
        escalationAfterPercent: settings?.escalationAfterPercent ?? 80,
        breachNotifyRoles: this.normalizeNotifyRoles(
          settings?.breachNotifyRoles,
        ),
        createdById: user.id,
        targets: nextTargets,
        teamIds: [teamId],
      });
    });

    return this.list({ teamId }, user);
  }

  // Legacy endpoint used by older admin pages.
  async reset(teamId: string, user: AuthUser) {
    this.ensureTeamAdminOrOwner(user, teamId);
    await this.ensureTeam(teamId);
    await this.ensurePolicyConfigsSeeded();
    await this.prisma.$executeRaw`
      DELETE FROM "SlaPolicyAssignment"
      WHERE "teamId" = ${teamId}
    `;

    return this.list({ teamId }, user);
  }

  async listPolicyConfigs(user: AuthUser) {
    await this.ensurePolicyConfigsSeeded();
    const scopeTeamIds = this.policyReadScope(user);
    const isOwner = user.role === UserRole.OWNER;

    const rows = isOwner
      ? await this.prisma.$queryRaw<PolicyRow[]>`
          SELECT
            p."id",
            p."name",
            p."description",
            p."isDefault",
            p."enabled",
            p."businessHoursOnly",
            p."escalationEnabled",
            p."escalationAfterPercent",
            p."breachNotifyRoles" as "breachNotifyRoles",
            p."createdAt",
            p."updatedAt"
          FROM "SlaPolicyConfig" p
          ORDER BY p."isDefault" DESC, p."createdAt" ASC
        `
      : await this.prisma.$queryRaw<PolicyRow[]>`
          SELECT
            p."id",
            p."name",
            p."description",
            p."isDefault",
            p."enabled",
            p."businessHoursOnly",
            p."escalationEnabled",
            p."escalationAfterPercent",
            p."breachNotifyRoles" as "breachNotifyRoles",
            p."createdAt",
            p."updatedAt"
          FROM "SlaPolicyConfig" p
          WHERE p."isDefault" = true
            OR EXISTS (
              SELECT 1
              FROM "SlaPolicyAssignment" a
              WHERE a."policyConfigId" = p."id"
                AND a."teamId" IN (${Prisma.join(scopeTeamIds)})
            )
          ORDER BY p."isDefault" DESC, p."createdAt" ASC
        `;

    const graph = await this.loadPolicyGraph(rows, this.prisma);
    return {
      data: graph.map((policy) =>
        this.serializePolicy(policy, isOwner ? null : new Set(scopeTeamIds)),
      ),
    };
  }

  async createPolicyConfig(payload: CreateSlaPolicyConfigDto, user: AuthUser) {
    const writeScope = this.policyWriteScope(user);
    const isOwner = user.role === UserRole.OWNER;
    const requestedTeamIds = this.unique(payload.appliedTeamIds ?? []);
    const teamIds = isOwner
      ? requestedTeamIds
      : requestedTeamIds.length > 0
        ? requestedTeamIds
        : [writeScope[0]];

    if (!isOwner && payload.isDefault) {
      throw new ForbiddenException('Only owner can set default SLA policy');
    }
    if (!isOwner && teamIds.some((teamId) => teamId !== writeScope[0])) {
      throw new ForbiddenException(
        'Team admin can only scope SLA policy to primary team',
      );
    }
    if ((payload.isDefault ?? false) && payload.enabled === false) {
      throw new BadRequestException('Default SLA policy cannot be disabled');
    }

    await this.ensureTeamsExist(teamIds);
    const targets = this.normalizeTargets(payload.targets);
    const notifyRoles = this.normalizeNotifyRoles(payload.breachNotifyRoles);
    const policyId = randomUUID();

    await this.prisma.$transaction(async (tx) => {
      if (payload.isDefault) {
        await tx.$executeRaw`
          UPDATE "SlaPolicyConfig"
          SET "isDefault" = false, "updatedAt" = NOW()
          WHERE "isDefault" = true
        `;
      }

      if (teamIds.length > 0) {
        await tx.$executeRaw`
          DELETE FROM "SlaPolicyAssignment"
          WHERE "teamId" IN (${Prisma.join(teamIds)})
        `;
      }

      await this.insertPolicyConfig(tx, {
        policyId,
        name: payload.name.trim(),
        description: payload.description?.trim() || null,
        isDefault: payload.isDefault ?? false,
        enabled: payload.enabled ?? true,
        businessHoursOnly: payload.businessHoursOnly ?? true,
        escalationEnabled: payload.escalationEnabled ?? true,
        escalationAfterPercent: payload.escalationAfterPercent ?? 80,
        breachNotifyRoles: notifyRoles,
        createdById: user.id,
        targets,
        teamIds,
      });
    });

    const created = await this.getPolicyById(policyId, this.prisma);
    return { data: this.serializePolicy(created, null) };
  }

  async updatePolicyConfig(
    policyId: string,
    payload: UpdateSlaPolicyConfigDto,
    user: AuthUser,
  ) {
    await this.ensurePolicyConfigsSeeded();
    const writeScope = this.policyWriteScope(user);
    const isOwner = user.role === UserRole.OWNER;
    const existing = await this.getPolicyById(policyId, this.prisma);

    if (!isOwner) {
      if (payload.isDefault !== undefined) {
        throw new ForbiddenException('Only owner can set default SLA policy');
      }
      if (existing.isDefault) {
        throw new ForbiddenException(
          'Team admin cannot modify global default SLA policy',
        );
      }
      const hasScopedAssignment = existing.assignments.some(
        (assignment) => assignment.teamId === writeScope[0],
      );
      if (!hasScopedAssignment) {
        throw new ForbiddenException(
          'Team admin can only manage SLA policy for primary team',
        );
      }
    }

    const nextTeamIds = this.unique(
      payload.appliedTeamIds ??
        existing.assignments.map((assignment) => assignment.teamId),
    );
    if (!isOwner && nextTeamIds.some((teamId) => teamId !== writeScope[0])) {
      throw new ForbiddenException(
        'Team admin can only scope SLA policy to primary team',
      );
    }

    const nextIsDefault = isOwner
      ? (payload.isDefault ?? existing.isDefault)
      : existing.isDefault;
    const nextEnabled = payload.enabled ?? existing.enabled;
    if (nextIsDefault && !nextEnabled) {
      throw new BadRequestException('Default SLA policy cannot be disabled');
    }
    if (payload.appliedTeamIds !== undefined) {
      await this.ensureTeamsExist(nextTeamIds);
    }

    const nextTargets = payload.targets
      ? this.normalizeTargets(payload.targets)
      : this.normalizeTargets(existing.targets);
    const nextNotifyRoles = this.normalizeNotifyRoles(
      payload.breachNotifyRoles ?? existing.breachNotifyRoles,
    );
    await this.prisma.$transaction(async (tx) => {
      if (nextIsDefault && !existing.isDefault) {
        await tx.$executeRaw`
          UPDATE "SlaPolicyConfig"
          SET "isDefault" = false, "updatedAt" = NOW()
          WHERE "isDefault" = true
        `;
      }

      if (payload.appliedTeamIds !== undefined && nextTeamIds.length > 0) {
        await tx.$executeRaw`
          DELETE FROM "SlaPolicyAssignment"
          WHERE "teamId" IN (${Prisma.join(nextTeamIds)})
            AND "policyConfigId" <> ${policyId}
        `;
      }

      await tx.$executeRaw`
        UPDATE "SlaPolicyConfig"
        SET
          "name" = ${payload.name?.trim() ?? existing.name},
          "description" = ${
            payload.description !== undefined
              ? payload.description.trim() || null
              : (existing.description ?? null)
          },
          "isDefault" = ${nextIsDefault},
          "enabled" = ${nextEnabled},
          "businessHoursOnly" = ${payload.businessHoursOnly ?? existing.businessHoursOnly},
          "escalationEnabled" = ${payload.escalationEnabled ?? existing.escalationEnabled},
          "escalationAfterPercent" = ${
            payload.escalationAfterPercent ?? existing.escalationAfterPercent
          },
          "breachNotifyRoles" = ${nextNotifyRoles}::"SlaNotifyRole"[],
          "updatedAt" = NOW()
        WHERE "id" = ${policyId}
      `;

      if (payload.targets !== undefined) {
        await tx.$executeRaw`
          DELETE FROM "SlaPolicyConfigTarget"
          WHERE "policyConfigId" = ${policyId}
        `;
        for (const target of nextTargets) {
          await tx.$executeRaw`
            INSERT INTO "SlaPolicyConfigTarget"
              ("id", "policyConfigId", "priority", "firstResponseHours", "resolutionHours", "createdAt", "updatedAt")
            VALUES
              (${randomUUID()}, ${policyId}, ${target.priority}::"TicketPriority", ${target.firstResponseHours}, ${target.resolutionHours}, NOW(), NOW())
          `;
        }
      }

      if (payload.appliedTeamIds !== undefined) {
        if (nextTeamIds.length === 0) {
          await tx.$executeRaw`
            DELETE FROM "SlaPolicyAssignment"
            WHERE "policyConfigId" = ${policyId}
          `;
        } else {
          await tx.$executeRaw`
            DELETE FROM "SlaPolicyAssignment"
            WHERE "policyConfigId" = ${policyId}
              AND "teamId" NOT IN (${Prisma.join(nextTeamIds)})
          `;
          for (const teamId of nextTeamIds) {
            await tx.$executeRaw`
              INSERT INTO "SlaPolicyAssignment" ("id", "policyConfigId", "teamId", "createdAt", "updatedAt")
              VALUES (${randomUUID()}, ${policyId}, ${teamId}, NOW(), NOW())
              ON CONFLICT ("policyConfigId","teamId") DO NOTHING
            `;
          }
        }
      }
    });

    const updated = await this.getPolicyById(policyId, this.prisma);
    return { data: this.serializePolicy(updated, null) };
  }

  async deletePolicyConfig(policyId: string, user: AuthUser) {
    await this.ensurePolicyConfigsSeeded();
    const writeScope = this.policyWriteScope(user);
    const isOwner = user.role === UserRole.OWNER;
    const existing = await this.getPolicyById(policyId, this.prisma);

    if (!isOwner) {
      if (existing.isDefault) {
        throw new ForbiddenException(
          'Team admin cannot delete global default SLA policy',
        );
      }
      const hasScopedAssignment = existing.assignments.some(
        (assignment) => assignment.teamId === writeScope[0],
      );
      if (!hasScopedAssignment) {
        throw new ForbiddenException(
          'Team admin can only delete SLA policy for primary team',
        );
      }
      if (
        existing.assignments.some(
          (assignment) => assignment.teamId !== writeScope[0],
        )
      ) {
        throw new ForbiddenException(
          'Team admin cannot delete cross-team SLA policy',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM "SlaPolicyConfig"
        WHERE "id" = ${policyId}
      `;
    });

    return { id: policyId };
  }

  async getBusinessHoursSettings(user: AuthUser) {
    this.ensureSlaPageAccess(user);
    const settings = await this.ensureBusinessHoursSettingsRecord(this.prisma);
    return { data: this.serializeBusinessHours(settings) };
  }

  async updateBusinessHoursSettings(
    payload: UpdateSlaBusinessHoursDto,
    user: AuthUser,
  ) {
    this.ensureSlaPageWriteAccess(user);
    const current = await this.ensureBusinessHoursSettingsRecord(this.prisma);

    const schedule = this.normalizeSchedule(
      payload.schedule ?? this.parseSchedule(current.schedule),
    );
    const holidays = this.normalizeHolidays(
      payload.holidays ?? this.parseHolidays(current.holidays),
    );
    const timezone = payload.timezone?.trim() || current.timezone;

    await this.prisma.$executeRaw`
      UPDATE "SlaBusinessHoursSetting"
      SET
        "timezone" = ${timezone},
        "schedule" = ${JSON.stringify(schedule)}::jsonb,
        "holidays" = ${JSON.stringify(holidays)}::jsonb,
        "updatedAt" = NOW()
      WHERE "id" = 'global'
    `;

    const updated = await this.ensureBusinessHoursSettingsRecord(this.prisma);
    return { data: this.serializeBusinessHours(updated) };
  }

  private async loadPolicyGraph(policyRows: PolicyRow[], tx: PrismaTx) {
    if (policyRows.length === 0) return [] as PolicyGraph[];
    const policyIds = policyRows.map((policy) => policy.id);
    const targets = await tx.$queryRaw<PolicyTargetRow[]>`
      SELECT
        t."policyConfigId" as "policyConfigId",
        t."priority" as "priority",
        t."firstResponseHours" as "firstResponseHours",
        t."resolutionHours" as "resolutionHours"
      FROM "SlaPolicyConfigTarget" t
      WHERE t."policyConfigId" IN (${Prisma.join(policyIds)})
    `;
    const assignments = await tx.$queryRaw<PolicyAssignmentRow[]>`
      SELECT
        a."policyConfigId" as "policyConfigId",
        a."teamId" as "teamId",
        tm."name" as "teamName"
      FROM "SlaPolicyAssignment" a
      INNER JOIN "Team" tm ON tm."id" = a."teamId"
      WHERE a."policyConfigId" IN (${Prisma.join(policyIds)})
      ORDER BY tm."name" ASC
    `;

    const targetMap = new Map<string, PolicyTargetRow[]>();
    for (const target of targets) {
      const list = targetMap.get(target.policyConfigId) ?? [];
      list.push(target);
      targetMap.set(target.policyConfigId, list);
    }

    const assignmentMap = new Map<string, PolicyAssignmentRow[]>();
    for (const assignment of assignments) {
      const list = assignmentMap.get(assignment.policyConfigId) ?? [];
      list.push(assignment);
      assignmentMap.set(assignment.policyConfigId, list);
    }

    return policyRows.map((row) => ({
      ...row,
      targets: this.normalizeTargets(targetMap.get(row.id) ?? []),
      assignments: (assignmentMap.get(row.id) ?? []).map((assignment) => ({
        teamId: assignment.teamId,
        teamName: assignment.teamName,
      })),
    }));
  }

  private async getPolicyById(policyId: string, tx: PrismaTx) {
    const rows = await tx.$queryRaw<PolicyRow[]>`
      SELECT
        p."id",
        p."name",
        p."description",
        p."isDefault",
        p."enabled",
        p."businessHoursOnly",
        p."escalationEnabled",
        p."escalationAfterPercent",
        p."breachNotifyRoles" as "breachNotifyRoles",
        p."createdAt",
        p."updatedAt"
      FROM "SlaPolicyConfig" p
      WHERE p."id" = ${policyId}
      LIMIT 1
    `;
    if (!rows[0]) {
      throw new NotFoundException('SLA policy not found');
    }
    const graph = await this.loadPolicyGraph(rows, tx);
    return graph[0];
  }

  private serializePolicy(policy: PolicyGraph, scopeTeams: Set<string> | null) {
    const assignments =
      scopeTeams == null
        ? policy.assignments
        : policy.assignments.filter((assignment) =>
            scopeTeams.has(assignment.teamId),
          );
    return {
      id: policy.id,
      name: policy.name,
      description: policy.description ?? '',
      isDefault: policy.isDefault,
      enabled: policy.enabled,
      businessHoursOnly: policy.businessHoursOnly,
      escalationEnabled: policy.escalationEnabled,
      escalationAfterPercent: policy.escalationAfterPercent,
      breachNotifyRoles: this.normalizeNotifyRoles(policy.breachNotifyRoles),
      appliedTeamIds: assignments.map((assignment) => assignment.teamId),
      appliedTeams: assignments.map((assignment) => ({
        id: assignment.teamId,
        name: assignment.teamName,
      })),
      targets: this.normalizeTargets(policy.targets),
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    };
  }

  private serializeBusinessHours(settings: BusinessSettingsRow) {
    return {
      timezone: settings.timezone,
      schedule: this.normalizeSchedule(this.parseSchedule(settings.schedule)),
      holidays: this.normalizeHolidays(this.parseHolidays(settings.holidays)),
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  private normalizeTargets(
    targets: Array<{
      priority: TicketPriority;
      firstResponseHours: number;
      resolutionHours: number;
    }>,
  ) {
    if (targets.length !== PRIORITIES.length) {
      throw new BadRequestException(
        'SLA targets must include all priorities (P1-P4)',
      );
    }
    const map = new Map<
      TicketPriority,
      { firstResponseHours: number; resolutionHours: number }
    >();
    for (const target of targets) {
      if (map.has(target.priority)) {
        throw new BadRequestException(
          `Duplicate SLA target for ${target.priority}`,
        );
      }
      if (target.firstResponseHours <= 0 || target.resolutionHours <= 0) {
        throw new BadRequestException(
          'SLA target hours must be greater than 0',
        );
      }
      if (target.resolutionHours <= target.firstResponseHours) {
        throw new BadRequestException(
          `Resolution hours must be greater than first response hours for ${target.priority}`,
        );
      }
      map.set(target.priority, {
        firstResponseHours: Number(target.firstResponseHours),
        resolutionHours: Number(target.resolutionHours),
      });
    }
    for (const priority of PRIORITIES) {
      if (!map.has(priority)) {
        throw new BadRequestException(`Missing SLA target for ${priority}`);
      }
    }
    return PRIORITIES.map((priority) => ({
      priority,
      firstResponseHours: map.get(priority)!.firstResponseHours,
      resolutionHours: map.get(priority)!.resolutionHours,
    }));
  }

  private normalizeNotifyRoles(roles: string[] | undefined) {
    const allowed = new Set(['AGENT', 'LEAD', 'MANAGER', 'OWNER']);
    const deduped = this.unique(
      (roles ?? []).map((value) => value.toUpperCase()),
    ).filter((value) => allowed.has(value));
    return deduped.length > 0 ? deduped : ['AGENT', 'LEAD'];
  }

  private normalizeSchedule(
    days: Array<{
      day: string;
      enabled?: boolean;
      start?: string;
      end?: string;
    }>,
  ): BusinessDay[] {
    const byDay = new Map<WeekDay, BusinessDay>();
    for (const day of days) {
      if (!WEEK_DAYS.includes(day.day as WeekDay)) {
        continue;
      }
      const normalized: BusinessDay = {
        day: day.day as WeekDay,
        enabled: Boolean(day.enabled),
        start: day.start ?? '09:00',
        end: day.end ?? '18:00',
      };
      if (
        !this.isValidTime(normalized.start) ||
        !this.isValidTime(normalized.end)
      ) {
        throw new BadRequestException(
          `Invalid time format in business hours for ${normalized.day}`,
        );
      }
      if (
        normalized.enabled &&
        !this.isStartBeforeEnd(normalized.start, normalized.end)
      ) {
        throw new BadRequestException(
          `Business hours start must be before end for ${normalized.day}`,
        );
      }
      byDay.set(normalized.day, normalized);
    }

    return WEEK_DAYS.map((day, index) => {
      const fallback = this.defaultSchedule[index];
      return byDay.get(day) ?? fallback;
    });
  }

  private normalizeHolidays(holidays: Holiday[]) {
    const deduped = new Map<string, Holiday>();
    for (const holiday of holidays) {
      const name = (holiday.name ?? '').trim();
      const date = (holiday.date ?? '').trim();
      if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        continue;
      }
      deduped.set(`${date}:${name.toLowerCase()}`, { name, date });
    }
    return [...deduped.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  private parseSchedule(value: Prisma.JsonValue): BusinessDay[] {
    if (!Array.isArray(value)) return [...this.defaultSchedule];
    const parsed: Array<{
      day: string;
      enabled?: boolean;
      start?: string;
      end?: string;
    }> = [];
    for (const item of value as unknown[]) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }
      const record = item as Record<string, unknown>;
      parsed.push({
        day: typeof record.day === 'string' ? record.day : '',
        enabled: Boolean(record.enabled),
        start: typeof record.start === 'string' ? record.start : '09:00',
        end: typeof record.end === 'string' ? record.end : '18:00',
      });
    }
    return this.normalizeSchedule(parsed);
  }

  private parseHolidays(value: Prisma.JsonValue): Holiday[] {
    if (!Array.isArray(value)) return [];
    const result: Holiday[] = [];
    for (const item of value as unknown[]) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }
      const record = item as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name : '';
      const date = typeof record.date === 'string' ? record.date : '';
      if (name.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        result.push({ name, date });
      }
    }
    return result;
  }

  private async insertPolicyConfig(
    tx: PrismaTx,
    payload: {
      policyId: string;
      name: string;
      description: string | null;
      isDefault: boolean;
      enabled: boolean;
      businessHoursOnly: boolean;
      escalationEnabled: boolean;
      escalationAfterPercent: number;
      breachNotifyRoles: string[];
      createdById: string | null;
      targets: Array<{
        priority: TicketPriority;
        firstResponseHours: number;
        resolutionHours: number;
      }>;
      teamIds: string[];
    },
  ) {
    await tx.$executeRaw`
      INSERT INTO "SlaPolicyConfig"
        ("id", "name", "description", "isDefault", "enabled", "businessHoursOnly", "escalationEnabled", "escalationAfterPercent", "breachNotifyRoles", "createdById", "createdAt", "updatedAt")
      VALUES
        (${payload.policyId}, ${payload.name}, ${payload.description}, ${payload.isDefault}, ${payload.enabled}, ${payload.businessHoursOnly}, ${payload.escalationEnabled}, ${payload.escalationAfterPercent}, ${payload.breachNotifyRoles}::"SlaNotifyRole"[], ${payload.createdById}, NOW(), NOW())
    `;

    for (const target of payload.targets) {
      await tx.$executeRaw`
        INSERT INTO "SlaPolicyConfigTarget"
          ("id", "policyConfigId", "priority", "firstResponseHours", "resolutionHours", "createdAt", "updatedAt")
        VALUES
          (${randomUUID()}, ${payload.policyId}, ${target.priority}::"TicketPriority", ${target.firstResponseHours}, ${target.resolutionHours}, NOW(), NOW())
      `;
    }

    for (const teamId of payload.teamIds) {
      await tx.$executeRaw`
        INSERT INTO "SlaPolicyAssignment" ("id", "policyConfigId", "teamId", "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${payload.policyId}, ${teamId}, NOW(), NOW())
      `;
    }
  }

  private async resolveEffectivePolicyForTeam(
    teamId: string,
    tx: PrismaTx,
  ): Promise<{ policyId: string | null; source: 'team' | 'default' }> {
    const assignmentRows = await tx.$queryRaw<Array<{ policyId: string }>>`
      SELECT p."id" AS "policyId"
      FROM "SlaPolicyAssignment" a
      INNER JOIN "SlaPolicyConfig" p ON p."id" = a."policyConfigId"
      WHERE a."teamId" = ${teamId}
        AND p."enabled" = true
      ORDER BY a."updatedAt" DESC
      LIMIT 1
    `;
    if (assignmentRows[0]?.policyId) {
      return { policyId: assignmentRows[0].policyId, source: 'team' };
    }

    const defaultRows = await tx.$queryRaw<Array<{ policyId: string }>>`
      SELECT p."id" AS "policyId"
      FROM "SlaPolicyConfig" p
      WHERE p."isDefault" = true
        AND p."enabled" = true
      ORDER BY p."updatedAt" DESC
      LIMIT 1
    `;
    if (defaultRows[0]?.policyId) {
      return { policyId: defaultRows[0].policyId, source: 'default' };
    }

    return { policyId: null, source: 'default' };
  }

  private async loadPolicyTargetMap(policyId: string, tx: PrismaTx) {
    const targets = await tx.$queryRaw<PolicyTargetRow[]>`
      SELECT
        t."policyConfigId" as "policyConfigId",
        t."priority" as "priority",
        t."firstResponseHours" as "firstResponseHours",
        t."resolutionHours" as "resolutionHours"
      FROM "SlaPolicyConfigTarget" t
      WHERE t."policyConfigId" = ${policyId}
    `;
    const normalized = this.normalizeTargets(targets);
    return new Map(normalized.map((target) => [target.priority, target]));
  }

  private async ensurePolicyConfigsSeeded() {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint as "count"
      FROM "SlaPolicyConfig"
    `;
    if (Number(rows[0]?.count ?? 0) > 0) return;

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint as "count"
        FROM "SlaPolicyConfig"
      `;
      if (Number(current[0]?.count ?? 0) > 0) return;

      const defaultTargets = PRIORITIES.map((priority) => ({
        priority,
        firstResponseHours: this.defaultSlaConfig[priority].firstResponseHours,
        resolutionHours: this.defaultSlaConfig[priority].resolutionHours,
      }));

      await this.insertPolicyConfig(tx, {
        policyId: randomUUID(),
        name: 'Global Default SLA',
        description: 'System default SLA policy.',
        isDefault: true,
        enabled: true,
        businessHoursOnly: true,
        escalationEnabled: true,
        escalationAfterPercent: 80,
        breachNotifyRoles: ['AGENT', 'LEAD'],
        createdById: null,
        targets: defaultTargets,
        teamIds: [],
      });

      const teams = await tx.team.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      const [{ exists: legacySlaTableExists }] = await tx.$queryRaw<
        Array<{ exists: boolean }>
      >`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name = 'SlaPolicy'
        ) AS "exists"
      `;

      const legacyTargets = legacySlaTableExists
        ? await tx.$queryRaw<
            Array<{
              teamId: string;
              priority: TicketPriority;
              firstResponseHours: number;
              resolutionHours: number;
            }>
          >`
            SELECT
              "teamId",
              "priority",
              "firstResponseHours",
              "resolutionHours"
            FROM "SlaPolicy"
          `
        : [];
      const legacyByTeam = new Map<
        string,
        Map<
          TicketPriority,
          { firstResponseHours: number; resolutionHours: number }
        >
      >();
      for (const row of legacyTargets) {
        const byPriority =
          legacyByTeam.get(row.teamId) ??
          new Map<
            TicketPriority,
            { firstResponseHours: number; resolutionHours: number }
          >();
        byPriority.set(row.priority, {
          firstResponseHours: row.firstResponseHours,
          resolutionHours: row.resolutionHours,
        });
        legacyByTeam.set(row.teamId, byPriority);
      }

      for (const team of teams) {
        const runtimeMap =
          legacyByTeam.get(team.id) ??
          new Map<
            TicketPriority,
            { firstResponseHours: number; resolutionHours: number }
          >();
        const targets = PRIORITIES.map((priority) => ({
          priority,
          firstResponseHours:
            runtimeMap.get(priority)?.firstResponseHours ??
            this.defaultSlaConfig[priority].firstResponseHours,
          resolutionHours:
            runtimeMap.get(priority)?.resolutionHours ??
            this.defaultSlaConfig[priority].resolutionHours,
        }));

        await this.insertPolicyConfig(tx, {
          policyId: randomUUID(),
          name: `${team.name} SLA`,
          description: 'Migrated from existing team SLA targets.',
          isDefault: false,
          enabled: true,
          businessHoursOnly: true,
          escalationEnabled: true,
          escalationAfterPercent: 80,
          breachNotifyRoles: ['AGENT', 'LEAD'],
          createdById: null,
          targets,
          teamIds: [team.id],
        });
      }
    });
  }

  private async ensureBusinessHoursSettingsRecord(tx: PrismaTx) {
    const rows = await tx.$queryRaw<BusinessSettingsRow[]>`
      SELECT
        s."id",
        s."timezone",
        s."schedule",
        s."holidays",
        s."createdAt",
        s."updatedAt"
      FROM "SlaBusinessHoursSetting" s
      WHERE s."id" = 'global'
      LIMIT 1
    `;
    if (rows[0]) {
      return rows[0];
    }

    await tx.$executeRaw`
      INSERT INTO "SlaBusinessHoursSetting"
        ("id", "timezone", "schedule", "holidays", "createdAt", "updatedAt")
      VALUES
        ('global', 'UTC', ${JSON.stringify(this.defaultSchedule)}::jsonb, ${JSON.stringify([])}::jsonb, NOW(), NOW())
      ON CONFLICT ("id") DO NOTHING
    `;

    const after = await tx.$queryRaw<BusinessSettingsRow[]>`
      SELECT
        s."id",
        s."timezone",
        s."schedule",
        s."holidays",
        s."createdAt",
        s."updatedAt"
      FROM "SlaBusinessHoursSetting" s
      WHERE s."id" = 'global'
      LIMIT 1
    `;
    if (!after[0]) {
      throw new NotFoundException(
        'Unable to initialize business hours settings',
      );
    }
    return after[0];
  }

  private async ensureTeamsExist(teamIds: string[]) {
    if (teamIds.length === 0) return;
    const count = await this.prisma.team.count({
      where: { id: { in: teamIds } },
    });
    if (count !== teamIds.length) {
      throw new NotFoundException('One or more teams were not found');
    }
  }

  private ensureTeamReadAccess(user: AuthUser, teamId: string) {
    if (user.role === UserRole.OWNER) return;
    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId === teamId)
      return;
    const leadTeamId = user.teamId ?? user.primaryTeamId;
    if (user.role === UserRole.LEAD && leadTeamId === teamId) return;
    throw new ForbiddenException('Team access required');
  }

  private ensureTeamAdminOrOwner(user: AuthUser, teamId: string) {
    if (user.role === UserRole.OWNER) return;
    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId === teamId)
      return;
    throw new ForbiddenException('Team admin or owner access required');
  }

  private ensureSlaPageAccess(user: AuthUser) {
    if (
      user.role === UserRole.OWNER ||
      user.role === UserRole.TEAM_ADMIN ||
      user.role === UserRole.LEAD
    ) {
      return;
    }
    throw new ForbiddenException(
      'SLA settings access is restricted to owner, team admin, and lead',
    );
  }

  private ensureSlaPageWriteAccess(user: AuthUser) {
    if (user.role === UserRole.OWNER || user.role === UserRole.TEAM_ADMIN) {
      return;
    }
    throw new ForbiddenException(
      'Only owner or team admin can update SLA settings',
    );
  }

  private policyReadScope(user: AuthUser): string[] {
    this.ensureSlaPageAccess(user);
    if (user.role === UserRole.OWNER) {
      return [];
    }
    if (user.role === UserRole.TEAM_ADMIN) {
      if (!user.primaryTeamId) {
        throw new ForbiddenException(
          'Team administrator must have a primary team set',
        );
      }
      return [user.primaryTeamId];
    }
    const leadTeamId = user.teamId ?? user.primaryTeamId;
    if (!leadTeamId) {
      throw new ForbiddenException('Lead must belong to a team');
    }
    return [leadTeamId];
  }

  private policyWriteScope(user: AuthUser): string[] {
    this.ensureSlaPageWriteAccess(user);
    if (user.role === UserRole.OWNER) {
      return [];
    }
    if (!user.primaryTeamId) {
      throw new ForbiddenException(
        'Team administrator must have a primary team set',
      );
    }
    return [user.primaryTeamId];
  }

  private async ensureTeam(teamId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
  }

  private unique(values: string[]) {
    return [...new Set(values)];
  }

  private isValidTime(value: string) {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
  }

  private isStartBeforeEnd(start: string, end: string) {
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);
    return startH * 60 + startM < endH * 60 + endM;
  }
}
