import type { OperationsJobRow } from "../../api/client";
import { RelativeTime } from "../RelativeTime";

const NEVER_RUN_HINT = "Not run since the app last restarted";

/** "Purged 3 tickets" style one-liner from whatever the worker reported. */
export function summarize(job: OperationsJobRow): string {
  if (job.lastRunOk === false) {
    return "Failed";
  }
  const summary = job.lastSummary;
  if (!summary) {
    return job.lastRunAt ? "Ran" : "—";
  }
  const parts = Object.entries(summary)
    .filter(
      ([key, value]) =>
        typeof value === "number" && value > 0 && key !== "durationMs",
    )
    .map(([key, value]) => `${humanize(key)}: ${String(value)}`);
  if (summary.dryRun === true) {
    parts.unshift("Dry run");
  }
  return parts.length > 0 ? parts.join(" · ") : "Nothing to do";
}

function humanize(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "every 5 min" from an interval, or "—" when the job has no timer. */
export function formatInterval(intervalMs: number | null): string {
  if (!intervalMs || intervalMs <= 0) return "—";
  if (intervalMs < 60_000) return `every ${Math.round(intervalMs / 1000)}s`;
  const minutes = Math.round(intervalMs / 60_000);
  if (minutes < 60) return `every ${minutes} min`;
  return `every ${Math.round(minutes / 60)} h`;
}

/**
 * The scheduled-jobs table (card 1.21). One row per worker: what it is, whether
 * it is on, when it last ran and what happened, roughly when it runs next, and
 * a Run now button. Last-run state is in memory, so a restart clears it — the
 * dash says so on hover rather than implying the job never ran.
 */
export function JobsTable({
  jobs,
  runningKey,
  onRun,
}: {
  jobs: OperationsJobRow[];
  runningKey: string | null;
  onRun: (job: OperationsJobRow) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-card">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3">Job</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Last run</th>
            <th className="px-4 py-3">Result</th>
            <th className="px-4 py-3">Next run</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {jobs.map((job) => (
            <tr key={job.key} className="align-top">
              <td className="px-4 py-3">
                <p className="font-medium text-foreground">{job.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {job.description}
                </p>
              </td>
              <td className="px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    job.enabled
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {job.enabled ? "On" : "Off"}
                </span>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatInterval(job.intervalMs)}
                </p>
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {job.lastRunAt ? (
                  <RelativeTime value={job.lastRunAt} />
                ) : (
                  <span title={NEVER_RUN_HINT}>—</span>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {summarize(job)}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {job.nextRunAt ? (
                  <span title="Approximate — the timer is not schedule-anchored">
                    <RelativeTime value={job.nextRunAt} />
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onRun(job)}
                  disabled={runningKey !== null}
                  className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition-all hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {runningKey === job.key ? "Running…" : "Run now"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
