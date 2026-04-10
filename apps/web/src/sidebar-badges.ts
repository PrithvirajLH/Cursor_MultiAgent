export type SidebarBadgeCounts = {
  assignedToMe?: number;
  triage?: number;
  open?: number;
  unassigned?: number;
  resolved?: number;
  createdByMeOpen?: number;
  createdByMeResolved?: number;
};

export function getSidebarBadge(
  itemKey: string,
  counts?: SidebarBadgeCounts,
): number | undefined {
  switch (itemKey) {
    case "triage":
      return counts?.triage;
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
    case "created-open":
      return counts?.createdByMeOpen;
    case "created-resolved":
      return counts?.createdByMeResolved;
    default:
      return undefined;
  }
}
