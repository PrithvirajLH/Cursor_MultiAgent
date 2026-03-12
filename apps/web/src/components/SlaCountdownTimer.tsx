import { Clock } from "lucide-react";
import { useCountdown } from "../hooks/useCountdown";
import { RelativeTime } from "./RelativeTime";
import { formatDate, formatDateLong } from "../utils/format";

type SlaTimerTicket = {
  createdAt: string;
  dueAt?: string | null;
  firstResponseDueAt?: string | null;
  firstResponseAt?: string | null;
  completedAt?: string | null;
  status?: string | null;
  slaPausedAt?: string | null;
};

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

type State =
  | "on_track"
  | "caution"
  | "at_risk"
  | "breached"
  | "paused"
  | "met"
  | "no_sla";

function getState(
  remainingMs: number | null,
  isPast: boolean,
  isPaused: boolean,
  totalMs: number,
): State {
  if (isPaused) return "paused";
  if (remainingMs === null || totalMs <= 0) return "no_sla";
  if (isPast) return "breached";
  const pct = (remainingMs / totalMs) * 100;
  if (pct > 50) return "on_track";
  if (pct > 25) return "caution";
  if (pct > 0) return "at_risk";
  return "breached";
}

const STATE_STYLES: Record<
  State,
  { bar: string; text: string; pulse?: boolean; label: string }
> = {
  on_track: {
    bar: "bg-emerald-500",
    text: "text-emerald-700",
    label: "On track",
  },
  caution: {
    bar: "bg-amber-500",
    text: "text-amber-700",
    label: "Caution",
  },
  at_risk: {
    bar: "bg-orange-500",
    text: "text-orange-700",
    pulse: true,
    label: "At risk",
  },
  breached: {
    bar: "bg-rose-500",
    text: "text-rose-700",
    label: "Breached",
  },
  paused: {
    bar: "bg-slate-300",
    text: "text-slate-600",
    label: "Paused",
  },
  met: {
    bar: "bg-emerald-500",
    text: "text-emerald-700",
    label: "Met",
  },
  no_sla: {
    bar: "bg-slate-200",
    text: "text-slate-500",
    label: "No SLA",
  },
};

type SlaCountdownTimerProps = {
  type: "first_response" | "resolution";
  ticket: SlaTimerTicket | null;
  className?: string;
};

export function SlaCountdownTimer({
  type,
  ticket,
  className = "",
}: SlaCountdownTimerProps) {
  const isFirstResponse = type === "first_response";
  const title = isFirstResponse ? "First Response SLA" : "Resolution SLA";

  if (!ticket) {
    return (
      <div
        className={`rounded-2xl border border-slate-200 bg-slate-50/80 p-4 ${className}`}
      >
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        <p className="text-xs text-slate-500 mt-1">No SLA data</p>
      </div>
    );
  }

  const isPaused =
    !isFirstResponse &&
    (ticket.status === "WAITING_ON_REQUESTER" ||
      ticket.status === "WAITING_ON_VENDOR");

  if (isFirstResponse && ticket.firstResponseAt) {
    return (
      <div
        className={`rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 ${className}`}
      >
        <p className="text-sm font-semibold text-emerald-800">{title}</p>
        <p className="text-xs text-emerald-600 mt-1">Responded</p>
      </div>
    );
  }

  if (!isFirstResponse && ticket.completedAt) {
    return (
      <div
        className={`rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 ${className}`}
      >
        <p className="text-sm font-semibold text-emerald-800">{title}</p>
        <p className="text-xs text-emerald-600 mt-1">Met</p>
      </div>
    );
  }

  const dueAt = isFirstResponse ? ticket.firstResponseDueAt : ticket.dueAt;
  if (!dueAt) {
    return (
      <div
        className={`rounded-2xl border border-slate-200 bg-slate-50/80 p-4 ${className}`}
      >
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        <p className="text-xs text-slate-500 mt-1">No SLA configured</p>
      </div>
    );
  }

  const createdAt = new Date(ticket.createdAt).getTime();
  const dueMs = new Date(dueAt).getTime();
  const totalMs = Math.max(1, dueMs - createdAt);

  const { remainingMs, isPast } = useCountdown(isPaused ? null : dueAt);
  const state = getState(
    isPaused ? null : (remainingMs ?? 0),
    isPast,
    isPaused,
    totalMs,
  );
  const styles = STATE_STYLES[state];

  const hasBeenPaused = !isFirstResponse && !!ticket.slaPausedAt;
  const hideProgressPercent = !isFirstResponse && (isPaused || hasBeenPaused);

  const pctRemaining =
    hideProgressPercent || remainingMs === null
      ? 0
      : Math.min(100, Math.max(0, (remainingMs / totalMs) * 100));

  const tooltipTitle = `Due: ${formatDateLong(dueAt)}`;

  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-soft ${className} ${
        styles.pulse ? "animate-pulse" : ""
      }`}
      title={tooltipTitle}
    >
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {isPaused ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-500">
          <Clock className="h-4 w-4 shrink-0" aria-hidden />
          <span className="text-xs font-medium">Paused</span>
          {ticket.slaPausedAt && (
            <span
              className="text-xs text-slate-400"
              title={formatDateLong(ticket.slaPausedAt)}
            >
              since <RelativeTime value={ticket.slaPausedAt} />
            </span>
          )}
        </div>
      ) : (
        <>
          <div className={`mt-2 flex items-center gap-2 ${styles.text}`}>
            <Clock className="h-4 w-4" aria-hidden />
            <span className="text-sm font-semibold tabular-nums">
              {remainingMs !== null
                ? isPast
                  ? "Overdue"
                  : formatRemaining(remainingMs)
                : "—"}
            </span>
          </div>
          {!hideProgressPercent && (
            <>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${styles.bar}`}
                  style={{ width: `${pctRemaining}%` }}
                  role="progressbar"
                  aria-valuenow={Math.round(pctRemaining)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${pctRemaining.toFixed(0)}% remaining`}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {Math.round(pctRemaining)}% remaining · Due {formatDate(dueAt)}
              </p>
            </>
          )}
          {hideProgressPercent && (
            <p className="mt-1 text-xs text-slate-500">
              Due {formatDate(dueAt)}
              {hasBeenPaused && (
                <span className="ml-1 text-slate-400">
                  (SLA was paused; % not shown)
                </span>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
