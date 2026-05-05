import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchTickets, type TicketRecord } from "../api/client";
import { useFilters } from "../hooks/useFilters";
import { useAuthSession } from "../hooks/useAuthSession";
import {
  priorityBadgeClass,
  statusBadgeClass,
} from "./ticket-detail/utils";
import { formatStatus, formatTicketId } from "../utils/format";

interface TicketDetailMidListProps {
  /** Ticket id of the row that should appear highlighted (the one currently open). */
  currentTicketId: string | undefined;
  /**
   * If provided, called instead of navigating — used when the detail is
   * embedded inside the queue tab so we just swap the active ticket.
   */
  onSelectTicket?: (id: string) => void;
}

/**
 * Compact ticket-list rail rendered to the left of the detail panes.
 *
 * Reuses `useFilters` so URL params keep this list in sync with `/tickets`.
 * The query key (`tickets-mid-list`) is separate from the queue table's
 * local-state list so we don't fight TicketsPage's optimistic patching.
 */
export function TicketDetailMidList({
  currentTicketId,
  onSelectTicket,
}: TicketDetailMidListProps) {
  const { apiParams } = useFilters();
  const { user, loading: authLoading } = useAuthSession();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["tickets-mid-list", apiParams],
    queryFn: ({ signal }) => fetchTickets(apiParams, { signal }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled: !!user && !authLoading,
  });

  const rows = useMemo(() => data?.data ?? [], [data]);

  if (isLoading && rows.length === 0) {
    return (
      <div className="p-3 text-[12px] text-muted-foreground">Loading…</div>
    );
  }
  if (isError) {
    return (
      <div className="p-3 text-[12px] text-red-600">Couldn't load list</div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="p-3 text-[12px] text-muted-foreground">
        No tickets match the current filters.
      </div>
    );
  }

  return (
    <ul className="flex flex-col">
      {rows.map((t) => (
        <MidListRow
          key={t.id}
          ticket={t}
          isCurrent={t.id === currentTicketId}
          onSelectTicket={onSelectTicket}
        />
      ))}
    </ul>
  );
}

function MidListRow({
  ticket,
  isCurrent,
  onSelectTicket,
}: {
  ticket: TicketRecord;
  isCurrent: boolean;
  onSelectTicket?: (id: string) => void;
}) {
  const requester =
    ticket.requester?.displayName ?? ticket.requester?.email ?? "—";
  const initials = toInitials(requester);
  const updated = relativeTime(ticket.updatedAt);

  const content = (
    <>
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${priorityBadgeClass(ticket.priority)}`}
        >
          {ticket.priority}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground truncate">
          {formatTicketId(ticket)}
        </span>
        <span className="flex-1" />
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusBadgeClass(ticket.status)}`}
        >
          {formatStatus(ticket.status)}
        </span>
      </div>
      <div
        className="text-[12.5px] font-medium leading-tight mb-1 text-foreground"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {ticket.subject || "(no subject)"}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-foreground/70 flex-none">
          {initials}
        </span>
        <span className="truncate flex-1">{requester}</span>
        <span className="font-mono">{updated}</span>
      </div>
    </>
  );

  const baseClass =
    "block w-full text-left px-3 py-2.5 border-b border-border transition-colors hover:bg-accent/40";
  const activeStyle = isCurrent
    ? { boxShadow: "inset 3px 0 0 0 hsl(var(--primary))" }
    : undefined;
  const activeBg = isCurrent ? "bg-primary/[0.06]" : "";

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelectTicket?.(ticket.id)}
        style={activeStyle}
        className={`${baseClass} ${activeBg}`}
      >
        {content}
      </button>
    </li>
  );
}

function toInitials(name: string | null | undefined): string {
  if (!name || name === "—") return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}
