import { describe, expect, it } from "vitest";
import { TICKET_DETAIL_LAYOUT_CLASSNAMES } from "./ticket-detail-layout";

describe("ticket detail responsive layout", () => {
  it("stacks the sidebar below the main panel on smaller screens", () => {
    expect(TICKET_DETAIL_LAYOUT_CLASSNAMES.contentShell).toContain(
      "overflow-y-auto",
    );
    expect(TICKET_DETAIL_LAYOUT_CLASSNAMES.contentContainer).toContain(
      "flex-col",
    );
    expect(TICKET_DETAIL_LAYOUT_CLASSNAMES.contentContainer).toContain(
      "lg:flex-row",
    );
    expect(TICKET_DETAIL_LAYOUT_CLASSNAMES.sidebar).toContain("w-full");
    expect(TICKET_DETAIL_LAYOUT_CLASSNAMES.sidebar).toContain("lg:w-80");
    expect(TICKET_DETAIL_LAYOUT_CLASSNAMES.sidebar).toContain("border-t");
    expect(TICKET_DETAIL_LAYOUT_CLASSNAMES.sidebar).toContain(
      "lg:border-t-0",
    );
  });
});
