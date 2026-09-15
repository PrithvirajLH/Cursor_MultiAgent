import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(__dirname, "useFilters.ts"), "utf8");

/** Names the hook reads out of the URL. */
function parsedNames(): Set<string> {
  return new Set(
    [...SOURCE.matchAll(/searchParams\.get\("([^"]+)"\)/g)].map((m) => m[1]),
  );
}

/** Names the hook writes back into the URL. */
function writtenNames(): Set<string> {
  return new Set(
    [...SOURCE.matchAll(/params\.set\("([^"]+)"/g)].map((m) => m[1]),
  );
}

/**
 * Names the hook forwards to the API.
 *
 * ⚠️ TWO STYLES, AND MISSING EITHER MAKES THIS TEST LIE. `apiParams` seeds an
 * object literal (`page:`, `scope:`, `sort:` …) and then adds the optional ones
 * by assignment (`p.teamIds = …`). A check that only knew about the second
 * style would "find" five missing names and be ignored as noise.
 */
function forwardedNames(): Set<string> {
  const start = SOURCE.indexOf("const apiParams = useMemo(");
  const end = SOURCE.indexOf("return {", start);
  const block = SOURCE.slice(start, end);
  const assigned = [...block.matchAll(/\bp\.(\w+)\s*=/g)].map((m) => m[1]);
  const literal = [...block.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]);
  return new Set([...assigned, ...literal]);
}

const difference = (a: Set<string>, b: Set<string>) =>
  [...a].filter((name) => !b.has(name)).sort();

/**
 * Card 1.99 — a filter name has to be spelled in three places or it vanishes.
 *
 * ⚠️ A NAME MISSING FROM ANY ONE LIST DOES NOT ERROR. It disappears, and it
 * fails in the WIDENING direction, which is the dangerous one. Card 1.88 is the
 * proof: a saved view was pointed at `resolvedFrom`, the parser did not know the
 * word, so the date window was not narrowed — it was REMOVED, and "Resolved this
 * week" listed every resolved ticket ever. The badge said 4 and the list showed
 * 5. Every API test passed, because they call the endpoint directly.
 *
 * ⚠️ THIS COMPARES THE THREE EXISTING LISTS TO EACH OTHER RATHER THAN TO A
 * DECLARATION OF ITS OWN. A canonical list here would be a FOURTH place to
 * forget, which is the failure mode it is supposed to prevent. Restructuring the
 * hook so all three derive from one declaration was the other option; it was not
 * taken because each field carries its own parsing, clamping and default
 * comparison (`!== "desc"`, `Math.min` on pageSize, comma-split arrays), and
 * rewriting that is a large change to a load-bearing hook for no behavioural
 * gain. This gets the guarantee at a fraction of the risk.
 */
describe("every filter is spelled in all three places (card 1.99)", () => {
  it("is reading a file that actually contains the three lists", () => {
    // If a refactor renames `searchParams`/`params.set`/`apiParams`, every
    // assertion below would pass vacuously on three empty sets.
    expect(parsedNames().size).toBeGreaterThan(15);
    expect(writtenNames().size).toBeGreaterThan(15);
    expect(forwardedNames().size).toBeGreaterThan(15);
  });

  it("⚠️ every name read from the URL is also written back to it", () => {
    const missing = difference(parsedNames(), writtenNames());
    expect(missing, `parsed but never written back: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("⚠️ every name written to the URL is also read back from it", () => {
    const missing = difference(writtenNames(), parsedNames());
    expect(missing, `written but never parsed: ${missing.join(", ")}`).toEqual([]);
  });

  it("⚠️ every name read from the URL is forwarded to the API", () => {
    // THE ASSERTION THAT WOULD HAVE CAUGHT CARD 1.88. `resolvedFrom` reached
    // the hook and was dropped on the way to the query.
    const missing = difference(parsedNames(), forwardedNames());
    expect(
      missing,
      `parsed but never forwarded to the API: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("⚠️ nothing is forwarded that the URL cannot express", () => {
    // The other direction: a filter the API receives but no URL can carry is a
    // view nobody can share or reload back into.
    const missing = difference(forwardedNames(), parsedNames());
    expect(
      missing,
      `forwarded but not parseable from the URL: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
