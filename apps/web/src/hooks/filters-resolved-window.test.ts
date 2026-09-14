import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAVED_VIEWS } from "../components/shell/saved-views";

/** Source with comments stripped, so an assertion cannot match a comment. */
function codeOnly(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Card 1.88 — the saved view and the filter hook have to know the same word.
 *
 * ⚠️ THIS GUARDS A BUG THE BROWSER FOUND AND THE API TESTS COULD NOT. The
 * badge counts by `resolvedAt`, so the saved view was moved to `resolvedFrom`
 * — but `useFilters` is the ONLY path from the URL to the API query, and it
 * did not know that word. The parameter was dropped silently and "Resolved
 * this week" listed every resolved ticket ever, while the integration tests
 * passed because they call the API directly.
 */
describe("the resolved-this-week window survives the URL round trip (card 1.88)", () => {
  const hook = codeOnly("useFilters.ts");

  it("⚠️ the saved view asks for resolvedFrom, not updatedFrom", () => {
    const view = SAVED_VIEWS.find((v) => v.id === "recent-resolved");
    expect(view).toBeTruthy();
    const query = view!.buildQuery();
    expect(query).toContain("resolvedFrom=");
    expect(query).not.toContain("updatedFrom=");
  });

  it("⚠️ the hook reads it out of the URL", () => {
    expect(hook).toMatch(/searchParams\.get\("resolvedFrom"\)/);
  });

  it("⚠️ the hook passes it to the API", () => {
    // The step that was missing: parsed but never forwarded is the same as
    // never parsed at all.
    expect(hook).toMatch(/p\.resolvedFrom = filters\.resolvedFrom/);
  });

  it("writes it back to the URL, so the view stays shareable", () => {
    expect(hook).toMatch(/params\.set\("resolvedFrom"/);
  });

  it("counts it as an active filter", () => {
    expect(hook).toMatch(/!!filters\.resolvedFrom/);
  });
});
