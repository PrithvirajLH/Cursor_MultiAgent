import {
  shouldRowKeyActivate,
  ticketSelectionCellWiring,
} from "./ticket-selection-cell";
import { useState } from "react";
import {
  assignTicket,
  bulkPriorityTickets,
  transitionTicket,
  type TicketRecord,
  type TicketStatus,
} from "../api/client";
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
 * Handles both Agent 4 format and buildDescription format. Everything else is
 * returned verbatim — the "Facility:" two-line strip was removed 2026-09-01
 * (see the matching note in TicketDetailPage.tsx).
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
  /** Called after a context-menu mutation (assign/status/priority) so the parent can refetch. */
  onTicketMutated?: () => void;
};

export function TicketTableView({
  tickets,
  role,
  focusedTicketId,
  selection,
  onRowClick,
  onTicketMutated,
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

  const handleContextAction = async (
    action: "open_new_tab" | "assign_me" | "status" | "priority" | "copy",
    ticket: TicketRecord,
    value?: string,
  ) => {
    if (action === "open_new_tab") {
      onRowClick(ticket, { newTab: true });
      return;
    }
    if (action === "copy") {
      // Copy the human-readable display ID (e.g. WG_20260503_014), not the UUID.
      void navigator.clipboard.writeText(
        ticket.displayId ?? formatTicketId(ticket),
      );
      toast.success("Ticket ID copied to clipboard");
      return;
    }
    try {
      if (action === "assign_me") {
        await assignTicket(ticket.id, {}); // empty payload = assign to current user
        toast.success("Assigned to you.");
      } else if (action === "status" && value) {
        await transitionTicket(ticket.id, { status: value as TicketStatus });
        toast.success(`Status changed to ${formatStatus(value)}.`);
      } else if (action === "priority" && value) {
        await bulkPriorityTickets([ticket.id], value);
        toast.success(`Priority changed to ${value}.`);
      } else {
        return;
      }
      onTicketMutated?.();
    } catch {
      toast.error("Unable to update the ticket.");
    }
  };

  return (
    <div className="overflow-x-auto">
      <table aria-label="Tickets" className="w-full min-w-[1180px]">
        <thead className="border-b border-border bg-card">
          <tr>
            {showCheckbox ? (
              <th scope="col" className="w-12 px-6 py-4 text-left">
                <input
                  type="checkbox"
                  checked={selection.isAllSelected}
                  onChange={selection.toggleAll}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30 transition accent-primary"
                  aria-label="Select all tickets"
                />
              </th>
            ) : null}
            <th scope="col" className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              ID
            </th>
            <th scope="col" className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Subject
            </th>
            <th scope="col" className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Requester
            </th>
            <th scope="col" className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Priority
            </th>
            <th scope="col" className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Status
            </th>
            <th scope="col" className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Assignee
            </th>
            <th scope="col" className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Created
            </th>
            <th scope="col" className="px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
            const selectionWiring = ticketSelectionCellWiring(
              ticket.id,
              selection.toggle,
            );
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
                  // ⚠️ Card 1.49, second half. The row is a button, so Space
                  // and Enter open the ticket - but the select-me checkbox
                  // lives INSIDE the row, and Space on a focused checkbox is
                  // how a keyboard user ticks it. Without this guard the key
                  // both toggled the box and navigated away from the list,
                  // which is worse than the dead control it replaced: the
                  // selection was made and then immediately abandoned.
                  //
                  // Found by pressing Space in the browser. The click fix
                  // alone did not cover it, because this is a different
                  // handler on a different element.
                  if (!shouldRowKeyActivate(event)) {
                    return;
                  }
                  event.preventDefault();
                  onRowClick(ticket, {
                    newTab: event.metaKey || event.ctrlKey,
                  });
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
                  /*
                    Card 1.49. The handlers come from
                    `ticketSelectionCellWiring` rather than being written
                    inline, because this control was DEAD and no test could
                    see it: the input's onChange was `() => {}` and its
                    onClick stopped the click before it reached the only
                    handler that acted, so the box did nothing and Space did
                    nothing, while the padding beside it worked. There is no
                    jsdom in this project's vitest, so a plain function is
                    what makes the wiring assertable at all.
                  */
                  <td className="px-6 py-4" {...selectionWiring.cell}>
                    <input
                      type="checkbox"
                      checked={selected}
                      {...selectionWiring.input}
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
                  <div className="flex max-w-lg items-center gap-2">
                    {/*
                      Card 1.29: the requester spoke last, so the next move is
                      ours. Quiet enough to scan a column for, not a klaxon —
                      and it comes off the row from the server, so it is still
                      here after a reload. Sits inside the subject cell, which
                      is already two lines tall, so the SEV / reference /
                      status cells beside it do not move.
                    */}
                    {/*
                      Card 1.10: a follow-up that has come due and not yet been
                      cleared by the scheduler. Same quiet treatment as the
                      replied marker, in the same cell, so no column moves.
                    */}
                    {ticket.followUpAt &&
                    new Date(ticket.followUpAt).getTime() <= Date.now() ? (
                      <span
                        data-follow-up-due="true"
                        title={`Follow-up was due ${new Date(ticket.followUpAt).toLocaleString()}`}
                        className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                      >
                        Follow-up
                      </span>
                    ) : null}
                    {ticket.awaitingAgentReply ? (
                      <span
                        data-awaiting-agent-reply="true"
                        title="The requester replied — this one is waiting on us"
                        className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary"
                      >
                        Replied
                      </span>
                    ) : null}
                    <p className="truncate text-sm font-semibold text-foreground leading-tight">
                      {ticket.subject}
                    </p>
                  </div>
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
