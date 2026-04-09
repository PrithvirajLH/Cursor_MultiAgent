import { useRef, useState } from "react";
import { X, Inbox, ChevronLeft } from "lucide-react";
import { useTicketTabs, type TicketTab } from "../contexts/TicketTabsContext";

type TicketTabBarProps = {
  onSwitchTab: (ticketId: string | null) => void;
};

export function TicketTabBar({ onSwitchTab }: TicketTabBarProps) {
  const {
    tabs,
    activeTabId,
    switchTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
  } = useTicketTabs();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);

  const isQueueActive = activeTabId === null || activeTabId === "__queue__";

  function handleSwitchToQueue() {
    switchTab("__queue__");
    onSwitchTab(null);
  }

  function handleSwitchToTicket(tab: TicketTab) {
    if (tab.id === activeTabId) return;
    switchTab(tab.id);
    onSwitchTab(tab.id);
  }

  function handleClose(e: React.MouseEvent, tabId: string) {
    e.stopPropagation();
    const remaining = tabs.filter((t) => t.id !== tabId);
    closeTab(tabId);

    if (tabId === activeTabId) {
      if (remaining.length > 0) {
        const idx = tabs.findIndex((t) => t.id === tabId);
        const next =
          idx < remaining.length
            ? remaining[idx]
            : remaining[remaining.length - 1];
        switchTab(next.id);
        onSwitchTab(next.id);
      } else {
        onSwitchTab(null);
      }
    }
  }

  function handleContextMenu(e: React.MouseEvent, tabId: string) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  }

  function handleCloseContextMenu() {
    setContextMenu(null);
  }

  const priorityColor: Record<string, string> = {
    P1: "bg-red-500",
    P2: "bg-orange-400",
    P3: "bg-blue-500",
    P4: "bg-slate-400",
  };

  return (
    <>
      <div className="flex items-stretch bg-card border-b border-border px-1 h-10">
        {/* Back to Queue button */}
        <button
          onClick={handleSwitchToQueue}
          className={`flex items-center gap-1.5 px-3 text-[12px] font-semibold transition-all border-b-2 shrink-0 ${
            isQueueActive
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40"
          }`}
        >
          {!isQueueActive && <ChevronLeft className="h-3.5 w-3.5" />}
          <Inbox className="h-3.5 w-3.5" />
          <span>Queue</span>
          {tabs.length > 0 && (
            <span className={`ml-0.5 text-[10px] font-bold min-w-[18px] text-center rounded-full px-1 leading-[18px] ${
              isQueueActive
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground"
            }`}>
              {tabs.length}
            </span>
          )}
        </button>

        {/* Divider */}
        {tabs.length > 0 && (
          <div className="w-px bg-border my-2 mx-1 shrink-0" />
        )}

        {/* Scrollable ticket tabs */}
        <div
          ref={scrollRef}
          className="flex items-stretch gap-px overflow-x-auto flex-1 min-w-0"
          style={{ scrollbarWidth: "none" }}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                onClick={() => handleSwitchToTicket(tab)}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                className={`group relative flex items-center gap-1.5 px-3 py-2 text-[12px] transition-all min-w-0 max-w-[200px] shrink-0 border-b-2 ${
                  isActive
                    ? "border-primary text-foreground bg-primary/5 font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/40"
                }`}
              >
                {/* Priority dot */}
                <span
                  className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                    priorityColor[tab.priority] ?? "bg-slate-400"
                  }`}
                />

                {/* ID + Subject */}
                <span className="truncate">
                  <span className={`font-mono text-[10px] ${isActive ? "text-primary" : "text-muted-foreground/70"}`}>
                    {tab.displayId}
                  </span>
                  <span className="ml-1.5 truncate">{tab.subject}</span>
                </span>

                {/* Close */}
                <span
                  onClick={(e) => handleClose(e, tab.id)}
                  className={`shrink-0 h-4 w-4 rounded-full flex items-center justify-center transition-all ml-auto ${
                    isActive
                      ? "text-muted-foreground hover:text-foreground hover:bg-destructive/10 hover:text-destructive"
                      : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  }`}
                >
                  <X className="h-2.5 w-2.5" />
                </span>
              </button>
            );
          })}
        </div>

        {/* Close all (visible when 2+ tabs) */}
        {tabs.length >= 2 && (
          <button
            onClick={() => {
              closeAllTabs();
              onSwitchTab(null);
            }}
            className="flex items-center px-2 text-[10px] text-muted-foreground/60 hover:text-destructive transition-colors shrink-0"
            title="Close all tabs"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={handleCloseContextMenu}
          />
          <div
            className="fixed z-[9999] rounded-xl border border-border bg-card shadow-elevated py-1.5 min-w-[160px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            <ContextMenuItem
              label="Close Tab"
              onClick={() => {
                const tabId = contextMenu.tabId;
                handleCloseContextMenu();
                const remaining = tabs.filter((t) => t.id !== tabId);
                closeTab(tabId);
                if (tabId === activeTabId) {
                  if (remaining.length > 0) {
                    onSwitchTab(remaining[0].id);
                  } else {
                    onSwitchTab(null);
                  }
                }
              }}
            />
            {tabs.length > 1 && (
              <ContextMenuItem
                label="Close Other Tabs"
                onClick={() => {
                  const tabId = contextMenu.tabId;
                  handleCloseContextMenu();
                  closeOtherTabs(tabId);
                  switchTab(tabId);
                  onSwitchTab(tabId);
                }}
              />
            )}
            <div className="my-1 h-px bg-border/50 mx-2" />
            <ContextMenuItem
              label="Close All Tabs"
              destructive
              onClick={() => {
                handleCloseContextMenu();
                closeAllTabs();
                onSwitchTab(null);
              }}
            />
          </div>
        </>
      )}
    </>
  );
}

function ContextMenuItem({
  label,
  onClick,
  destructive,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors ${
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "text-foreground hover:bg-accent"
      }`}
    >
      {label}
    </button>
  );
}
