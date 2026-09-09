/**
 * The one parser for a comma-separated list of TAG NAMES (card 1.50).
 *
 * ⚠️ THERE USED TO BE TWO FOR TAGS, AND ONLY ONE WAS RIGHT.
 *
 * `useFilters.parseArray` read `?tags=network,printer` from the URL correctly
 * and still does the same job for statuses, priorities and ids. `TicketsPage`
 * had a SECOND copy inline in an `onChange`, and that one ate every comma you
 * typed, so the tickets list could not filter on more than one tag at all:
 *
 *     key ","  ->  box shows "network"      <- comma gone
 *     key "p"  ->  box shows "networkp"     <- the two tags fuse
 *     result:      ["networkprinter"]       <- matches nothing, no error
 *
 * Two pieces of code parsing the same list is the cause, not the symptom, so
 * the broken copy is deleted rather than repaired — the same lesson cards 1.36,
 * 1.38 and 1.47 each reached from a different direction.
 *
 * ⚠️ Kept separate from `parseArray` on purpose. This lowercases, because tag
 * names are normalised that way server-side (`TagsService.normalize`) and `VPN`
 * and `vpn` must not become two filters. `parseArray` must NOT lowercase — it
 * also parses status and priority enums, where `NEW` is not `new`.
 */
export function parseTagList(value: string | null | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const trimmed = part.trim().toLowerCase();
    if (trimmed !== "") {
      seen.add(trimmed);
    }
  }
  return [...seen];
}
