/**
 * What one SLA breach-worker tick did (card 1.21). The two counts are the
 * notifications the tick raised — an instance that breaches with no team lead
 * and no on-call address raises none, so these are "breaches notified", not
 * "instances inspected". The worker keeps no other count today.
 */
export type SlaWorkerRunSummary = {
  ranAt: string;
  ok: boolean;
  breachesProcessed: number;
  atRiskProcessed: number;
};
