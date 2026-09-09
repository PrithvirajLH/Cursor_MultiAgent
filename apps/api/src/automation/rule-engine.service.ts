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
import { isStaffRole } from '../notifications/is-staff-role.util';
import type { ActionProvenance } from './action-provenance.type';
import { MACRO_ALLOWED_ACTIONS } from './macro-allowed-actions.util';
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

/**
 * How long a macro's transaction may run (card 1.51).
 *
 * ⚠️ 15 SECONDS, AND NOT PRISMA'S 5-SECOND DEFAULT. Observed live: a bulk
 * macro over three tickets failed on one with "Transaction already closed:
 * ... timeout for this transaction was 5000 ms, however 5037 ms passed",
 * inside `slaInstance.upsert`. `set_priority` calls `slaEngine.syncFromTicket`
 * INSIDE this transaction, and with five of these running at once against a
 * remote pooler, 5 s is simply too tight. Latency, not logic - the retry
 * succeeded immediately and the rollback was clean.
 *
 * ⚠️ THE SLA SYNC STAYS INSIDE THE TRANSACTION. Moving it out would let an SLA
 * row survive a priority change that rolled back: a visible timeout traded for
 * silent inconsistency, which is a worse bug and a harder one to notice.
 *
 * 15 s rather than the 60 s used by the automation scheduler
 * (automation-scheduler.service.ts): that one runs alone on a timer, whereas
 * this runs five-wide under a bulk macro, and a long-held transaction there
 * starves a pooled connection for everyone else. 15 s is three times the
 * observed overrun with room to spare, and still short enough that a genuinely
 * stuck macro fails rather than hangs.
 *
 * `maxWait` is deliberately left at its default: the failure we saw was the
 * transaction's own duration, not waiting for a connection from the pool -
 * that error reads "Unable to start a transaction in the given time" and has
 * not appeared.
 */
