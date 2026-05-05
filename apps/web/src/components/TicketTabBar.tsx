import { useRef, useState } from "react";
import { X, Inbox } from "lucide-react";
import { useTicketTabs, type TicketTab } from "../contexts/TicketTabsContext";

type TicketTabBarProps = {
  onSwitchTab: (ticketId: string | null) => void;
};

const PRIORITY_STYLE: Record<string, { bg: string; fg: string }> = {
  P1: { bg: "bg-red-500/15", fg: "text-red-600 dark:text-red-400" },
  P2: { bg: "bg-orange-500/15", fg: "text-orange-600 dark:text-orange-400" },
  P3: { bg: "bg-blue-500/15", fg: "text-blue-600 dark:text-blue-400" },
  P4: { bg: "bg-slate-500/15", fg: "text-slate-600 dark:text-slate-400" },
};

const STATUS_DOT: Record<string, string> = {
  NEW: "bg-slate-400",
  TRIAGED: "bg-slate-400",
  ASSIGNED: "bg-amber-500",
  IN_PROGRESS: "bg-amber-500",
  WAITING_ON_REQUESTER: "bg-blue-500",
  WAITING_ON_VENDOR: "bg-blue-500",
  RESOLVED: "bg-emerald-500",
  CLOSED: "bg-slate-400",
  REOPENED: "bg-rose-500",
};

