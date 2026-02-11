import { Injectable } from '@nestjs/common';
import { NotificationType, TicketPriority, TicketStatus, UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SlaEngineService } from '../slas/sla-engine.service';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
  ) {}

  /**
   * Dry-run: evaluate a single rule against a ticket. No side effects.
   * Returns whether the rule matches and which actions would run.
   */
  async evaluateRuleForTicket(
    ruleId: string,
    ticketId: string,
  ): Promise<{ matched: boolean; actionsThatWouldRun: ActionNode[]; message?: string }> {
    const rule = await this.prisma.automationRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule) {
      return { matched: false, actionsThatWouldRun: [], message: 'Rule not found' };
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { assignedTeam: true },
    });
    if (!ticket) {
      return { matched: false, actionsThatWouldRun: [], message: 'Ticket not found' };
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
      return { matched: false, actionsThatWouldRun: [], message: 'Rule has no conditions' };
    }

    const matched = this.evaluateConditions(conditions, ctx);
    if (!matched) {
      return { matched: false, actionsThatWouldRun: [], message: 'Conditions did not match' };
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
        (await this.alreadyExecutedRecently(rule.id, ticketId, trigger, SLA_DE_DUPE_HOURS))
      ) {
        continue;
      }

      try {
        await this.prisma.$transaction(async (tx) => {
          await this.executeActions(tx, ticketId, actions, ticket, rule.id, rule.createdById);
          await tx.automationExecution.create({
            data: { ruleId: rule.id, ticketId, trigger, success: true },
          });
        });
        executed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Rule ${rule.name}: ${msg}`);
        await this.prisma.automationExecution.create({
          data: { ruleId: rule.id, ticketId, trigger, success: false, error: msg },
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
  private evaluateConditions(conditions: ConditionNode[], ctx: TicketContext): boolean {
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
    const str = raw != null ? String(raw).toLowerCase() : '';
    const valStr = value != null ? String(value).toLowerCase() : '';

    switch (operator) {
      case 'contains':
        return str.includes(valStr);
      case 'equals':
        return str === valStr;
      case 'notEquals':
        return str !== valStr;
      case 'in':
        if (!Array.isArray(value)) return raw === value;
        return value.some((v) => String(v).toLowerCase() === str || raw === v);
      case 'notIn':
        if (!Array.isArray(value)) return raw !== value;
        return !value.some((v) => String(v).toLowerCase() === str || raw === v);
      case 'isEmpty':
        return raw == null || String(raw).trim() === '';
      case 'isNotEmpty':
        return raw != null && String(raw).trim() !== '';
      default:
        return false;
    }
  }

  private async executeActions(
    tx: Prisma.TransactionClient,
    ticketId: string,
    actions: ActionNode[],
    ticket: {
      id: string;
      subject: string;
      priority: TicketPriority;
      status: TicketStatus;
      assignedTeamId: string | null;
      assigneeId: string | null;
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
          if (action.priority && ['P1', 'P2', 'P3', 'P4'].includes(action.priority)) {
            const fromPriority = current.priority;
            const newPriority = action.priority as TicketPriority;
            await tx.ticket.update({
              where: { id: ticketId },
              data: { priority: newPriority },
            });
            await tx.ticketEvent.create({
              data: {
                ticketId,
                type: 'TICKET_PRIORITY_CHANGED',
                payload: { from: fromPriority, to: action.priority },
                createdById: ruleCreatedById,
              },
            });
            await this.slaEngine.syncFromTicket(ticketId, undefined, tx);
            current = { ...current, priority: newPriority };
          }
          break;
        case 'set_status':
          if (action.status) {
            const fromStatus = current.status;
            const newStatus = action.status as TicketStatus;
            await tx.ticket.update({
              where: { id: ticketId },
              data: { status: newStatus },
            });
            await tx.ticketEvent.create({
              data: {
                ticketId,
                type: 'TICKET_STATUS_CHANGED',
                payload: { from: fromStatus, to: newStatus },
                createdById: ruleCreatedById,
              },
            });
            await this.slaEngine.syncFromTicket(ticketId, undefined, tx);
            current = { ...current, status: newStatus };
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
            const systemUser = await tx.user.findFirst({
              where: { role: UserRole.OWNER },
              select: { id: true },
            });
            if (systemUser) {
              await tx.ticketMessage.create({
                data: {
                  ticketId,
                  authorId: systemUser.id,
                  type: 'INTERNAL',
                  body: `[Automation] ${action.body}`,
                },
              });
            }
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
    assignedTeamId: string | null;
    assigneeId: string | null;
    priority: TicketPriority;
    status: TicketStatus;
    assignedTeam?: { members: { userId: string }[] } | null;
  }> {
    const t = await tx.ticket.findUnique({
      where: { id: ticketId },
      include: { assignedTeam: { include: { members: true } } },
    });
    if (!t) throw new Error('Ticket not found');
    return t;
  }
}
