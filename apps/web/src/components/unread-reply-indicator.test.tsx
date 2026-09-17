import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  UNREAD_REPLY_ROW_BAR,
  UnreadReplyBadge,
} from "./unread-reply-indicator";

/**
 * Card 1.138 — the owner asked for this in BOTH lists: the queue table and the
 * rail beside an open ticket.
 */
describe("the unread-reply badge", () => {
  it("says how many, so two unread replies do not look like one", () => {
    const html = renderToStaticMarkup(<UnreadReplyBadge count={2} />);
    expect(html).toContain('data-unread-replies="2"');
    expect(html).toContain(">2<");
  });

  it("caps at 9+, so a neglected thread cannot widen the column", () => {
    expect(renderToStaticMarkup(<UnreadReplyBadge count={12} />)).toContain(
      ">9+<",
    );
  });

  it("renders nothing at zero", () => {
    expect(renderToStaticMarkup(<UnreadReplyBadge count={0} />)).toBe("");
  });

  it("renders nothing for a negative count", () => {
    // Defensive: an older payload or a bad patch must not produce a badge
    // reading "-1".
    expect(renderToStaticMarkup(<UnreadReplyBadge count={-1} />)).toBe("");
  });

  it("names the number in words for a screen reader and a hover", () => {
    expect(renderToStaticMarkup(<UnreadReplyBadge count={1} />)).toContain(
      "One reply nobody has read yet",
    );
    expect(renderToStaticMarkup(<UnreadReplyBadge count={4} />)).toContain(
      "4 replies nobody has read yet",
    );
  });
});

/**
 * ⚠️ THE DRIFT GUARD, and the reason this file reads source text.
 *
 * The owner asked for the indicator in two places. Two components rendering
 * "the same" red bar from two hand-written Tailwind strings is precisely how
 * this project's markers have drifted before - cards 1.99 and 1.127 are the
 * same failure in filters. Both lists must take it from here.
 */
describe("both lists use the one indicator", () => {
  const source = (file: string) =>
    readFileSync(join(__dirname, file), "utf8");

  const LISTS = ["TicketTableView.tsx", "TicketDetailMidList.tsx"];

  for (const file of LISTS) {
    it(`${file} imports the shared indicator`, () => {
      expect(source(file)).toContain("unread-reply-indicator");
      expect(source(file)).toContain("UnreadReplyBadge");
      expect(source(file)).toContain("UNREAD_REPLY_ROW_BAR");
    });

    it(`${file} does not hand-write the bar`, () => {
      // The literal class belongs in one module. Finding it spelled out here
      // means a second copy has appeared.
      expect(source(file)).not.toContain(UNREAD_REPLY_ROW_BAR);
    });
  }

  it("⚠️ neither list still renders the old \"Replied\" pill", () => {
    // The owner asked for it replaced, not joined. Two markers about one
    // conversation, only one of which ever clears, is the confusion this card
    // removes.
    for (const file of LISTS) {
      expect(source(file)).not.toContain("data-awaiting-agent-reply");
    }
  });
});
