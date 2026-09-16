import { describe, expect, it } from "vitest";
import {
  getNextTicketDetailTab,
  getTicketDetailTabAccessibilityState,
  getTicketDetailTabIds,
  getTicketDetailTabPanelClassName,
} from "./ticket-detail-tabs";

describe("ticket detail tabs", () => {
  it("supports roving keyboard navigation with arrow, home, and end keys", () => {
    expect(getNextTicketDetailTab("conversation", "ArrowRight")).toBe(
      "attachments",
    );
    expect(getNextTicketDetailTab("attachments", "ArrowRight")).toBe(
      "timeline",
    );
    expect(getNextTicketDetailTab("timeline", "ArrowRight")).toBe(
      "conversation",
    );
    expect(getNextTicketDetailTab("conversation", "ArrowLeft")).toBe(
      "timeline",
    );
    expect(getNextTicketDetailTab("timeline", "Home")).toBe("conversation");
    expect(getNextTicketDetailTab("conversation", "End")).toBe("timeline");
    expect(getNextTicketDetailTab("conversation", "Enter")).toBeNull();
  });

  it("marks only the active tab as tabbable and only the active panel as visible", () => {
    expect(
      getTicketDetailTabAccessibilityState("conversation", "conversation"),
    ).toEqual({
      tabIndex: 0,
      hidden: false,
    });
    expect(
      getTicketDetailTabAccessibilityState("timeline", "conversation"),
    ).toEqual({
      tabIndex: -1,
      hidden: true,
    });
  });

  it("renders inactive panels with a hidden display class instead of layered flex panels", () => {
    expect(getTicketDetailTabPanelClassName("timeline", "conversation")).toBe(
      "absolute inset-0 hidden",
    );
  });

  it("⚠️ the active panel can scroll its own overflow (card 1.120)", () => {
    // THE REGRESSION ASSERTION. `absolute inset-0` pins the panel to a fixed
    // box; without a scroller the overflow is simply unreachable. Measured in
    // production with seven emailed attachments: 1015px of content in a 562px
    // panel, 453px that no scroller in the whole ancestor chain could reach.
    const active = getTicketDetailTabPanelClassName(
      "attachments",
      "attachments",
    );
    expect(active).toContain("overflow-y-auto");
  });

  it("⚠️ and carries min-h-0, without which the scroller never engages", () => {
    // NOT A DETAIL. A flex child will not shrink below its content height, so
    // `overflow-y-auto` alone leaves the panel as tall as its content and
    // nothing ever scrolls - the fix would look applied and change nothing.
    expect(getTicketDetailTabPanelClassName("timeline", "timeline")).toContain(
      "min-h-0",
    );
  });

  it("⚠️ every tab gets the same treatment, conversation included", () => {
    // The card feared conversation would need excluding, because it owns a
    // message-list scroller and a composer. Measured at a 700px viewport with a
    // four-message thread: the panel does not overflow and nothing doubles,
    // because `TicketConversation`'s root is `flex flex-1 flex-col min-h-0` and
    // absorbs the height itself. One rule, no special cases.
    for (const tab of ["conversation", "attachments", "timeline"] as const) {
      expect(getTicketDetailTabPanelClassName(tab, tab)).toBe(
        "absolute inset-0 flex flex-col overflow-y-auto min-h-0",
      );
    }
  });

  it("derives stable tab and panel ids", () => {
    expect(getTicketDetailTabIds("conversation")).toEqual({
      tabId: "tab-conversation",
      panelId: "panel-conversation",
    });
    expect(getTicketDetailTabIds("timeline")).toEqual({
      tabId: "tab-timeline",
      panelId: "panel-timeline",
    });
  });
});
