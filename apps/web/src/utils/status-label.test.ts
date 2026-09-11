import { describe, expect, it } from "vitest";
import { statusLabel } from "./status-label";
import { formatStatus } from "./format";

describe("statusLabel (card 2.12)", () => {
  it("⚠️ never lets a raw enum reach the screen", () => {
    expect(statusLabel("IN_PROGRESS")).toBe("In progress");
    expect(statusLabel("WAITING_ON_REQUESTER")).toBe("Waiting on requester");
    expect(statusLabel("WAITING_ON_VENDOR")).toBe("Waiting on vendor");
  });

  it("names every status the API can send", () => {
    const statuses = [
      "NEW",
      "TRIAGED",
      "ASSIGNED",
      "IN_PROGRESS",
      "WAITING_ON_REQUESTER",
      "WAITING_ON_VENDOR",
      "RESOLVED",
      "CLOSED",
      "REOPENED",
    ];
    for (const status of statuses) {
      const label = statusLabel(status);
      expect(label).not.toContain("_");
      expect(label).not.toBe(status);
    }
  });

  it("⚠️ falls back to something readable for a status it has never seen", () => {
    // A status added to the API before this map hears about it must not render
    // as an empty badge.
    expect(statusLabel("PENDING_APPROVAL")).toBe("Pending Approval");
  });

  it("is what formatStatus returns, so there is one spelling", () => {
    expect(formatStatus("IN_PROGRESS")).toBe(statusLabel("IN_PROGRESS"));
  });
});
