import { useRef, useState } from "react";
import { X, Inbox } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
  type DragCancelEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import {
  restrictToHorizontalAxis,
  restrictToFirstScrollableAncestor,
} from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
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
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const isQueueActive = activeTabId === null || activeTabId === "__queue__";
  const draggingTab = draggingId
    ? tabs.find((t) => t.id === draggingId) ?? null
    : null;

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

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
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

  function handleDragCancel(_event: DragCancelEvent) {
    setDraggingId(null);
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
          modifiers={[
            // Lock the drag overlay to horizontal motion so the tab
            // can't drift up/down out of the bar — matches Chrome.
            restrictToHorizontalAxis,
            // Keep the overlay within the scrollable tab strip's bounds
            // so it doesn't fly off into the page chrome.
            restrictToFirstScrollableAncestor,
          ]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={tabs.map((t) => t.id)}
            strategy={horizontalListSortingStrategy}
          >
            {/* Scrollable ticket tabs */}
            <div
              ref={scrollRef}
              className="flex items-end gap-0.5 overflow-x-auto flex-1 min-w-0 [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none" }}
            >
              {tabs.map((tab) => (
                <SortableTab
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onClick={() => handleSwitchToTicket(tab)}
                  onAuxClick={(e) => handleAuxClick(e, tab.id)}
                  onContextMenu={(e) => handleContextMenu(e, tab.id)}
                  onClose={(e) => handleClose(e, tab.id)}
                />
              ))}
            </div>
          </SortableContext>

          {/* Floating tab that follows the cursor while dragging.
              dnd-kit handles positioning + smoothing for us. */}
          <DragOverlay
            dropAnimation={{
              duration: 200,
              easing: "cubic-bezier(0.2, 0, 0, 1)",
            }}
          >
            {draggingTab ? (
              <TabContent
                tab={draggingTab}
                isActive={draggingTab.id === activeTabId}
                isOverlay
              />
            ) : null}
          </DragOverlay>
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

/* ─── Sortable wrapper for each tab ──────────────────────────────── */

interface SortableTabProps {
  tab: TicketTab;
  isActive: boolean;
  onClick: () => void;
  onAuxClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onClose: (e: React.MouseEvent) => void;
}

function SortableTab({
  tab,
  isActive,
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
        // Hide the source while it's being dragged — DragOverlay renders
        // the floating copy. opacity:0 keeps the slot in place so
        // surrounding tabs don't snap; the SortableContext's transition
        // makes the gap glide as collisions change.
        opacity: isDragging ? 0 : 1,
      }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      onAuxClick={onAuxClick}
      onContextMenu={onContextMenu}
      className={`shrink-0 ${isDragging ? "z-10" : ""}`}
    >
      <TabContent tab={tab} isActive={isActive} onClose={onClose} />
    </div>
  );
}

/* ─── Tab visual content (used both inline and in DragOverlay) ──── */

interface TabContentProps {
  tab: TicketTab;
  isActive: boolean;
  onClose?: (e: React.MouseEvent) => void;
  isOverlay?: boolean;
}

function TabContent({ tab, isActive, onClose, isOverlay }: TabContentProps) {
  const priorityStyle = PRIORITY_STYLE[tab.priority] ?? PRIORITY_STYLE.P4;
  const statusDot = STATUS_DOT[tab.status] ?? "bg-slate-400";

  return (
    <div
      className={`group relative flex items-center gap-1.5 h-9 pl-2.5 pr-1.5 rounded-t-lg text-[12.5px] min-w-0 max-w-[260px] ${
        isActive
          ? "bg-card text-foreground font-medium shadow-[inset_0_-1px_0_0_var(--background,white)]"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
      } ${
        isOverlay
          ? "shadow-lg ring-1 ring-border bg-card text-foreground cursor-grabbing"
          : "cursor-grab active:cursor-grabbing"
      }`}
    >
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
      {!isOverlay && onClose && (
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
