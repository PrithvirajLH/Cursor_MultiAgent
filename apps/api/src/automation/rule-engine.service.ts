import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import {
  NotificationType,
  TagSource,
  TicketCloseReason,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import type { Prisma, User } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SlaEngineService } from '../slas/sla-engine.service';
import { TagsService } from '../tags/tags.service';
import { TicketsService } from '../tickets/tickets.service';
import { TicketSlaCalculationService } from '../tickets/ticket-sla-calculation.service';
import { fillTemplateVars } from './template-vars.util';

export type AutomationTrigger =
  | 'TICKET_CREATED'
  | 'STATUS_CHANGED'
  | 'SLA_APPROACHING'
  | 'SLA_BREACHED'
  | 'TIME_IN_STATUS'
  | 'UNASSIGNED_FOR';

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
  tags?: string[];
  categoryId?: string;
  target?: string;
  to?: string;
  address?: string;
  subject?: string;
};

/** Work that must only happen once the rule's transaction has committed (card 1.4). */
type PostCommitTask = () => Promise<void>;

/** The ticket row the action executor works on; refreshed after each mutating action. */
type ActionTicket = {
  id: string;
  subject: string;
  displayId?: string | null;
  createdAt: Date;
  priority: TicketPriority;
  status: TicketStatus;
  assignedTeamId: string | null;
  assigneeId: string | null;
  categoryId: string | null;
  firstResponseDueAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  completedAt: Date | null;
  dueAt: Date | null;
  slaPausedAt: Date | null;
  requesterId: string;
  requester?: User | null;
  assignee?: User | null;
  assignedTeam?: { members: { userId: string }[] } | null;
};

/**
 * SLA and time triggers: skip if we already ran this rule for this ticket
 * recently (idempotent). For time rules this is what makes a reminder repeat
 * at most daily while its condition still holds.
 */
const SLA_DE_DUPE_HOURS = 24;
const DE_DUPED_TRIGGERS: AutomationTrigger[] = [
  'SLA_APPROACHING',
  'SLA_BREACHED',
  'TIME_IN_STATUS',
  'UNASSIGNED_FOR',
];
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_REQUESTER_REMINDER =
  'This ticket is waiting on you — please reply or let us know if it is resolved.';
const AUTOMATION_EMAIL_EVENT = 'AUTOMATION_EMAIL';
const TAGS_CHANGED_EVENT = 'TAGS_CHANGED';

