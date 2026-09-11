/**
 * The one link to a ticket in the web app (card 2.12).
 *
 * ⚠️ THIS EXISTS BECAUSE IT WAS WRITTEN TWICE — `notifications.service.ts` and
 * `sla-breach.service.ts` each carried a private `ticketLink`, identical down to
 * the fallback URL. One rule in two places is the drift behind cards 1.36, 1.38,
 * 1.47, 1.50, 1.61, 1.70, 1.71 and 1.75, one of which the owner found in
 * production. Both now call this.
 *
 * Prefers the display id, because `IT-0042` is what a person recognises in an
 * email or a Teams message and `7fe5d219-…` is not. Falls back to the UUID: the
 * column is nullable, and a link reading `/tickets/undefined` would be worse
 * than an ugly one that works.
 *
 * @param webAppUrl `WEB_APP_URL`, or undefined in local development.
 * @param ticket The ticket, by id and display id.
 * @returns An absolute URL to the ticket.
 */
export function ticketLink(
  webAppUrl: string | undefined,
  ticket: { id: string; displayId?: string | null },
): string {
  const base = (webAppUrl ?? 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/tickets/${ticket.displayId ?? ticket.id}`;
}
