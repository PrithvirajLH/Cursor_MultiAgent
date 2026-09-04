import type {
  FirstContactResolutionResponse,
  ReassignmentCountResponse,
  TimeInStatusResponse,
} from "../../api/client";
import { EmptyState } from "../EmptyState";
import { CardShell } from "./report-primitives";

interface ReportsDeskTabProps {
  firstContact: FirstContactResolutionResponse | null;
  reassignment: ReassignmentCountResponse | null;
  timeInStatus: TimeInStatusResponse | null;
}

/** `WAITING_ON_REQUESTER` reads badly in a table; the app never shows the enum. */
function statusLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function hours(value: number): string {
  if (value < 1) return `${Math.round(value * 60)}m`;
  if (value < 48) return `${value.toFixed(1)}h`;
  return `${(value / 24).toFixed(1)}d`;
}

/**
 * "Desk" tab of the Reports page — the three metrics card 1.17 added.
 *
 * Each figure carries what it rests on rather than standing alone: the
 * first-contact percentage shows the counts behind it, the reassignment
 * distribution is a table rather than one average, and each time-in-status row
 * says how many closed intervals it averaged. A single number with no
 * denominator is how a report gets quoted in a meeting and then turns out to
 * have been three tickets.
 */
export function ReportsDeskTab({
  firstContact,
  reassignment,
  timeInStatus,
}: ReportsDeskTabProps) {
  const distribution = reassignment?.data ?? [];
  const statusRows = timeInStatus?.data ?? [];
  const worstStatus = statusRows.reduce<
    TimeInStatusResponse["data"][number] | null
  >(
    (worst, row) =>
      worst === null || row.averageHours > worst.averageHours ? row : worst,
    null,
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <CardShell
          title="First-contact resolution"
          sub="Resolved with at most one reply from us"
        >
          {firstContact && firstContact.resolved > 0 ? (
            <div>
              <p className="text-3xl font-semibold text-foreground">
                {firstContact.percent}%
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {firstContact.firstContact} of {firstContact.resolved} resolved
                tickets in this range
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                The requester's own replies and internal notes are not counted —
                only messages we sent them.
              </p>
            </div>
          ) : (
            <EmptyState
              title="Nothing resolved in this range"
              description="Widen the date range or clear a filter."
            />
          )}
        </CardShell>

        <CardShell
          title="Reassignments"
          sub="How often a ticket is handed on before it is finished"
        >
          {distribution.length > 0 ? (
            <div>
              <p className="text-3xl font-semibold text-foreground">
                {reassignment?.averagePerTicket ?? 0}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                average per ticket, across {reassignment?.tickets ?? 0} tickets
              </p>
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-1 font-medium">Reassignments</th>
                    <th className="pb-1 text-right font-medium">Tickets</th>
                  </tr>
                </thead>
                <tbody>
                  {distribution.map((row) => (
                    <tr key={row.reassignments} className="border-t border-border">
                      <td className="py-1.5 text-foreground">
                        {row.reassignments === 0
                          ? "None — went straight through"
                          : row.reassignments}
                      </td>
                      <td className="py-1.5 text-right text-foreground">
                        {row.tickets}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground">
                The first assignment is not a reassignment — every ticket gets
                one.
              </p>
            </div>
          ) : (
            <EmptyState
              title="No tickets in this range"
              description="Widen the date range or clear a filter."
            />
          )}
        </CardShell>
      </div>

      <CardShell
        title="Time in each status"
        sub={
          worstStatus
            ? `Longest: ${statusLabel(worstStatus.status)} at ${hours(worstStatus.averageHours)}`
            : "Average and median hours per status"
        }
      >
        {statusRows.length > 0 ? (
          <div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-1 font-medium">Status</th>
                  <th className="pb-1 text-right font-medium">Average</th>
                  <th className="pb-1 text-right font-medium">Median</th>
                  <th className="pb-1 text-right font-medium">Intervals</th>
                </tr>
              </thead>
              <tbody>
                {statusRows.map((row) => (
                  <tr key={row.status} className="border-t border-border">
                    <td className="py-1.5 text-foreground">
                      {statusLabel(row.status)}
                    </td>
                    <td className="py-1.5 text-right text-foreground">
                      {hours(row.averageHours)}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      {hours(row.medianHours)}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      {row.intervals}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">
              Only finished stretches are measured. The status a ticket is
              sitting in right now has no end yet, so counting it would make a
              busy status look slow purely because the report was run today.
            </p>
          </div>
        ) : (
          <EmptyState
            title="No status changes in this range"
            description="Widen the date range or clear a filter."
          />
        )}
      </CardShell>
    </div>
  );
}
