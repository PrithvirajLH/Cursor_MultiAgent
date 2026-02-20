import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
  NotificationType,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SlaEngineService } from '../slas/sla-engine.service';
import { TicketsService } from '../tickets/tickets.service';

export type AutomationTrigger =
  | 'TICKET_CREATED'
  | 'STATUS_CHANGED'
  | 'SLA_APPROACHING'
  | 'SLA_BREACHED';

export type TicketContext = {
  id: string;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignedTeamId: string | null;
  assigneeId: string | null;
  categoryId: string | null;
  requesterId: string;
  [key: string]: unknown;
};

type ConditionNode =
  | { field: string; operator: string; value: unknown }
  | { and: ConditionNode[] }
  | { or: ConditionNode[] };

type ActionNode = {
  type: string;
  teamId?: string;
  userId?: string;
  priority?: string;
  status?: string;
  body?: string;
};

/** SLA triggers: skip if we already ran this rule for this ticket recently (idempotent). */
const SLA_DE_DUPE_HOURS = 24;

@Injectable()
export class RuleEngineService {
  private readonly defaultSlaConfig: Record<
    TicketPriority,
    { firstResponseHours: number; resolutionHours: number }
  > = {
    [TicketPriority.P1]: { firstResponseHours: 1, resolutionHours: 4 },
    [TicketPriority.P2]: { firstResponseHours: 4, resolutionHours: 24 },
    [TicketPriority.P3]: { firstResponseHours: 8, resolutionHours: 72 },
    [TicketPriority.P4]: { firstResponseHours: 24, resolutionHours: 168 },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService: TicketsService,
  ) {}