export const MACRO_TRANSACTION_OPTIONS = { timeout: 15_000 } as const;

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
          const result = await this.executeActions(tx, ticketId, actions, ticket, {
            kind: 'rule',
            ruleId: rule.id,
            actorId: rule.createdById,
          });
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

  /**
   * Apply a MACRO's actions, on behalf of the person who clicked it (card 1.7).
   *
   * Shares one executor with the rule engine rather than copying the switch -
   * a second copy is what caused the faults cards 1.36 and 1.38 had to fix. The
   * difference is entirely in the provenance:
   *
   *   * NO `AutomationExecution` ROW IS WRITTEN. Those rows are per-rule and
   *     drive automation reporting; a human's click is not a rule firing, and
   *     recording one would have quietly corrupted that reporting.
   *   * The ticket event is `MACRO_APPLIED`, attributed to the ACTOR, so the
   *     audit trail says a person did this. `AUTOMATION_RULE_EXECUTED` is
   *     never written here.
   *   * Any action outside MACRO_ALLOWED_ACTIONS is skipped and reported on
   *     that event rather than silently dropped.
   *
   * The transaction and the post-commit tasks are owned here, so a caller
   * cannot half-apply a macro by forgetting to run them. Callers must do their
   * own permission check first - this method deliberately makes no access
   * decision, exactly like `runForTicket`.
   */
  async applyMacroActions(
    ticketId: string,
    actions: ActionNode[],
    provenance: Extract<ActionProvenance, { kind: 'macro' }>,
  ): Promise<{ applied: number; skipped: string[] }> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        requester: true,
        assignee: true,
        assignedTeam: { include: { members: true } },
      },
    });
    if (!ticket || ticket.deletedAt) {
      throw new Error('Ticket not found');
    }
    let postCommit: PostCommitTask[] = [];
    let skipped: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const result = await this.executeActions(
        tx,
        ticketId,
        actions,
        await this.getTicketForActions(tx, ticketId),
        provenance,
      );
      postCommit = result.postCommit;
      skipped = result.skipped;
      await tx.ticketEvent.create({
        data: {
          ticketId,
          type: 'MACRO_APPLIED',
          payload: {
            cannedResponseId: provenance.cannedResponseId,
            actionCount: actions.length - skipped.length,
            ...(skipped.length > 0 ? { skippedActions: skipped } : {}),
          },
          createdById: provenance.actorId,
        },
      });
    }, MACRO_TRANSACTION_OPTIONS);
    // External effects only after the commit, so a rolled-back macro does
    // nothing outward - the same rule the rule engine follows.
    await this.runPostCommit(postCommit, 'macro');
    await this.ticketsService.publishAutomationRealtimeUpdate(
      ticketId,
      provenance.actorId,
    );
    return { applied: actions.length - skipped.length, skipped };
  }

  /**
   * Run a list of actions inside a transaction (cards 1.4 and 1.7).
   *
   * ⚠️ THE `provenance` PARAMETER REPLACED `ruleId` + `actorId`, and
   * that is the whole reason a macro can share this code. A macro run by a
   * person is not a rule firing: passing a fabricated ruleId would have made a
   * human's click look like automation, and `AutomationExecution` rows drive
   * automation reporting. See action-provenance.type.ts.
   *
   * The caller owns the transaction AND must run the returned post-commit tasks
   * after it commits - get that wrong and the work half-applies.
   */
  private async executeActions(
    tx: Prisma.TransactionClient,
    ticketId: string,
    actions: ActionNode[],
    ticket: ActionTicket,
    provenance: ActionProvenance,
  ): Promise<{
    current: ActionTicket;
    postCommit: PostCommitTask[];
    skipped: string[];
  }> {
    let current: ActionTicket = ticket;
    const postCommit: PostCommitTask[] = [];
    const skipped: string[] = [];
    const actorId = provenance.actorId;
    for (const action of actions) {
      // Card 1.7 §2, enforced HERE as well as on save. A macro stored before
      // the allowlist existed - or edited through a stale client - still must
      // not be able to send email. Skipping rather than throwing keeps the
      // useful half of such a macro working, and the skip is returned to the
      // caller so it lands on the ticket event rather than vanishing.
      if (
        provenance.kind === 'macro' &&
        !MACRO_ALLOWED_ACTIONS.includes(action.type)
      ) {
        skipped.push(action.type);
        continue;
      }
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
              actorId,
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
              actorId,
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
                createdById: actorId,
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
              actorId,
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
            let authorId = actorId;
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
                // The prefix follows the provenance. A macro is a person
                // clicking a button, and labelling their note "[Automation]"
                // contradicted the rest of the audit trail, which correctly
                // attributes it to them - caught by reading a real note in the
                // browser, not by a test.
                body:
                  provenance.kind === 'rule'
                    ? `[Automation] ${action.body}`
                    : `[Template] ${action.body}`,
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
            actorId,
            tx,
          );
          const added = names.filter((name) => !existing.has(name));
          if (added.length > 0) {
            await this.writeTagsEvent(tx, ticketId, added, [], actorId);
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
          await this.writeTagsEvent(tx, ticketId, [], removed, actorId);
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
                // False when a person clicked a macro (card 1.7).
                byAutomation: provenance.kind === 'rule',
              },
              createdById: actorId,
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
          // Rules only. The allowlist above already drops this for a macro;
          // this second check makes that structural rather than dependent on
          // the loop staying correct, and it is what lets the ruleId be read
          // off the provenance without a cast.
          if (provenance.kind !== 'rule') break;
          const task = await this.buildSendEmailTask(
            tx,
            ticketId,
            current,
            action,
            provenance.ruleId,
          );
          if (task) postCommit.push(task);
          break;
        }
        default:
          break;
      }
    }
    return { current, postCommit, skipped };
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
    // Card 1.42 §1b. A rule may email an address OUTSIDE the staff group - a
    // vendor, a distribution list - but not a member of staff, or `send_email`
    // becomes the way around "staff use the app". Staff still receive the
    // rule's message; they receive it as a bell.
    //
    // ⚠️ §1b says "the in-app notification still fires - only the email is
    // dropped". IT DID NOT. `send_email` was email-only and raised nothing
    // in-app; the action that raises one is the separate `notify_requester`
    // above. So the bell below is BUILT here, not merely preserved - without it
    // restricting the email would silently swallow a rule's message.
    //
    // The `to: 'address'` branch is looked up rather than pattern-matched: a
    // staff member's own address must not become a bypass, and addresses cannot
    // be judged by domain because everybody is on the organisation's own one.
    const externalRecipients = recipients.filter(
      (user) => !isStaffRole(user.role),
    );
    const staffUserIds = new Set(
      recipients.filter((user) => isStaffRole(user.role)).map((u) => u.id),
    );
    const addressOwners = addresses.length
      ? await tx.user.findMany({
          where: {
            email: { in: addresses.map((a) => a.trim().toLowerCase()) },
          },
          select: { id: true, email: true, role: true },
        })
      : [];
    const staffAddresses = new Set<string>();
    for (const owner of addressOwners) {
      if (isStaffRole(owner.role)) {
        staffAddresses.add(owner.email.toLowerCase());
        staffUserIds.add(owner.id);
      }
    }
    const externalAddresses = addresses.filter(
      (address) => !staffAddresses.has(address.trim().toLowerCase()),
    );
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
      if (externalRecipients.length > 0) {
        await this.notifications.notifyUsers(externalRecipients, details);
      }
      if (externalAddresses.length > 0) {
        await this.notifications.notifyAddresses(externalAddresses, details);
      }
      if (staffUserIds.size > 0) {
        await this.notifyStaffOfRuleEmail(
          Array.from(staffUserIds),
          ticketId,
          details.subject,
          details.body,
        );
      }
    };
  }

  /**
   * A rule's message delivered as a bell rather than an email (card 1.42 §1b).
   *
   * Written straight through prisma, matching the `notify_requester` action
   * rather than injecting InAppNotificationsService, so both automation
   * notifications have one shape. That does mean no realtime push - the same as
   * `notify_requester` today - so it arrives on the notification centre's next
   * poll rather than instantly. Acceptable for a rule-driven message; say so
   * rather than discovering it later.
   *
   * TICKET_UPDATED is the type the automation engine already uses, and card
   * 1.42 added it to the notification centre's icon map, where it had been
   * missing and falling through to a generic bell.
   */
  private async notifyStaffOfRuleEmail(
    userIds: string[],
    ticketId: string,
    subject: string,
    body: string,
  ): Promise<void> {
    try {
      await this.prisma.notification.createMany({
        data: userIds.map((userId) => ({
          userId,
          type: NotificationType.TICKET_UPDATED,
          title: subject,
          body,
          ticketId,
        })),
      });
    } catch (error) {
      this.logger.error(
        `Failed to raise in-app notifications for a rule on ticket ${ticketId}`,
        (error as Error).stack,
      );
    }
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
