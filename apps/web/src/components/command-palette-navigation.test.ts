import { describe, expect, it } from "vitest";
import {
  buildActionableCommandPaletteEntityItems,
  getTeamSearchNavigationTarget,
} from "./command-palette-navigation";

describe("command palette entity actions", () => {
  it("omits unsupported user results from actionable search items", () => {
    const items = buildActionableCommandPaletteEntityItems({
      tickets: [
        {
          id: "ticket-1",
          number: 101,
          displayId: "T-101",
          subject: "Printer offline",
          status: "NEW",
          priority: "SEV3",
          assignedTeam: null,
        },
      ],
      users: [
        {
          id: "user-1",
          displayName: "Ada Lovelace",
          email: "ada@example.com",
        },
      ],
      teams: [
        {
          id: "team-1",
          name: "Facilities",
        },
      ],
    });

    expect(items).toEqual([
      {
        type: "ticket",
        id: "ticket-ticket-1",
        data: {
          id: "ticket-1",
          number: 101,
          displayId: "T-101",
          subject: "Printer offline",
          status: "NEW",
          priority: "SEV3",
          assignedTeam: null,
        },
      },
      {
        type: "team",
        id: "team-team-1",
        data: {
          id: "team-1",
          name: "Facilities",
        },
      },
    ]);
  });

  it("creates a team deep-link target that preserves the selected team", () => {
    expect(
      getTeamSearchNavigationTarget({
        id: "team-42",
        name: "Service Desk",
      }),
    ).toEqual({
      pathname: "/team",
      state: {
        selectedTeamId: "team-42",
      },
    });
  });
});
