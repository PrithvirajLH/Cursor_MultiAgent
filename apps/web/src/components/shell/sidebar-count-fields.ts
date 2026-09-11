/**
 * The counts-response keys a sidebar badge may read.
 *
 * Spelled out rather than `string` so a typo is a compile error and so
 * `counts[field]` type-checks against the response shape - the map is indexed
 * by a preset id that TypeScript cannot narrow, and without this the lookup
 * would need a cast.
 */
export type SidebarCountField =
  | 'sev1Today'
  | 'awaitingReplyOver24h'
  | 'atRisk'
  | 'unassigned'
  | 'resolvedThisWeek'
  | 'reopened'
  | 'watching'
  | 'mentions'
  | 'followUpsDueToday';

/**
 * Which field of `GET /tickets/counts` fills each fixed sidebar badge.
 *
 * ⚠️ CARD 1.69 STEP 4. These nine rows used to be nine uncached
 * `GET /tickets?pageSize=1` requests through `useViewCounts`, on every sidebar
 * render, while `/tickets/counts` already answered ten other questions in one
 * cached call. Two count systems — the thing cards 1.16, 1.53 and 1.65 each
 * ran into separately, and that 1.65 hit directly as a nav badge stuck on a
 * stale number because it came from the other source.
 *
 * Every mapping here is asserted against the list its row navigates to, for
 * three roles, in the API's `tickets.counts-consolidation.spec.ts`. A badge
 * that does not equal the list behind it is worse than the request storm it
 * replaced: the storm was only slow.
 *
 * ⚠️ CARD 1.70 RESOLVED THE TWO THAT USED TO LOOK WRONG HERE.
 *
 * Card 1.69 step 4 had to point these at duplicate fields — `unassignedAnyStatus`
 * and `breachRisk` — because each definition disagreed with the other and
 * choosing either moved a number somebody was already reading. That was the
 * right call at the time and the wrong place to leave it: two names for one
 * idea is the drift behind cards 1.36, 1.38, 1.47 and 1.50.
 *
 * The owner has now decided both, so the duplicates are gone:
 *
 * - **Unassigned means unassigned AND open.** An unassigned *resolved* ticket
 *   needs nobody; the badge exists to surface work no one has picked up. The
 *   sidebar adopts the count's definition, which DashboardPage has shown for
 *   months.
 * - **Breach risk uses `SLA_AT_RISK_THRESHOLD_MINUTES`** and respects
 *   `completedAt`, in the list and the count alike — and the label is rendered
 *   from that same value rather than hard-coded beside it.
 *
 * Keyed by preset id so a hidden preset (card 1.53) cannot shift a badge onto
 * the wrong row, which the previous index-matched array could.
 */
export const PRESET_COUNT_FIELD: Record<
  string,
  SidebarCountField | undefined
> = {
  'p1-today': 'sev1Today',
  'awaiting-24h': 'awaitingReplyOver24h',
  'sla-at-risk': 'atRisk',
  unassigned: 'unassigned',
  'recent-resolved': 'resolvedThisWeek',
  reopened: 'reopened',
  watching: 'watching',
  mentions: 'mentions',
  followups: 'followUpsDueToday',
};
