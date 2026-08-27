import type { AutomationTrigger } from './rule-engine.service';

/** Triggers fired by the scheduler on a clock rather than by a ticket event (card 1.3). */
export const TIME_TRIGGERS: AutomationTrigger[] = [
  'TIME_IN_STATUS',
  'UNASSIGNED_FOR',
];
