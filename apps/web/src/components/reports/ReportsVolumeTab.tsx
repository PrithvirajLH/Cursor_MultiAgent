import { useMemo } from "react";
import { EmptyState } from "../EmptyState";
import { CardShell, MiniBars, toPercent } from "./report-primitives";

type ChannelRow = { channel: string; label: string; percent: number };

interface ReportsVolumeTabProps {
  inboundSeries: number[];
  solvedSeries: number[];
  backlogSeries: number[];
  volumeDates: string[];
  channelBreakdownData: ChannelRow[];
}

/**
 * "Volume" tab of the Reports page. Extracted from ReportsPage.tsx.
 * Receives the shared daily series as props (computed once in the parent) and
 * derives its own view state (peak days, has-data flags) locally.
 */
export function ReportsVolumeTab({
  inboundSeries,
  solvedSeries,
  backlogSeries,
  volumeDates,
  channelBreakdownData,
}: ReportsVolumeTabProps) {
  const hasInboundSeries = inboundSeries.length > 0;
  const hasSolvedSeries = solvedSeries.length > 0;
  const hasBacklogSeries = backlogSeries.length > 0;
  const hasChannelBreakdown = channelBreakdownData.length > 0;

  const peakDays = useMemo(() => {
    if (volumeDates.length > 0 && volumeDates.length === inboundSeries.length) {
      return volumeDates
        .map((date, idx) => ({
          d: new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
            weekday: "short",
          }),
          v: inboundSeries[idx],
        }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 5);
    }
    return [];
  }, [inboundSeries, volumeDates]);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <CardShell title="Inbound vs solved vs backlog" sub="Daily trend">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-border bg-muted p-4">
                <p className="text-sm font-semibold text-foreground">Inbound</p>
                <p className="mb-2 text-xs text-muted-foreground">Tickets/day</p>
                {hasInboundSeries ? (
                  <div className="text-primary">
                    <MiniBars points={inboundSeries} />
                  </div>
                ) : (
                  <div className="mt-4">
                    <EmptyState title="No inbound data" compact />
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-border bg-muted p-4">
                <p className="text-sm font-semibold text-foreground">Solved</p>
                <p className="mb-2 text-xs text-muted-foreground">Tickets/day</p>
                {hasSolvedSeries ? (
                  <div className="text-emerald-400">
                    <MiniBars points={solvedSeries} />
                  </div>
                ) : (
                  <div className="mt-4">
                    <EmptyState title="No solved data" compact />
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-border bg-muted p-4">
                <p className="text-sm font-semibold text-foreground">Backlog</p>
                <p className="mb-2 text-xs text-muted-foreground">Open tickets</p>
                {hasBacklogSeries ? (
                  <div className="text-amber-600">
                    <MiniBars points={backlogSeries} />
                  </div>
                ) : (
                  <div className="mt-4">
                    <EmptyState title="No backlog data" compact />
                  </div>
                )}
              </div>
            </div>
          </CardShell>
        </div>

        <div className="space-y-5 lg:col-span-4">
          <CardShell title="By channel" sub="Share of inbound">
            {hasChannelBreakdown ? (
              <div className="space-y-2">
                {channelBreakdownData.map((row) => (
                  <div
                    key={row.channel}
                    className="rounded-lg px-3 py-2 hover:bg-muted"
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-foreground">
                        {row.label}
                      </span>
                      <span className="text-muted-foreground">
                        {toPercent(row.percent)}
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-accent">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{ width: `${row.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4">
                <EmptyState
                  title="No channel tracking"
                  description="No channels recorded in current scope."
                  compact
                />
              </div>
            )}
          </CardShell>

          <CardShell title="Peak days" sub="Highest inbound volume">
            {peakDays.length > 0 ? (
              <div className="space-y-2">
                {peakDays.map((row) => (
                  <div
                    key={`${row.d}-${row.v}`}
                    className="flex items-center justify-between rounded-xl border border-border bg-muted px-3 py-2"
                  >
                    <span className="text-sm font-medium text-foreground">
                      {row.d}
                    </span>
                    <span className="rounded-lg bg-accent px-2 py-1 text-xs font-medium text-foreground">
                      {row.v}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4">
                <EmptyState
                  title="No peak days"
                  description="Not enough volume data to determine peaks."
                  compact
                />
              </div>
            )}
          </CardShell>
        </div>
      </div>
    </div>
  );
}