  /**
   * Dry-run: evaluate a single rule against a ticket. No side effects.
   * Returns whether the rule matches and which actions would run.
   */
  async evaluateRuleForTicket(
    ruleId: string,
    ticketId: string,
  ): Promise<{
    matched: boolean;
    actionsThatWouldRun: ActionNode[];
    message?: string;
  }> {
    const rule = await this.prisma.automationRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule) {
      return {
        matched: false,
        actionsThatWouldRun: [],
        message: 'Rule not found',
      };
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { assignedTeam: true },
    });
    if (!ticket) {
      return {
        matched: false,
        actionsThatWouldRun: [],
        message: 'Ticket not found',
      };
    }

    const ctx: TicketContext = this.ticketToContext(ticket);

    if (rule.teamId && ticket.assignedTeamId !== rule.teamId) {
      return {
        matched: false,
        actionsThatWouldRun: [],
        message: 'Rule is team-scoped and ticket is not (or different team)',
      };
    }

    const conditions = rule.conditions as ConditionNode[];
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return {
        matched: false,
        actionsThatWouldRun: [],
        message: 'Rule has no conditions',
      };
    }

    const matched = this.evaluateConditions(conditions, ctx);
    if (!matched) {
      return {
        matched: false,
        actionsThatWouldRun: [],
        message: 'Conditions did not match',
      };
    }

    const actions = rule.actions as ActionNode[];
    const actionsThatWouldRun = Array.isArray(actions) ? actions : [];
    return { matched: true, actionsThatWouldRun };
  }

  /**
   * Run all active automation rules for the given trigger and ticket.
   * Each rule run is atomic: all ticket updates, events, messages, and AutomationExecution
   * are performed inside a single transaction; on failure nothing is persisted and we
   * record a failed AutomationExecution outside the transaction.
   * Rules are ordered by priority (lower number first).
   * For SLA_APPROACHING/SLA_BREACHED, skips if this rule already ran for this ticket in the last 24h.
   * Note: Automation does not call TicketsService flows (e.g. standard assignee/transfer
   * notifications). For parity with manual actions, consider calling notification service
   * after commit or refactoring to shared domain operations.
   */
  async runForTicket(
    ticketId: string,
    trigger: AutomationTrigger,
  ): Promise<{ executed: number; errors: string[] }> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        requester: true,
        assignee: true,
        assignedTeam: { include: { members: true } },
      },
    });

    if (!ticket) {
      return { executed: 0, errors: ['Ticket not found'] };
    }

    const ctx: TicketContext = this.ticketToContext(ticket);

    const rules = await this.prisma.automationRule.findMany({
      where: { trigger, isActive: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      include: { team: true },
    });

    const errors: string[] = [];
    let executed = 0;

    for (const rule of rules) {
      if (rule.teamId && ticket.assignedTeamId !== rule.teamId) {
        continue;
      }

      const conditions = rule.conditions as ConditionNode[];
      if (!Array.isArray(conditions) || conditions.length === 0) {
        continue;
      }

      if (!this.evaluateConditions(conditions, ctx)) {
        continue;
      }

      const actions = rule.actions as ActionNode[];
      if (!Array.isArray(actions) || actions.length === 0) {
        continue;
      }

      if (
        (trigger === 'SLA_APPROACHING' || trigger === 'SLA_BREACHED') &&
        (await this.alreadyExecutedRecently(
          rule.id,
          ticketId,
          trigger,
          SLA_DE_DUPE_HOURS,
        ))
      ) {
        continue;
      }

      try {
        await this.prisma.$transaction(async (tx) => {
          await this.executeActions(
            tx,
            ticketId,
            actions,
            ticket,
            rule.id,
            rule.createdById,
          );
          await tx.ticketEvent.create({
            data: {
              ticketId,
              type: 'AUTOMATION_RULE_EXECUTED',
              payload: {
                automationRuleId: rule.id,
                automationRuleName: rule.name,
                trigger,
                actionCount: actions.length,
              },
              createdById: rule.createdById,
            },
          });
          await tx.automationExecution.create({
            data: { ruleId: rule.id, ticketId, trigger, success: true },
          });
        });
        executed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Rule ${rule.name}: ${msg}`);
        await this.prisma.automationExecution.create({
          data: {
            ruleId: rule.id,
            ticketId,
            trigger,
            success: false,
            error: msg,
          },
        });
      }
    }

    return { executed, errors };
  }

  private ticketToContext(ticket: {
    id: string;
    subject: string;
    description: string | null;
    priority: TicketPriority;
    status: TicketStatus;
    assignedTeamId: string | null;
    assigneeId: string | null;
    categoryId: string | null;
    requesterId: string;
  }): TicketContext {
    return {
      id: ticket.id,
      subject: ticket.subject,
      description: ticket.description ?? '',
      priority: ticket.priority,
      status: ticket.status,
      assignedTeamId: ticket.assignedTeamId,
      assigneeId: ticket.assigneeId,
      categoryId: ticket.categoryId,
      requesterId: ticket.requesterId,
    };
  }

  private async alreadyExecutedRecently(
    ruleId: string,
    ticketId: string,
    trigger: AutomationTrigger,
    hours: number,
  ): Promise<boolean> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const count = await this.prisma.automationExecution.count({
      where: {
        ruleId,
        ticketId,
        trigger,
        success: true,
        executedAt: { gte: since },
      },
    });
    return count > 0;
  }

  /** Top-level: all nodes must evaluate to true (AND). Each node can be and/or/field. */
  private evaluateConditions(
    conditions: ConditionNode[],
    ctx: TicketContext,
  ): boolean {
    return conditions.every((node) => this.evaluateNode(node, ctx));
  }

  private evaluateNode(node: ConditionNode, ctx: TicketContext): boolean {
    if ('and' in node && Array.isArray(node.and)) {
      return node.and.every((n) => this.evaluateNode(n, ctx));
    }
    if ('or' in node && Array.isArray(node.or)) {
      return node.or.some((n) => this.evaluateNode(n, ctx));
    }
    if ('field' in node && 'operator' in node) {
      return this.evaluateSingle(node.field, node.operator, node.value, ctx);
    }
    return false;
  }

  private evaluateSingle(
    field: string,
    operator: string,
    value: unknown,
    ctx: TicketContext,
  ): boolean {
    const raw = (ctx as Record<string, unknown>)[field];
    const str = (this.normalizeComparableValue(raw) ?? '').toLowerCase();
    const valStr = (this.normalizeComparableValue(value) ?? '').toLowerCase();

    switch (operator) {
      case 'contains':
        return str.includes(valStr);
      case 'equals':
        return str === valStr;
      case 'notEquals':
        return str !== valStr;
      case 'in':
        if (!Array.isArray(value)) return raw === value;
        return value.some((v) => {
          const option = this.normalizeComparableValue(v);
          return (option != null && option.toLowerCase() === str) || raw === v;
        });
      case 'notIn':
        if (!Array.isArray(value)) return raw !== value;
        return !value.some((v) => {
          const option = this.normalizeComparableValue(v);
          return (option != null && option.toLowerCase() === str) || raw === v;
        });
      case 'isEmpty':
        return (
          raw == null ||
          (this.normalizeComparableValue(raw) ?? '').trim() === ''
        );
      case 'isNotEmpty':
        return (
          raw != null &&
          (this.normalizeComparableValue(raw) ?? '').trim() !== ''
        );
      default:
        return false;
    }
  }

  private normalizeComparableValue(value: unknown): string | null {
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
    return null;
  }

  private async executeActions(
    tx: Prisma.TransactionClient,
    ticketId: string,
    actions: ActionNode[],
    ticket: {
      id: string;
      subject: string;
      createdAt: Date;
      priority: TicketPriority;
      status: TicketStatus;
      assignedTeamId: string | null;
      assigneeId: string | null;
      firstResponseDueAt: Date | null;
      resolvedAt: Date | null;
      closedAt: Date | null;
      completedAt: Date | null;
      dueAt: Date | null;
      slaPausedAt: Date | null;
      assignedTeam?: { members: { userId: string }[] } | null;
    },
    _ruleId: string,
    ruleCreatedById: string,
  ): Promise<void> {
    let current = ticket;
    for (const action of actions) {
      switch (action.type) {
        case 'assign_team':
          if (action.teamId) {
            const priorTeamId = current.assignedTeamId;
            await tx.ticket.update({
              where: { id: ticketId },
              data: { assignedTeamId: action.teamId, assigneeId: null },
            });
            await tx.ticketEvent.create({
              data: {
                ticketId,
                type: 'TICKET_TRANSFERRED',
                payload: { fromTeamId: priorTeamId, toTeamId: action.teamId },
                createdById: ruleCreatedById,
              },
            });
            await this.slaEngine.syncFromTicket(ticketId, undefined, tx);
            current = await this.getTicketForActions(tx, ticketId);
          }
          break;
        case 'assign_user':
          if (action.userId) {
            if (!current.assignedTeamId) {
              throw new Error(
                'assign_user requires the ticket to be assigned to a team first',
              );
            }
            const membership = await tx.teamMember.findUnique({
              where: {
                teamId_userId: {
                  teamId: current.assignedTeamId,
                  userId: action.userId,
                },
              },
              select: { id: true },
            });
            if (!membership) {
              throw new Error(
                `User ${action.userId} is not a member of team ${current.assignedTeamId}`,
              );
            }
            await tx.ticket.update({
              where: { id: ticketId },
              data: { assigneeId: action.userId },
            });
            await tx.ticketEvent.create({
              data: {
                ticketId,
                type: 'TICKET_ASSIGNED',
                payload: { assigneeId: action.userId },
                createdById: ruleCreatedById,
              },
            });
            await this.slaEngine.syncFromTicket(ticketId, undefined, tx);
            current = await this.getTicketForActions(tx, ticketId);
          }
          break;
        case 'set_priority':
          if (
            action.priority &&
            ['P1', 'P2', 'P3', 'P4'].includes(action.priority)
          ) {
            const fromPriority = current.priority;
            const newPriority = action.priority as TicketPriority;

            const oldSla = await this.getSlaConfig(
              current.priority,
              current.assignedTeamId,
              tx,
            );
            const newSla = await this.getSlaConfig(
              newPriority,
              current.assignedTeamId,
              tx,
            );

            const firstStart = current.firstResponseDueAt
              ? this.addHours(
                  current.firstResponseDueAt,
                  -oldSla.firstResponseHours,
                )
              : current.createdAt;
            const resolutionStart = current.dueAt
              ? this.addHours(current.dueAt, -oldSla.resolutionHours)
              : current.createdAt;

            const firstResponseDueAt = this.addHours(
              firstStart,
              newSla.firstResponseHours,
            );
            const dueAt = this.addHours(
              resolutionStart,
              newSla.resolutionHours,
            );

            await tx.ticket.update({
              where: { id: ticketId },
              data: { priority: newPriority, firstResponseDueAt, dueAt },
            });
            await tx.ticketEvent.create({
              data: {
                ticketId,
                type: 'TICKET_PRIORITY_CHANGED',
                payload: { from: fromPriority, to: action.priority },
                createdById: ruleCreatedById,
              },
            });
            await this.slaEngine.syncFromTicket(
              ticketId,
              { policyConfigId: newSla.policyConfigId ?? null },
              tx,
            );
            current = await this.getTicketForActions(tx, ticketId);
          }
          break;
        case 'set_status':
          if (action.status) {
            const newStatus = action.status as TicketStatus;
            current = await this.applyStatusTransitionAction(
              tx,
              ticketId,
              current,
              newStatus,
              ruleCreatedById,
            );
          }
          break;
        case 'notify_team_lead':
          if (current.assignedTeamId) {
            const leads = await tx.teamMember.findMany({
              where: { teamId: current.assignedTeamId, role: 'LEAD' },
              select: { userId: true },
            });
            for (const m of leads) {
              await tx.notification.create({
                data: {
                  userId: m.userId,
                  type: NotificationType.SLA_AT_RISK,
                  title: `Automation: ${current.subject}`,
                  body: action.body ?? 'Rule triggered for this ticket.',
                  ticketId,
                },
              });
            }
          }
          break;
        case 'add_internal_note':
          if (action.body) {
            let authorId = ruleCreatedById;
            const author = await tx.user.findUnique({
              where: { id: authorId },
              select: { id: true },
            });
            if (!author) {
              const fallbackOwner = await tx.user.findFirst({
                where: { role: UserRole.OWNER },
                select: { id: true },
              });
              if (!fallbackOwner) {
                throw new Error(
                  'Unable to add automation internal note: no valid author account',
                );
              }
              authorId = fallbackOwner.id;
            }
            await tx.ticketMessage.create({
              data: {
                ticketId,
                authorId,
                type: 'INTERNAL',
                body: `[Automation] ${action.body}`,
              },
            });
          }
          break;
        default:
          break;
      }
    }
  }

  private async getTicketForActions(
    tx: Prisma.TransactionClient,
    ticketId: string,
  ): Promise<{
    id: string;
    subject: string;
    createdAt: Date;
    assignedTeamId: string | null;
    assigneeId: string | null;
    priority: TicketPriority;
    status: TicketStatus;
    firstResponseDueAt: Date | null;
    resolvedAt: Date | null;
    closedAt: Date | null;
    completedAt: Date | null;
    dueAt: Date | null;
    slaPausedAt: Date | null;
    assignedTeam?: { members: { userId: string }[] } | null;
  }> {
    const t = await tx.ticket.findUnique({
      where: { id: ticketId },
      include: { assignedTeam: { include: { members: true } } },
    });
    if (!t) throw new Error('Ticket not found');
    return t;
  }

  private async applyStatusTransitionAction(
    tx: Prisma.TransactionClient,
    ticketId: string,
    current: {
      id: string;
      subject: string;
      createdAt: Date;
      assignedTeamId: string | null;
      assigneeId: string | null;
      priority: TicketPriority;
      status: TicketStatus;
      firstResponseDueAt: Date | null;
      resolvedAt: Date | null;
      closedAt: Date | null;
      completedAt: Date | null;
      dueAt: Date | null;
      slaPausedAt: Date | null;
      assignedTeam?: { members: { userId: string }[] } | null;
    },
    newStatus: TicketStatus,
    ruleCreatedById: string,
  ) {
    if (newStatus === current.status) {
      return current;
    }

    await this.ticketsService.applyStatusTransitionInTx(
      tx,
      {
        id: current.id,
        status: current.status,
        priority: current.priority,
        assignedTeamId: current.assignedTeamId,
        dueAt: current.dueAt,
        slaPausedAt: current.slaPausedAt,
        resolvedAt: current.resolvedAt,
        closedAt: current.closedAt,
        completedAt: current.completedAt,
      },
      newStatus,
      ruleCreatedById,
    );

    return this.getTicketForActions(tx, ticketId);
  }

  private async getSlaConfig(
    priority: TicketPriority,
    teamId: string | null,
    tx: Prisma.TransactionClient,
  ) {
    if (teamId) {
      const assignedRows = await tx.$queryRaw<
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

    const defaultRows = await tx.$queryRaw<
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
}
