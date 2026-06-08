import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftRight, Inbox, RotateCcw } from "lucide-react";
import {
  fetchReportAgentWorkload,
  fetchReportReopenRate,
  fetchReportSummary,
  fetchReportTeamSummary,
  fetchReportTicketsByAge,
  fetchReportTicketsByCategory,
  fetchReportTransfers,
  fetchTicketCounts,
  fetchTicketActivity,
  fetchTicketById,
  fetchTicketStatusBreakdown,
  fetchTickets,
  type AgentPerformanceResponse,
  type AgentWorkloadResponse,
  type ReopenRateResponse,
  type TeamSummaryResponse,
  type TicketActivityPoint,
  type TicketAgeBucketResponse,
  type ReportSummaryResponse,
  type TicketRecord,
  type TicketStatusPoint,
  type TicketsByCategoryResponse,
  type TicketsByPriorityResponse,
  type TransfersResponse,
} from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { RelativeTime } from "../components/RelativeTime";
import { TopBar } from "../components/TopBar";
import { StatusBadge } from "../components/dashboard/StatusBadge";
import {
  TicketActivityChart,
  type ActivityPoint,
} from "../components/dashboard/TicketActivityChart";
import { ReopenRateChart } from "../components/reports/ReopenRateChart";
import { TicketVolumeChart } from "../components/reports/TicketVolumeChart";
import { TicketsByAgeChart } from "../components/reports/TicketsByAgeChart";
import {
  REALTIME_TICKET_CHANGED_EVENT,
  type RealtimeTicketChangedEventPayload,
} from "../realtime/events";
import { formatStatus, formatTicketId, getSlaTone } from "../utils/format";
import type { Role } from "../types";
import { useHeaderContext } from "../contexts/HeaderContext";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const RECENT_TICKETS_COUNT = 6;

type DashboardPageProps = {
  role: Role;
};

type KpiTone = "blue" | "green" | "purple" | "orange" | "red" | "gray";

type KpiItem = {
  label: string;
  value: number;
  helper?: string;
  tone: KpiTone;
};

type SnapshotStats = {
  open: number;
  resolved: number;
  total: number;
  unassigned: number;
  assignedToMe: number;
  resolvedByMe: number;
  atRisk: number;
  overdue: number;
};

const ROLE_META: Record<Role, { title: string; subtitle: string }> = {
  EMPLOYEE: { title: "My Dashboard", subtitle: "Track your support requests" },
  AGENT: {
    title: "Agent Dashboard",
    subtitle: "Your assigned tickets and workload",
  },
  LEAD: {
    title: "Team Lead Dashboard",
    subtitle: "Team insights and performance",
  },
  TEAM_ADMIN: {
    title: "Team Admin Dashboard",
    subtitle: "Queue operations and SLA management",
  },
  OWNER: { title: "Platform Dashboard", subtitle: "Organization-wide metrics" },
};

const EMPTY_TICKETS = {
  data: [] as TicketRecord[],
  meta: { page: 1, pageSize: 0, total: 0, totalPages: 0 },
};

const EMPTY_COUNTS = {
  assignedToMe: 0,
  triage: 0,
  open: 0,
  unassigned: 0,
  resolved: 0,
  resolvedByMe: 0,
  atRisk: 0,
  overdue: 0,
};

const EMPTY_SLA = {
  data: {
    met: 0,
    breached: 0,
    total: 0,
    firstResponseMet: 0,
    firstResponseBreached: 0,
    resolutionMet: 0,
    resolutionBreached: 0,
  },
};

const EMPTY_REPORT_SUMMARY: ReportSummaryResponse = {
  ticketVolume: { data: [] },
  slaCompliance: EMPTY_SLA,
  resolutionTime: { data: [] },
  ticketsByPriority: { data: [] },
  ticketsByStatus: { data: [] },
  agentPerformance: { data: [] },
};

const RESOLVED_STATUSES = new Set(["RESOLVED", "CLOSED"]);
const OPEN_STATUSES = new Set([
  "NEW",
  "TRIAGED",
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_ON_REQUESTER",
  "WAITING_ON_VENDOR",
  "REOPENED",
]);

function parseDateMillis(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isResolvedStatus(status?: string | null) {
  return Boolean(status && RESOLVED_STATUSES.has(status));
}

function isOpenStatus(status?: string | null) {
  return Boolean(status && OPEN_STATUSES.has(status));
}

function incrementTodaySeries(
  series: Array<{ date: string; count: number }>,
  delta: number,
) {
  if (delta === 0) return series;
  const today = new Date().toISOString().slice(0, 10);
  const index = series.findIndex((point) => point.date === today);
  if (index === -1) {
    return [...series, { date: today, count: Math.max(0, delta) }];
  }
  const next = [...series];
  next[index] = {
    ...next[index],
    count: Math.max(0, next[index].count + delta),
  };
  return next;
}

function mapActivitySeries(
  data: TicketActivityPoint[],
  rangeDays: number,
): ActivityPoint[] {
  return data.map((point) => {
    const date = new Date(`${point.date}T00:00:00Z`);
    const day =
      rangeDays > 7
        ? date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          })
        : date.toLocaleDateString("en-US", {
            weekday: "short",
            timeZone: "UTC",
          });
    return { ...point, day };
  });
}

function priorityLabel(priority?: string | null): string {
  const v = (priority ?? "").toUpperCase();
  if (v === "SEV1" || v === "URGENT") return "SEV1";
  if (v === "SEV2" || v === "HIGH") return "SEV2";
  if (v === "SEV3" || v === "MEDIUM") return "SEV3";
  if (v === "SEV4" || v === "LOW") return "SEV4";
  return priority ?? "—";
}

function priorityClass(priority?: string | null): string {
  switch (priority) {
    case "SEV1":
      return "bg-red-100 text-red-700";
    case "SEV2":
      return "bg-orange-100 text-orange-700";
    case "SEV3":
      return "bg-primary/10 text-primary";
    case "SEV4":
    default:
      return "bg-white/[0.06] text-muted-foreground";
  }
}

function activitySummary(ticket: TicketRecord): string {
  if (ticket.status === "RESOLVED" || ticket.status === "CLOSED") {
    return "Resolved";
  }
  if (ticket.status === "WAITING_ON_REQUESTER") {
    return "Waiting for requester";
  }
  if (ticket.status === "WAITING_ON_VENDOR") {
    return "Waiting for vendor";
  }
  return `Status changed to ${formatStatus(ticket.status)}`;
}

function safePercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function kpiToneClass(tone: KpiTone): {
  bg: string;
  text: string;
  bgTone: string;
} {
  switch (tone) {
    case "green":
      return {
        bg: "bg-green-500",
        text: "text-green-400",
        bgTone: "bg-green-500/10",
      };
    case "purple":
      return {
        bg: "bg-violet-500",
        text: "text-violet-400",
        bgTone: "bg-violet-500/10",
      };
    case "orange":
      return {
        bg: "bg-orange-500",
        text: "text-orange-400",
        bgTone: "bg-orange-500/10",
      };
    case "red":
      return { bg: "bg-red-500", text: "text-red-400", bgTone: "bg-red-500/10" };
    case "gray":
      return {
        bg: "bg-slate-400",
        text: "text-muted-foreground",
        bgTone: "bg-white/[0.06]",
      };
    case "blue":
    default:
      return { bg: "bg-blue-600", text: "text-primary", bgTone: "bg-primary/10" };
  }
}

