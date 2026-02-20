import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from '../tickets/tickets.service';
import {
  CreateAutomationRuleDto,
  isValidConditionNode,
} from './dto/create-automation-rule.dto';
import { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';
import type { AutomationTrigger } from './rule-engine.service';
import { RuleEngineService } from './rule-engine.service';

@Injectable()
export class AutomationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService: TicketsService,
    private readonly ruleEngine: RuleEngineService,
  ) {}
  private adminAuditEventTableExists: boolean | null = null;

  async list(user: AuthUser) {
    if (user.role === UserRole.TEAM_ADMIN && !user.primaryTeamId) {
      throw new ForbiddenException(
        'Team administrator must have a primary team set',
      );
    }
    // OWNER sees all rules; TEAM_ADMIN sees only rules scoped to their primary team (no global).
    const where =
      user.role === UserRole.TEAM_ADMIN ? { teamId: user.primaryTeamId! } : {};
    const data = await this.prisma.automationRule.findMany({
      where,
      include: {
        team: true,
        createdBy: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    });
    return { data };
  }

  async getOne(id: string, user: AuthUser) {
    const rule = await this.prisma.automationRule.findUnique({
      where: { id },
      include: {
        team: true,
        createdBy: { select: { id: true, displayName: true, email: true } },
      },
    });
    if (!rule) {
      throw new NotFoundException('Automation rule not found');
    }
    this.ensureCanManage(user, rule.teamId);
    return rule;
  }

  async getExecutions(ruleId: string, user: AuthUser, page = 1, pageSize = 20) {
    const rule = await this.prisma.automationRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule) {
      throw new NotFoundException('Automation rule not found');
    }
    this.ensureCanManage(user, rule.teamId);

    const skip = (page - 1) * pageSize;
    const [data, total] = await Promise.all([
      this.prisma.automationExecution.findMany({
        where: { ruleId },
        skip,
        take: pageSize,
        orderBy: { executedAt: 'desc' },
        include: {
          ticket: {
            select: { id: true, number: true, displayId: true, subject: true },
          },
        },
      }),
      this.prisma.automationExecution.count({ where: { ruleId } }),
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

  async create(payload: CreateAutomationRuleDto, user: AuthUser) {
    this.ensureCanManage(user, payload.teamId ?? undefined);

    const validTriggers: AutomationTrigger[] = [
      'TICKET_CREATED',
      'STATUS_CHANGED',
      'SLA_APPROACHING',
      'SLA_BREACHED',
    ];
    if (!validTriggers.includes(payload.trigger as AutomationTrigger)) {
      throw new BadRequestException(`Invalid trigger: ${payload.trigger}`);
    }
    this.validateActionParams(payload.actions);

    const created = await this.prisma.automationRule.create({
      data: {
        name: payload.name,
        description: payload.description,
        trigger: payload.trigger,
        conditions: payload.conditions as object,
        actions: payload.actions as object,
        isActive: payload.isActive ?? true,
        priority: payload.priority ?? 0,
        teamId: payload.teamId,
        createdById: user.id,
      },
      include: {
        team: true,
        createdBy: { select: { id: true, displayName: true, email: true } },
      },
    });
    await this.recordAdminAuditEvent(
      'AUTOMATION_RULE_CREATED',
      {
        ruleId: created.id,
        name: created.name,
        trigger: created.trigger,
        teamId: created.teamId,
        isActive: created.isActive,
        priority: created.priority,
      },
      user,
      created.teamId ?? null,
    );
    return created;
  }

  async update(id: string, payload: UpdateAutomationRuleDto, user: AuthUser) {
    const rule = await this.prisma.automationRule.findUnique({
      where: { id },
    });
    if (!rule) {
      throw new NotFoundException('Automation rule not found');
    }
    this.ensureCanManage(user, rule.teamId);

    if (payload.teamId !== undefined) {
      this.ensureCanManage(user, payload.teamId);
    }

    const validTriggers: AutomationTrigger[] = [
      'TICKET_CREATED',
      'STATUS_CHANGED',
      'SLA_APPROACHING',
      'SLA_BREACHED',
    ];
    if (payload.trigger !== undefined) {
      if (!validTriggers.includes(payload.trigger as AutomationTrigger)) {
        throw new BadRequestException(`Invalid trigger: ${payload.trigger}`);
      }
    }
    if (payload.conditions !== undefined) {
      if (
        !Array.isArray(payload.conditions) ||
        payload.conditions.length === 0
      ) {
        throw new BadRequestException('conditions must be a non-empty array');
      }
      if (!payload.conditions.every(isValidConditionNode)) {
        throw new BadRequestException(
          'Invalid condition tree: each node must be a leaf (field + operator) or an and/or group with at least one valid child (validated recursively).',
        );
      }
    }
    if (payload.actions !== undefined) {
      if (!Array.isArray(payload.actions) || payload.actions.length === 0) {
        throw new BadRequestException('actions must be a non-empty array');
      }
      this.validateActionParams(payload.actions);
    }

    const data: Record<string, unknown> = {};
    if (payload.name !== undefined) data.name = payload.name;
    if (payload.description !== undefined)
      data.description = payload.description;
    if (payload.trigger !== undefined) data.trigger = payload.trigger;
    if (payload.conditions !== undefined)
      data.conditions = payload.conditions as object;
    if (payload.actions !== undefined) data.actions = payload.actions as object;
    if (payload.isActive !== undefined) data.isActive = payload.isActive;
    if (payload.priority !== undefined) data.priority = payload.priority;
    if (payload.teamId !== undefined) data.teamId = payload.teamId;

    const updated = await this.prisma.automationRule.update({
      where: { id },
      data,
      include: {
        team: true,
        createdBy: { select: { id: true, displayName: true, email: true } },
      },
    });
    await this.recordAdminAuditEvent(
      'AUTOMATION_RULE_UPDATED',
      {
        ruleId: updated.id,
        name: updated.name,
        trigger: updated.trigger,
        teamId: updated.teamId,
        isActive: updated.isActive,
        priority: updated.priority,
      },
      user,
      updated.teamId ?? null,
    );
    return updated;
  }

  async remove(id: string, user: AuthUser) {
    const rule = await this.prisma.automationRule.findUnique({
      where: { id },
    });
    if (!rule) {
      throw new NotFoundException('Automation rule not found');
    }
    this.ensureCanManage(user, rule.teamId);
    await this.prisma.automationRule.delete({ where: { id } });
    await this.recordAdminAuditEvent(
      'AUTOMATION_RULE_DELETED',
      {
        ruleId: rule.id,
        name: rule.name,
        trigger: rule.trigger,
        teamId: rule.teamId,
        isActive: rule.isActive,
        priority: rule.priority,
      },
      user,
      rule.teamId ?? null,
    );
    return { id };
  }

  /**
   * Dry-run: evaluate rule against a ticket. Enforces ticket visibility (same as TicketsService.getById);
   * throws NotFoundException or ForbiddenException if the user cannot access the ticket.
   */
  async evaluateRuleForTicket(
    ruleId: string,
    ticketId: string,
    user: AuthUser,
  ): Promise<{
    matched: boolean;
    actionsThatWouldRun: unknown[];
    message?: string;
  }> {
    await this.getOne(ruleId, user);
    await this.ticketsService.getById(ticketId, user);
    return this.ruleEngine.evaluateRuleForTicket(ruleId, ticketId);
  }

  /** Require action-type-specific params so rules are not no-ops. */
  private validateActionParams(
    actions: Array<{
      type?: string;
      teamId?: string;
      userId?: string;
      priority?: string;
      status?: string;
      body?: string;
    }>,
  ) {
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const type = a?.type;
      switch (type) {
        case 'assign_team':
          if (!a.teamId?.trim()) {
            throw new BadRequestException(
              `Action ${i + 1} (assign_team): teamId is required.`,
            );
          }
          break;
        case 'assign_user':
          if (!a.userId?.trim()) {
            throw new BadRequestException(
              `Action ${i + 1} (assign_user): userId is required.`,
            );
          }
          break;
        case 'set_priority':
          if (!a.priority || !['P1', 'P2', 'P3', 'P4'].includes(a.priority)) {
            throw new BadRequestException(
              `Action ${i + 1} (set_priority): priority must be P1, P2, P3, or P4.`,
            );
          }
          break;
        case 'set_status':
          if (!a.status?.trim()) {
            throw new BadRequestException(
              `Action ${i + 1} (set_status): status is required.`,
            );
          }
          break;
        case 'add_internal_note':
          if (!a.body?.trim()) {
            throw new BadRequestException(
              `Action ${i + 1} (add_internal_note): body is required.`,
            );
          }
          break;
        case 'notify_team_lead':
          break;
        default:
          throw new BadRequestException(
            `Action ${i + 1}: unknown type '${type ?? ''}'.`,
          );
      }
    }
  }

  /** Global rules (teamId = null) are OWNER-only. TEAM_ADMIN can only manage rules for their primary team. */
  private ensureCanManage(user: AuthUser, teamId?: string | null) {
    if (user.role === UserRole.OWNER) return;
    if (
      user.role === UserRole.TEAM_ADMIN &&
      teamId &&
      user.primaryTeamId === teamId
    )
      return;
    if (!teamId) {
      throw new ForbiddenException(
        'Only owners can create or manage global (unscoped) automation rules',
      );
    }
    throw new ForbiddenException(
      'Only owners and team admins (for their team) can manage automation rules',
    );
  }

  private async recordAdminAuditEvent(
    type: string,
    payload: Record<string, unknown>,
    user: AuthUser,
    teamId: string | null,
  ) {
    const hasTable = await this.hasAdminAuditEventTable();
    if (!hasTable) return;
    // Resolve snapshot fields (8.1 fix) so audit data survives user/team deletion
    let actorName: string = user.email;
    let teamName: string | null = null;
    try {
      const [actor, team] = await Promise.all([
        this.prisma.user
          .findUnique({ where: { id: user.id }, select: { displayName: true } })
          .catch(() => null),
        teamId
          ? this.prisma.team
              .findUnique({ where: { id: teamId }, select: { name: true } })
              .catch(() => null)
          : null,
      ]);
      actorName = actor?.displayName ?? user.email;
      teamName = team?.name ?? null;
    } catch {
      /* best-effort */
    }
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "AdminAuditEvent" ("id", "type", "payload", "createdById", "teamId", "actorEmail", "actorName", "teamName", "createdAt")
        VALUES (${randomUUID()}, ${type}, ${JSON.stringify(payload)}::jsonb, ${user.id}, ${teamId}, ${user.email}, ${actorName}, ${teamName}, now())
      `;
    } catch {
      // Non-blocking audit log write
    }
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
}
