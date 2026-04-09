export const TICKET_DETAIL_LAYOUT_CLASSNAMES = {
  contentShell:
    "flex flex-1 overflow-x-hidden overflow-y-auto lg:overflow-hidden",
  contentContainer:
    "flex w-full min-h-full flex-col lg:min-h-0 lg:flex-row",
  mainPanel:
    "flex min-h-[60vh] min-w-0 flex-1 flex-col bg-background lg:min-h-0 lg:border-r lg:border-border",
  sidebar:
    "w-full border-t border-border bg-card lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-t-0",
} as const;
