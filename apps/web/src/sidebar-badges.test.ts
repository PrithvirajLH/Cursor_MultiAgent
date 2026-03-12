import { describe, expect, it } from "vitest";
import { getSidebarBadge, getSidebarChildBadge } from "./sidebar-badges";

const counts = {
  assignedToMe: 3,
  triage: 5,
  open: 8,
  unassigned: 2,
  resolved: 11,
};

describe("sidebar badge mapping", () => {
  it("maps completed to the resolved aggregate", () => {
    expect(getSidebarBadge("completed", counts)).toBe(11);
  });

  it("keeps created tickets unbadged until a matching aggregate exists", () => {
    expect(getSidebarBadge("created", counts)).toBeUndefined();
  });

  it("preserves existing child badge mappings", () => {
    expect(getSidebarChildBadge("assigned", counts)).toBe(3);
    expect(getSidebarChildBadge("unassigned", counts)).toBe(2);
  });
});
