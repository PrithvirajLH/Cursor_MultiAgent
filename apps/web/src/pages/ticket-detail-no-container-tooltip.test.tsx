import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SOURCE = readFileSync(
  join(__dirname, "TicketDetailPage.tsx"),
  "utf8",
);

/** The opening tag of the panel that wraps the whole ticket view. */
const rootSection = (() => {
  const start = SOURCE.indexOf("    <section");
  return SOURCE.slice(start, SOURCE.indexOf(">", start) + 1);
})();

/**
 * The ticket panel must not put a tooltip on everything inside it.
 *
 * ⚠️ REPORTED FROM THE LIVE APP: hovering ANYTHING inside a ticket — an
 * attachment's Download button, a message, a field — popped up a tooltip
 * reading "All Tickets".
 *
 * ⚠️ THE CAUSE WAS ONE ATTRIBUTE ON THE CONTAINER. The wrapping `<section>`
 * had `title={headerTitle}`, and `headerTitle` is the VIEW name from the header
 * context ("All Tickets" on the /tickets route). A browser shows an ancestor's
 * `title` for every descendant that has none of its own, so a single attribute
 * on the outermost element covered the entire panel.
 *
 * ⚠️ `aria-label` IS THE RIGHT TOOL AND `title` IS NOT. Both give the section an
 * accessible name; only `title` renders a tooltip. Nothing about this panel
 * wants a tooltip, so the name is given the way that does not produce one.
 *
 * Asserted on the source rather than by rendering, because this page needs the
 * router, the header context and a loaded ticket to mount, and the defect is a
 * static property of one JSX tag.
 */
describe("the ticket panel does not tooltip its own contents", () => {
  it("⚠️ the wrapping section carries no title attribute", () => {
    // THE REGRESSION ASSERTION.
    expect(rootSection).not.toMatch(/\btitle=/);
  });

  it("⚠️ it still has an accessible name", () => {
    // NON-VACUITY: deleting the attribute outright would also pass the test
    // above, and would silently strip the landmark's name from screen readers.
    expect(rootSection).toMatch(/aria-label=\{headerTitle\}/);
  });

  it("⚠️ no other container element in this page uses title=", () => {
    // `title` belongs on a small control the user points at, never on a layout
    // element. TopBar's `title` is a React prop and is not matched here.
    const containerWithTitle =
      /<(section|main|article|aside|form|ul|ol|table)\b[^>]*\stitle=/s;
    expect(SOURCE).not.toMatch(containerWithTitle);
  });
});
