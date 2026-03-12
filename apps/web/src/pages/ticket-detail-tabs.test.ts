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
    expect(
      getTicketDetailTabPanelClassName("conversation", "conversation"),
    ).toBe("absolute inset-0 flex flex-col");
    expect(getTicketDetailTabPanelClassName("timeline", "conversation")).toBe(
      "absolute inset-0 hidden",
    );
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