export function TicketTabBar({ onSwitchTab }: TicketTabBarProps) {
  const {
    tabs,
    activeTabId,
    switchTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    reorderTabs,
  } = useTicketTabs();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: "before" | "after";
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

  function handleAuxClick(e: React.MouseEvent, tabId: string) {
    // Middle-click closes the tab — matches browser convention.
    if (e.button === 1) {
      e.preventDefault();
      handleClose(e, tabId);
    }
  }

  function handleContextMenu(e: React.MouseEvent, tabId: string) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  }

  function handleCloseContextMenu() {
    setContextMenu(null);
  }

  return (
    <>
      <div className="relative flex items-end h-11 bg-slate-200 dark:bg-slate-900 border-b border-slate-300 dark:border-slate-800 pl-2 pr-1 select-none">
        {/* Queue (home) button */}
        <button
          type="button"
          onClick={handleSwitchToQueue}
          className={`flex items-center gap-1.5 h-9 px-3 mr-1.5 rounded-t-lg text-[12.5px] font-semibold transition-colors shrink-0 ${
            isQueueActive
              ? "bg-card text-foreground shadow-[inset_0_-1px_0_0_var(--background,white)]"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
          }`}
          title="Queue"
        >
          <Inbox
            className={`h-4 w-4 ${
              isQueueActive ? "text-primary" : "text-muted-foreground"
            }`}
          />
          <span>Queue</span>
          {tabs.length > 0 && (
            <span
              className={`text-[10px] font-bold tabular-nums min-w-[18px] text-center rounded-full px-1 leading-[18px] ${
                isQueueActive
                  ? "bg-primary/15 text-primary"
                  : "bg-foreground/10 text-muted-foreground"
              }`}
            >
              {tabs.length}
            </span>
          )}
        </button>

        {/* Scrollable ticket tabs */}
        <div
          ref={scrollRef}
          className="flex items-end gap-0.5 overflow-x-auto flex-1 min-w-0 [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const isDragging = draggingTabId === tab.id;
            const isDropTargetBefore =
              dropTarget?.id === tab.id &&
              dropTarget.position === "before" &&
              draggingTabId !== tab.id;
            const isDropTargetAfter =
              dropTarget?.id === tab.id &&
              dropTarget.position === "after" &&
              draggingTabId !== tab.id;
            const priorityStyle =
              PRIORITY_STYLE[tab.priority] ?? PRIORITY_STYLE.P4;
            const statusDot = STATUS_DOT[tab.status] ?? "bg-slate-400";
            return (
              <div
                key={tab.id}
                draggable
                onClick={() => handleSwitchToTicket(tab)}
                onAuxClick={(e) => handleAuxClick(e, tab.id)}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                onDragStart={(e) => {
                  setDraggingTabId(tab.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", tab.id);
                }}
                onDragOver={(e) => {
                  if (!draggingTabId || draggingTabId === tab.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  // Decide insertion side from the cursor's X relative to
                  // the target tab's midpoint — Chrome/VS Code-style.
                  const rect = e.currentTarget.getBoundingClientRect();
                  const isLeftHalf =
                    e.clientX < rect.left + rect.width / 2;
                  setDropTarget({
                    id: tab.id,
                    position: isLeftHalf ? "before" : "after",
                  });
                }}
                onDragLeave={() => {
                  setDropTarget((prev) =>
                    prev?.id === tab.id ? null : prev,
                  );
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const fromId = e.dataTransfer.getData("text/plain");
                  const target = dropTarget;
                  if (fromId && target && fromId !== target.id) {
                    reorderTabs(fromId, target.id, target.position);
                  }
                  setDraggingTabId(null);
                  setDropTarget(null);
                }}
                onDragEnd={() => {
                  setDraggingTabId(null);
                  setDropTarget(null);
                }}
                className={`group relative flex items-center gap-1.5 h-9 pl-2.5 pr-1.5 rounded-t-lg text-[12.5px] transition-colors min-w-0 max-w-[260px] shrink-0 ${
                  isActive
                    ? "bg-card text-foreground font-medium shadow-[inset_0_-1px_0_0_var(--background,white)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                } ${
                  isDragging
                    ? "opacity-60 cursor-grabbing"
                    : draggingTabId
                      ? "cursor-grabbing"
                      : "cursor-grab active:cursor-grabbing"
                }`}
              >
                {/* Drop-target indicator: a primary-color stripe on the
                    edge of the tab the user is hovering toward. Sides
                    flip based on cursor position so the user sees the
                    exact insertion point. */}
                {isDropTargetBefore && (
                  <span
                    className="absolute -left-px top-1 bottom-0 w-0.5 rounded-full bg-primary shadow-[0_0_4px_rgba(0,0,0,0.1)]"
                    aria-hidden
                  />
                )}
                {isDropTargetAfter && (
                  <span
                    className="absolute -right-px top-1 bottom-0 w-0.5 rounded-full bg-primary shadow-[0_0_4px_rgba(0,0,0,0.1)]"
                    aria-hidden
                  />
                )}
                {/* Priority chip */}
                <span
                  className={`flex-none h-[18px] px-1 rounded text-[10px] font-bold tabular-nums tracking-tight grid place-items-center ${priorityStyle.bg} ${priorityStyle.fg}`}
                >
                  {tab.priority}
                </span>

                {/* Status dot */}
                <span
                  className={`h-1.5 w-1.5 rounded-full flex-none ${statusDot}`}
                  aria-hidden
                />

                {/* ID + Subject */}
                <span className="flex items-baseline gap-1.5 min-w-0 flex-1">
                  <span
                    className={`font-mono text-[10px] flex-none ${
                      isActive
                        ? "text-muted-foreground"
                        : "text-muted-foreground/70"
                    }`}
                  >
                    {tab.displayId}
                  </span>
                  <span className="truncate">{tab.subject}</span>
                </span>

                {/* Close */}
                <button
                  type="button"
                  onClick={(e) => handleClose(e, tab.id)}
                  className={`shrink-0 h-5 w-5 rounded grid place-items-center transition-all ${
                    isActive
                      ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  }`}
                  aria-label={`Close ${tab.displayId}`}
                  title="Close tab"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Close all */}
        {tabs.length >= 2 && (
          <button
            type="button"
            onClick={() => {
              closeAllTabs();
              onSwitchTab(null);
            }}
            className="ml-1 h-9 px-2 grid place-items-center text-[11px] text-muted-foreground/70 hover:text-destructive transition-colors shrink-0 rounded-md hover:bg-accent/40"
            title="Close all tabs"
          >
            <X className="h-3.5 w-3.5" />
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
            className="fixed z-[9999] rounded-xl border border-border bg-popover shadow-xl py-1.5 min-w-[180px] backdrop-blur-md"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            <ContextMenuItem
              label="Close tab"
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
                label="Close other tabs"
                onClick={() => {
                  const tabId = contextMenu.tabId;
                  handleCloseContextMenu();
                  closeOtherTabs(tabId);
                  switchTab(tabId);
                  onSwitchTab(tabId);
                }}
              />
            )}
            <div className="my-1 h-px bg-border/60 mx-2" />
            <ContextMenuItem
              label="Close all tabs"
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
      type="button"
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
