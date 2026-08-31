import type { JobKey } from './job-key.const';

/**
 * A system-wide switch, reported as state only — never a setting's value. These
 * live in Azure app settings and are read-only here (card 1.21 §4.1).
 */
export type OperationsSwitch = {
  key: string;
  label: string;
  description: string;
  on: boolean;
  /** Short state word for the chip: "On", "Dry run", "Not configured"… */
  state: string;
  /** The setting that turns it on, named so an owner knows what to change. */
  setting: string | null;
};

/** Where tickets arrive from, and whether that path is configured. */
export type OperationsDataIn = {
  key: string;
  label: string;
  path: string;
  configured: boolean;
  state: string;
};

/** One row of the scheduled-jobs table. */
export type OperationsJobRow = {
  key: JobKey;
  label: string;
  description: string;
  enabled: boolean;
  intervalMs: number | null;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  /** Whatever the worker reported last; shape differs per job. */
  lastSummary: Record<string, unknown> | null;
  /** lastRunAt + intervalMs. Approximate: the timer is not schedule-anchored. */
  nextRunAt: string | null;
};

/**
 * Everything the Operations page needs, in one call. Any part that cannot be
 * built is `null` rather than an error — a failed garnish must never break the
 * console.
 */
export type OperationsSnapshot = {
  generatedAt: string;
  switches: OperationsSwitch[] | null;
  dataIn: OperationsDataIn[] | null;
  jobs: OperationsJobRow[];
};
