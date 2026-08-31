import { Link } from "react-router-dom";
import type { TicketRecord } from "../../api/client";
import { RelativeTime } from "../RelativeTime";
import { formatStatus } from "../../utils/format";
import { statusBadgeClass } from "../../utils/statusColors";

/** Rows shown before the "see all" link takes over. */
const MAX_ROWS = 5;
const SKELETON_ROWS = 3;

type RequesterHistoryListProps = {
  rows: TicketRecord[];
  /** Total matching tickets for this requester, including the one being viewed. */
  total: number;
  currentTicketId: string;
  requesterId: string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
};

/**
 * Presentational body of the requester-history panel: loading, error, empty and
 * list states. Split out from the panel so it can be asserted without a query
 * client or a DOM (the web tests render to static markup in Node).
 *
 * Rows link by ticket **id** — the detail route resolves a uuid, not a display
 * id — and open in a new tab so the agent keeps the ticket they are working on.
 */
export function RequesterHistoryList({
  rows,
  total,
  currentTicketId,
  requesterId,
  loading,
  error,
  onRetry,
}: RequesterHistoryListProps) {
  if (loading) {
    return (
      <div className="space-y-2 px-4 pb-3" aria-hidden>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="h-3 w-16 rounded skeleton-shimmer" />
            <div className="h-3 flex-1 rounded skeleton-shimmer" />
            <div className="h-4 w-12 rounded-full skeleton-shimmer" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 pb-3">
        <p className="text-xs text-muted-foreground">
          Couldn&apos;t load this person&apos;s other tickets
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 text-xs font-medium text-primary hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  const others = rows.filter((ticket) => ticket.id !== currentTicketId);
  const visible = others.slice(0, MAX_ROWS);
  // `total` counts the ticket being viewed too — it always matches the filter.
  const otherTotal = Math.max(others.length, total - 1);

  if (visible.length === 0) {
    return (
      <div className="px-4 pb-3">
        <p className="text-xs italic text-muted-foreground/60">
          No other tickets from this person.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-3">
      <ul className="divide-y divide-border/50">
        {visible.map((ticket) => (
          <li key={ticket.id}>
            <a
              href={`/tickets/${ticket.id}`}
              target="_blank"
              rel="noopener noreferrer"
              title={ticket.subject}
              className="flex items-center gap-2 py-2 hover:bg-accent/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="font-mono text-[10px] text-muted-foreground">
                {ticket.displayId ?? `#${ticket.number}`}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                {ticket.subject}
              </span>
              <span
                className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusBadgeClass(ticket.status)}`}
              >
                {formatStatus(ticket.status)}
              </span>
              <RelativeTime
                value={ticket.updatedAt}
                variant="compact"
                className="flex-shrink-0 text-[10px] text-muted-foreground"
              />
            </a>
          </li>
        ))}
      </ul>
      {otherTotal > visible.length && (
        <Link
          to={`/tickets?requesterIds=${requesterId}&statusGroup=all`}
          className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
        >
          See all {otherTotal} tickets from this person
        </Link>
      )}
    </div>
  );
}
