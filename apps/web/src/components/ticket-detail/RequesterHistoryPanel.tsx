import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { fetchTickets } from "../../api/client";
import { RequesterHistoryList } from "./RequesterHistoryList";

/** Six fetched, five shown — the sixth only tells us whether to offer "see all". */
const FETCH_SIZE = 6;
const STALE_TIME_MS = 60_000;

type RequesterHistoryPanelProps = {
  requesterId: string;
  currentTicketId: string;
  expanded: boolean;
  onToggle: () => void;
};

/**
 * "Other tickets from this requester" — the question every agent asks before
 * replying. Collapsed by default and the query is `enabled` only while open, so
 * a ticket's first paint makes no extra request. The list endpoint applies the
 * caller's own access filter, so this shows only tickets they could already
 * open.
 */
export function RequesterHistoryPanel({
  requesterId,
  currentTicketId,
  expanded,
  onToggle,
}: RequesterHistoryPanelProps) {
  const historyQuery = useQuery({
    queryKey: ["requester-history", requesterId],
    queryFn: () =>
      fetchTickets({
        requesterIds: [requesterId],
        statusGroup: "all",
        pageSize: FETCH_SIZE,
        sort: "updatedAt",
        order: "desc",
      }),
    enabled: expanded && Boolean(requesterId),
    staleTime: STALE_TIME_MS,
  });
  const rows = historyQuery.data?.data ?? [];
  const total = historyQuery.data?.meta.total ?? rows.length;
  // The ticket being viewed always matches this filter and is always visible to
  // the viewer, so the others are simply `total - 1` — whether or not it landed
  // inside the fetched page. `total` is already access-filtered by the API.
  const countLabel = historyQuery.data ? Math.max(0, total - 1) : null;

  return (
    <div className="rounded-xl border border-border bg-card shadow-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-accent/30 transition-colors"
      >
        <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
          Other tickets from this requester
          {countLabel !== null && (
            <span className="ml-1.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground/60">
              ({countLabel})
            </span>
          )}
        </h4>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <RequesterHistoryList
          rows={rows}
          total={total}
          currentTicketId={currentTicketId}
          requesterId={requesterId}
          loading={historyQuery.isLoading}
          error={historyQuery.isError}
          onRetry={() => void historyQuery.refetch()}
        />
      )}
    </div>
  );
}
