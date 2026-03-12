import type { SearchResults } from "../api/client";

export type CommandPaletteEntityResultItem =
  | {
      type: "ticket";
      id: string;
      data: SearchResults["tickets"][number];
    }
  | {
      type: "team";
      id: string;
      data: SearchResults["teams"][number];
    };

export function buildActionableCommandPaletteEntityItems(
  results: SearchResults | null,
): CommandPaletteEntityResultItem[] {
  const items: CommandPaletteEntityResultItem[] = [];

  results?.tickets.forEach((ticket) => {
    items.push({
      type: "ticket",
      data: ticket,
      id: `ticket-${ticket.id}`,
    });
  });

  results?.teams.forEach((team) => {
    items.push({
      type: "team",
      data: team,
      id: `team-${team.id}`,
    });
  });

  return items;
}

export function getTeamSearchNavigationTarget(
  team: SearchResults["teams"][number],
) {
  return {
    pathname: "/team",
    state: {
      selectedTeamId: team.id,
    },
  } as const;
}
