import { describe, expect, it } from "vitest";
import { parseFilters } from "./useFilters";
import { TICKET_VIEW_FILTERS } from "./ticket-view-filters";
import type { TicketFilters } from "../types";

/**
 * Card 1.127 — the owner saved a view with a tag filter on it and the tag was
 * gone when they came back. *"filter by tag saved view is not sticking"*.
 *
 * ⚠️ THE SAVE SUCCEEDED. Nothing errored, nothing warned, the filter was simply
 * discarded - because the field list was hand-written in six places and three
 * of them had drifted. This file's job is to make the seventh copy impossible.
 */

/** Pagination is not a filter and is deliberately not carried by a saved view. */
const NOT_A_FILTER = ["page", "pageSize"];

/** A value that is not this field's default, so its survival is observable. */
function sampleFor(
  field: (typeof TICKET_VIEW_FILTERS.fields)[number],
): string[] | string {
  if (field.kind === "list") {
    return field.key === "slaStatus" ? ["breached"] : ["sample-value"];
  }
  if (field.kind === "text") {
    return field.key.endsWith("From") || field.key.endsWith("To")
      ? "2026-09-01"
      : "sample text";
  }
  const notTheDefault: Record<string, string> = {
    statusGroup: "open",
    scope: "assigned",
    sort: "createdAt",
    order: "asc",
  };
  return notTheDefault[field.key];
}

/** Every filter, each holding a non-default value. */
function fullyPopulated(): TicketFilters {
  const filters = parseFilters(new URLSearchParams()) as Record<
    string,
    unknown
  >;
  for (const field of TICKET_VIEW_FILTERS.fields) {
    filters[field.key] = sampleFor(field);
  }
  return filters as unknown as TicketFilters;
}

describe("the saved-view filter catalogue (card 1.127)", () => {
  it("⚠️ knows every filter the URL layer knows", () => {
    // THE ASSERTION THIS CARD EXISTS FOR, and the reason `parseFilters` is
    // exported: it builds the whole filter object, so its keys ARE the field
    // list. Add a filter there and forget the catalogue and this fails - which
    // is exactly what happened to `tags`, `resolvedFrom` and `resolvedTo`.
    const known = new Set(
      TICKET_VIEW_FILTERS.fields.map((field) => field.key as string),
    );
    const everyFilter = Object.keys(
      parseFilters(new URLSearchParams()) as Record<string, unknown>,
    ).filter((key) => !NOT_A_FILTER.includes(key));

    expect(everyFilter.filter((key) => !known.has(key))).toEqual([]);
  });

  it("⚠️ carries every one of them through save and back", () => {
    // Driven from the catalogue, so a new field gets round-trip coverage the
    // moment it is added rather than whenever somebody remembers.
    const applied = TICKET_VIEW_FILTERS.toApplied(
      TICKET_VIEW_FILTERS.toPersisted(fullyPopulated()),
    ) as Record<string, unknown>;

    for (const field of TICKET_VIEW_FILTERS.fields) {
      expect(applied[field.key]).toEqual(sampleFor(field));
    }
  });

  it("carries them through the dropdown's payload too", () => {
    // The dropdown saves through a different function from the button, and it
    // had drifted in the same way.
    const payload = TICKET_VIEW_FILTERS.toPayload(fullyPopulated());

    for (const field of TICKET_VIEW_FILTERS.fields) {
      expect(payload[field.key]).toEqual(sampleFor(field));
    }
  });

  it("⚠️ the owner's own case: a tag survives save and apply", () => {
    const withTag = { ...fullyPopulated(), tags: ["payroll"] };

    const stored = TICKET_VIEW_FILTERS.toPersisted(withTag);
    expect(stored.tags).toEqual(["payroll"]);
    expect(TICKET_VIEW_FILTERS.toApplied(stored).tags).toEqual(["payroll"]);
  });

  it("and the one nobody reported: a resolved date range survives", () => {
    const withDates = {
      ...fullyPopulated(),
      resolvedFrom: "2026-09-14",
      resolvedTo: "2026-09-16",
    };

    const applied = TICKET_VIEW_FILTERS.toApplied(
      TICKET_VIEW_FILTERS.toPersisted(withDates),
    );
    expect(applied.resolvedFrom).toBe("2026-09-14");
    expect(applied.resolvedTo).toBe("2026-09-16");
  });

  it("⚠️ scope, sort and order still survive - they worked before", () => {
    // NON-VACUITY. Three filters that were already persisted correctly, and the
    // ones a careless unification would drop. The batch prompt warns that they
    // are absent from the URL builder; they are not - they sit at the top of
    // `apiParams` rather than in the conditional block below it.
    const applied = TICKET_VIEW_FILTERS.toApplied(
      TICKET_VIEW_FILTERS.toPersisted({
        ...fullyPopulated(),
        scope: "assigned",
        sort: "createdAt",
        order: "asc",
      }),
    );

    expect(applied.scope).toBe("assigned");
    expect(applied.sort).toBe("createdAt");
    expect(applied.order).toBe("asc");
  });

  it("stores nothing for a filter at its default, so a view stays portable", () => {
    // The other half of the contract: `toPersisted` strips defaults. A view
    // that stored every field would pin someone else's sort order onto anybody
    // who applied it.
    const stored = TICKET_VIEW_FILTERS.toPersisted(
      parseFilters(new URLSearchParams()),
    );

    expect(stored).toEqual({});
  });

  it("⚠️ applies cleanly to a view that carries nothing at all", () => {
    // An older view, saved before any of this. It must not throw and must not
    // invent values.
    const applied = TICKET_VIEW_FILTERS.toApplied({});

    expect(applied.tags).toEqual([]);
    expect(applied.q).toBe("");
    expect(applied.scope).toBe("all");
    expect(applied.sort).toBe("updatedAt");
    expect(applied.order).toBe("desc");
    // ⚠️ AND `statusGroup` STAYS UNDEFINED rather than becoming "all", which is
    // what `applyView` has always done. There are real saved views in
    // production; changing this would change what they do when applied.
    expect(applied.statusGroup).toBeUndefined();
  });
});
