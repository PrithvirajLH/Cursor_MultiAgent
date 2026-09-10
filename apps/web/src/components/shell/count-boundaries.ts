/**
 * The day boundaries three sidebar badges are defined against.
 *
 * ⚠️ THESE ARE LOCAL-CLOCK DATES AND THAT IS LOAD-BEARING. They were private
 * to `saved-views.ts`, where they built the query strings the badges navigate
 * to; card 1.69 step 4 moved the counting to `GET /tickets/counts`, which now
 * has to be given the same boundaries or three badge numbers would shift. The
 * server cannot derive them: for a user at UTC-5 working in the evening, the
 * local date and the UTC date are different days.
 *
 * Exported from here rather than duplicated so `saved-views.ts` (which still
 * builds the links) and the counts query use one definition. Two copies of a
 * date boundary is precisely how the badge and the list it opens drift apart.
 */
export const todayIso = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
};

/** N days before now, as a local-clock `YYYY-MM-DD`. */
export const isoDaysAgo = (days: number): string => {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
};

/** What `GET /tickets/counts` needs to answer the three date-bound badges. */
export type CountBoundaries = {
  todayFrom: string;
  awaitingUpdatedTo: string;
  resolvedUpdatedFrom: string;
};

/**
 * The boundaries for the current moment.
 *
 * Recomputed per render rather than memoised: it is three `Date` reads, and a
 * cached value would leave a tab open past midnight showing yesterday's
 * "today". React Query keys on the result, so a changed date is a new key and
 * refetches on its own.
 */
export function countBoundaries(): CountBoundaries {
  return {
    todayFrom: todayIso(),
    awaitingUpdatedTo: isoDaysAgo(1),
    resolvedUpdatedFrom: isoDaysAgo(7),
  };
}
