import { describe, expect, it } from "vitest";
import { redactionEmailCaveat } from "./redaction-caveat";

/**
 * Card 1.11 — the sentence that stops the Remove button implying a recall.
 *
 * You cannot unsend an email. A public reply has already reached the requester
 * and everyone CC'd, and removing it cleans up the ticket and nothing else. The
 * two cases the card asks to distinguish are here, plus the one that would
 * make the warning a lie: a send that FAILED.
 */
describe("redaction email caveat", () => {
  it("warns for a public reply that really went out", () => {
    const caveat = redactionEmailCaveat({
      delivery: { emailed: 3, refused: 0, internal: false },
    });
    expect(caveat).toContain("3 people");
    expect(caveat).toContain("does not take the email back");
  });

  it("uses the singular for one recipient", () => {
    expect(
      redactionEmailCaveat({
        delivery: { emailed: 1, refused: 0, internal: false },
      }),
    ).toContain("1 person");
  });

  it("says nothing for an internal note", () => {
    // Card 1.42 emails no internal notes, so there is no caveat to make - and
    // a caveat that does not apply is how the ones that do stop being read.
    expect(
      redactionEmailCaveat({
        delivery: { emailed: 0, refused: 0, internal: true },
      }),
    ).toBeNull();
  });

  it("says nothing when the send FAILED", () => {
    // `delivery` reports the outbox, not the intent. Claiming an email went out
    // when it did not would send somebody chasing a recipient who never
    // received anything.
    expect(
      redactionEmailCaveat({
        delivery: { emailed: 0, refused: 2, internal: false },
      }),
    ).toBeNull();
  });

  it("says nothing when delivery is not known yet", () => {
    expect(redactionEmailCaveat({})).toBeNull();
  });
});
