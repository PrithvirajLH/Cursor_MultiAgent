import type { TicketFilters } from "../types";

/**
 * One filter field, described once.
 *
 * `kind` decides how the three derivations below treat it:
 * - `list` — an array; absent means `[]`, and an empty one is not persisted.
 * - `text` — a string; absent means `""`, and an empty one is not persisted.
 * - `value` — a scalar with a meaningful default; absent means `whenAbsent`,
 *   and a value equal to `omitWhen` is not persisted.
 */
type TicketFilterField =
  | { key: ListKey; kind: "list" }
  | { key: TextKey; kind: "text"; trim?: true }
  | { key: ValueKey; kind: "value"; whenAbsent?: string; omitWhen?: string };

type ListKey =
  | "statuses"
  | "priorities"
  | "teamIds"
  | "assigneeIds"
  | "requesterIds"
  | "slaStatus"
  | "tags";

type TextKey =
  | "createdFrom"
  | "createdTo"
  | "updatedFrom"
  | "updatedTo"
  | "resolvedFrom"
  | "resolvedTo"
  | "dueFrom"
  | "dueTo"
  | "q";

type ValueKey = "statusGroup" | "scope" | "sort" | "order";

/**
 * ⚠️ THE ONE LIST. Adding a ticket filter means adding it HERE, and the test
 * beside this file fails if the URL layer learns a field this does not know.
 */
const FIELDS: readonly TicketFilterField[] = [
  // ⚠️ `statusGroup` has NO `whenAbsent`, unlike the three below it. Applying a
  // view that does not carry one leaves it undefined rather than forcing "all",
  // which is what `applyView` has always done - and there are real saved views
  // in production relying on it.
  { key: "statusGroup", kind: "value", omitWhen: "all" },
  { key: "statuses", kind: "list" },
  { key: "priorities", kind: "list" },
  { key: "teamIds", kind: "list" },
  { key: "assigneeIds", kind: "list" },
  { key: "requesterIds", kind: "list" },
  { key: "slaStatus", kind: "list" },
  // ⚠️ CARD 1.127. THE FIELD THE OWNER LOST. A tag filter worked on screen and
  // in the URL and was silently discarded the moment you pressed Save view.
  { key: "tags", kind: "list" },
  { key: "createdFrom", kind: "text" },
  { key: "createdTo", kind: "text" },
  { key: "updatedFrom", kind: "text" },
  { key: "updatedTo", kind: "text" },
  // ⚠️ CARD 1.127, AND NOBODY HAD REPORTED THESE - which is the point. A
  // "resolved this week" view lost its date range exactly as silently.
  { key: "resolvedFrom", kind: "text" },
  { key: "resolvedTo", kind: "text" },
  { key: "dueFrom", kind: "text" },
  { key: "dueTo", kind: "text" },
  { key: "q", kind: "text", trim: true },
  { key: "scope", kind: "value", whenAbsent: "all", omitWhen: "all" },
  { key: "sort", kind: "value", whenAbsent: "updatedAt", omitWhen: "updatedAt" },
  { key: "order", kind: "value", whenAbsent: "desc", omitWhen: "desc" },
] as const;

function readList(raw: Record<string, unknown>, key: string): string[] {
  const value = raw[key];
  return Array.isArray(value) ? (value as string[]) : [];
}

function readText(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  return typeof value === "string" ? value : "";
}

/**
 * Saved-view filters, derived from one field list rather than four
 * (card 1.127).
 *
 * ⚠️ WHY THIS EXISTS. The same field list was hand-written in SIX places: the
 * URL reader and writer and the API query builder in `useFilters.ts`, which all
 * knew about `tags`, `resolvedFrom` and `resolvedTo` - and `filtersForPersistence`,
 * `applyView` and `filtersToPayload`, which all did not. So the tag filter
 * worked on screen, worked in the URL, and vanished on save. **The save
 * SUCCEEDED. Nothing errored, nothing warned, the filter was simply gone.**
 *
 * ⚠️ THE OWNER'S OWN GUESS WAS THAT THE TAG CONTROL IS MISSING FROM THE
 * ADVANCED PANEL. That is true - `FilterPanel.tsx` has no tag control, and
 * `TagFilterInput` lives on the toolbar - but it is NOT the cause, and moving
 * the control would not have fixed anything.
 *
 * ⚠️ THE THREE DERIVATIONS ARE NOT SYMMETRIC, DELIBERATELY. `toPersisted`
 * strips empty and default values so a stored view is portable; `toApplied`
 * supplies defaults for anything absent; `toPayload` sends the shape the API
 * expects. One list of fields, three jobs - not one function pretending to do
 * all three.
 *
 * ⚠️ This is card 1.99's bug in a place card 1.99 did not reach: *"a ticket
 * filter must be spelled in three places or it silently vanishes"*. It was six.
 */
export const TICKET_VIEW_FILTERS = Object.freeze({
  /** Every field a saved view carries, for tests that must not hand-write it. */
  fields: FIELDS,

  /**
   * What gets STORED: empty and default values stripped, so a view is portable.
   *
   * @param filters The live filter state.
   * @returns The object to persist as the view's filters.
   */
  toPersisted(filters: TicketFilters): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of FIELDS) {
      if (field.kind === "list") {
        const value = filters[field.key];
        if (value?.length) out[field.key] = value;
        continue;
      }
      if (field.kind === "text") {
        const raw = filters[field.key];
        const value = field.trim ? raw?.trim() : raw;
        if (value) out[field.key] = value;
        continue;
      }
      const value = filters[field.key];
      if (value && value !== field.omitWhen) out[field.key] = value;
    }
    return out;
  },

  /**
   * What gets APPLIED: a stored view back to filter state, with defaults for
   * anything it does not carry.
   *
   * @param raw The view's stored filters, from the API and therefore untrusted.
   * @returns A partial filter state to merge into the page.
   */
  toApplied(raw: Record<string, unknown>): Partial<TicketFilters> {
    const out: Record<string, unknown> = {};
    for (const field of FIELDS) {
      if (field.kind === "list") {
        out[field.key] = readList(raw, field.key);
        continue;
      }
      if (field.kind === "text") {
        out[field.key] = readText(raw, field.key);
        continue;
      }
      const value = raw[field.key];
      out[field.key] =
        typeof value === "string" && value !== "" ? value : field.whenAbsent;
    }
    return out as Partial<TicketFilters>;
  },

  /**
   * What gets SENT when the dropdown saves a view.
   *
   * Differs from `toPersisted` in that it sends every field, with an empty
   * string collapsed to `undefined` - which is the shape this endpoint has
   * always received.
   *
   * @param filters The live filter state.
   * @returns The request payload.
   */
  toPayload(filters: TicketFilters): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of FIELDS) {
      if (field.kind === "list") {
        out[field.key] = filters[field.key];
        continue;
      }
      if (field.kind === "text") {
        out[field.key] = filters[field.key] || undefined;
        continue;
      }
      out[field.key] = filters[field.key];
    }
    return out;
  },
});