function PriorityBadge({ priority }: { priority?: string | null }) {
  return (
    <span
      className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${priorityClass(priority)}`}
    >
      {priorityLabel(priority)}
    </span>
  );
}

function SlaChip({ ticket }: { ticket: TicketRecord }) {
  const tone = getSlaTone({
    dueAt: ticket.dueAt,
    completedAt: ticket.completedAt,
    status: ticket.status,
    slaPausedAt: ticket.slaPausedAt,
  });
  return (
    <span
      className={`inline-flex rounded border px-2 py-1 text-xs font-medium ${tone.className}`}
    >
      {tone.label}
    </span>
  );
}

function ChartLegend({
  items,
}: {
  items: Array<{ label: string; color: string }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      {items.map((item) => (
        <div key={item.label} className="inline-flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function StatusDonutChart({ data }: { data: TicketStatusPoint[] }) {
  function statusColor(status: string): string {
    switch (status) {
      case "NEW":
        return "hsl(var(--status-new))";
      case "TRIAGED":
        return "hsl(var(--status-progress))";
      case "ASSIGNED":
        return "hsl(var(--status-progress))";
      case "IN_PROGRESS":
        return "hsl(var(--status-progress))";
      case "WAITING_ON_REQUESTER":
        return "hsl(var(--status-waiting))";
      case "WAITING_ON_VENDOR":
        return "hsl(var(--status-waiting))";
      case "RESOLVED":
        return "hsl(var(--status-resolved))";
      case "CLOSED":
        return "hsl(var(--fg-faint))";
      case "REOPENED":
        return "hsl(var(--status-red))";
      default:
        return "hsl(var(--fg-subtle))";
    }
  }

  const points = data
    .map((item) => ({
      name: formatStatus(item.status),
      value: item.count,
      color: statusColor(item.status),
    }))
    .filter((item) => item.value > 0);

  if (points.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        No tickets in range
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={points}
              dataKey="value"
              nameKey="name"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={2}
            >
              {points.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number | undefined) => [value ?? 0, "Tickets"]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend
        items={points.map((point) => ({
          label: point.name,
          color: point.color,
        }))}
      />
    </div>
  );
}

function PriorityDonutChart({
  data,
}: {
  data: TicketsByPriorityResponse["data"];
}) {
  const points = data
    .map((item) => ({
      name: priorityLabel(item.priority),
      value: item.count,
      color:
        item.priority === "SEV1"
          ? "hsl(var(--status-red))"
          : item.priority === "SEV2"
            ? "hsl(var(--status-amber))"
            : item.priority === "SEV3"
              ? "hsl(var(--status-blue))"
              : "hsl(var(--fg-faint))",
    }))
    .filter((item) => item.value > 0);

  if (points.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        No tickets in range
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={points}
              dataKey="value"
              nameKey="name"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={2}
            >
              {points.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number | undefined) => [value ?? 0, "Tickets"]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend
        items={points.map((point) => ({
          label: point.name,
          color: point.color,
        }))}
      />
    </div>
  );
}

function LeadAgentWorkloadBarChart({
  data,
}: {
  data: AgentWorkloadResponse["data"];
}) {
  const points = data.map((item) => ({
    name: item.name || item.email || "Agent",
    openTickets: Math.max(0, item.assignedOpen ?? 0),
  }));

  if (points.length === 0) {
    return (
      <div className="flex h-[250px] w-full items-center justify-center">
        <EmptyState
          title="No workload data"
          description="No assigned open tickets."
          compact
        />
      </div>
    );
  }

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={points}
          margin={{ top: 5, right: 5, left: 0, bottom: 10 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(222, 28%, 18%)"
            vertical={false}
          />
          <XAxis
            dataKey="name"
            tick={{ fill: "hsl(215, 22%, 48%)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "hsl(215, 22%, 48%)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number | undefined) => [
              value ?? 0,
              "Open Tickets",
            ]}
            contentStyle={{
              borderRadius: "12px",
              backgroundColor: "hsl(222, 40%, 13%)",
              color: "hsl(215, 100%, 96%)",
              border: "1px solid hsl(222, 28%, 18%)",
              boxShadow: "0 4px 15px rgba(0, 0, 0, 0.04)",
              fontSize: "12px",
            }}
          />
          <Bar dataKey="openTickets" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function LeadSlaBarChart({
  data,
}: {
  data: { met: number; atRisk: number; breached: number };
}) {
  const total = data.met + data.atRisk + data.breached;

  if (total <= 0) {
    return (
      <div className="flex h-[250px] w-full items-center justify-center">
        <EmptyState
          title="No SLA data"
          description="No SLA events found in this range."
          compact
        />
      </div>
    );
  }

  const compliance = Math.round((data.met / total) * 100);
  const segs = [
    { name: "Met", value: data.met, color: "hsl(var(--status-green))" },
    { name: "At Risk", value: data.atRisk, color: "hsl(var(--status-amber))" },
    { name: "Breached", value: data.breached, color: "hsl(var(--status-red))" },
  ];

  // A single horizontal stacked bar reads far better than 3 separate columns
  // (no empty gap when a bucket is 0) and leads with the headline compliance %.
  return (
    <div className="flex h-full min-h-[200px] flex-col justify-center gap-5 py-1">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums tracking-tight text-foreground">
            {compliance}%
          </span>
          <span className="text-sm font-medium text-muted-foreground">met</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {total} ticket{total === 1 ? "" : "s"} tracked this period
        </p>
      </div>

      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {segs.map((s) =>
          s.value > 0 ? (
            <div
              key={s.name}
              className="h-full"
              style={{
                width: `${(s.value / total) * 100}%`,
                background: s.color,
              }}
              title={`${s.name}: ${s.value}`}
            />
          ) : null,
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {segs.map((s) => (
          <div key={s.name} className="flex flex-col gap-1.5">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: s.color }}
              />
              {s.name}
            </span>
            <span className="pl-3.5 text-lg font-semibold tabular-nums text-foreground">
              {s.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LeadStatusPieChart({ data }: { data: TicketStatusPoint[] }) {
  function statusColor(status: string): string {
    switch (status) {
      case "NEW":
        return "hsl(var(--status-new))";
      case "TRIAGED":
        return "hsl(var(--status-progress))";
      case "ASSIGNED":
        return "hsl(var(--status-progress))";
      case "IN_PROGRESS":
        return "hsl(var(--status-progress))";
      case "WAITING_ON_REQUESTER":
        return "hsl(var(--status-waiting))";
      case "WAITING_ON_VENDOR":
        return "hsl(var(--status-waiting))";
      case "RESOLVED":
        return "hsl(var(--status-resolved))";
      case "CLOSED":
        return "hsl(var(--fg-faint))";
      case "REOPENED":
        return "hsl(var(--status-red))";
      default:
        return "hsl(var(--fg-subtle))";
    }
  }

  const points = data.map((item) => ({
    name: formatStatus(item.status),
    value: item.count,
    color: statusColor(item.status),
  }));

  const total = points.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) {
    return (
      <div className="flex h-[250px] w-full items-center justify-center">
        <EmptyState
          title="No status data"
          description="No tickets matching this range."
          compact
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={points}
              dataKey="value"
              nameKey="name"
              innerRadius={55}
              outerRadius={105}
            >
              {points.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number | undefined) => [value ?? 0, "Tickets"]}
              contentStyle={{
                borderRadius: "12px",
                backgroundColor: "hsl(222, 40%, 13%)",
                color: "hsl(215, 100%, 96%)",
                border: "1px solid hsl(222, 28%, 18%)",
                boxShadow: "0 4px 15px rgba(0, 0, 0, 0.04)",
                fontSize: "12px",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend
        items={points.map((item) => ({ label: item.name, color: item.color }))}
      />
    </div>
  );
}

function ModernTicketCard({
  ticket,
  onClick,
}: {
  ticket: TicketRecord;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="group flex flex-col sm:flex-row gap-5 p-6 bg-card border border-border rounded-[24px] hover:border-primary/30 hover:shadow-glow-sm transition-all cursor-pointer mb-4"
    >
      <div className="flex-shrink-0">
        <div
          className={`w-12 h-12 rounded-full border-2 border-white shadow-sm flex items-center justify-center font-bold text-lg ${priorityClass(ticket.priority)}`}
        >
          {ticket.assignee
            ? (
                ticket.assignee.displayName?.charAt(0) ||
                ticket.assignee.email?.charAt(0) ||
                "?"
              ).toUpperCase()
            : "?"}
        </div>
      </div>
      <div className="flex-grow">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
          <h3 className="text-[17px] font-bold text-foreground group-hover:text-primary transition truncate pr-4">
            {ticket.subject}
          </h3>
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            <RelativeTime value={ticket.updatedAt} />
          </span>
        </div>
        <p className="text-[14px] text-muted-foreground mb-5 line-clamp-1">
          {activitySummary(ticket)}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-3 py-1.5 rounded-lg bg-white/[0.06] text-muted-foreground text-xs font-bold tracking-wider uppercase border border-border">
            ID: {formatTicketId(ticket)}
          </span>
          <PriorityBadge priority={ticket.priority} />
          <StatusBadge status={ticket.status} />
          <SlaChip ticket={ticket} />
        </div>
      </div>
    </div>
  );
}

export function DashboardPage({ role }: DashboardPageProps) {
  const headerCtx = useHeaderContext();
  const navigate = useNavigate();
  const currentEmail = headerCtx?.currentEmail?.trim().toLowerCase() ?? "";
  const isEmployee = role === "EMPLOYEE";
  const isAgent = role === "AGENT";
  const isLead = role === "LEAD";
  const isTeamAdmin = role === "TEAM_ADMIN";
  const isOwner = role === "OWNER";

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<"3" | "7" | "30" | "custom">("30");
  // ISO date strings (yyyy-mm-dd). Default custom window = last 30 days.
  const [customFrom, setCustomFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );

  const renderRangeFilter = () => (
    <div className="flex items-center gap-2">
      <select
        value={range}
        onChange={(event) =>
          setRange(event.target.value as "3" | "7" | "30" | "custom")
        }
        className="surface-card px-4 py-2 text-sm font-medium hover:border-primary/40 transition outline-none text-foreground"
      >
        <option value="3">Last 3 days</option>
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="custom">Custom range…</option>
      </select>
      {range === "custom" ? (
        <>
          <input
            type="date"
            value={customFrom}
            max={customTo}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="surface-card px-3 py-2 text-sm text-foreground outline-none hover:border-primary/40 transition"
            aria-label="From date"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            value={customTo}
            min={customFrom}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setCustomTo(e.target.value)}
            className="surface-card px-3 py-2 text-sm text-foreground outline-none hover:border-primary/40 transition"
            aria-label="To date"
          />
        </>
      ) : null}
    </div>
  );
  const [sort, setSort] = useState<"recent" | "oldest">("recent");

  const [recentTickets, setRecentTickets] = useState<TicketRecord[]>([]);
  const [stats, setStats] = useState<SnapshotStats>({
    open: 0,
    resolved: 0,
    total: 0,
    unassigned: 0,
    assignedToMe: 0,
    resolvedByMe: 0,
    atRisk: 0,
    overdue: 0,
  });
  const [activity, setActivity] = useState<ActivityPoint[]>([]);
  const [statusBreakdown, setStatusBreakdown] = useState<TicketStatusPoint[]>(
    [],
  );
  const [priorityBreakdown, setPriorityBreakdown] = useState<
    TicketsByPriorityResponse["data"]
  >([]);
  const [ageBreakdown, setAgeBreakdown] = useState<
    TicketAgeBucketResponse["data"]
  >([]);
  const [agentWorkload, setAgentWorkload] = useState<
    AgentWorkloadResponse["data"]
  >([]);
  const [agentPerformance, setAgentPerformance] = useState<
    AgentPerformanceResponse["data"]
  >([]);
  const [reopenSeries, setReopenSeries] = useState<ReopenRateResponse["data"]>(
    [],
  );
  const [queueCategories, setQueueCategories] = useState<
    TicketsByCategoryResponse["data"]
  >([]);
  const [teamSummary, setTeamSummary] = useState<TeamSummaryResponse["data"]>(
    [],
  );
  const [volumeSeries, setVolumeSeries] = useState<
    { date: string; count: number }[]
  >([]);
  const [transfers, setTransfers] = useState<TransfersResponse["data"]>({
    total: 0,
    series: [],
  });
  const [slaCompliance, setSlaCompliance] = useState({
    met: 0,
    breached: 0,
    total: 0,
    atRisk: 0,
  });

  const loadedOnceRef = useRef(false);
  const recentTicketsRef = useRef<TicketRecord[]>([]);
  const lastRealtimeUpdatedAtByTicketRef = useRef<Record<string, number>>({});
  const knownTicketStateRef = useRef<
    Record<
      string,
      {
        status: string;
        priority: string;
        assigneeEmail: string;
      }
    >
  >({});
  const realtimeHydrationInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setRange("30");
    setSort("recent");
  }, [role]);

  useEffect(() => {
    recentTicketsRef.current = recentTickets;
    const knownStates = { ...knownTicketStateRef.current };
    for (const ticket of recentTickets) {
      knownStates[ticket.id] = {
        status: ticket.status,
        priority: ticket.priority,
        assigneeEmail: ticket.assignee?.email?.toLowerCase() ?? "",
      };
      const updatedAtMs = parseDateMillis(ticket.updatedAt);
      if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
        continue;
      }
      const previous = lastRealtimeUpdatedAtByTicketRef.current[ticket.id] ?? 0;
      if (updatedAtMs > previous) {
        lastRealtimeUpdatedAtByTicketRef.current[ticket.id] = updatedAtMs;
      }
    }
    knownTicketStateRef.current = knownStates;
  }, [recentTickets]);

  const hydrateRealtimeTicketState = useCallback(async (ticketId: string) => {
    if (knownTicketStateRef.current[ticketId]) {
      return knownTicketStateRef.current[ticketId];
    }
    if (realtimeHydrationInFlightRef.current.has(ticketId)) {
      return null;
    }
    realtimeHydrationInFlightRef.current.add(ticketId);
    try {
      const ticket = await fetchTicketById(ticketId);
      knownTicketStateRef.current[ticket.id] = {
        status: ticket.status,
        priority: ticket.priority,
        assigneeEmail: ticket.assignee?.email?.toLowerCase() ?? "",
      };
      const updatedAtMs = parseDateMillis(ticket.updatedAt);
      if (updatedAtMs > 0) {
        lastRealtimeUpdatedAtByTicketRef.current[ticket.id] = Math.max(
          lastRealtimeUpdatedAtByTicketRef.current[ticket.id] ?? 0,
          updatedAtMs,
        );
      }
      return knownTicketStateRef.current[ticket.id];
    } catch {
      return null;
    } finally {
      realtimeHydrationInFlightRef.current.delete(ticketId);
    }
  }, []);

  const applyRealtimeTicketPatch = useCallback(
    (payload: RealtimeTicketChangedEventPayload) => {
      const ticketId = payload.ticketId;
      if (!ticketId) {
        return;
      }

      const incomingUpdatedAtMs = parseDateMillis(
        payload.updatedAt ?? payload.occurredAt,
      );
      if (incomingUpdatedAtMs > 0) {
        const lastUpdatedAtMs =
          lastRealtimeUpdatedAtByTicketRef.current[ticketId] ?? 0;
        if (incomingUpdatedAtMs < lastUpdatedAtMs) {
          return;
        }
        lastRealtimeUpdatedAtByTicketRef.current[ticketId] =
          incomingUpdatedAtMs;
      }

      const currentTicket = recentTicketsRef.current.find(
        (ticket) => ticket.id === ticketId,
      );
      const previousState =
        knownTicketStateRef.current[ticketId] ??
        (currentTicket
          ? {
              status: currentTicket.status,
              priority: currentTicket.priority,
              assigneeEmail: currentTicket.assignee?.email?.toLowerCase() ?? "",
            }
          : null);
      if (!previousState && payload.reason !== "ticket_created") {
        void hydrateRealtimeTicketState(ticketId);
        return;
      }
      const prevStatus = previousState?.status;
      const prevPriority = previousState?.priority;
      const nextStatus = payload.status ?? prevStatus;
      const nextPriority = payload.priority ?? prevPriority;
      const prevAssigneeEmail = previousState?.assigneeEmail ?? "";
      const nextAssigneeEmail =
        payload.assignee?.email?.toLowerCase() ??
        (Object.prototype.hasOwnProperty.call(payload, "assigneeId") &&
        payload.assigneeId === null
          ? ""
          : prevAssigneeEmail);
      const prevIsOpen = isOpenStatus(prevStatus);
      const nextIsOpen = isOpenStatus(nextStatus);
      const prevIsResolved = isResolvedStatus(prevStatus);
      const nextIsResolved = isResolvedStatus(nextStatus);
      const prevAssignedToMe = Boolean(
        currentEmail && prevAssigneeEmail === currentEmail,
      );
      const nextAssignedToMe = Boolean(
        currentEmail && nextAssigneeEmail === currentEmail,
      );
      const prevUnassignedOpen = prevIsOpen && !prevAssigneeEmail;
      const nextUnassignedOpen = nextIsOpen && !nextAssigneeEmail;

      knownTicketStateRef.current[ticketId] = {
        status: nextStatus ?? "",
        priority: nextPriority ?? "",
        assigneeEmail: nextAssigneeEmail,
      };

      setRecentTickets((prev) => {
        const index = prev.findIndex((ticket) => ticket.id === ticketId);
        if (index === -1) {
          return prev;
        }
        const patched: TicketRecord = { ...prev[index] };
        if (typeof payload.status === "string" && payload.status) {
          patched.status =
            payload.status as import("../api/client").TicketStatus;
        }
        if (typeof payload.priority === "string" && payload.priority) {
          patched.priority =
            payload.priority as import("../api/client").TicketPriority;
        }
        if (typeof payload.updatedAt === "string" && payload.updatedAt) {
          patched.updatedAt = payload.updatedAt;
        }
        if (payload.assignedTeam?.id) {
          patched.assignedTeam = payload.assignedTeam;
        } else if (
          Object.prototype.hasOwnProperty.call(payload, "assignedTeamId") &&
          payload.assignedTeamId === null
        ) {
          patched.assignedTeam = null;
        }
        if (payload.assignee?.id) {
          patched.assignee = payload.assignee;
        } else if (
          Object.prototype.hasOwnProperty.call(payload, "assigneeId") &&
          payload.assigneeId === null
        ) {
          patched.assignee = null;
        }
        const next = [...prev];
        next[index] = patched;
        next.sort((a, b) =>
          sort === "oldest"
            ? parseDateMillis(a.updatedAt) - parseDateMillis(b.updatedAt)
            : parseDateMillis(b.updatedAt) - parseDateMillis(a.updatedAt),
        );
        return next;
      });

      setStats((prev) => {
        let open = prev.open;
        let resolved = prev.resolved;
        let total = prev.total;
        let unassigned = prev.unassigned;
        let assignedToMe = prev.assignedToMe;
        let resolvedByMe = prev.resolvedByMe;

        if (payload.reason === "ticket_created" && !prevStatus) {
          total += 1;
          if (nextIsResolved) resolved += 1;
          else if (nextIsOpen) open += 1;
          if (nextUnassignedOpen) unassigned += 1;
          if (nextAssignedToMe && nextIsOpen) assignedToMe += 1;
          if (nextAssignedToMe && nextIsResolved) resolvedByMe += 1;
        }

        if (prevStatus && nextStatus && prevStatus !== nextStatus) {
          if (prevIsOpen && !nextIsOpen) open -= 1;
          if (!prevIsOpen && nextIsOpen) open += 1;
          if (prevIsResolved && !nextIsResolved) resolved -= 1;
          if (!prevIsResolved && nextIsResolved) resolved += 1;
          if (prevAssignedToMe && !nextAssignedToMe && prevIsResolved) {
            resolvedByMe -= 1;
          }
          if (!prevAssignedToMe && nextAssignedToMe && nextIsResolved) {
            resolvedByMe += 1;
          }
        }

        if (
          prevStatus &&
          (prevAssignedToMe !== nextAssignedToMe || prevIsOpen !== nextIsOpen)
        ) {
          if (prevAssignedToMe && prevIsOpen) assignedToMe -= 1;
          if (nextAssignedToMe && nextIsOpen) assignedToMe += 1;
        }

        if (prevStatus && prevUnassignedOpen !== nextUnassignedOpen) {
          if (prevUnassignedOpen) unassigned -= 1;
          if (nextUnassignedOpen) unassigned += 1;
        }

        return {
          ...prev,
          open: Math.max(0, open),
          resolved: Math.max(0, resolved),
          total: Math.max(0, total),
          unassigned: Math.max(0, unassigned),
          assignedToMe: Math.max(0, assignedToMe),
          resolvedByMe: Math.max(0, resolvedByMe),
        };
      });

      setStatusBreakdown((prev) => {
        if (prev.length === 0 || !nextStatus) {
          return prev;
        }
        const counts = new Map(
          prev.map((point) => [point.status, point.count]),
        );
        if (prevStatus && prevStatus !== nextStatus) {
          counts.set(
            prevStatus as import("../api/client").TicketStatus,
            Math.max(
              0,
              (counts.get(prevStatus as import("../api/client").TicketStatus) ??
                0) - 1,
            ),
          );
          counts.set(
            nextStatus as import("../api/client").TicketStatus,
            Math.max(
              0,
              (counts.get(nextStatus as import("../api/client").TicketStatus) ??
                0) + 1,
            ),
          );
        } else if (!prevStatus && payload.reason === "ticket_created") {
          counts.set(
            nextStatus as import("../api/client").TicketStatus,
            Math.max(
              0,
              (counts.get(nextStatus as import("../api/client").TicketStatus) ??
                0) + 1,
            ),
          );
        }
        const knownOrder = prev.map((point) => point.status);
        const appended = Array.from(counts.keys()).filter(
          (status) => !knownOrder.includes(status),
        );
        return [...knownOrder, ...appended].map((status) => ({
          status: status as import("../api/client").TicketStatus,
          count: Math.max(0, counts.get(status) ?? 0),
        }));
      });

      setPriorityBreakdown((prev) => {
        if (prev.length === 0 || !nextPriority) {
          return prev;
        }
        const counts = new Map(
          prev.map((point) => [point.priority, point.count]),
        );
        if (prevPriority && prevPriority !== nextPriority) {
          counts.set(
            prevPriority as import("../api/client").TicketPriority,
            Math.max(
              0,
              (counts.get(
                prevPriority as import("../api/client").TicketPriority,
              ) ?? 0) - 1,
            ),
          );
          counts.set(
            nextPriority as import("../api/client").TicketPriority,
            Math.max(
              0,
              (counts.get(
                nextPriority as import("../api/client").TicketPriority,
              ) ?? 0) + 1,
            ),
          );
        } else if (!prevPriority && payload.reason === "ticket_created") {
          counts.set(
            nextPriority as import("../api/client").TicketPriority,
            Math.max(
              0,
              (counts.get(
                nextPriority as import("../api/client").TicketPriority,
              ) ?? 0) + 1,
            ),
          );
        }
        const knownOrder = prev.map((point) => point.priority);
        const appended = Array.from(counts.keys()).filter(
          (priority) => !knownOrder.includes(priority),
        );
        return [...knownOrder, ...appended].map((priority) => ({
          priority: priority as import("../api/client").TicketPriority,
          count: Math.max(0, counts.get(priority) ?? 0),
        }));
      });

      setActivity((prev) => {
        if (prev.length === 0) return prev;
        const today = new Date().toISOString().slice(0, 10);
        const index = prev.findIndex((point) => point.date === today);
        if (index === -1) return prev;
        let openDelta = 0;
        let resolvedDelta = 0;
        if (payload.reason === "ticket_created" && !prevStatus && nextIsOpen) {
          openDelta += 1;
        }
        if (prevStatus && nextStatus && prevStatus !== nextStatus) {
          if (prevIsOpen && !nextIsOpen) openDelta -= 1;
          if (!prevIsOpen && nextIsOpen) openDelta += 1;
          if (!prevIsResolved && nextIsResolved) resolvedDelta += 1;
          if (prevIsResolved && !nextIsResolved) resolvedDelta -= 1;
        }
        if (openDelta === 0 && resolvedDelta === 0) return prev;
        const next = [...prev];
        next[index] = {
          ...next[index],
          open: Math.max(0, next[index].open + openDelta),
          resolved: Math.max(0, next[index].resolved + resolvedDelta),
        };
        return next;
      });

      setVolumeSeries((prev) => {
        if (payload.reason !== "ticket_created") return prev;
        return incrementTodaySeries(prev, 1);
      });

      setReopenSeries((prev) => {
        if (
          !nextStatus ||
          nextStatus !== "REOPENED" ||
          prevStatus === "REOPENED"
        ) {
          return prev;
        }
        return incrementTodaySeries(prev, 1);
      });

      setTransfers((prev) => {
        if (payload.reason !== "transferred") {
          return prev;
        }
        return {
          total: Math.max(0, prev.total + 1),
          series: incrementTodaySeries(prev.series, 1),
        };
      });
    },
    [currentEmail, hydrateRealtimeTicketState, sort],
  );

  useEffect(() => {
    const handleTicketChanged = (event: Event) => {
      applyRealtimeTicketPatch(
        (event as CustomEvent<RealtimeTicketChangedEventPayload>).detail,
      );
    };

    window.addEventListener(
      REALTIME_TICKET_CHANGED_EVENT,
      handleTicketChanged as EventListener,
    );

    return () =>
      window.removeEventListener(
        REALTIME_TICKET_CHANGED_EVENT,
        handleTicketChanged as EventListener,
      );
  }, [applyRealtimeTicketPatch]);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      if (loadedOnceRef.current) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        let updatedFrom: string;
        let updatedTo: string | undefined;
        let reportFrom: string;
        let reportTo: string;
        if (range === "custom") {
          // Treat customFrom as start-of-day, customTo as end-of-day in local TZ
          const fromDate = new Date(`${customFrom}T00:00:00`);
          const toDate = new Date(`${customTo}T23:59:59.999`);
          updatedFrom = fromDate.toISOString();
          updatedTo = toDate.toISOString();
          reportFrom = customFrom;
          reportTo = customTo;
        } else {
          const rangeDays = Number(range);
          const from = new Date();
          from.setDate(from.getDate() - rangeDays);
          updatedFrom = from.toISOString();
          reportFrom = updatedFrom.slice(0, 10);
          reportTo = new Date().toISOString().slice(0, 10);
        }
        const order = sort === "oldest" ? "asc" : "desc";

        if (isEmployee) {
          const [recentRes, counts] = await Promise.all([
            fetchTickets({
              pageSize: RECENT_TICKETS_COUNT,
              sort: "updatedAt",
              order,
              scope: "created",
              updatedFrom,
              updatedTo,
              includeTotal: false,
            }).catch(() => EMPTY_TICKETS),
            fetchTicketCounts().catch(() => EMPTY_COUNTS),
          ]);

          if (!active) return;

          const open = counts.open;
          const resolved = counts.resolved;

          setRecentTickets(recentRes.data);
          setStats({
            open,
            resolved,
            total: open + resolved,
            unassigned: 0,
            assignedToMe: 0,
            resolvedByMe: 0,
            atRisk: 0,
            overdue: 0,
          });

          setActivity([]);
          setStatusBreakdown([]);
          setPriorityBreakdown([]);
          setAgeBreakdown([]);
          setAgentWorkload([]);
          setAgentPerformance([]);
          setReopenSeries([]);
          setQueueCategories([]);
          setTeamSummary([]);
          setVolumeSeries([]);
          setTransfers({ total: 0, series: [] });
          setSlaCompliance({ met: 0, breached: 0, total: 0, atRisk: 0 });
        } else {
          const counts = await fetchTicketCounts().catch(() => EMPTY_COUNTS);

          const [
            recentRes,
            activityRes,
            statusRes,
            summaryRes,
            workloadRes,
            ageRes,
            reopenRes,
            categoryRes,
            teamSummaryRes,
            transferRes,
          ] = await Promise.all([
            isAgent
              ? fetchTickets({
                  pageSize: RECENT_TICKETS_COUNT,
                  sort: "updatedAt",
                  order,
                  scope: "assigned",
                  updatedFrom,
                  updatedTo,
                  includeTotal: false,
                }).catch(() => EMPTY_TICKETS)
              : Promise.resolve(EMPTY_TICKETS),
            fetchTicketActivity({
              from: reportFrom,
              to: reportTo,
              ...(isAgent ? { scope: "assigned" as const } : {}),
            }).catch(() => ({ data: [] })),
            isAgent
              ? fetchTicketStatusBreakdown({
                  from: reportFrom,
                  to: reportTo,
                  scope: "assigned",
                  dateField: "updatedAt",
                }).catch(() => ({ data: [] }))
              : Promise.resolve({ data: [] as TicketStatusPoint[] }),
            isLead || isTeamAdmin || isOwner
              ? fetchReportSummary({
                  from: reportFrom,
                  to: reportTo,
                  dateField: "updatedAt",
                }).catch(() => EMPTY_REPORT_SUMMARY)
              : Promise.resolve(EMPTY_REPORT_SUMMARY),
            isLead || isTeamAdmin || isOwner
              ? fetchReportAgentWorkload({
                  from: reportFrom,
                  to: reportTo,
                }).catch(() => ({ data: [] }))
              : Promise.resolve({ data: [] }),
            isTeamAdmin
              ? fetchReportTicketsByAge({
                  from: reportFrom,
                  to: reportTo,
                  dateField: "updatedAt",
                }).catch(() => ({ data: [] }))
              : Promise.resolve({ data: [] }),
            isTeamAdmin || isOwner
              ? fetchReportReopenRate({ from: reportFrom, to: reportTo }).catch(
                  () => ({ data: [] }),
                )
              : Promise.resolve({ data: [] }),
            isTeamAdmin
              ? fetchReportTicketsByCategory({
                  from: reportFrom,
                  to: reportTo,
                  statusGroup: "open",
                  dateField: "updatedAt",
                }).catch(() => ({ data: [] }))
              : Promise.resolve({ data: [] }),
            isOwner
              ? fetchReportTeamSummary({
                  from: reportFrom,
                  to: reportTo,
                  dateField: "updatedAt",
                }).catch(() => ({ data: [] }))
              : Promise.resolve({ data: [] }),
            isTeamAdmin || isOwner
              ? fetchReportTransfers({
                  from: reportFrom,
                  to: reportTo,
                  dateField: "updatedAt",
                }).catch(() => ({ data: { total: 0, series: [] } }))
              : Promise.resolve({ data: { total: 0, series: [] } }),
          ]);

          if (!active) return;

          const open = counts.open;
          const resolved = counts.resolved;

          setRecentTickets(recentRes.data);
          setStats({
            open,
            resolved,
            total: open + resolved,
            unassigned: counts.unassigned,
            assignedToMe: counts.assignedToMe,
            resolvedByMe: counts.resolvedByMe,
            atRisk: counts.atRisk,
            overdue: counts.overdue,
          });

          {
            const fromMs = new Date(`${reportFrom}T00:00:00`).getTime();
            const toMs = new Date(`${reportTo}T00:00:00`).getTime();
            const rangeDaysForActivity = Math.max(
              1,
              Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24)),
            );
            setActivity(
              mapActivitySeries(activityRes.data, rangeDaysForActivity),
            );
          }
          setStatusBreakdown(
            (isAgent
              ? statusRes.data
              : summaryRes.ticketsByStatus
                  .data) as import("../api/client").TicketStatusPoint[],
          );
          setSlaCompliance({
            met: summaryRes.slaCompliance.data.met,
            breached: summaryRes.slaCompliance.data.breached,
            total: summaryRes.slaCompliance.data.total,
            atRisk: counts.atRisk,
          });
          setAgentWorkload(workloadRes.data);
          setAgentPerformance(
            isLead || isOwner ? summaryRes.agentPerformance.data : [],
          );
          setPriorityBreakdown(
            isOwner ? summaryRes.ticketsByPriority.data : [],
          );
          setAgeBreakdown(ageRes.data);
          setReopenSeries(reopenRes.data);
          setQueueCategories(categoryRes.data.slice(0, 6));
          setTeamSummary(teamSummaryRes.data);
          setVolumeSeries(isOwner ? summaryRes.ticketVolume.data : []);
          setTransfers(transferRes.data);
        }

        loadedOnceRef.current = true;
      } finally {
        if (!active) return;
        setLoading(false);
        setRefreshing(false);
      }
    }

    loadDashboard();

    return () => {
      active = false;
    };
  }, [role, range, customFrom, customTo, sort, isEmployee, isAgent, isLead, isTeamAdmin, isOwner]);

  const roleMeta = ROLE_META[role] ?? ROLE_META.EMPLOYEE;

  const activeAgents = useMemo(
    () =>
      agentWorkload.filter(
        (item) => (item.assignedOpen ?? 0) > 0 || (item.inProgress ?? 0) > 0,
      ).length,
    [agentWorkload],
  );

  const reopenTotal = useMemo(
    () => reopenSeries.reduce((sum, item) => sum + item.count, 0),
    [reopenSeries],
  );

  const reopenRate = safePercent(reopenTotal, stats.resolved);
  const unassignedPercent = safePercent(stats.unassigned, stats.open);

  // Owner "Executive vitals" must track the selected date range like every
  // chart on this page does. The /tickets/counts snapshot (stats.*) is always
  // live and ignores the date picker — that's why the vitals stayed at 7/7/14
  // even for an empty range. Derive open/closed/total from the SAME
  // date-ranged status breakdown the charts use (summaryRes.ticketsByStatus →
  // statusBreakdown). Closed = RESOLVED/CLOSED; everything else is open.
  const rangeStats = useMemo(() => {
    const closedStatuses = new Set(["RESOLVED", "CLOSED"]);
    let open = 0;
    let closed = 0;
    let total = 0;
    for (const point of statusBreakdown) {
      total += point.count;
      if (closedStatuses.has(String(point.status).toUpperCase())) {
        closed += point.count;
      } else {
        open += point.count;
      }
    }
    return { open, closed, total };
  }, [statusBreakdown]);

  const kpis = useMemo<KpiItem[]>(() => {
    if (isEmployee) {
      return [
        { label: "My open tickets", value: stats.open, tone: "blue" },
        {
          label: "My resolved & closed tickets",
          value: stats.resolved,
          tone: "green",
        },
      ];
    }

    if (isAgent) {
      return [
        { label: "Total open tickets", value: stats.open, tone: "blue" },
        { label: "Unassigned tickets", value: stats.unassigned, tone: "gray" },
        { label: "Assigned to me", value: stats.assignedToMe, tone: "purple" },
        { label: "Resolved by me", value: stats.resolvedByMe, tone: "green" },
      ];
    }

    if (isLead) {
      return [
        { label: "Total open tickets", value: stats.open, tone: "blue" },
        {
          label: "Unassigned tickets",
          value: stats.unassigned,
          tone: "orange",
        },
        { label: "Assigned to me", value: stats.assignedToMe, tone: "purple" },
        { label: "Resolved by me", value: stats.resolvedByMe, tone: "green" },
      ];
    }

    if (isTeamAdmin) {
      return [
        { label: "Open tickets", value: stats.open, tone: "blue" },
        {
          label: "At risk",
          value: stats.atRisk,
          helper: "Near breach window",
          tone: "orange",
        },
        {
          label: "Overdue",
          value: stats.overdue,
          helper: "Breached SLA",
          tone: "red",
        },
        {
          label: "Active agents",
          value: activeAgents,
          helper: `${unassignedPercent}% unassigned`,
          tone: "purple",
        },
        { label: "Total requests", value: stats.total, tone: "gray" },
      ];
    }

    return [
      { label: "Open tickets", value: rangeStats.open, tone: "blue" },
      { label: "Closed tickets", value: rangeStats.closed, tone: "green" },
      { label: "Total requests", value: rangeStats.total, tone: "gray" },
      { label: "Active agents", value: activeAgents, tone: "purple" },
      { label: "Transfers", value: transfers.total, tone: "orange" },
    ];
  }, [
    activeAgents,
    isAgent,
    isEmployee,
    isLead,
    isTeamAdmin,
    rangeStats,
    stats,
    transfers.total,
    unassignedPercent,
  ]);

  return (
    <section className="min-h-screen bg-background">
      <div className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-[1600px] px-6 py-4">
          {headerCtx ? (
            <TopBar
              title={headerCtx.title}
              subtitle={headerCtx.subtitle}
              currentEmail={headerCtx.currentEmail}
              onOpenSearch={headerCtx.onOpenSearch}
              notificationProps={headerCtx.notificationProps}
              leftContent={
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-foreground">
                    {headerCtx.title}
                  </h1>
                  <p className="text-sm font-medium text-muted-foreground">
                    {headerCtx.subtitle}
                  </p>
                  {refreshing ? (
                    <p className="mt-1 text-xs font-semibold text-primary">
                      Refreshing data...
                    </p>
                  ) : null}
                </div>
              }
            />
          ) : (
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                {roleMeta.title}
              </h1>
              <p className="text-sm font-medium text-muted-foreground">
                {roleMeta.subtitle}
              </p>
              {refreshing ? (
                <p className="mt-1 text-xs font-semibold text-primary">
                  Refreshing data...
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1600px] px-6 py-8">
        <div className="space-y-8">
          {isEmployee ? (
            <div className="grid gap-8 lg:grid-cols-12">
              <div className="lg:col-span-8">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight text-foreground">
                      My Requests
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Track the status of your submitted tickets
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={sort}
                      onChange={(event) =>
                        setSort(event.target.value as "recent" | "oldest")
                      }
                      className="surface-card px-4 py-2 text-sm font-medium hover:border-primary/40 transition outline-none text-foreground"
                    >
                      <option value="recent">Most recent</option>
                      <option value="oldest">Oldest</option>
                    </select>
                  </div>
                </div>

                {loading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-32 animate-pulse rounded-[24px] border border-border bg-white/[0.04]"
                      />
                    ))}
                  </div>
                ) : recentTickets.length === 0 ? (
                  <EmptyState
                    title="No recent activity"
                    description={`No recent activity found.`}
                    compact
                  />
                ) : (
                  <div className="space-y-4">
                    {recentTickets.map((ticket) => (
                      <ModernTicketCard
                        key={ticket.id}
                        ticket={ticket}
                        onClick={() => navigate(`/tickets/${ticket.id}`)}
                      />
                    ))}
                    <div className="pt-4 text-center">
                      <button
                        type="button"
                        onClick={() => navigate("/tickets?scope=created")}
                        className="text-sm font-semibold text-primary transition hover:text-primary/80"
                      >
                        View my tickets →
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-6 lg:col-span-4">
                <div className="bg-card rounded-[24px] p-6 border border-border">
                  <h3 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground mb-6">
                    Quick Stats
                  </h3>
                  <div className="space-y-5">
                    {kpis.map((item, idx) => {
                      const tone = kpiToneClass(item.tone);
                      return (
                        <div
                          key={idx}
                          className="flex justify-between items-center pb-5 border-b border-slate-50 last:border-0 last:pb-0"
                        >
                          <div>
                            <div className="text-[14px] font-medium text-muted-foreground">
                              {item.label}
                            </div>
                            {item.helper && (
                              <div
                                className={`mt-0.5 text-[11px] font-bold uppercase tracking-wider ${tone.text}`}
                              >
                                {item.helper}
                              </div>
                            )}
                          </div>
                          <div className="text-3xl font-bold tracking-tight text-foreground">
                            {item.value}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {isAgent ? (
            <div className="grid gap-8 lg:grid-cols-12">
              <div className="lg:col-span-8">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight text-foreground">
                      Your Action Items
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Review and resolve your assigned tickets
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={sort}
                      onChange={(event) =>
                        setSort(event.target.value as "recent" | "oldest")
                      }
                      className="surface-card px-4 py-2 text-sm font-medium hover:border-primary/40 transition outline-none text-foreground"
                    >
                      <option value="recent">Most recent updates</option>
                      <option value="oldest">Oldest updates</option>
                    </select>
                  </div>
                </div>

                {loading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-32 animate-pulse rounded-[24px] border border-border bg-white/[0.04]"
                      />
                    ))}
                  </div>
                ) : recentTickets.length === 0 ? (
                  <EmptyState
                    title="All caught up!"
                    description="No active tickets require your attention."
                    compact
                  />
                ) : (
                  <div className="space-y-4">
                    {recentTickets.map((ticket) => (
                      <ModernTicketCard
                        key={ticket.id}
                        ticket={ticket}
                        onClick={() => navigate(`/tickets/${ticket.id}`)}
                      />
                    ))}
                    <div className="pt-4 text-center">
                      <button
                        type="button"
                        onClick={() => navigate("/tickets")}
                        className="text-sm font-semibold text-primary transition hover:text-primary/80"
                      >
                        View all tickets →
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-6 lg:col-span-4">
                <div className="bg-card rounded-[24px] p-6 border border-border">
                  <h3 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground mb-6">
                    Workload Vitals
                  </h3>
                  <div className="space-y-5">
                    {kpis.map((item, idx) => {
                      const tone = kpiToneClass(item.tone);
                      return (
                        <div
                          key={idx}
                          className="flex justify-between items-center pb-5 border-b border-slate-50 last:border-0 last:pb-0"
                        >
                          <div>
                            <div className="text-[14px] font-medium text-muted-foreground">
                              {item.label}
                            </div>
                            {item.helper && (
                              <div
                                className={`mt-0.5 text-[11px] font-bold uppercase tracking-wider ${tone.text}`}
                              >
                                {item.helper}
                              </div>
                            )}
                          </div>
                          <div className="text-3xl font-bold tracking-tight text-foreground">
                            {item.value}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-card rounded-[24px] p-6 border border-border flex min-h-[300px] flex-col">
                  <h3 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
                    Activity Trend
                  </h3>
                  {loading ? (
                    <div className="flex-1 animate-pulse rounded-xl bg-white/[0.04]" />
                  ) : (
                    <div className="flex-1 -mx-4 mt-2">
                      <TicketActivityChart data={activity} />
                    </div>
                  )}
                </div>

                <div className="bg-card rounded-[24px] p-6 border border-border flex min-h-[300px] flex-col">
                  <h3 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
                    Queue Status
                  </h3>
                  {loading ? (
                    <div className="flex-1 animate-pulse rounded-xl bg-white/[0.04]" />
                  ) : (
                    <div className="flex-1 -mx-4 mt-2">
                      <StatusDonutChart data={statusBreakdown} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {isLead ? (
            <div className="grid gap-8 lg:grid-cols-12">
              <div className="space-y-6 lg:col-span-8">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight text-foreground">
                      Team Insights
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Monitor your team's workload and SLA compliance
                    </p>
                  </div>
                  {renderRangeFilter()}
                </div>

                <div className="bg-card rounded-[24px] p-6 border border-border min-h-[300px] flex flex-col">
                  <h3 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
                    Agent Workload
                  </h3>
                  {loading ? (
                    <div className="flex-1 animate-pulse bg-white/[0.04] rounded-xl" />
                  ) : (
                    <div className="flex-1 -mx-4">
                      <LeadAgentWorkloadBarChart data={agentWorkload} />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-card rounded-[24px] p-6 border border-border flex flex-col">
                    <h3 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
                      Status Distribution
                    </h3>
                    {loading ? (
                      <div className="flex-1 animate-pulse bg-white/[0.04] rounded-xl" />
                    ) : (
                      <div className="flex-1 -mx-4">
                        <LeadStatusPieChart data={statusBreakdown} />
                      </div>
                    )}
                  </div>
                  <div className="bg-card rounded-[24px] p-6 border border-border flex flex-col">
                    <h3 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
                      Agent Performance
                    </h3>
                    <div className="flex-1">
                      {loading ? (
                        <div className="animate-pulse bg-white/[0.04] h-32 rounded-xl" />
                      ) : agentPerformance.length === 0 ? (
                        <span className="text-sm text-muted-foreground">No data</span>
                      ) : (
                        agentPerformance.slice(0, 4).map((agent) => (
                          <div
                            key={agent.userId}
                            className="flex justify-between items-center py-3 border-b border-slate-50 last:border-0"
                          >
                            <span className="font-semibold text-foreground text-[15px]">
                              {agent.name}
                            </span>
                            <div className="flex gap-2 items-center text-sm">
                              <span className="text-muted-foreground">
                                {agent.ticketsResolved} res
                              </span>
                              <span className="font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded">
                                {agent.ticketsResolved > 0
                                  ? `${Math.min(100, Math.round((agent.firstResponses / agent.ticketsResolved) * 100))}%`
                                  : "—"}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6 lg:col-span-4">
                <div className="bg-card rounded-[24px] p-6 border border-border">
                  <h3 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground mb-6">
                    Team Vitals
                  </h3>
                  <div className="space-y-5">
                    {kpis.map((item, idx) => {
                      const tone = kpiToneClass(item.tone);
                      return (
                        <div
                          key={idx}
                          className="flex justify-between items-center pb-5 border-b border-slate-50 last:border-0 last:pb-0"
                        >
                          <div>
                            <div className="text-[14px] font-medium text-muted-foreground">
                              {item.label}
                            </div>
                            {item.helper && (
                              <div
                                className={`mt-0.5 text-[11px] font-bold uppercase tracking-wider ${tone.text}`}
                              >
                                {item.helper}
                              </div>
                            )}
                          </div>
                          <div className="text-3xl font-bold tracking-tight text-foreground">
                            {item.value}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-card rounded-[24px] p-6 border border-border flex min-h-[300px] flex-col">
                  <h3 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
                    SLA Performance
                  </h3>
                  {loading ? (
                    <div className="flex-1 animate-pulse bg-white/[0.04] rounded-xl" />
                  ) : (
                    <div className="flex-1 -mx-4">
                      <LeadSlaBarChart
                        data={{
                          met: slaCompliance.met,
                          atRisk: slaCompliance.atRisk,
                          breached: slaCompliance.breached,
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {isTeamAdmin ? (
            <div className="grid gap-8 lg:grid-cols-12">
              <div className="space-y-6 lg:col-span-8">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight text-foreground">
                      Queue Operations
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Manage triage configurations and active queue health
                    </p>
                  </div>
                  {renderRangeFilter()}
                </div>

                {/* Operational Warnings Bento */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-card rounded-[24px] p-6 border border-red-500/20 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-red-500" />
                    <h3 className="text-sm font-bold text-foreground/80 mb-2">
                      Breached SLA
                    </h3>
                    <div className="text-4xl font-bold tracking-tight text-red-600 mb-1">
                      {stats.overdue}
                    </div>
                    <p className="text-[12px] font-semibold text-muted-foreground">
                      Immediate attention
                    </p>
                  </div>
                  <div className="bg-card rounded-[24px] p-6 border border-orange-500/20 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-orange-500" />
                    <h3 className="text-sm font-bold text-foreground/80 mb-2">
                      At Risk
                    </h3>
                    <div className="text-4xl font-bold tracking-tight text-orange-600 mb-1">
                      {stats.atRisk}
                    </div>
                    <p className="text-[12px] font-semibold text-muted-foreground">
                      Approaching breach
                    </p>
                  </div>
                  <div className="bg-card rounded-[24px] p-6 border border-blue-500/20 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-blue-500" />
                    <h3 className="text-sm font-bold text-foreground/80 mb-2">
                      Unassigned
                    </h3>
                    <div className="text-4xl font-bold tracking-tight text-primary mb-1">
                      {stats.unassigned}
                    </div>
                    <p className="text-[12px] font-semibold text-muted-foreground">
                      {unassignedPercent}% of open
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-card rounded-[24px] p-6 border border-border flex min-h-[300px] flex-col">
                    <h3 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
                      Tickets by Age
                    </h3>
                    {loading ? (
                      <div className="flex-1 animate-pulse bg-white/[0.04] rounded-xl" />
                    ) : (
                      <div className="flex-1 -mx-4 mt-2">
                        <TicketsByAgeChart data={ageBreakdown} />
                      </div>
                    )}
                  </div>
                  <div className="bg-card rounded-[24px] p-6 border border-border flex min-h-[300px] flex-col">
                    <h3 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
                      Reopen Trend
                    </h3>
                    {loading ? (
                      <div className="flex-1 animate-pulse bg-white/[0.04] rounded-xl" />
                    ) : (
                      <div className="flex-1 -mx-4 mt-2">
                        {reopenSeries.length > 0 ? (
                          <ReopenRateChart data={reopenSeries} />
                        ) : (
                          <span className="p-4 text-muted-foreground">No data</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-card rounded-[24px] p-6 border border-border">
                  <h3 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
                    Routing Exceptions & Categories
                  </h3>
                  <div className="grid grid-cols-2 gap-8 text-sm">
                    <div className="space-y-4">
                      <div className="flex justify-between border-b border-slate-50 pb-2">
                        <span className="text-foreground/70">
                          Emails not parsed
                        </span>
                        <span className="font-bold text-red-600">0</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-50 pb-2">
                        <span className="text-foreground/70">Auto-assigned</span>
                        <span className="font-bold text-primary">
                          {stats.assignedToMe}
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-slate-50 pb-2">
                        <span className="text-foreground/70">Failed webhooks</span>
                        <span className="font-bold text-orange-600">0</span>
                      </div>
                    </div>
                    <div className="space-y-4 border-l border-border pl-8">
                      {queueCategories.slice(0, 3).map((c) => (
                        <div
                          key={c.id}
                          className="flex justify-between border-b border-slate-50 pb-2"
                        >
                          <span className="text-foreground/70">{c.name}</span>
                          <span className="font-bold">{c.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6 lg:col-span-4">
                <div className="bg-slate-900 rounded-[24px] p-6 shadow-[0_4px_20px_rgb(0,0,0,0.1)] border border-slate-800">
                  <h3 className="text-[13px] font-bold uppercase tracking-widest text-slate-400 mb-6">
                    Admin Summary
                  </h3>
                  <div className="space-y-5">
                    {kpis.map((item, idx) => {
                      return (
                        <div
                          key={idx}
                          className="flex justify-between items-center pb-5 border-b border-slate-800 last:border-0 last:pb-0"
                        >
                          <div>
                            <div className="text-[14px] font-medium text-slate-300">
                              {item.label}
                            </div>
                          </div>
                          <div className="text-3xl font-bold tracking-tight text-white">
                            {item.value}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-card rounded-[24px] p-6 border border-border">
                  <h3 className="text-[13px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
                    Quick Settings
                  </h3>
                  <div className="space-y-3">
                    <button
                      onClick={() => navigate("/routing")}
                      className="w-full text-left px-4 py-3 bg-white/[0.04] rounded-xl text-[14px] font-semibold text-foreground/80 hover:bg-primary/10 hover:text-primary transition"
                    >
                      ⚙️ Routing Rules Mode
                    </button>
                    <button
                      disabled
                      className="w-full text-left px-4 py-3 bg-white/[0.04] rounded-xl text-[14px] font-semibold text-muted-foreground cursor-not-allowed"
                    >
                      ⏱️ Business Hours Config
                    </button>
                    <button
                      disabled
                      className="w-full text-left px-4 py-3 bg-white/[0.04] rounded-xl text-[14px] font-semibold text-muted-foreground cursor-not-allowed"
                    >
                      ⚡ Macros Library
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {isOwner ? (
            <div className="grid gap-8 lg:grid-cols-12">
              <div className="space-y-6 lg:col-span-8">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight text-foreground">
                      Platform Overview
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Cross-team performance and business metrics
                    </p>
                  </div>
                  {renderRangeFilter()}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="relative overflow-hidden surface-card p-5">
                    <span
                      className="absolute inset-x-0 top-0 h-1 bg-primary"
                      aria-hidden
                    />
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Total open
                      </p>
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Inbox className="h-4 w-4" strokeWidth={2} />
                      </span>
                    </div>
                    <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                      {stats.open}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      System-wide
                    </p>
                  </div>
                  <div className="surface-card p-5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Total transfers
                      </p>
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
                        <ArrowLeftRight className="h-4 w-4" strokeWidth={2} />
                      </span>
                    </div>
                    <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                      {transfers.total}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Reassigned across teams
                    </p>
                  </div>
                  <div className="surface-card p-5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Reopen rate
                      </p>
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                          reopenRate > 10
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <RotateCcw className="h-4 w-4" strokeWidth={2} />
                      </span>
                    </div>
                    <div
                      className={`mt-2 text-3xl font-semibold tracking-tight tabular-nums ${
                        reopenRate > 10
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-foreground"
                      }`}
                    >
                      {reopenRate}%
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Resolved then reopened
                    </p>
                  </div>
                </div>

                <div className="flex min-h-[300px] flex-col overflow-hidden surface-card p-6">
                  <h3 className="mb-4 text-sm font-semibold text-foreground">
                    Platform activity
                  </h3>
                  {loading ? (
                    <div className="flex-1 skeleton-shimmer rounded-lg" />
                  ) : (
                    <div className="-mx-2 flex-1">
                      <TicketVolumeChart data={volumeSeries} />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div className="flex flex-col overflow-hidden surface-card p-6">
                    <h3 className="mb-4 text-sm font-semibold text-foreground">
                      Tickets by priority
                    </h3>
                    {loading ? (
                      <div className="flex-1 skeleton-shimmer rounded-lg" />
                    ) : (
                      <div className="-mx-2 flex-1">
                        <PriorityDonutChart data={priorityBreakdown} />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col surface-card p-6">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">
                      Top performers
                    </h3>
                    <div className="flex-1">
                      {loading ? (
                        <div className="h-32 skeleton-shimmer rounded-lg" />
                      ) : agentPerformance.length === 0 ? (
                        <span className="text-sm text-muted-foreground">
                          No data
                        </span>
                      ) : (
                        <ul className="divide-y divide-border">
                          {agentPerformance.slice(0, 4).map((agent, idx) => (
                            <li
                              key={agent.userId}
                              className="flex items-center justify-between gap-3 py-2.5"
                            >
                              <span className="flex items-center gap-2.5 text-sm font-medium text-foreground">
                                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">
                                  {idx + 1}
                                </span>
                                {agent.name}
                              </span>
                              <span className="rounded-md bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-500/15 dark:text-green-400">
                                {agent.avgFirstResponseHours == null
                                  ? "—"
                                  : `${agent.avgFirstResponseHours.toFixed(1)}h FRT`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6 lg:col-span-4">
                <div className="surface-card p-6">
                  <h3 className="mb-4 text-sm font-semibold text-foreground">
                    Executive vitals
                  </h3>
                  <div className="divide-y divide-border">
                    {kpis.map((item, idx) => {
                      const tone = kpiToneClass(item.tone);
                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground">
                              {item.label}
                            </div>
                            {item.helper && (
                              <div className={`mt-0.5 text-xs ${tone.text}`}>
                                {item.helper}
                              </div>
                            )}
                          </div>
                          <div className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                            {item.value}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex min-h-[280px] flex-col overflow-hidden surface-card p-6">
                  <h3 className="mb-4 text-sm font-semibold text-foreground">
                    SLA compliance
                  </h3>
                  {loading ? (
                    <div className="flex-1 skeleton-shimmer rounded-lg" />
                  ) : (
                    <div className="-mx-2 flex-1">
                      <LeadSlaBarChart
                        data={{
                          met: slaCompliance.met,
                          atRisk: slaCompliance.atRisk,
                          breached: slaCompliance.breached,
                        }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-col surface-card p-6">
                  <h3 className="mb-3 text-sm font-semibold text-foreground">
                    Team summary
                  </h3>
                  {loading ? (
                    <div className="h-40 skeleton-shimmer rounded-lg" />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="py-2 text-left font-medium">Team</th>
                            <th className="py-2 text-right font-medium">Open</th>
                            <th className="py-2 text-right font-medium">SLA</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {teamSummary.map((team) => {
                            const pct = safePercent(team.resolved, team.total);
                            return (
                              <tr key={team.id}>
                                <td className="py-2.5 font-medium text-foreground">
                                  {team.name}
                                </td>
                                <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                                  {team.open}
                                </td>
                                <td
                                  className={`py-2.5 text-right font-semibold tabular-nums ${
                                    pct >= 90
                                      ? "text-green-600 dark:text-green-400"
                                      : pct >= 75
                                        ? "text-amber-600 dark:text-amber-400"
                                        : "text-red-600 dark:text-red-400"
                                  }`}
                                >
                                  {pct}%
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
