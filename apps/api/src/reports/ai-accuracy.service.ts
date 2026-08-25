import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  scoreAccuracy,
  type AccuracyReport,
  type ScoredCorrection,
  type ScoredDecision,
} from './ai-accuracy.scoring';

const DEFAULT_MIN_ACCURACY = 0.85;
const DEPARTMENT_FIELD = 'department';

/**
 * Loads routing decisions and human corrections, and scores them.
 *
 * Deliberately knows nothing about roles: authorization and team scoping stay
 * with `ReportsService`, which already owns that logic and is covered by its own
 * fail-closed tests. This service is handed an already-scoped team id.
 */
@Injectable()
export class AiAccuracyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Build an accuracy report for a window.
   *
   * @param teamId when set, only decisions predicting that team are scored —
   *   this is what a LEAD sees. Null means platform-wide (OWNER).
   */
  async getReport(
    from: Date,
    toExclusive: Date,
    teamId: string | null,
  ): Promise<AccuracyReport> {
    const decisionRows = await this.prisma.routingDecisionLog.findMany({
      where: {
        createdAt: { gte: from, lt: toExclusive },
        ...(teamId ? { predictedTeamId: teamId } : {}),
      },
      select: {
        ticketId: true,
        predictedTeamId: true,
        confidence: true,
        accepted: true,
      },
    });

    const ticketIds = decisionRows
      .map((row) => row.ticketId)
      .filter((id): id is string => id !== null);

    // Corrections are looked up by ticket, not by date: a ticket routed on the
    // last day of the window may be corrected the next morning, and that
    // correction is still the ground truth for this window's decision.
    const correctionRows = ticketIds.length
      ? await this.prisma.correctionLog.findMany({
          where: { ticketId: { in: ticketIds }, field: DEPARTMENT_FIELD },
          orderBy: { createdAt: 'asc' },
          select: { ticketId: true, toValue: true },
        })
      : [];

    const decisions: ScoredDecision[] = decisionRows.map((row) => ({
      ticketId: row.ticketId,
      predictedTeamId: row.predictedTeamId,
      confidence: row.confidence,
      accepted: row.accepted,
    }));
    const corrections: ScoredCorrection[] = correctionRows.map((row) => ({
      ticketId: row.ticketId,
      toValue: row.toValue,
    }));

    return scoreAccuracy(decisions, corrections, this.minAccuracy());
  }

  /** Phase threshold, configurable. Phase 1 = 0.85, rising to 0.97 by Phase 4. */
  private minAccuracy(): number {
    const raw = this.config.get<string>('AI_ACCURACY_MIN');
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return DEFAULT_MIN_ACCURACY;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      return DEFAULT_MIN_ACCURACY;
    }
    return parsed;
  }
}
