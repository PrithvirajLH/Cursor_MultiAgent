/**
 * Why an action ran: a rule fired, or a person clicked a macro (card 1.7 §3).
 *
 * Before this card the action executor took a bare `ruleId` plus the rule
 * author's id, which left a macro no honest way to call it. Passing a
 * fabricated ruleId would have made a human's click look like a rule firing -
 * and `AutomationExecution` rows drive automation reporting, so that would have
 * quietly corrupted it.
 *
 * `actorId` is the person or rule-author the resulting events and internal notes
 * are attributed to. It is on both variants because every action needs somebody
 * to blame; `kind` is what the audit trail and the reporting read.
 */
export type ActionProvenance =
  | { readonly kind: 'rule'; readonly ruleId: string; readonly actorId: string }
  | {
      readonly kind: 'macro';
      readonly cannedResponseId: string;
      readonly actorId: string;
    };
