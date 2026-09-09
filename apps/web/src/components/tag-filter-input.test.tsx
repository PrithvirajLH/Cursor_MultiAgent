import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TagFilterInput } from "./TagFilterInput";

/**
 * Card 1.50 — what the tag filter shows.
 *
 * The suite runs in a node environment with no jsdom, so this asserts the
 * rendered markup: that two tags render as two removable chips, and that the
 * old "csv" label is gone. The keystroke behaviour itself is pinned by
 * `parse-tag-list.test.ts` and by the browser pass in §8.
 */
describe("TagFilterInput", () => {
  it("⚠️ shows two tags as two separate chips", () => {
    // The old control could not hold two tags at all - they fused into
    // "networkprinter" as you typed the comma.
    const html = renderToStaticMarkup(
      <TagFilterInput tags={["network", "printer"]} onChange={() => {}} />,
    );
    expect(html).toContain("network");
    expect(html).toContain("printer");
    expect(html).not.toContain("networkprinter");
    // Each chip is removable on its own, which a text box could not offer.
    expect(html).toContain('aria-label="Remove tag network"');
    expect(html).toContain('aria-label="Remove tag printer"');
  });

  it("says what it does in plain language, with no \"csv\"", () => {
    // Owner's standing preference, and the reader no longer needs to know the
    // comma trick for the control to work.
    const html = renderToStaticMarkup(
      <TagFilterInput tags={[]} onChange={() => {}} />,
    );
    expect(html.toLowerCase()).not.toContain("csv");
    expect(html).toContain('aria-label="Filter by tag"');
    expect(html).toContain('placeholder="Filter by tag"');
  });

  it("offers no chips and keeps the placeholder when empty", () => {
    const html = renderToStaticMarkup(
      <TagFilterInput tags={[]} onChange={() => {}} />,
    );
    expect(html).not.toContain("Remove tag");
  });

  it("hides the placeholder once a tag is chosen", () => {
    const html = renderToStaticMarkup(
      <TagFilterInput tags={["vpn"]} onChange={() => {}} />,
    );
    expect(html).not.toContain('placeholder="Filter by tag"');
  });
});
