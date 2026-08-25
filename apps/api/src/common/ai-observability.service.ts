import { Injectable, Logger } from '@nestjs/common';
import { AiRoutingMethod, AiStepStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** One pipeline step, as recorded by the pipeline's own step tracker. */
export interface PipelineStepRecord {
  step: number;
  agent: string;
  status: 'success' | 'error';
  latencyMs: number;
  toolsCalled?: string[];
  input?: string;
  rawOutput?: string;
  parsed?: unknown;
  error?: string;
}

export interface RoutingRecord {
  correlationId: string;
  ticketId: string | null;
  predictedTeamId: string | null;
  confidence: number;
  thresholdUsed: number;
  method: AiRoutingMethod;
  matchedRuleId?: string | null;
  alternatives?: unknown;
  accepted: boolean;
}

/**
 * Durable, queryable AI observability.
 *
 * The pipeline previously wrote its whole trace into a TicketEvent JSON
 * payload, which cannot answer the questions ADR-001 exists to answer: routing
 * accuracy, per-department precision and recall, a confusion matrix, or which
 * step regressed after a prompt change. Those need columns and indexes.
 *
 * Every method here is FIRE AND FORGET. Observability must never fail, slow, or
 * roll back a user's intake — a failed log is logged and swallowed.
 */
@Injectable()
export class AiObservabilityService {
  private readonly logger = new Logger(AiObservabilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist one row per pipeline step.
   *
   * @param redact when true the department handles PHI, so free-text model
   *   input/output is dropped rather than stored. HIPAA applies to the log as
   *   much as to the ticket (AGENTS.md §12).
   */
  recordSteps(
    correlationId: string,
    ticketId: string | null,
    steps: PipelineStepRecord[],
    redact: boolean,
  ): void {
    if (steps.length === 0) {
      return;
    }
    const rows = steps.map((step) => ({
      correlationId,
      ticketId,
      step: step.step,
      agentName: step.agent,
      latencyMs: Math.max(0, Math.round(step.latencyMs)),
      status:
        step.status === 'success' ? AiStepStatus.SUCCESS : AiStepStatus.ERROR,
      rawOutput: redact ? null : (step.rawOutput ?? null),
      parsed: redact
        ? Prisma.JsonNull
        : ((step.parsed ?? Prisma.JsonNull) as Prisma.InputJsonValue),
      error: step.error ?? null,
      redacted: redact,
    }));
    void this.prisma.aiInferenceLog
      .createMany({ data: rows })
      .catch((error: unknown) => this.swallow('AiInferenceLog', error));
  }

  /** Persist the routing decision that accuracy scoring is measured against. */
  recordRouting(record: RoutingRecord): void {
    void this.prisma.routingDecisionLog
      .create({
        data: {
          correlationId: record.correlationId,
          ticketId: record.ticketId,
          predictedTeamId: record.predictedTeamId,
          confidence: record.confidence,
          thresholdUsed: record.thresholdUsed,
          method: record.method,
          matchedRuleId: record.matchedRuleId ?? null,
          alternatives: (record.alternatives ??
            Prisma.JsonNull) as Prisma.InputJsonValue,
          accepted: record.accepted,
        },
      })
      .catch((error: unknown) => this.swallow('RoutingDecisionLog', error));
  }

  /**
   * Record an agent overriding an AI decision — the ground truth that routing
   * accuracy is scored against.
   *
   * Self-guarding: a row is written ONLY when the ticket was actually routed by
   * the AI (it has a RoutingDecisionLog entry). Editing the department of a
   * manually created ticket is an ordinary edit, not a correction of a
   * prediction, and must not count against accuracy. Callers therefore do not
   * need to know whether a ticket came from the pipeline.
   *
   * A no-op when the value did not really change.
   */
  recordCorrection(
    ticketId: string,
    field: string,
    fromValue: string | null,
    toValue: string | null,
    correctedById: string,
    reason?: string | null,
  ): void {
    if (fromValue === toValue) {
      return;
    }
    void this.writeCorrection(
      ticketId,
      field,
      fromValue,
      toValue,
      correctedById,
      reason ?? null,
    ).catch((error: unknown) => this.swallow('CorrectionLog', error));
  }

  private async writeCorrection(
    ticketId: string,
    field: string,
    fromValue: string | null,
    toValue: string | null,
    correctedById: string,
    reason: string | null,
  ): Promise<void> {
    const routed = await this.prisma.routingDecisionLog.findFirst({
      where: { ticketId },
      select: { id: true },
    });
    if (!routed) {
      return;
    }
    await this.prisma.correctionLog.create({
      data: { ticketId, field, fromValue, toValue, correctedById, reason },
    });
  }

  private swallow(table: string, error: unknown): void {
    this.logger.warn(
      `${table} write failed (non-fatal): ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
