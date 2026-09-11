import { describe, expect, it } from "vitest";
import {
  inlineImageCount,
  redactionEmailCaveat,
  redactionOutcomeMessage,
} from "./redaction-caveat";

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
      delivery: { emailed: 3, pending: 0,
      refused: 0, recipients: [],
      internal: false },
    });
    expect(caveat).toContain("3 people");
    expect(caveat).toContain("does not take the email back");
  });

  it("uses the singular for one recipient", () => {
    expect(
      redactionEmailCaveat({
        delivery: { emailed: 1, pending: 0,
      refused: 0, recipients: [],
      internal: false },
      }),
    ).toContain("1 person");
  });

  it("says nothing for an internal note", () => {
    // Card 1.42 emails no internal notes, so there is no caveat to make - and
    // a caveat that does not apply is how the ones that do stop being read.
    expect(
      redactionEmailCaveat({
        delivery: { emailed: 0, pending: 0,
      refused: 0, recipients: [],
      internal: true },
      }),
    ).toBeNull();
  });

  it("says nothing when the send FAILED", () => {
    // `delivery` reports the outbox, not the intent. Claiming an email went out
    // when it did not would send somebody chasing a recipient who never
    // received anything.
    expect(
      redactionEmailCaveat({
        delivery: { emailed: 0, pending: 0,
      refused: 2, recipients: [],
      internal: false },
      }),
    ).toBeNull();
  });

  it("says nothing when delivery is not known yet", () => {
    expect(redactionEmailCaveat({})).toBeNull();
  });

  it("⚠️ warns about an email still sitting in the queue (card 1.47)", () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. This case used to
    // produce NO caveat at all - `emailed` was 0 because the row was still
    // PENDING - and then the original text was emailed a moment later.
    const caveat = redactionEmailCaveat({
      delivery: { emailed: 0, refused: 0, pending: 1, recipients: [],
      internal: false },
    });
    expect(caveat).not.toBeNull();
    expect(caveat).toContain("still queued");
    expect(caveat).toContain("will stop that email");
  });

  it("does not promise a stop in the past tense before the click", () => {
    // At dialog time nothing has been stopped yet. Saying "we have stopped it"
    // here would be a nicer-sounding version of the defect.
    const caveat = redactionEmailCaveat({
      delivery: { emailed: 0, refused: 0, pending: 1, recipients: [],
      internal: false },
    });
    expect(caveat).not.toContain("have stopped");
  });

  it("prefers the sent wording when something both sent and is queued", () => {
    const caveat = redactionEmailCaveat({
      delivery: { emailed: 2, refused: 0, pending: 1, recipients: [],
      internal: false },
    });
    expect(caveat).toContain("does not take the email back");
  });

  it("still says nothing for a queued INTERNAL note", () => {
    expect(
      redactionEmailCaveat({
        delivery: { emailed: 0, refused: 0, pending: 1, recipients: [],
      internal: true },
      }),
    ).toBeNull();
  });
});

/**
 * Card 1.47 — what the agent is told AFTER the removal.
 *
 * The server reports what it managed, not what it hoped. These three outcomes
 * are the whole card: caught it, did not catch it, nothing to catch.
 */
describe("redaction outcome", () => {
  it("says it stopped the email when it really did", () => {
    expect(
      redactionOutcomeMessage({ alreadyEmailed: false, emailsStopped: 1 }),
    ).toBe("Removed. This had not been emailed yet, and we have stopped it.");
  });

  it("⚠️ does NOT claim a stop when the send got away", () => {
    // The losing side of the race: the sweeper claimed the row first. False
    // reassurance here is worse than shipping nothing.
    const message = redactionOutcomeMessage({
      alreadyEmailed: true,
      emailedCount: 3,
      emailsStopped: 0,
    });
    expect(message).not.toContain("stopped");
    expect(message).toContain("cannot be recalled");
    expect(message).toContain("3 people");
  });

  it("stays honest when a stop and a send both happened", () => {
    const message = redactionOutcomeMessage({
      alreadyEmailed: true,
      emailedCount: 1,
      emailsStopped: 1,
    });
    expect(message).toContain("cannot be recalled");
  });

  it("says the plain thing when there was no email at all", () => {
    expect(
      redactionOutcomeMessage({ alreadyEmailed: false, emailsStopped: 0 }),
    ).toBe("Message removed.");
  });
});

/**
 * Card 1.48 — the dialog has to say the image goes too.
 *
 * It is not recoverable after the click, so discovering it afterwards is not
 * good enough.
 */
describe("inline image count", () => {
  it("counts a pasted image", () => {
    expect(inlineImageCount('<img data-attachment-id="a1">')).toBe(1);
  });

  it("counts each image once", () => {
    expect(
      inlineImageCount(
        '<img data-attachment-id="a1"><img data-attachment-id="a1"><img data-attachment-id="a2">',
      ),
    ).toBe(2);
  });

  it("ignores an image that is still uploading", () => {
    expect(inlineImageCount('<img data-temp-id="t1">')).toBe(0);
  });

  it("is zero for plain text and for nothing at all", () => {
    expect(inlineImageCount("just words")).toBe(0);
    expect(inlineImageCount("")).toBe(0);
    expect(inlineImageCount(null)).toBe(0);
  });
});
