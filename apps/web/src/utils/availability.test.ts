import { describe, expect, it } from "vitest";
import {
  availabilityLabel,
  backOnInputValue,
  backOnIsUsable,
  backOnToIso,
  isAwayNow,
  reassignOffer,
} from "./availability";

const NOW = new Date("2026-09-11T12:00:00.000Z");

describe("isAwayNow", () => {
  it("is not away when the flag says available", () => {
    expect(isAwayNow({ isAvailable: true, awayUntil: null }, NOW)).toBe(false);
  });

  it("is away with no end date", () => {
    expect(isAwayNow({ isAvailable: false, awayUntil: null }, NOW)).toBe(true);
  });

  it("⚠️ treats a PAST return date as back, whatever the flag says", () => {
    // The same rule as the server's availableUserFilter. If these two disagree
    // the menu says away while tickets keep arriving - the confusion card 2.2
    // exists to end.
    expect(
      isAwayNow(
        { isAvailable: false, awayUntil: "2026-09-10T00:00:00.000Z" },
        NOW,
      ),
    ).toBe(false);
  });

  it("⚠️ treats a FUTURE return date as still away", () => {
    // The discriminating half: without this, the case above would pass with a
    // function that always returned false.
    expect(
      isAwayNow(
        { isAvailable: false, awayUntil: "2026-09-12T00:00:00.000Z" },
        NOW,
      ),
    ).toBe(true);
  });

  it("treats an unparseable date as still away rather than quietly present", () => {
    expect(isAwayNow({ isAvailable: false, awayUntil: "not a date" }, NOW)).toBe(
      true,
    );
  });
});

describe("availabilityLabel", () => {
  it("says Available when here", () => {
    expect(availabilityLabel({ isAvailable: true, awayUntil: null }, NOW)).toBe(
      "Available",
    );
  });

  it("says Away with no date when there is none", () => {
    expect(availabilityLabel({ isAvailable: false, awayUntil: null }, NOW)).toBe(
      "Away",
    );
  });

  it("names the return date when away until one", () => {
    const label = availabilityLabel(
      { isAvailable: false, awayUntil: "2026-09-12T00:00:00.000Z" },
      NOW,
    );
    expect(label).toMatch(/^Away until /);
    expect(label).toContain("2026");
  });

  it("⚠️ says Available once the return date has passed", () => {
    expect(
      availabilityLabel(
        { isAvailable: false, awayUntil: "2026-09-01T00:00:00.000Z" },
        NOW,
      ),
    ).toBe("Available");
  });
});

describe("backOnInputValue / backOnToIso", () => {
  it("round-trips a date through the input and back", () => {
    const iso = backOnToIso("2026-09-20");
    expect(iso).not.toBeNull();
    expect(backOnInputValue(iso)).toBe("2026-09-20");
  });

  it("⚠️ builds LOCAL midnight, not UTC midnight", () => {
    // new Date("2026-09-20") is UTC midnight, which is the 19th in any zone
    // behind UTC and would put somebody back a day early. The local
    // construction is what keeps the picked day the picked day.
    const iso = backOnToIso("2026-09-20");
    const parsed = new Date(iso as string);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(8);
    expect(parsed.getDate()).toBe(20);
    expect(parsed.getHours()).toBe(0);
  });

  it("gives an empty input value for no date", () => {
    expect(backOnInputValue(null)).toBe("");
    expect(backOnInputValue("not a date")).toBe("");
  });

  it("returns null for an empty or malformed input", () => {
    expect(backOnToIso("")).toBeNull();
    expect(backOnToIso("20/09/2026")).toBeNull();
  });
});

describe("backOnIsUsable", () => {
  it("accepts no date at all - away with no end in sight", () => {
    expect(backOnIsUsable("", NOW)).toBe(true);
  });

  it("⚠️ rejects a date the server would refuse", () => {
    // The API 400s on a past return date; this is the same answer, before the
    // request, so the user gets a disabled button instead of an error code.
    expect(backOnIsUsable("2026-09-01", NOW)).toBe(false);
  });

  it("accepts a future date", () => {
    expect(backOnIsUsable("2026-12-01", NOW)).toBe(true);
  });

  it("rejects a malformed date", () => {
    expect(backOnIsUsable("tomorrow", NOW)).toBe(false);
  });
});

describe("reassignOffer", () => {
  it("offers nothing when there is nothing to hand over", () => {
    expect(reassignOffer(0, false)).toBeNull();
  });

  it("counts one ticket in the singular", () => {
    expect(reassignOffer(1, false)).toBe(
      "You have 1 open ticket. Hand them to the queue",
    );
  });

  it("counts several in the plural", () => {
    expect(reassignOffer(7, false)).toBe(
      "You have 7 open tickets. Hand them to the queue",
    );
  });

  it("⚠️ says the smaller number it can actually move when truncated", () => {
    // One bulk call carries 100 ids. Offering to move 140 and moving 100 is a
    // quiet shortfall nobody notices until a ticket goes missing.
    expect(reassignOffer(140, true)).toBe(
      "You have 140 open tickets. Hand the first 100 to the queue",
    );
  });
});
