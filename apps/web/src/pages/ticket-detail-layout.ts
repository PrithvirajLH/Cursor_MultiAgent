export const TICKET_DETAIL_LAYOUT_CLASSNAMES = {
  contentShell:
    "flex flex-1 overflow-x-hidden overflow-y-auto lg:overflow-hidden",
  contentContainer:
    "flex w-full min-h-full flex-col lg:min-h-0 lg:flex-row",
  midList:
    "hidden lg:flex lg:w-[280px] lg:shrink-0 lg:flex-col lg:border-r lg:border-border lg:bg-card lg:overflow-y-auto",
  mainPanel:
    "flex min-h-[calc(60vh/var(--ui-zoom))] min-w-0 flex-1 flex-col bg-background lg:min-h-0 lg:border-r lg:border-border",
  sidebar:
    "w-full border-t border-border bg-card lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-t-0",
} as const;
