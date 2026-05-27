import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  UserPlus,
  Activity,
  ArrowUpCircle,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
} from "lucide-react";
import type {
  TicketRecord,
  TicketStatus,
  TicketPriority,
} from "../api/client";
import { formatStatus, formatTicketId } from "../utils/format";
import { getUiZoom } from "../utils/uiZoom";

export type TicketContextMenuAction =
  | "open_new_tab"
  | "assign_me"
  | "status"
  | "priority"
  | "copy";

export type TicketContextMenuProps = {
  x: number;
  y: number;
  ticket: TicketRecord;
  onClose: () => void;
  /** value carries the chosen status/priority for the `status`/`priority` actions. */
  onAction: (
    action: TicketContextMenuAction,
    ticket: TicketRecord,
    value?: string,
  ) => void;
};

const STATUS_OPTIONS: TicketStatus[] = [
  "NEW",
  "TRIAGED",
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_ON_REQUESTER",
  "WAITING_ON_VENDOR",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
];

const PRIORITY_OPTIONS: { value: TicketPriority; label: string }[] = [
  { value: "SEV1", label: "SEV1 · Critical" },
  { value: "SEV2", label: "SEV2 · High" },
  { value: "SEV3", label: "SEV3 · Normal" },
  { value: "SEV4", label: "SEV4 · Low" },
];

const itemClass =
  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors text-left";

export function TicketContextMenu({
  x,
  y,
  ticket,
  onClose,
  onAction,
}: TicketContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [openSub, setOpenSub] = useState<"status" | "priority" | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // x/y are visual cursor coords; a fixed element renders at value*zoom, so
  // divide by the zoom to place the menu under the cursor. See getUiZoom().
  const z = getUiZoom();
  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(y, window.innerHeight - 360) / z,
    left: Math.min(x, window.innerWidth - 250) / z,
    zIndex: 100,
  };

  return createPortal(
    <div
      ref={menuRef}
      style={style}
      className="flex max-h-[calc(80vh/var(--ui-zoom))] w-56 flex-col gap-0.5 overflow-y-auto rounded-xl border border-border bg-popover/95 p-1.5 shadow-xl backdrop-blur-md animate-fade-in origin-top-left"
    >
      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-b border-border mb-1 truncate">
        {formatTicketId(ticket)}
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAction("open_new_tab", ticket);
          onClose();
        }}
        className={itemClass}
      >
        <ExternalLink className="h-4 w-4 text-slate-400 shrink-0" />
        Open in new tab
      </button>

      <div className="my-0.5 border-b border-border" />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAction("assign_me", ticket);
          onClose();
        }}
        className={itemClass}
      >
        <UserPlus className="h-4 w-4 text-slate-400 shrink-0" />
        Assign to Me
      </button>

      {/* Change Status (expandable) */}
      <button
        type="button"
        aria-expanded={openSub === "status"}
        onClick={(e) => {
          e.stopPropagation();
          setOpenSub((prev) => (prev === "status" ? null : "status"));
        }}
        className={itemClass}
      >
        <Activity className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="flex-1">Change Status</span>
        <ChevronRight
          className={`h-3.5 w-3.5 text-slate-400 transition-transform ${openSub === "status" ? "rotate-90" : ""}`}
        />
      </button>
      {openSub === "status" ? (
        <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-1.5">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAction("status", ticket, s);
                onClose();
              }}
              className={`${itemClass} text-[13px]`}
            >
              <span className="flex-1">{formatStatus(s)}</span>
              {ticket.status === s ? (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* Change Priority (expandable) */}
      <button
        type="button"
        aria-expanded={openSub === "priority"}
        onClick={(e) => {
          e.stopPropagation();
          setOpenSub((prev) => (prev === "priority" ? null : "priority"));
        }}
        className={itemClass}
      >
        <ArrowUpCircle className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="flex-1">Change Priority</span>
        <ChevronRight
          className={`h-3.5 w-3.5 text-slate-400 transition-transform ${openSub === "priority" ? "rotate-90" : ""}`}
        />
      </button>
      {openSub === "priority" ? (
        <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-1.5">
          {PRIORITY_OPTIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAction("priority", ticket, p.value);
                onClose();
              }}
              className={`${itemClass} text-[13px]`}
            >
              <span className="flex-1">{p.label}</span>
              {ticket.priority === p.value ? (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="my-0.5 border-b border-border" />

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAction("copy", ticket);
          onClose();
        }}
        className={itemClass}
      >
        <Copy className="h-4 w-4 text-slate-400 shrink-0" />
        Copy Ticket ID
      </button>
    </div>,
    document.body,
  );
}
