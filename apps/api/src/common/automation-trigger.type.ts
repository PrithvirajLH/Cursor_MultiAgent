/**
 * What can set an automation rule running (card 1.103).
 *
 * ⚠️ THIS LIVES IN `common/` SO IT IS A LEAF. It used to be declared in
 * `automation/rule-engine.service.ts`, which meant anything needing only the
 * NAME of a trigger had to import the whole rule engine — and that is one of
 * the edges that made `common` depend on `automation` and closed a circular
 * import. `rule-engine.service.ts` re-exports it, so existing importers are
 * unaffected.
 */
export type AutomationTrigger =
  | 'TICKET_CREATED'
  | 'STATUS_CHANGED'
  | 'SLA_APPROACHING'
  | 'SLA_BREACHED'
  | 'TIME_IN_STATUS'
  | 'UNASSIGNED_FOR';
