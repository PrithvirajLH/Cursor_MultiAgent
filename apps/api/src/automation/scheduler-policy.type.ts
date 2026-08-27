/** Timer settings for time-based automation rules. */
export type SchedulerPolicy = {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
};
