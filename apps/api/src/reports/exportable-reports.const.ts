/**
 * Reports that flatten honestly to a single table and can therefore be exported
 * as CSV (card 1.13). `summary`, `ai-accuracy` and `tag-analytics` are excluded
 * on purpose: their shapes are nested and would need a spreadsheet per section.
 */
export const EXPORTABLE_REPORTS = [
  'team-summary',
  'agent-performance',
  'agent-workload',
  'sla-breaches',
  'tickets-by-status',
  'tickets-by-priority',
  'tickets-by-category',
  'tickets-by-age',
  'channel-breakdown',
  'reopen-rate',
  'transfers',
  'resolution-time',
  'sla-compliance',
  'sla-compliance-by-priority',
  'sla-compliance-by-team',
  'csat-trend',
  'csat-drivers',
  'csat-low-tags',
  'ticket-volume',
] as const;

export type ReportKey = (typeof EXPORTABLE_REPORTS)[number];
