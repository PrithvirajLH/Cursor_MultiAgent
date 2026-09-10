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
  | 'breachRisk'
  | 'unassignedAnyStatus'
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
 * ⚠️ TWO OF THESE LOOK WRONG AND ARE NOT.
 *
 * - `unassigned` → `unassignedAnyStatus`, not `unassigned`. The preset links
 *   to `scope=unassigned`, which the list reads as `assigneeId IS NULL` and
 *   nothing else; the older `unassigned` count also requires the ticket to be
 *   open. They differ by the unassigned resolved/closed tickets.
 * - `sla-at-risk` → `breachRisk`, not `atRisk`. The list's `slaStatus=at_risk`
 *   uses a hard-coded FOUR-hour window and requires `completedAt IS NULL`;
 *   `atRisk` uses `SLA_AT_RISK_THRESHOLD_MINUTES` (default two hours) and
 *   ignores `completedAt`.
 *
 * In both cases DashboardPage has been showing the narrower number for
 * months, so neither could be widened and neither badge could be pointed at
 * it. Do not "simplify" these two — there is a test that fails if you do.
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
  'sla-at-risk': 'breachRisk',
  unassigned: 'unassignedAnyStatus',
  'recent-resolved': 'resolvedThisWeek',
  reopened: 'reopened',
  watching: 'watching',
  mentions: 'mentions',
  followups: 'followUpsDueToday',
};
