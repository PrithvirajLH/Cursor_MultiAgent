/**
 * The confirmation shown after a message is posted, keyed off what the server
 * actually stored rather than what the composer asked for.
 *
 * The API silently rewrites an AGENT's PUBLIC message to INTERNAL on any
 * ticket they are not the assignee of. Card 1.38 stops the composer offering
 * `Public` in the case we can predict, but it cannot catch all of them: an
 * agent can open an assigned ticket, start a public reply, and have it
 * reassigned before they press send. Then the only honest signal left is this
 * one, so a downgrade has to say so rather than quietly reading "Reply sent".
 */
export function messageSentToast(
  requestedType: "PUBLIC" | "INTERNAL",
  storedType: "PUBLIC" | "INTERNAL",
): string {
  if (storedType === "INTERNAL" && requestedType !== "INTERNAL") {
    return "Saved as an internal note — the requester was not emailed.";
  }
  return storedType === "INTERNAL" ? "Internal note added" : "Reply sent";
}
