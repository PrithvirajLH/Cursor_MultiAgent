/** The background jobs an owner can inspect and trigger (card 1.21). */
export const JOB_KEYS = [
  'sla-breach',
  'retention',
  'automation-scheduler',
  'email-outbox',
  'lead-digest',
  'inbound-mailbox',
  'availability-return',
] as const;

export type JobKey = (typeof JOB_KEYS)[number];
