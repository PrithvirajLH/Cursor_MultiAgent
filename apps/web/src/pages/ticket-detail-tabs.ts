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

/**
 * The class for one tab panel (card 1.120).
 *
 * ⚠️ `absolute inset-0` PINS EVERY PANEL TO A FIXED BOX, and until this card
 * the active branch gave it no way to scroll its own overflow. Measured in
 * production on the first ticket ever to carry seven emailed attachments:
 * `panel-attachments` had clientHeight 562 against scrollHeight 1015, so **453
 * pixels were unreachable** - the image preview began 856px into an 889px
 * viewport. Every ancestor was `overflow: visible`, the container above is
 * `lg:overflow-hidden` and the body does not scroll, so nothing in the chain
 * could reach it.
 *
 * ⚠️ `min-h-0` IS NOT OPTIONAL. A flex child will not shrink below its
 * content height without it, so the scroller would never engage and the fix
 * would look applied while changing nothing.
 *
 * ⚠️ THE FEARED DOUBLE SCROLLBAR ON CONVERSATION DID NOT REPRODUCE, and that
 * was measured rather than argued. The card warned that this helper serves all
 * three tabs and that conversation has its own message-list scroller plus a
 * composer, so a panel-level scroller might give it two scrollbars. Applying it
 * there and re-measuring at a 700px viewport with a four-message thread: panel
 * `scrollHeight === clientHeight`, one inner scroller, nothing doubled. The
 * reason is structural - `TicketConversation`'s root is
 * `flex flex-1 flex-col min-h-0`, so it always sizes to the panel and its list
 * absorbs the overflow. The panel cannot overflow from conversation content, so
 * this rule is inert there rather than harmful. No special case is warranted.
 *
 * ⚠️ A REAL DOUBLING WAS FOUND ON TIMELINE INSTEAD, and fixed at its source:
 * `TicketTimeline` capped its own list at `max-h-[660px]` - a workaround from
 * when no panel could scroll - which at a 700px viewport left a 660px list
 * inside a 415px panel and two nested scrollbars. That cap is gone; see the
 * comment there.
 */
export function getTicketDetailTabPanelClassName(
  tab: TicketDetailTabId,
  activeTab: TicketDetailTabId,
) {
  return tab === activeTab
    ? 'absolute inset-0 flex flex-col overflow-y-auto min-h-0'
    : 'absolute inset-0 hidden';
}
