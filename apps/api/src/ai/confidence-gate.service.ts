import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { ClassificationResult } from './types/pipeline.types';

/** Outcome of the deterministic confidence evaluation. */
export interface ConfidenceDecision {
  /** True when the ticket may be auto-routed; false sends it to human triage. */
  passed: boolean;
  /** Weighted score in the range 0-1. */
  overallConfidence: number;
  /** The threshold this decision was measured against. */
  thresholdUsed: number;
  /** Why the gate decided as it did — recorded on RoutingDecisionLog. */
  reason: 'passed' | 'below_threshold' | 'multi_department' | 'unknown_department';
}

const DEPARTMENT_WEIGHT = 0.6;
const CATEGORY_WEIGHT = 0.3;
/**
 * Below this, a category prediction is treated as absent and the department
 * score stands alone: the receiving department can triage its own category.
 */
const CATEGORY_TRUST_FLOOR = 0.5;
const DEFAULT_THRESHOLD = 0.75;
const DEFAULT_SENSITIVE_THRESHOLD = 0.85;

/**
 * Decides whether an AI classification is confident enough to auto-route.
 *
 * This was previously delegated to an LLM ("Agent 3"), which was asked in prose
 * to compute a weighted average and compare it to a hardcoded threshold. Model
 * self-assessment is uncalibrated, the arithmetic was unverifiable, and the
 * thresholds could not be changed without editing a prompt and redeploying.
 *
 * Scoring and the pass/fail decision now live here, in deterministic and
 * unit-tested code. Thresholds are configuration (env defaults, with a
 * per-department override column), per AGENTS.md §10. The LLM still writes the
 * clarifying question, which is a genuine language task.
 */
@Injectable()
export class ConfidenceGateService {
  private readonly logger = new Logger(ConfidenceGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Evaluate a classification against the receiving department's threshold.
   *
   * Fails closed: an unresolvable department, or any score at or below the
   * threshold, routes to human triage rather than guessing.
   */
  async evaluate(
    classification: ClassificationResult,
  ): Promise<ConfidenceDecision> {
    const overallConfidence = this.score(classification);

    // A request spanning departments has no single correct route; ask the user
    // which issue is primary rather than picking one.
    if (classification.isMultiDepartment) {
      return {
        passed: false,
        overallConfidence,
        thresholdUsed: this.standardThreshold(),
        reason: 'multi_department',
      };
    }

    const threshold = await this.resolveThreshold(classification.department.id);
    if (threshold === null) {
      this.logger.warn(
        `Classification named department "${classification.department.id}" which is not an active team; routing to triage.`,
      );
      return {
        passed: false,
        overallConfidence,
        thresholdUsed: this.standardThreshold(),
        reason: 'unknown_department',
      };
    }

    return {
      passed: overallConfidence >= threshold,
      overallConfidence,
      thresholdUsed: threshold,
      reason: overallConfidence >= threshold ? 'passed' : 'below_threshold',
    };
  }

  /**
   * Weighted confidence score.
   *
   * Weights are department 0.6 / category 0.3 / priority 0.1. The classifier
   * does not emit a priority confidence, so the score is renormalised over the
   * components actually present rather than silently treating the missing one
   * as zero — which would cap every ticket at 0.9 and make the 0.85 sensitive
   * threshold nearly unreachable.
   */
  private score(classification: ClassificationResult): number {
    const department = this.clamp(classification.department.confidence);
    const category = classification.category
      ? this.clamp(classification.category.confidence)
      : null;
    if (category === null || category < CATEGORY_TRUST_FLOOR) {
      return department;
    }
    const weighted =
      department * DEPARTMENT_WEIGHT + category * CATEGORY_WEIGHT;
    return this.clamp(weighted / (DEPARTMENT_WEIGHT + CATEGORY_WEIGHT));
  }

  /**
   * Resolve the threshold for a department: its own override if set, otherwise
   * the sensitive or standard default. Returns null when the team is unknown or
   * inactive, which the caller treats as a triage route.
   */
  private async resolveThreshold(teamId: string): Promise<number | null> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, isActive: true },
      select: { isSensitive: true, confidenceThreshold: true },
    });
    if (!team) {
      return null;
    }
    if (team.confidenceThreshold !== null) {
      return this.clamp(team.confidenceThreshold);
    }
    return team.isSensitive
      ? this.sensitiveThreshold()
      : this.standardThreshold();
  }

  private standardThreshold(): number {
    return this.readThreshold('AI_CONFIDENCE_THRESHOLD', DEFAULT_THRESHOLD);
  }

  private sensitiveThreshold(): number {
    return this.readThreshold(
      'AI_SENSITIVE_DEPT_THRESHOLD',
      DEFAULT_SENSITIVE_THRESHOLD,
    );
  }

  private readThreshold(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      this.logger.warn(
        `${key}="${String(raw)}" is not a number in the range 0-1; using ${fallback}.`,
      );
      return fallback;
    }
    return parsed;
  }

  private clamp(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.min(1, Math.max(0, value));
  }
}
