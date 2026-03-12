export const TICKET_DETAIL_TABS = [
  "conversation",
  "attachments",
  "timeline",
] as const;

export type TicketDetailTabId = (typeof TICKET_DETAIL_TABS)[number];

export function getTicketDetailTabIds(tab: TicketDetailTabId) {
  return {
    tabId: `tab-${tab}`,
    panelId: `panel-${tab}`,
  };
}

export function getNextTicketDetailTab(
  current: TicketDetailTabId,
  key: string,
): TicketDetailTabId | null {
  const currentIndex = TICKET_DETAIL_TABS.indexOf(current);
  if (currentIndex === -1) {
    return null;
  }

  switch (key) {
    case "ArrowRight":
      return TICKET_DETAIL_TABS[(currentIndex + 1) % TICKET_DETAIL_TABS.length];
    case "ArrowLeft":
      return TICKET_DETAIL_TABS[
        (currentIndex - 1 + TICKET_DETAIL_TABS.length) %
          TICKET_DETAIL_TABS.length
      ];
    case "Home":
      return TICKET_DETAIL_TABS[0];
    case "End":
      return TICKET_DETAIL_TABS[TICKET_DETAIL_TABS.length - 1];
    default:
      return null;
  }
}

export function getTicketDetailTabAccessibilityState(
  tab: TicketDetailTabId,
  activeTab: TicketDetailTabId,
) {
  return {
    tabIndex: tab === activeTab ? 0 : -1,
    hidden: tab !== activeTab,
  };
}

export function getTicketDetailTabPanelClassName(
  tab: TicketDetailTabId,
  activeTab: TicketDetailTabId,
) {
  return tab === activeTab
    ? "absolute inset-0 flex flex-col"
    : "absolute inset-0 hidden";
}
