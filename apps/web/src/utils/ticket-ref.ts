/**
 * Which form of a ticket reference is in hand, and which one to share (card 2.12).
 *
 * `/tickets/7fe5d219-…` is unrecognisable pasted into Teams or an email, and
 * every ticket already carries a display id like `IT-0042`. The route now
 * accepts both, so the browser needs to tell them apart — by SHAPE, matching
 * the server's `ticket-ref.util.ts`, because a UUID cannot look like a display
 * id and a lookup that guesses wrong costs a round trip on the hottest read.
 *
 * ⚠️ `displayId` IS NULLABLE in the schema, even though every production row
 * has one. Nothing here may assume it: a link reading `/tickets/undefined` is
 * worse than an ugly one that works.
 */

/** Canonical UUID shape, any version. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/** The reference to put in a link: the display id when there is one. */
export function ticketRefFor(ticket: {
  id: string;
  displayId?: string | null;
}): string {
  const displayId = ticket.displayId?.trim();
  return displayId ? displayId : ticket.id;
}

/**
 * The shareable URL for a ticket.
 *
 * @param origin `window.location.origin`, passed in so this stays testable
 *   without a DOM — every web test in this repo runs in node.
 */
export function ticketUrl(
  origin: string,
  ticket: { id: string; displayId?: string | null },
): string {
  return `${origin.replace(/\/$/, "")}/tickets/${ticketRefFor(ticket)}`;
}
