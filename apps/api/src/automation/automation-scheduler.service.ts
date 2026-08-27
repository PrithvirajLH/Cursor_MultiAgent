import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TicketStatus } from '@prisma/client';
import { AutomationQueueService } from '../common/automation-queue.service';
import { parsePositiveInt } from '../common/config.utils';
import { PrismaService } from '../prisma/prisma.service';
import type { AutomationTrigger } from './rule-engine.service';
import type { SchedulerPolicy } from './scheduler-policy.type';
import { TIME_TRIGGERS } from './time-triggers.const';

// Advisory lock key for the scheduler. SLA breach 847291, backfill 847292, retention 847293.
const SCHEDULER_LOCK_KEY = 847294;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 300_000;
const DEFAULT_BATCH_SIZE = 200;
const TICKET_STATUSES = Object.values(TicketStatus) as string[];

type SchedulerRunSummary = {
  ranAt: string;
  rulesConsidered: number;
  rulesSkippedNoThreshold: number;
  ticketsEnqueued: number;
};

/** Hours threshold and status list extracted from a time rule's conditions. */
type RuleThreshold = { hours: number | null; statuses: TicketStatus[] };

type ConditionNode = {
  field?: string;
  operator?: string;
  value?: unknown;
  and?: ConditionNode[];
  or?: ConditionNode[];
};

type TimeRule = {
  id: string;
  name: string;
  trigger: string;
  teamId: string | null;
  conditions: unknown;
};

/**
 * Interval worker for time-based automation rules (card 1.3). Each tick it
 * finds, per active TIME_IN_STATUS / UNASSIGNED_FOR rule, the tickets that
 * meet the rule's own threshold and enqueues them for the rule engine, which
 * re-evaluates every condition, applies team scoping and the 24 h de-dupe.
 * The worker itself never writes to a ticket. Single-instance via an advisory
 * lock; rules are opt-in, so the worker is safe to leave enabled.
 */
