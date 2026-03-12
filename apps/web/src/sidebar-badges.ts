export type SidebarBadgeCounts = {
  assignedToMe?: number;
  triage?: number;
  open?: number;
  unassigned?: number;
  resolved?: number;
};

export function getSidebarBadge(
  itemKey: string,
  counts?: SidebarBadgeCounts,
): number | undefined {
  switch (itemKey) {
    case "triage":
      return counts?.triage;
    case "tickets":
      return counts?.open;
    case "completed":
      return counts?.resolved;
    default:
      return undefined;
  }
}

export function getSidebarChildBadge(
  itemKey: string,
  counts?: SidebarBadgeCounts,
): number | undefined {
  switch (itemKey) {
    case "assigned":
      return counts?.assignedToMe;
    case "unassigned":
      return counts?.unassigned;
    default:
      return undefined;
  }
}
