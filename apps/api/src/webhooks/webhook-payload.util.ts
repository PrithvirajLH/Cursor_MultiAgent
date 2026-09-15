/**
 * What goes out in a webhook (card 2.6).
 *
 * ⚠️ IDS AND METADATA ONLY. NEVER A MESSAGE BODY, A DESCRIPTION, A SUBJECT OR A
 * CUSTOM-FIELD VALUE.
 *
 * This is a healthcare desk. A ticket body can contain PHI, and a webhook posts
 * it to a third-party system nobody here controls, at a URL an admin typed. A
 * consumer that genuinely needs the content can call back with its own API key
 * and be access-checked on the way in — which is the entire reason keys shipped
 * in the same card.
 *
 * ⚠️ THE SUBJECT IS EXCLUDED TOO, and that is not an oversight. "Re: HIV test
 * results" is a subject line, and this desk serves departments where the
 * subject alone is the sensitive part.
 *
 * ⚠️ `version` IS PRESENT FROM THE FIRST DELIVERY. Retrofitting a version onto
 * a shipped webhook means breaking every consumer at once; carrying a constant
 * `1` costs nothing and buys the ability to change shape later.
 */

/** The events a subscription can ask for. */
export const WEBHOOK_EVENTS = [
  'ticket.created',
  'ticket.status_changed',
  'message.added',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** The envelope every delivery shares. */
export interface WebhookEnvelope {
  version: 1;
  event: WebhookEvent;
  /** When the thing happened, not when delivery was attempted. */
  occurredAt: string;
  data: Record<string, string | number | null>;
}

/**
 * Build the envelope for one event.
 *
 * ⚠️ THE FIELD LIST IS EXHAUSTIVE AND DELIBERATELY NARROW. A test asserts that
 * the serialised output contains no body, description, subject or custom-field
 * value, so widening this without thinking fails the suite rather than quietly
 * shipping PHI to a third party.
 */
export function buildWebhookEnvelope(input: {
  event: WebhookEvent;
  occurredAt: Date;
  ticketId: string;
  ticketNumber: number;
  displayId: string | null;
  status: string;
  priority: string;
  teamId: string | null;
  actorId: string | null;
  /** Only for `ticket.status_changed`. */
  previousStatus?: string | null;
  /** Only for `message.added`: which message, never what it said. */
  messageId?: string | null;
  /** Whether that message was internal, which a consumer may need to filter. */
  messageVisibility?: string | null;
}): WebhookEnvelope {
  const data: Record<string, string | number | null> = {
    ticketId: input.ticketId,
    ticketNumber: input.ticketNumber,
    displayId: input.displayId,
    status: input.status,
    priority: input.priority,
    teamId: input.teamId,
    actorId: input.actorId,
  };
  if (input.event === 'ticket.status_changed') {
    data.previousStatus = input.previousStatus ?? null;
  }
  if (input.event === 'message.added') {
    data.messageId = input.messageId ?? null;
    data.messageVisibility = input.messageVisibility ?? null;
  }
  return {
    version: 1,
    event: input.event,
    occurredAt: input.occurredAt.toISOString(),
    data,
  };
}