@Injectable()
export class AutomationSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AutomationSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly policy: SchedulerPolicy;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly automationQueue: AutomationQueueService,
  ) {
    this.policy = AutomationSchedulerService.readPolicy(config);
  }

  /** AUTOMATION_SCHEDULER_ENABLED (default true), _INTERVAL_MS (5 min), _BATCH (200). */
  static readPolicy(config: ConfigService): SchedulerPolicy {
    return {
      enabled: config.get<string>('AUTOMATION_SCHEDULER_ENABLED') !== 'false',
      intervalMs: parsePositiveInt(
        config.get<string>('AUTOMATION_SCHEDULER_INTERVAL_MS'),
        DEFAULT_INTERVAL_MS,
      ),
      batchSize: parsePositiveInt(
        config.get<string>('AUTOMATION_SCHEDULER_BATCH'),
        DEFAULT_BATCH_SIZE,
      ),
    };
  }

  /**
   * Pull the hours threshold (`hoursSinceActivity` / `hoursUnassigned` gte N)
   * and the status list (`status` equals / in) out of a rule's conditions.
   * Flat leaves and `and` groups are read; `or` groups are ignored for
   * candidate selection because the engine re-evaluates the full tree anyway.
   */
  static extractThreshold(rule: { conditions: unknown }): RuleThreshold {
    const result: RuleThreshold = { hours: null, statuses: [] };
    const visit = (node: ConditionNode): void => {
      if (Array.isArray(node.and)) {
        node.and.forEach(visit);
        return;
      }
      if (Array.isArray(node.or)) return;
      if (
        (node.field === 'hoursSinceActivity' ||
          node.field === 'hoursUnassigned') &&
        node.operator === 'gte'
      ) {
        const hours = Number(node.value);
        if (Number.isFinite(hours) && hours >= 0) result.hours = hours;
        return;
      }
      if (node.field === 'status') {
        const values =
          node.operator === 'equals'
            ? [node.value]
            : node.operator === 'in' && Array.isArray(node.value)
              ? node.value
              : [];
        for (const value of values) {
          if (typeof value === 'string' && TICKET_STATUSES.includes(value)) {
            result.statuses.push(value as TicketStatus);
          }
        }
      }
    };
    const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
    (conditions as ConditionNode[]).forEach(visit);
    return result;
  }

  /**
   * Candidate query for one rule, or null when the rule lacks its threshold
   * (TIME_IN_STATUS also needs at least one status). Pure, so tests can
   * assert the shape.
   */
  static candidateWhere(
    trigger: string,
    threshold: RuleThreshold,
    teamId: string | null,
    now: Date,
  ): Prisma.TicketWhereInput | null {
    if (threshold.hours === null) return null;
    const cutoff = new Date(now.getTime() - threshold.hours * HOUR_MS);
    const teamScope = teamId ? { assignedTeamId: teamId } : {};
    if (trigger === 'TIME_IN_STATUS') {
      if (threshold.statuses.length === 0) return null;
      return {
        deletedAt: null,
        status: { in: threshold.statuses },
        updatedAt: { lte: cutoff },
        ...teamScope,
      };
    }
    if (trigger === 'UNASSIGNED_FOR') {
      return {
        deletedAt: null,
        assigneeId: null,
        status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
        createdAt: { lte: cutoff },
        ...teamScope,
      };
    }
    return null;
  }

  onModuleInit(): void {
    if (!this.policy.enabled) {
      this.logger.log(
        'Automation scheduler disabled (AUTOMATION_SCHEDULER_ENABLED=false)',
      );
      return;
    }
    this.logger.log(
      `Automation scheduler enabled (every ${this.policy.intervalMs} ms, batch ${this.policy.batchSize})`,
    );
    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        this.logger.error(
          'Automation scheduler tick failed',
          (error as Error).stack,
        );
      });
    }, this.policy.intervalMs);
    this.runOnce().catch((error) => {
      this.logger.error(
        'Automation scheduler tick failed',
        (error as Error).stack,
      );
    });
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Current effective policy (copy). */
  getPolicy(): SchedulerPolicy {
    return { ...this.policy };
  }

  /**
   * One scheduler tick. Returns null when another instance holds the lock or a
   * tick is already running here. Public so tests and a future admin endpoint
   * can trigger it.
   */
  async runOnce(): Promise<SchedulerRunSummary | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const now = new Date();
      const plan = await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = await tx.$queryRaw<
            [{ locked: boolean }]
          >`SELECT pg_try_advisory_xact_lock(${SCHEDULER_LOCK_KEY}) AS locked`;
          if (!locked) return null;
          const rules: TimeRule[] = await tx.automationRule.findMany({
            where: { isActive: true, trigger: { in: TIME_TRIGGERS } },
            select: {
              id: true,
              name: true,
              trigger: true,
              teamId: true,
              conditions: true,
            },
            orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
          });
          const pairs = new Map<
            string,
            { ticketId: string; trigger: AutomationTrigger }
          >();
          let skipped = 0;
          for (const rule of rules) {
            const threshold = AutomationSchedulerService.extractThreshold(rule);
            const where = AutomationSchedulerService.candidateWhere(
              rule.trigger,
              threshold,
              rule.teamId,
              now,
            );
            if (!where) {
              skipped += 1;
              this.logger.warn(
                `Time rule "${rule.name}" (${rule.id}) has no hours threshold${rule.trigger === 'TIME_IN_STATUS' ? ' or status' : ''}; skipped`,
              );
              continue;
            }
            const orderBy: Prisma.TicketOrderByWithRelationInput =
              rule.trigger === 'TIME_IN_STATUS'
                ? { updatedAt: 'asc' }
                : { createdAt: 'asc' };
            const candidates = await tx.ticket.findMany({
              where,
              select: { id: true },
              orderBy,
              take: this.policy.batchSize,
            });
            for (const candidate of candidates) {
              pairs.set(`${candidate.id}:${rule.trigger}`, {
                ticketId: candidate.id,
                trigger: rule.trigger as AutomationTrigger,
              });
            }
          }
          return {
            rulesConsidered: rules.length,
            skipped,
            pairs: [...pairs.values()],
          };
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
      if (!plan) return null;
      // After commit: the queue runs the engine inline when Redis is off.
      for (const pair of plan.pairs) {
        await this.automationQueue.enqueue(pair.ticketId, pair.trigger);
      }
      const summary: SchedulerRunSummary = {
        ranAt: now.toISOString(),
        rulesConsidered: plan.rulesConsidered,
        rulesSkippedNoThreshold: plan.skipped,
        ticketsEnqueued: plan.pairs.length,
      };
      this.logger.log(JSON.stringify(summary));
      return summary;
    } finally {
      this.running = false;
    }
  }
}
