import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Inbox } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { useTicketTabs, type TicketTab } from "../contexts/TicketTabsContext";
import { getUiZoom } from "../utils/uiZoom";

type TicketTabBarProps = {
  onSwitchTab: (ticketId: string | null) => void;
};

const PRIORITY_STYLE: Record<string, { bg: string; fg: string }> = {
  SEV1: { bg: "bg-red-500/15", fg: "text-red-600 dark:text-red-400" },
  SEV2: { bg: "bg-orange-500/15", fg: "text-orange-600 dark:text-orange-400" },
  SEV3: { bg: "bg-blue-500/15", fg: "text-blue-600 dark:text-blue-400" },
  SEV4: { bg: "bg-slate-500/15", fg: "text-slate-600 dark:text-slate-400" },
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
  const isQueueActive = activeTabId === null || activeTabId === "__queue__";

  // Keep the active tab visible — when it changes (or a hidden tab is
  // activated by sidebar/list navigation), scroll the strip so the
  // active tab is in the visible area. Otherwise it can sit off-screen
  // while the count badge says e.g. "3" with only 2 tabs in view.
  useEffect(() => {
    if (!activeTabId || activeTabId === "__queue__") return;
    const strip = scrollRef.current;
    if (!strip) return;
    const node = strip.querySelector<HTMLElement>(
      `[data-tab-id="${activeTabId}"]`,
    );
    if (node) {
      node.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [activeTabId]);

  // 5px activation distance lets the click handler fire when the user
  // just clicks; only when they actually move the mouse does drag start.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIdx = tabs.findIndex((t) => t.id === active.id);
    const toIdx = tabs.findIndex((t) => t.id === over.id);
    if (fromIdx === -1 || toIdx === -1) return;
    // Mirror Chrome behavior: dragging right inserts after, dragging
    // left inserts before. dnd-kit's collision detection picks the
    // closest center, so this gives a natural insertion point.
    const position = fromIdx < toIdx ? "after" : "before";
    reorderTabs(active.id as string, over.id as string, position);
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

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={tabs.map((t) => t.id)}
            strategy={horizontalListSortingStrategy}
          >
            {/* Scrollable ticket tabs — Chrome-style: tabs flush together
                with vertical dividers between inactive ones, active tab
                "lifts" out of the strip via card bg + soft shadow.
                Vertical mouse-wheel input is translated to horizontal
                scroll so you can flip through tabs without a trackpad. */}
            <div
              ref={scrollRef}
              className="flex items-end overflow-x-auto flex-1 min-w-0 [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none" }}
              onWheel={(e) => {
                // Only re-route purely-vertical wheels; let trackpads
                // pass through so two-finger horizontal scroll still
                // works natively.
                if (
                  Math.abs(e.deltaY) > Math.abs(e.deltaX) &&
                  e.currentTarget.scrollWidth > e.currentTarget.clientWidth
                ) {
                  e.currentTarget.scrollLeft += e.deltaY;
                  e.preventDefault();
                }
              }}
            >
              {tabs.map((tab, idx) => {
                const isActive = tab.id === activeTabId;
                const next = tabs[idx + 1];
                const nextActive = next ? next.id === activeTabId : false;
                // Render the vertical divider between two consecutive
                // inactive tabs only — touching an active tab would
                // look noisy. The last inactive tab also drops it.
                const showDivider =
                  !isActive && next != null && !nextActive;
                return (
                  <SortableTab
                    key={tab.id}
                    tab={tab}
                    isActive={isActive}
                    showDivider={showDivider}
                    onClick={() => handleSwitchToTicket(tab)}
                    onAuxClick={(e) => handleAuxClick(e, tab.id)}
                    onContextMenu={(e) => handleContextMenu(e, tab.id)}
                    onClose={(e) => handleClose(e, tab.id)}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

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

      {/* Context menu — portal to body so `fixed` is viewport-relative (escapes
          any transformed/filtered ancestor) and divide cursor coords by the
          zoom so it lands under the pointer. See getUiZoom(). */}
      {contextMenu &&
        createPortal(
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={handleCloseContextMenu}
          />
          <div
            className="fixed z-[9999] rounded-xl border border-border bg-popover shadow-xl py-1.5 min-w-[180px] backdrop-blur-md"
            style={{
              top: contextMenu.y / getUiZoom(),
              left: contextMenu.x / getUiZoom(),
            }}
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
        </>,
        document.body,
      )}
    </>
  );
}

/* ─── Sortable wrapper for each tab ──────────────────────────────── */

interface SortableTabProps {
  tab: TicketTab;
  isActive: boolean;
  showDivider: boolean;
  onClick: () => void;
  onAuxClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onClose: (e: React.MouseEvent) => void;
}

function SortableTab({
  tab,
  isActive,
  showDivider,
  onClick,
  onAuxClick,
  onContextMenu,
  onClose,
}: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // While dragging, lift the tab visually with a small shadow +
        // higher z-index so it floats above neighbours. The transform
        // from useSortable carries the tab to the cursor naturally —
        // no DragOverlay required, which avoided a coordinate-offset
        // bug we saw with portaled overlays.
        zIndex: isDragging ? 50 : undefined,
        boxShadow: isDragging
          ? "0 6px 18px rgba(0,0,0,0.18)"
          : undefined,
        cursor: isDragging ? "grabbing" : "grab",
      }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      onAuxClick={onAuxClick}
      onContextMenu={onContextMenu}
      data-tab-id={tab.id}
      className="shrink-0 rounded-t-lg"
    >
      <TabContent
        tab={tab}
        isActive={isActive}
        showDivider={showDivider && !isDragging}
        onClose={onClose}
        dragging={isDragging}
      />
    </div>
  );
}

/* ─── Tab visual content ─────────────────────────────────────────── */

interface TabContentProps {
  tab: TicketTab;
  isActive: boolean;
  showDivider?: boolean;
  onClose?: (e: React.MouseEvent) => void;
  dragging?: boolean;
}

function TabContent({
  tab,
  isActive,
  showDivider,
  onClose,
  dragging,
}: TabContentProps) {
  const priorityStyle = PRIORITY_STYLE[tab.priority] ?? PRIORITY_STYLE.SEV4;
  const statusDot = STATUS_DOT[tab.status] ?? "bg-slate-400";

  return (
    <div
      className={`group relative flex items-center gap-1.5 h-9 pl-3 pr-1.5 rounded-t-[10px] text-[12.5px] min-w-0 max-w-[260px] ${
        dragging
          ? "bg-card text-foreground shadow-md"
          : isActive
            ? "bg-card text-foreground font-medium shadow-[inset_0_-1px_0_0_var(--background,white)]"
            : "text-muted-foreground hover:text-foreground hover:bg-card/60"
      }`}
    >
      {/* Subtle Chrome-style "ears" at the active tab's bottom corners
          — small 6×6 quarter-circle curves filled with the card color
          so the tab visually blends into the content area below. */}
      {(isActive || dragging) && (
        <>
          <svg
            className="absolute -left-[6px] bottom-0 pointer-events-none"
            width="6"
            height="6"
            viewBox="0 0 6 6"
            aria-hidden
          >
            <path
              d="M 6 0 L 6 6 L 0 6 A 6 6 0 0 1 6 0 Z"
              fill="hsl(var(--card))"
            />
          </svg>
          <svg
            className="absolute -right-[6px] bottom-0 pointer-events-none"
            width="6"
            height="6"
            viewBox="0 0 6 6"
            aria-hidden
          >
            <path
              d="M 0 0 L 0 6 L 6 6 A 6 6 0 0 0 0 0 Z"
              fill="hsl(var(--card))"
            />
          </svg>
        </>
      )}

      {/* Vertical divider between consecutive inactive tabs (Chrome). */}
      {showDivider && (
        <span
          className="absolute right-0 top-2 bottom-2 w-px bg-slate-300/60 dark:bg-slate-700"
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
            isActive ? "text-muted-foreground" : "text-muted-foreground/70"
          }`}
        >
          {tab.displayId}
        </span>
        <span className="truncate">{tab.subject}</span>
      </span>

      {/* Close — hidden in overlay (no interaction during drag) */}
      {onClose && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
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
      )}
    </div>
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