@Injectable()
export class RuleEngineService {
  private readonly logger = new Logger(RuleEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly slaEngine: SlaEngineService,
    @Inject(forwardRef(() => TicketsService))
    private readonly ticketsService: TicketsService,
    @Inject(forwardRef(() => TicketSlaCalculationService))
    private readonly slaCalc: TicketSlaCalculationService,
    private readonly tags: TagsService,
    private readonly notifications: NotificationsService,
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
    if (!ticket || ticket.deletedAt) {
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
   * Run the first matching active automation rule for the given trigger and ticket.
   * Matching uses rule priority (lower number first, then oldest).
   * Each rule run is atomic: all ticket updates, events, messages, and AutomationExecution
   * are performed inside a single transaction; on failure nothing is persisted and we
   * record a failed AutomationExecution outside the transaction.
   * For SLA_APPROACHING/SLA_BREACHED, skips if this rule already ran for this ticket in the last 24h.
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

    if (!ticket || ticket.deletedAt) {
      // Soft-deleted tickets never run automation rules.
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
        DE_DUPED_TRIGGERS.includes(trigger) &&
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
        let postCommit: PostCommitTask[] = [];
        await this.prisma.$transaction(async (tx) => {
          const result = await this.executeActions(
            tx,
            ticketId,
            actions,
            ticket,
            rule.id,
            rule.createdById,
          );
          postCommit = result.postCommit;
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
        // Emails and other external effects only after the commit: a rolled-back rule sends nothing.
        await this.runPostCommit(postCommit, rule.name);
        await this.ticketsService.publishAutomationRealtimeUpdate(
          ticketId,
          rule.createdById ?? null,
        );
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

      // UI and workflow docs define first-match execution semantics.
      break;
    }

    return { executed, errors };
  }

  /**
   * Condition context. `hoursSinceActivity` is whole hours since the last
   * write to the ticket (updatedAt); `hoursUnassigned` is whole hours since
   * creation while no assignee is set (0 once assigned). Both feed the `gte`
   * operator used by time-based rules (card 1.3).
   */
  ticketToContext(
    ticket: {
      id: string;
      subject: string;
      description: string | null;
      priority: TicketPriority;
      status: TicketStatus;
      assignedTeamId: string | null;
      assigneeId: string | null;
      categoryId: string | null;
      requesterId: string;
      createdAt?: Date;
      updatedAt?: Date;
    },
    now: Date = new Date(),
  ): TicketContext {
    const wholeHoursSince = (date: Date | undefined): number =>
      date
        ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / HOUR_MS))
        : 0;
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
      hoursSinceActivity: wholeHoursSince(ticket.updatedAt),
      hoursUnassigned: ticket.assigneeId
        ? 0
        : wholeHoursSince(ticket.createdAt),
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
      case 'gte': {
        // Numeric "at least" for the hour fields; non-numeric operands never match.
        const a = Number(raw);
        const b = Number(value);
        return Number.isFinite(a) && Number.isFinite(b) && a >= b;
      }
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
    ticket: ActionTicket,
    ruleId: string,
    ruleCreatedById: string,
  ): Promise<{ current: ActionTicket; postCommit: PostCommitTask[] }> {
    let current: ActionTicket = ticket;
    const postCommit: PostCommitTask[] = [];
    for (const action of actions) {
      switch (action.type) {
        case 'assign_team':
          if (action.teamId) {
            await this.ticketsService.applyTeamTransferInTx(
              tx,
              {
                id: current.id,
                createdAt: current.createdAt,
                status: current.status,
                priority: current.priority,
                assignedTeamId: current.assignedTeamId,
                assigneeId: current.assigneeId,
                firstResponseDueAt: current.firstResponseDueAt,
                dueAt: current.dueAt,
              },
              {
                newTeamId: action.teamId,
              },
              ruleCreatedById,
              { rejectSameTeam: false },
            );
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
            await this.ticketsService.applyAssigneeInTx(
              tx,
              {
                id: current.id,
                status: current.status,
                assignedTeamId: current.assignedTeamId,
                assigneeId: current.assigneeId,
              },
              { assigneeId: action.userId },
              ruleCreatedById,
            );
            current = await this.getTicketForActions(tx, ticketId);
          }
          break;
        case 'set_priority':
          if (
            action.priority &&
            ['SEV1', 'SEV2', 'SEV3', 'SEV4'].includes(action.priority)
          ) {
            const fromPriority = current.priority;
            const newPriority = action.priority as TicketPriority;

            const oldSla = await this.slaCalc.getSlaConfig(
              current.priority,
              current.assignedTeamId,
              tx,
            );
            const newSla = await this.slaCalc.getSlaConfig(
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
        case 'notify_requester':
          // In-app only (card 1.3); email arrives with send_email once SMTP exists.
          await tx.notification.create({
            data: {
              userId: current.requesterId,
              type: NotificationType.TICKET_UPDATED,
              title: `Reminder: ${current.subject}`,
              body: action.body ?? DEFAULT_REQUESTER_REMINDER,
              ticketId,
            },
          });
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
        case 'add_tag': {
          const names = this.normalizeTagNames(action.tags);
          if (names.length === 0) break;
          const existing = await this.readTagNames(tx, ticketId);
          await this.tags.attachManyToTicket(
            ticketId,
            names,
            TagSource.MANUAL,
            ruleCreatedById,
            tx,
          );
          const added = names.filter((name) => !existing.has(name));
          if (added.length > 0) {
            await this.writeTagsEvent(tx, ticketId, added, [], ruleCreatedById);
          }
          break;
        }
        case 'remove_tag': {
          const names = this.normalizeTagNames(action.tags);
          if (names.length === 0) break;
          const existing = await this.readTagNames(tx, ticketId);
          const removed = names.filter((name) => existing.has(name));
          if (removed.length === 0) break;
          await tx.ticketTag.deleteMany({
            where: { ticketId, tag: { name: { in: removed } } },
          });
          await this.writeTagsEvent(tx, ticketId, [], removed, ruleCreatedById);
          break;
        }
        case 'set_category': {
          if (!action.categoryId || action.categoryId === current.categoryId) {
            break;
          }
          const category = await tx.category.findUnique({
            where: { id: action.categoryId },
            select: { id: true, isActive: true },
          });
          if (!category || !category.isActive) {
            // Validated at save time; the category was deactivated or removed since. Skip, do not fail the rule.
            this.logger.warn(
              `set_category skipped for ticket ${ticketId}: category ${action.categoryId} is missing or inactive`,
            );
            break;
          }
          await tx.ticket.update({
            where: { id: ticketId },
            data: { categoryId: category.id },
          });
          await tx.ticketEvent.create({
            data: {
              ticketId,
              type: 'TICKET_CATEGORY_CHANGED',
              payload: {
                from: current.categoryId,
                to: category.id,
                byAutomation: true,
              },
              createdById: ruleCreatedById,
            },
          });
          current = await this.getTicketForActions(tx, ticketId);
          break;
        }
        case 'add_follower': {
          const followerId = this.resolveFollowerId(action, current);
          if (!followerId) break;
          await tx.ticketFollower.upsert({
            where: { ticketId_userId: { ticketId, userId: followerId } },
            update: {},
            create: { ticketId, userId: followerId },
          });
          break;
        }
        case 'send_email': {
          const task = await this.buildSendEmailTask(
            tx,
            ticketId,
            current,
            action,
            ruleId,
          );
          if (task) postCommit.push(task);
          break;
        }
        default:
          break;
      }
    }
    return { current, postCommit };
  }

  private async getTicketForActions(
    tx: Prisma.TransactionClient,
    ticketId: string,
  ): Promise<ActionTicket> {
    const t = await tx.ticket.findUnique({
      where: { id: ticketId },
      include: {
        requester: true,
        assignee: true,
        assignedTeam: { include: { members: true } },
      },
    });
    if (!t || t.deletedAt) throw new Error('Ticket not found');
    return t;
  }

  private async applyStatusTransitionAction(
    tx: Prisma.TransactionClient,
    ticketId: string,
    current: ActionTicket,
    newStatus: TicketStatus,
    ruleCreatedById: string,
  ): Promise<ActionTicket> {
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
        assigneeId: current.assigneeId,
        dueAt: current.dueAt,
        slaPausedAt: current.slaPausedAt,
        resolvedAt: current.resolvedAt,
        closedAt: current.closedAt,
        completedAt: current.completedAt,
      },
      newStatus,
      ruleCreatedById,
      // Every automation close is "the system closed it" (card 1.3).
      newStatus === TicketStatus.CLOSED
        ? TicketCloseReason.AUTO_CLOSED
        : undefined,
    );

    return this.getTicketForActions(tx, ticketId);
  }

  /** Trim/lowercase like TagsService; silently drops names it would reject. */
  private normalizeTagNames(raw: string[] | undefined): string[] {
    if (!Array.isArray(raw)) return [];
    const names = new Set<string>();
    for (const value of raw) {
      try {
        names.add(this.tags.normalize(value));
      } catch {
        continue;
      }
    }
    return [...names];
  }

  private async readTagNames(
    tx: Prisma.TransactionClient,
    ticketId: string,
  ): Promise<Set<string>> {
    const rows = await tx.ticketTag.findMany({
      where: { ticketId },
      select: { tag: { select: { name: true } } },
    });
    return new Set(rows.map((row) => row.tag.name));
  }

  private async writeTagsEvent(
    tx: Prisma.TransactionClient,
    ticketId: string,
    added: string[],
    removed: string[],
    ruleCreatedById: string,
  ): Promise<void> {
    await tx.ticketEvent.create({
      data: {
        ticketId,
        type: TAGS_CHANGED_EVENT,
        payload: { added, removed, byAutomation: true },
        createdById: ruleCreatedById,
      },
    });
  }

  /** Explicit userId wins; 'requester'/'assignee' resolve from the ticket (null when unassigned). */
  private resolveFollowerId(
    action: ActionNode,
    current: ActionTicket,
  ): string | null {
    if (action.userId) return action.userId;
    if (action.target === 'requester') return current.requesterId;
    if (action.target === 'assignee') return current.assigneeId;
    return null;
  }

  /**
   * Resolve recipients and fill placeholders now (inside the transaction, so
   * the ticket state is the one the rule saw), but defer the outbox write to
   * after commit. Returns null when nobody would receive the email.
   */
  private async buildSendEmailTask(
    tx: Prisma.TransactionClient,
    ticketId: string,
    current: ActionTicket,
    action: ActionNode,
    ruleId: string,
  ): Promise<PostCommitTask | null> {
    if (!action.to || !action.subject || !action.body) return null;
    const recipients: User[] = [];
    const addresses: string[] = [];
    if (action.to === 'requester' && current.requester) {
      recipients.push(current.requester);
    } else if (action.to === 'assignee' && current.assignee) {
      recipients.push(current.assignee);
    } else if (action.to === 'team_leads' && current.assignedTeamId) {
      const leads = await tx.teamMember.findMany({
        where: { teamId: current.assignedTeamId, role: 'LEAD' },
        include: { user: true },
      });
      recipients.push(...leads.map((lead) => lead.user));
    } else if (action.to === 'address' && action.address) {
      addresses.push(action.address);
    }
    if (recipients.length === 0 && addresses.length === 0) return null;
    const vars: Record<string, string> = {
      'ticket.displayId': current.displayId ?? '',
      'ticket.subject': current.subject,
      'requester.displayName': current.requester?.displayName ?? '',
    };
    const details = {
      eventType: AUTOMATION_EMAIL_EVENT,
      subject: fillTemplateVars(action.subject, vars),
      body: fillTemplateVars(action.body, vars),
      ticketId,
      payload: { ruleId },
    };
    return async (): Promise<void> => {
      if (recipients.length > 0) {
        await this.notifications.notifyUsers(recipients, details);
      }
      if (addresses.length > 0) {
        await this.notifications.notifyAddresses(addresses, details);
      }
    };
  }

  /** Run post-commit tasks one by one; a failure is logged and never undoes the rule. */
  private async runPostCommit(
    tasks: PostCommitTask[],
    ruleName: string,
  ): Promise<void> {
    for (const task of tasks) {
      try {
        await task();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Rule ${ruleName}: post-commit action failed: ${msg}`,
        );
      }
    }
  }

  private addHours(date: Date, hours: number) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
  }
}
