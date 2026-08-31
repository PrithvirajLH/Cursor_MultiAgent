import type { SlaWorkerRunSummary } from './sla-worker-run-summary.type';

/** Snapshot of the SLA breach worker for the readiness probe and the operations console. */
export type SlaWorkerState = {
  enabled: boolean;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  /** In memory only — a restart clears it (card 1.21). */
  lastSummary: SlaWorkerRunSummary | null;
};
