import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DESCRIPTION_CLAMP_LINES,
  TicketDescription,
} from "./TicketDescription";

/**
 * Card 1.39, task 1.
 *
 * On a real PAF termination ticket an eleven-line description took ~240px and
 * left the conversation ~275px — three messages out of ten. The rule that
 * matters most here is that clamping HIDES and never DROPS: the owner asked
 * explicitly to see the raw description, and `stripFacilityFromDescription` was
 * removed once already for eating lines.
 */

const LONG = [
  "Employee: Jane Doe",
  "Employee ID: 44821",
  "Facility: Riverside",
  "Position: RN",
  "Last day worked: 2026-08-28",
  "Termination type: Voluntary",
  "Eligible for rehire: Yes",
  "Final pay method: Direct deposit",
  "PTO payout: 38.5 hours",
  "Equipment returned: Badge, laptop",
  "Notes: exit interview completed",
].join("\n");

const SHORT = "The printer on 3 West is offline again.";

function render(text: string): string {
  return renderToStaticMarkup(<TicketDescription text={text} />);
}

describe("TicketDescription", () => {
  it("clamps a long description and offers Show more", () => {
    const html = render(LONG);
    expect(html).toContain("Show more");
    expect(html).toContain("-webkit-line-clamp");
  });

  it("clamps to the number of lines the constant says", () => {
    expect(render(LONG)).toContain(
      `-webkit-line-clamp:${DESCRIPTION_CLAMP_LINES}`,
    );
  });

  it("keeps the WHOLE original text in the document while clamped", () => {
    // The heart of the card: clamping is hiding, never dropping. The clamp is
    // CSS, so every line — including the last — is present and expanding
    // cannot lose anything. A future "optimisation" that truncated the string
    // would fail here.
    const html = render(LONG);
    for (const line of LONG.split("\n")) {
      expect(html).toContain(line);
    }
  });

  it("keeps whitespace-pre-wrap, because the description is line-oriented", () => {
    expect(render(LONG)).toContain("whitespace-pre-wrap");
  });

  it("grows no control for a short description", () => {
    const html = render(SHORT);
    expect(html).not.toContain("Show more");
    expect(html).not.toContain("Show less");
    expect(html).not.toContain("-webkit-line-clamp");
  });

  it("does not clamp a description with exactly the clamp's worth of lines", () => {
    const exact = Array.from(
      { length: DESCRIPTION_CLAMP_LINES },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    const html = render(exact);
    expect(html).not.toContain("Show more");
    expect(html).not.toContain("-webkit-line-clamp");
  });

  it("clamps as soon as there is one line more than fits", () => {
    const oneMore = Array.from(
      { length: DESCRIPTION_CLAMP_LINES + 1 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    expect(render(oneMore)).toContain("Show more");
  });

  it("gives the toggle a real button with aria-expanded", () => {
    const html = render(LONG);
    expect(html).toContain("<button");
    expect(html).toContain('aria-expanded="false"');
  });

  it("still renders links inside the description", () => {
    const html = render(
      "See https://example.com/policy for the full policy.\nline2\nline3\nline4",
    );
    expect(html).toContain('href="https://example.com/policy"');
  });
});

/*
 * NOT asserted here, and deliberately so — this suite runs in vitest's node
 * environment (no jsdom, no @testing-library, renderToStaticMarkup only), so no
 * effect runs, nothing has a height and nothing can be clicked:
 *
 *  - Clicking "Show more" revealing the text and the label becoming "Show
 *    less". State after a click needs a DOM. The static half is covered above:
 *    the full text is already in the document, so expanding is a CSS change
 *    with nothing left to fetch or reveal.
 *  - The layout measurement, which is what catches a SINGLE long line that
 *    wraps past the clamp. These tests only exercise the seeded newline lower
 *    bound. THAT GAP HID A REAL BUG: the first implementation measured
 *    `scrollHeight > clientHeight`, which is circular — the element is only
 *    clamped when we already believe it overflows, so a 375-character
 *    description with no newlines seeded false, never got clamped, reported
 *    equal heights and stayed unclamped with no toggle at 159px. Found only by
 *    loading it in a browser. The fix compares against the clamp's target
 *    height (line-height x DESCRIPTION_CLAMP_LINES), which does not depend on
 *    the current state. If you touch that measurement, check a long
 *    newline-free description in a real browser — no test here can see it.
 *  - Edit mode showing the description unclamped: that lives in
 *    TicketDetailPage's `editingText ?` branch, and the page needs a router, a
 *    QueryClient and several contexts to render.
 *
 * All three were checked in a browser instead; see the card's report.
 */
