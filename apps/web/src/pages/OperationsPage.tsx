import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  fetchOperationsSnapshot,
  runOperationsJob,
  type OperationsJobRow,
  type OperationsSnapshot,
} from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { JobsTable } from "../components/operations/JobsTable";
import { StatCard } from "../components/ui/StatCard";
import { SwitchCard } from "../components/operations/SwitchCard";
import { TopBar } from "../components/TopBar";
import { useHeaderContext } from "../contexts/HeaderContext";
import { useToast } from "../hooks/useToast";
import { handleApiError } from "../utils/handleApiError";

/** Section labels are a quiet eyebrow, deliberately lighter than a card title. */
const EYEBROW =
  "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

/**
 * Admin → Operations (card 1.21), modelled on the LMS jobs console: three
 * groups answering three questions — what is turned on, where tickets come in,
 * and what runs on a schedule. Owner only. No auto-refresh: a console that
 * repolls while you read it is noise.
 */
export function OperationsPage() {
  const headerCtx = useHeaderContext();
  const toast = useToast();
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [confirmJob, setConfirmJob] = useState<OperationsJobRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await fetchOperationsSnapshot());
      setError(null);
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runJob(job: OperationsJobRow) {
    setRunningKey(job.key);
    try {
      const result = await runOperationsJob(job.key);
      if (result.skipped === "locked") {
        toast.info("Another instance is already running this");
      } else {
        toast.success(`${job.label} ran — ${describeRun(result.summary)}`);
      }
      setSnapshot(await fetchOperationsSnapshot());
    } catch (err) {
      toast.error(handleApiError(err));
    } finally {
      setRunningKey(null);
    }
  }

  // Retention only asks first when it would actually delete something.
  function onRun(job: OperationsJobRow) {
    const deletesData =
      job.key === "retention" &&
      snapshot?.switches?.some(
        (row) => row.key === "retention" && row.state === "On",
      );
    if (deletesData) {
      setConfirmJob(job);
      return;
    }
    void runJob(job);
  }

  const headerValue = headerCtx;
  const pageHeading = (
    <div className="flex min-w-0 items-center gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-foreground">Operations</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Background jobs and what this deployment has switched on.
          {snapshot ? (
            <>
              {" "}
              Last loaded {new Date(snapshot.generatedAt).toLocaleTimeString()}.
            </>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void load()}
        disabled={loading}
        className="inline-flex h-9 flex-shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm text-foreground shadow-sm transition-all hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        Refresh
      </button>
    </div>
  );

  return (
    <section className="min-h-full bg-background animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto max-w-[1600px] px-6 py-4">
          {/* The page owns its title (like Routing Rules): one header row, not two. */}
          {headerValue ? (
            <TopBar
              title={headerValue.title}
              subtitle={headerValue.subtitle}
              currentEmail={headerValue.currentEmail}
              onOpenSearch={headerValue.onOpenSearch}
              notificationProps={headerValue.notificationProps}
              leftContent={pageHeading}
            />
          ) : (
            pageHeading
          )}
        </div>
      </div>

      <div className="mx-auto flex max-w-[1600px] flex-col gap-8 p-6">
        {error ? (
          <EmptyState
            title="Operations unavailable"
            description={error}
            primaryAction={{ label: "Try again", onClick: () => void load() }}
          />
        ) : null}

        {snapshot ? (
          <>
            <section className="flex flex-col gap-3">
              <h2 className={EYEBROW}>Feature switches</h2>
              {snapshot.switches ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {snapshot.switches.map((item) => (
                    <SwitchCard key={item.key} item={item} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Switch states are unavailable right now.
                </p>
              )}
              <p className="text-[11px] text-muted-foreground/80">
                Read-only here — these live in the app service settings, and
                changing one needs a settings change and a restart.
              </p>
            </section>

            <section className="flex flex-col gap-3">
              <h2 className={EYEBROW}>Data in</h2>
              {snapshot.dataIn ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {snapshot.dataIn.map((item) => (
                    <div
                      key={item.key}
                      className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-card"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold text-foreground">
                          {item.label}
                        </h3>
                        <span
                          className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            item.configured
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {item.state}
                        </span>
                      </div>
                      <p className="mt-2 flex-1 font-mono text-[11px] text-muted-foreground">
                        {item.path}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Intake states are unavailable right now.
                </p>
              )}
            </section>

            {snapshot.outbox ? (
              <section className="flex flex-col gap-3">
                <h2 className={EYEBROW}>Email outbox</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard
                    label="Waiting"
                    value={snapshot.outbox.pending}
                    tone={snapshot.outbox.pending > 0 ? "amber" : "neutral"}
                    hint="Queued, not yet sent"
                  />
                  <StatCard
                    label="In flight"
                    value={snapshot.outbox.processing}
                    tone={snapshot.outbox.processing > 0 ? "blue" : "neutral"}
                    hint="Claimed by a sender"
                  />
                  <StatCard
                    label="Sent"
                    value={snapshot.outbox.sent}
                    tone="green"
                  />
                  <StatCard
                    label="Given up"
                    value={snapshot.outbox.failed}
                    tone={snapshot.outbox.failed > 0 ? "red" : "neutral"}
                    hint="Out of attempts, or refused"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground/80">
                  Counts only. Waiting rows are retried by the outbox sweeper
                  below; given-up rows are never retried on purpose.
                </p>
              </section>
            ) : null}

            <section className="flex flex-col gap-3">
              <h2 className={EYEBROW}>Scheduled jobs</h2>
              <JobsTable
                jobs={snapshot.jobs}
                runningKey={runningKey}
                onRun={onRun}
              />
              <p className="text-[11px] text-muted-foreground/80">
                Last run and result are held in memory, so a restart clears
                them. Next run is approximate — the timer is not
                schedule-anchored.
              </p>
            </section>
          </>
        ) : null}
      </div>

      {confirmJob ? (
        <ConfirmDialog
          open
          destructive
          title="Run the retention job now?"
          message="Dry run is off, so this permanently deletes records that are past their retention window."
          confirmLabel="Run now"
          onConfirm={() => {
            const job = confirmJob;
            setConfirmJob(null);
            void runJob(job);
          }}
          onCancel={() => setConfirmJob(null)}
        />
      ) : null}
    </section>
  );
}

function describeRun(summary: Record<string, unknown> | null): string {
  if (!summary) return "nothing to do";
  if (summary.dryRun === true) return "nothing deleted (dry run)";
  const counted = Object.entries(summary).filter(
    ([, value]) => typeof value === "number" && value > 0,
  );
  return counted.length > 0
    ? counted.map(([key, value]) => `${key}: ${String(value)}`).join(", ")
    : "nothing to do";
}
