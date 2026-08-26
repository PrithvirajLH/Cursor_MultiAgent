/** Retention windows in days; `null` = class disabled (owner has not decided yet). */
export type RetentionPolicy = {
  enabled: boolean;
  dryRun: boolean;
  intervalMs: number;
  batchSize: number;
  softDeletedDays: number;
  closedTicketDays: number | null;
  adminAuditDays: number | null;
  outboxSentDays: number;
};
