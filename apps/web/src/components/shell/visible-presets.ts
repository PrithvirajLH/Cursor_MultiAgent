/**
 * The built-in sidebar rows a team should actually see (cards 1.53, 1.61).
 *
 * Payroll has no use for *SEV1 today* or *Awaiting reply > 24h*; their admin
 * switches those off and the whole team stops seeing them. The ids come from
 * `Team.hiddenPresetIds`.
 *
 * ⚠️ AN UNKNOWN ID IS IGNORED, SILENTLY. These ids are CODE CONSTANTS defined
 * in `saved-views.ts` and `system-views.ts`, not database rows, so a stored id
 * whose row has since been renamed or deleted refers to nothing. That rule
 * covers the system views as of card 1.61, on the same terms. It must not become a ghost entry
 * in the sidebar and must not throw - it simply matches no preset and falls out
 * of the filter. Nothing needs cleaning up when a preset is retired.
 *
 * ⚠️ Team-admin-only by design: there is deliberately no personal override, so
 * a member of Payroll cannot opt back in. Two mechanisms answering "is this row
 * visible" is the drift behind cards 1.36, 1.38, 1.47 and 1.50.
 *
 * ⚠️ THE PERFORMANCE ARGUMENT THAT WAS HERE IS NO LONGER TRUE, and it is
 * removed rather than left to mislead. It said every badge was its own
 * `GET /tickets` count query, so hiding six of ten presets saved six requests.
 * Card 1.69 step 4 moved all of those badges onto a single cached
 * `GET /tickets/counts`, so hiding a row now saves no requests at all. Hiding
 * is worth having for tidiness, which was always the owner's reason for asking.
 *
 * ⚠️ CARD 1.61 MADE THIS GENERIC over anything carrying an `id`, because the
 * sidebar has TWO built-in lists - `SAVED_VIEWS` and `SYSTEM_VIEWS` - and 1.53
 * only filtered the first. They are separate lists with different shapes but
 * one hidden-id namespace, so one filter serves both.
 *
 * @param rows The full built-in list, in display order.
 * @param hiddenIds Ids this team has switched off; unknown ones are ignored.
 * @returns The rows to render, in their original order.
 */
export function visiblePresets<T extends { readonly id: string }>(
  rows: readonly T[],
  hiddenIds: readonly string[] | undefined,
): T[] {
  if (!hiddenIds || hiddenIds.length === 0) {
    return [...rows];
  }
  const hidden = new Set(hiddenIds);
  return rows.filter((row) => !hidden.has(row.id));
}
