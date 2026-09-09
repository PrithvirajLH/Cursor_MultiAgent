import type { TicketMessage } from "../../api/client";

/**
 * The sentence to show before somebody removes a message (cards 1.11, 1.47).
 *
 * ⚠️ Removing a message does not unsend an email. A public reply has already
 * reached the requester and everyone CC'd — card 1.42's one surviving path —
 * and nothing in this product recalls it. The button must not imply otherwise,
 * so the warning belongs in front of the click rather than in a toast after it.
 *
 * ⚠️ THERE ARE THREE CASES, not two, and card 1.47 is the second one.
 *
 * Production has no Redis, so the outbox sweeper delivers on a 60-second
 * interval: a reply redacted seconds after sending is still sitting in the
 * queue, unsent. That used to show NO caveat at all — `emailed` was 0 — and
 * then the original text went out a moment later. So a queued email gets its
 * own sentence, promising a stop in the FUTURE tense, because at dialog time
 * nothing has been stopped yet. What actually happened is reported afterwards
 * by `redactionOutcomeMessage`, which is the only thing allowed to say "we
 * stopped it" — claiming it here would be a nicer-sounding version of the very
 * defect this card removes.
 *
 * An internal note gets no caveat in any case: card 1.42 emails none, and a
 * warning that does not apply is how the ones that do stop being read.
 *
 * Driven by `delivery`, which reports the OUTBOX rather than the intent — so a
 * reply whose send FAILED is correctly not described as sent.
 * Returns `null` when there is nothing extra to say.
 */
export function redactionEmailCaveat(
  message: Pick<TicketMessage, "delivery">,
): string | null {
  if (message.delivery?.internal) return null;
  const emailed = message.delivery?.emailed ?? 0;
  const pending = message.delivery?.pending ?? 0;
  if (emailed > 0) {
    return `This reply was already emailed to ${emailed} ${
      emailed === 1 ? "person" : "people"
    }. Removing it cleans up the ticket; it does not take the email back.`;
  }
  if (pending > 0) {
    return "This reply is still queued to be emailed. Removing it will stop that email going out — as long as it has not left in the meantime.";
  }
  return null;
}

/**
 * What to tell the agent once the removal has actually happened (card 1.47).
 *
 * The server reports what it managed, not what it hoped: `emailsStopped` counts
 * only the queued rows it claimed while they were still PENDING. If the sweeper
 * got there first, that row is counted as emailed instead, and this says so.
 * The order of these branches is the honesty rule — anything that really went
 * out is the headline, even if something else was caught.
 */
export function redactionOutcomeMessage(result: {
  alreadyEmailed: boolean;
  emailedCount?: number;
  emailsStopped?: number;
}): string {
  const stopped = result.emailsStopped ?? 0;
  const emailed = result.emailedCount ?? 0;
  if (result.alreadyEmailed) {
    const who =
      emailed > 0
        ? ` The email to ${emailed} ${
            emailed === 1 ? "person" : "people"
          } cannot be recalled.`
        : " The email had already gone and cannot be recalled.";
    return `Removed from the ticket.${who}`;
  }
  if (stopped > 0) {
    return "Removed. This had not been emailed yet, and we have stopped it.";
  }
  return "Message removed.";
}
