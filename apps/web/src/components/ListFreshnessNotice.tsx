import { WifiOff } from "lucide-react";

type ListFreshnessNoticeProps = {
  readonly connected: boolean;
  /** ISO timestamp of the last successful list load, or null before the first. */
  readonly lastUpdatedAt: string | null;
};

/** "11:42" from an ISO timestamp; null when there is nothing sensible to show. */
function formatClockTime(lastUpdatedAt: string | null): string | null {
  if (!lastUpdatedAt) return null;
  const parsed = new Date(lastUpdatedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Says the list is not live — and says nothing at all when it is.
 *
 * A connected queue renders no badge, no green dot, no reassurance: a status
 * that is present all day stops being read, and the only thing worth an agent's
 * attention here is the case where new tickets are no longer arriving on their
 * own. Connection state only — never an error body, a URL or a token.
 */
export function ListFreshnessNotice({
  connected,
  lastUpdatedAt,
}: ListFreshnessNoticeProps) {
  if (connected) return null;
  const clockTime = formatClockTime(lastUpdatedAt);
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
      <span>
        Reconnecting…{" "}
        {clockTime
          ? `list last updated ${clockTime}`
          : "list may be out of date"}
      </span>
    </span>
  );
}
