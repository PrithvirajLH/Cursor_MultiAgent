import { useState } from "react";
import type { TicketRecord } from "../api/client";
import { RelativeTime } from "./RelativeTime";
import {
  formatStatus,
  formatTicketId,
  getSlaTone,
  priorityBadgeClass,
  statusBadgeClass,
} from "../utils/format";
import { TicketContextMenu } from "./TicketContextMenu";
import { useToast } from "../hooks/useToast";

/**
 * For AI-generated tickets, extracts only the original user message.
 * Handles both Agent 4 format and buildDescription format.
 */
function extractOriginalMessage(description: string): string {
  // Try markdown bold format
  const mdMarker = "**Original message:**";
  const mdIdx = description.indexOf(mdMarker);
  if (mdIdx !== -1) {
    return description.substring(mdIdx + mdMarker.length).trim();
  }
  // Try plain format from Agent 4
  const plainMarker = "Original message:";
  const plainIdx = description.indexOf(plainMarker);
  if (plainIdx !== -1) {
    return description.substring(plainIdx + plainMarker.length).trim();
  }
  // Strip "Facility: ..." prefix for legacy tickets
  const lines = description.split("\n");
  if (lines[0]?.startsWith("Facility:")) {
    return lines.slice(2).join("\n").trim();
  }
  return description;
}

type TicketTableViewProps = {
  tickets: TicketRecord[];
  role: string;
  focusedTicketId?: string | null;
  selection: {
    isSelected: (id: string) => boolean;
    toggle: (id: string) => void;
    toggleAll: () => void;
    isAllSelected: boolean;
  };
  onRowClick: (ticket: TicketRecord, opts?: { newTab?: boolean }) => void;
};

export function TicketTableView({
  tickets,
  role,
  focusedTicketId,
  selection,
  onRowClick,
}: TicketTableViewProps) {
  const showCheckbox = role !== "EMPLOYEE";
  const toast = useToast();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    ticket: TicketRecord;
  } | null>(null);

  const handleContextMenu = (e: React.MouseEvent, ticket: TicketRecord) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, ticket });
  };

  const handleContextAction = (
    action: "open_new_tab" | "assign_me" | "status" | "priority" | "copy",
    ticket: TicketRecord,
  ) => {
    if (action === "open_new_tab") {
      onRowClick(ticket, { newTab: true });
      return;
    }
    if (action === "copy") {
      void navigator.clipboard.writeText(ticket.id);
      toast.success("Ticket ID copied to clipboard");
    } else {
      toast.info(
        `Action '${action}' selected for ticket ${formatTicketId(ticket)}`,
      );
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px]">
        <thead className="border-b border-border bg-card">
          <tr>
            {showCheckbox ? (
              <th className="w-12 px-6 py-4 text-left">
                <input
                  type="checkbox"
                  checked={selection.isAllSelected}
                  onChange={selection.toggleAll}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30 transition accent-primary"
                  aria-label="Select all tickets"
                />
              </th>
            ) : null}
            <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              ID
            </th>
            <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Subject
            </th>
            <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Requester
            </th>
            <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Priority
            </th>
            <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Status
            </th>
            <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Assignee
            </th>
            <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Created
            </th>
            <th className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              SLA
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {tickets.map((ticket) => {
            const sla = getSlaTone({
              dueAt: ticket.dueAt,
              completedAt: ticket.completedAt,
              status: ticket.status,
              slaPausedAt: ticket.slaPausedAt,
            });
            const requesterName =
              ticket.requester?.displayName ??
              ticket.requester?.email ??
              "Unknown";
            const assigneeName =
              ticket.assignee?.displayName ??
              ticket.assignee?.email ??
              "Unassigned";
            const snippet = ticket.description
              ? extractOriginalMessage(ticket.description.trim())
              : ticket.category?.name || "No additional details";
            const selected = selection.isSelected(ticket.id);
            const focused = focusedTicketId === ticket.id;
            return (
              <tr
                key={ticket.id}
                onClick={(event) => {
                  // Cmd/Ctrl+click → open in a new tab (browser convention).
                  const newTab = event.metaKey || event.ctrlKey;
                  onRowClick(ticket, { newTab });
                }}
                onAuxClick={(event) => {
                  // Middle-click → open in a new tab.
                  if (event.button === 1) {
                    event.preventDefault();
                    onRowClick(ticket, { newTab: true });
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, ticket)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRowClick(ticket, {
                      newTab: event.metaKey || event.ctrlKey,
                    });
                  }
                }}
                role="button"
                tabIndex={0}
                aria-selected={selected || focused}
                className={`cursor-pointer text-sm transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.05] ${
                  selected
                    ? "bg-primary/5 border-transparent z-10 relative shadow-[inset_2px_0_0_0_hsl(var(--primary))]"
                    : focused
                      ? "bg-white/[0.05]"
                      : "bg-transparent"
                }`}
              >
                {showCheckbox ? (
                  <td
                    className="px-6 py-4"
                    onClick={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      selection.toggle(ticket.id);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => {}}
                      onClick={(event) => event.stopPropagation()}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30 transition accent-primary"
                      aria-label={`Select ticket ${ticket.subject}`}
                    />
                  </td>
                ) : null}
                <td className="whitespace-nowrap px-6 py-4">
                  <span className="text-xs font-medium text-muted-foreground font-mono">
                    {formatTicketId(ticket)}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <p className="max-w-lg truncate text-sm font-semibold text-foreground leading-tight">
                    {ticket.subject}
                  </p>
                  <p className="max-w-lg truncate text-sm text-muted-foreground mt-0.5">
                    {snippet}
                  </p>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-foreground/80">
                  {requesterName}
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${priorityBadgeClass(ticket.priority)}`}
                  >
                    {ticket.priority ?? "SEV3"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(ticket.status)}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full bg-current`} />
                    {formatStatus(ticket.status)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-foreground/70">
                  {assigneeName}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-muted-foreground">
                  <RelativeTime value={ticket.createdAt} />
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${sla.className}`}
                  >
                    {sla.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {contextMenu && (
        <TicketContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          ticket={contextMenu.ticket}
          onClose={() => setContextMenu(null)}
          onAction={handleContextAction}
        />
      )}
    </div>
  );
}
