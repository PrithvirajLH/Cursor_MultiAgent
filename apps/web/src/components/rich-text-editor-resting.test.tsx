import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RichTextEditor } from "./RichTextEditor";

/**
 * Card 1.39, task 2 — the composer rests at one line.
 *
 * ≈154px was reserved before an agent typed a character: an always-on
 * formatting toolbar, the editable area, and the footer row. The footer row is
 * deliberately untouched — the Public/Internal state and the send button are
 * safety controls from cards 1.37 and 1.38 and must never be hidden.
 */

function render(value: string): string {
  return renderToStaticMarkup(
    <RichTextEditor
      value={value}
      onChange={() => {}}
      placeholder="Type a message…"
      users={[]}
      cannedVariables={{}}
    />,
  );
}

/** The editable div's inline min-height, in px. */
function restingHeight(html: string): number {
  const match = html.match(/min-height:\s*(\d+)px/);
  return match ? Number(match[1]) : -1;
}

describe("the composer at rest", () => {
  it("rests at a single line with no content", () => {
    expect(restingHeight(render(""))).toBe(24);
  });

  it("hides the formatting toolbar while idle", () => {
    // Seven buttons an agent does not need while reading.
    const html = render("");
    expect(html).not.toContain('aria-label="Bold"');
    expect(html).not.toContain('aria-label="Italic"');
  });

  it("keeps the box outlined when the toolbar is gone", () => {
    // The editable div used to rely on the toolbar for its top border
    // (border-t-0); without this it would render with an open top edge.
    expect(render("")).not.toContain("border-t-0");
  });

  it("treats an empty contentEditable's <br> as empty too", () => {
    // What the browser leaves behind after the agent deletes everything.
    expect(restingHeight(render("<br>"))).toBe(24);
  });
});

describe("the composer with content", () => {
  it("opens to full height as soon as there is content", () => {
    expect(restingHeight(render("<p>Half a reply</p>"))).toBe(48);
  });

  it("shows the toolbar once there is content", () => {
    const html = render("<p>Half a reply</p>");
    expect(html).toContain('aria-label="Bold"');
  });

  it("opens expanded for a RESTORED DRAFT, with no interaction", () => {
    // Drafts persist across navigation on this page. A draft hidden inside a
    // collapsed one-line box is a regression worse than the wasted space it
    // saves, so content alone — not focus — has to be enough to open it. This
    // is the first render, exactly as a returning agent would see it.
    const html = render("<p>a draft I left earlier</p>");
    expect(restingHeight(html)).toBe(48);
    expect(html).toContain('aria-label="Bold"');
    // The draft's TEXT is not asserted: the editable div is contentEditable and
    // its content is written imperatively through the ref, so it never appears
    // in server-rendered markup. The height and the toolbar are what tell us
    // the box opened for it, which is the part that could regress.
  });

  it("keeps the same scroll ceiling either way", () => {
    for (const value of ["", "<p>content</p>"]) {
      expect(render(value)).toMatch(/max-height:\s*288px/);
    }
  });
});

/*
 * NOT asserted here: the FOCUS half of the rule ("expanding on focus"). This
 * suite runs in vitest's node environment — no jsdom, no @testing-library, just
 * renderToStaticMarkup — so there is no element to focus and no event to fire,
 * and a test that pretended otherwise would be asserting nothing.
 *
 * The content half above covers the case that can actually lose an agent's work
 * (a restored draft). Focus-to-expand, collapse-on-blur-when-empty, and the
 * message list staying pinned while the composer resizes were all checked in a
 * browser instead; see the card's report.
 */
