/**
 * Pure scoring for AI routing accuracy.
 *
 * Deliberately free of Prisma and Nest so it can be unit tested against
 * hand-built fixtures, and reused unchanged by the offline benchmark runner.
 * Production scoring and benchmark scoring must never be able to disagree.
 */

/** One routing decision the pipeline made. */
export interface ScoredDecision {
  ticketId: string | null;
  predictedTeamId: string | null;
  confidence: number;
  /** False when the confidence gate sent it to human triage instead. */
  accepted: boolean;
}

/** A human moving a ticket off the team the AI chose. */
export interface ScoredCorrection {
  ticketId: string;
  /** The team the human moved it to — the ground truth. */
  toValue: string | null;
}

export interface DepartmentScore {
  /** Predicted this department and nobody moved it. */
  truePositives: number;
  /** Predicted this department and a human moved it elsewhere. */
  falsePositives: number;
  /** Predicted elsewhere and a human moved it here. */
  falseNegatives: number;
  /** null when there is nothing to divide by — never 0, never NaN. */
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface AccuracyReport {
  /** Inclusive window the figures cover, echoed back for the caller. */
  totalDecisions: number;
  /** Auto-routed by the AI. */
  acceptedDecisions: number;
  /** Sent to human triage by the confidence gate. */
  triagedDecisions: number;
  /** Accepted decisions a human later moved. */
  correctedDecisions: number;
  /** null when there were no accepted decisions to score. */
  accuracy: number | null;
  threshold: number;
  thresholdMet: boolean;
  byDepartment: Record<string, DepartmentScore>;
  /** predicted team id -> actual team id -> count. */
  confusionMatrix: Record<string, Record<string, number>>;
  /** Weakest accepted decisions — where to look first. Ids only, no free text. */
  lowestConfidence: Array<{
    ticketId: string | null;
    predictedTeamId: string | null;
    confidence: number;
  }>;
  /**
   * Stated on every report so the number is never quoted without it: ground
   * truth comes only from tickets a human actually moved, so a misroute nobody
   * noticed counts as correct. Real accuracy is at best this figure.
   */
  caveat: string;
}

const UNROUTED = '__unrouted__';
const CAVEAT =
  'Ground truth is derived from human corrections only. A misroute that nobody moved counts as correct, so this figure is an upper bound on accuracy.';

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * Score a set of routing decisions against the corrections humans made.
 *
 * Only accepted (auto-routed) decisions are scored. A ticket the gate sent to
 * triage was never a prediction the system stood behind, so counting it as a
 * miss would punish the gate for doing its job.
 *
 * @param minAccuracy the phase threshold to compare against (Phase 1 = 0.85).
 * @param lowestConfidenceLimit how many weak decisions to surface.
 */
export function scoreAccuracy(
  decisions: ScoredDecision[],
  corrections: ScoredCorrection[],
  minAccuracy: number,
  lowestConfidenceLimit = 10,
): AccuracyReport {
  const correctionByTicket = new Map<string, string | null>();
  for (const correction of corrections) {
    // Last correction wins: it is the most recent human judgement.
    correctionByTicket.set(correction.ticketId, correction.toValue);
  }

  const accepted = decisions.filter((decision) => decision.accepted);
  const triaged = decisions.length - accepted.length;

  const confusionMatrix: Record<string, Record<string, number>> = {};
  const tp = new Map<string, number>();
  const fp = new Map<string, number>();
  const fn = new Map<string, number>();
  const bump = (counter: Map<string, number>, key: string) =>
    counter.set(key, (counter.get(key) ?? 0) + 1);

  let corrected = 0;

  for (const decision of accepted) {
    const predicted = decision.predictedTeamId ?? UNROUTED;
    const correctedTo = decision.ticketId
      ? correctionByTicket.get(decision.ticketId)
      : undefined;
    const wasCorrected = correctedTo !== undefined;
    const actual = wasCorrected ? (correctedTo ?? UNROUTED) : predicted;

    confusionMatrix[predicted] ??= {};
    confusionMatrix[predicted][actual] =
      (confusionMatrix[predicted][actual] ?? 0) + 1;

    if (wasCorrected && actual !== predicted) {
      corrected += 1;
      bump(fp, predicted);
      bump(fn, actual);
    } else {
      bump(tp, predicted);
    }
  }

  const departments = new Set<string>([
    ...tp.keys(),
    ...fp.keys(),
    ...fn.keys(),
  ]);
  const byDepartment: Record<string, DepartmentScore> = {};
  for (const department of departments) {
    const truePositives = tp.get(department) ?? 0;
    const falsePositives = fp.get(department) ?? 0;
    const falseNegatives = fn.get(department) ?? 0;
    const precision = ratio(truePositives, truePositives + falsePositives);
    const recall = ratio(truePositives, truePositives + falseNegatives);
    const f1 =
      precision === null || recall === null || precision + recall === 0
        ? null
        : (2 * precision * recall) / (precision + recall);
    byDepartment[department] = {
      truePositives,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      f1,
    };
  }

  const accuracy = ratio(accepted.length - corrected, accepted.length);
  const lowestConfidence = [...accepted]
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, lowestConfidenceLimit)
    .map((decision) => ({
      ticketId: decision.ticketId,
      predictedTeamId: decision.predictedTeamId,
      confidence: decision.confidence,
    }));

  return {
    totalDecisions: decisions.length,
    acceptedDecisions: accepted.length,
    triagedDecisions: triaged,
    correctedDecisions: corrected,
    accuracy,
    threshold: minAccuracy,
    thresholdMet: accuracy !== null && accuracy >= minAccuracy,
    byDepartment,
    confusionMatrix,
    lowestConfidence,
    caveat: CAVEAT,
  };
}
