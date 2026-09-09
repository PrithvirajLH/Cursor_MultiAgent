import { describe, expect, it } from "vitest";
import { viewCountPlaceholder } from "./view-count-placeholder";

/**
 * Card 1.54 — a stale count beside an auth error is a lie.
 */
describe("viewCountPlaceholder", () => {
  it("⚠️ shows NOTHING rather than a stale number once the session expires", () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. The badges kept their
    // last good totals through eleven 401s, so the page displayed live-looking
    // figures next to a list that could not load. That contradiction is what
    // sent the diagnosis after the wrong query.
    expect(viewCountPlaceholder({ meta: { total: 14 } }, true)).toBeUndefined();
    expect(viewCountPlaceholder(14, true)).toBeUndefined();
  });

  it("keeps the last good value during an ordinary refetch", () => {
    // The original behaviour, which is correct when the session is fine: a
    // badge must not flicker to blank every sixty seconds.
    expect(viewCountPlaceholder({ meta: { total: 14 } }, false)).toEqual({
      meta: { total: 14 },
    });
    expect(viewCountPlaceholder(14, false)).toBe(14);
  });

  it("has nothing to show before the first successful load", () => {
    expect(viewCountPlaceholder(undefined, false)).toBeUndefined();
    expect(viewCountPlaceholder(undefined, true)).toBeUndefined();
  });
});
