import type { TicketMessage } from "../../api/client";

/**
 * The sentence to show before somebody removes a message (card 1.11).
 *
 * ⚠️ Removing a message does not unsend an email. A public reply has already
 * reached the requester and everyone CC'd — card 1.42's one surviving path —
 * and nothing in this product recalls it. The button must not imply otherwise,
 * so the warning belongs in front of the click rather than in a toast after it.
 *
 * An internal note was emailed to nobody, so it gets no such line: a caveat
 * that does not apply is noise, and noise is how the ones that do apply stop
 * being read.
 *
 * Driven by `delivery.emailed`, which reports the OUTBOX rather than the
 * intent — so a reply whose send FAILED is correctly not described as sent.
 * Returns `null` when there is nothing extra to say.
 */
export function redactionEmailCaveat(
  message: Pick<TicketMessage, "delivery">,
): string | null {
  const emailed = message.delivery?.emailed ?? 0;
  if (message.delivery?.internal) return null;
  if (emailed <= 0) return null;
  return `This reply was already emailed to ${emailed} ${
    emailed === 1 ? "person" : "people"
  }. Removing it cleans up the ticket; it does not take the email back.`;
}
