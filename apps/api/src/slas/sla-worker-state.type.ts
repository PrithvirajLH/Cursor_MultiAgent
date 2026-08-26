/** Snapshot of the SLA breach worker for the readiness probe. */
export type SlaWorkerState = {
  enabled: boolean;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
};
