/**
 * Decide whether a sidebar count may keep showing its last good value (card 1.54).
 *
 * ⚠️ THE CONTRADICTION THIS REMOVES. `useViewCounts` holds
 * `placeholderData: (prev) => prev` so a badge does not flicker to blank during
 * an ordinary refetch. That is right for a refetch and wrong for a sign-out: on
 * 2026-09-09 all ten count queries 401'd in the same 70 ms burst as the ticket
 * list, and every badge went on displaying a confident number beside a failed
 * list. The owner reasonably read that as one broken query rather than an
 * expired session — which is why the report said only the list was affected.
 *
 * Extracted as a function because this project's vitest runs in a **node**
 * environment with no jsdom, so a decision left inline in the hook cannot be
 * asserted at all.
 *
 * @param previous The last successful result, if there is one.
 * @param isExpired Whether the API is currently refusing the session.
 * @returns The value to show while the query is in flight.
 */
export function viewCountPlaceholder<T>(
  previous: T | undefined,
  isExpired: boolean,
): T | undefined {
  return isExpired ? undefined : previous;
}
