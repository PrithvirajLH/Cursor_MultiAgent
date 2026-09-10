/**
 * The three day boundaries three of the sidebar counts depend on (card 1.69).
 *
 * ⚠️ THESE COME FROM THE BROWSER, and they have to. `saved-views.ts` derives
 * them with `todayIso()` and `isoDaysAgo(n)` from the user's LOCAL clock, and
 * they have been the boundaries behind those three badges for as long as the
 * badges have existed. Recomputing them server-side in UTC is not equivalent:
 * for a user at UTC-5 working at 10pm, the local date and the UTC date are
 * different days, so "SEV1 today" would silently start counting a different
 * set. Step 4 was allowed to remove eight requests, not to change a number.
 *
 * ⚠️ AND THIS IS NOT A FILTER PARAMETER. Three dates, each validated as
 * `YYYY-MM-DD`. It cannot name a requester, an assignee or a team, so it
 * cannot be used to count tickets the caller may not read — every count still
 * runs under `accessConditionSql`. That distinction is the one the card draws:
 * a count endpoint taking arbitrary client filters would be an exfiltration
 * oracle, and this is not one.
 *
 * Each is optional. Absent means the corresponding count returns 0 rather than
 * guessing a boundary, which is visible in the UI rather than quietly wrong.
 */
export type TicketCountBoundaries = {
  /** `createdFrom` for "SEV1 today" — local midnight, as `YYYY-MM-DD`. */
  readonly todayFrom?: string;
  /** `updatedTo` for "Awaiting reply > 24h" — one day ago. */
  readonly awaitingUpdatedTo?: string;
  /** `updatedFrom` for "Resolved this week" — seven days ago. */
  readonly resolvedUpdatedFrom?: string;
};

/**
 * Whether two boundary sets would produce the same counts.
 *
 * Used to decide whether a cached entry is still answerable, because the
 * boundaries live in the cached VALUE rather than in the key — one entry per
 * user, so `invalidateCountsCache` (BUG-11) keeps working unchanged. A
 * mismatch is treated as a miss.
 *
 * `undefined` and an object with no fields set are the same request and must
 * compare equal, or a caller that sends no boundaries would never hit the
 * cache at all.
 */
export function sameCountBoundaries(
  a: TicketCountBoundaries | null | undefined,
  b: TicketCountBoundaries | null | undefined,
): boolean {
  return (
    (a?.todayFrom ?? null) === (b?.todayFrom ?? null) &&
    (a?.awaitingUpdatedTo ?? null) === (b?.awaitingUpdatedTo ?? null) &&
    (a?.resolvedUpdatedFrom ?? null) === (b?.resolvedUpdatedFrom ?? null)
  );
}
