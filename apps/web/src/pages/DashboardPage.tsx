import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchReportAgentPerformance,
  fetchReportAgentWorkload,
  fetchReportReopenRate,
  fetchReportSlaCompliance,
  fetchReportTeamSummary,
  fetchReportTicketVolume,
  fetchReportTicketsByAge,
  fetchReportTicketsByCategory,
  fetchReportTicketsByPriority,
  fetchReportTransfers,
  fetchTicketActivity,
  fetchTicketStatusBreakdown,
  fetchTickets,
  type AgentPerformanceResponse,
  type AgentWorkloadResponse,
  type NotificationRecord,
  type ReopenRateResponse,
  type TeamSummaryResponse,
  type TicketActivityPoint,
  type TicketAgeBucketResponse,
  type TicketRecord,
  type TicketStatusPoint,
  type TicketsByCategoryResponse,
  type TicketsByPriorityResponse,
  type TransfersResponse,
} from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { RelativeTime } from '../components/RelativeTime';
import { TopBar } from '../components/TopBar';
import { StatusBadge } from '../components/dashboard/StatusBadge';
import { TicketActivityChart, type ActivityPoint } from '../components/dashboard/TicketActivityChart';
import { ReopenRateChart } from '../components/reports/ReopenRateChart';
import { TicketVolumeChart } from '../components/reports/TicketVolumeChart';
import { TicketsByAgeChart } from '../components/reports/TicketsByAgeChart';
import { formatStatus, formatTicketId, getSlaTone } from '../utils/format';
import type { Role } from '../types';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const RECENT_TICKETS_COUNT = 6;

type DashboardHeaderProps = {
  title: string;
  subtitle: string;
  currentEmail: string;
  personas: { label: string; email: string }[];
  onEmailChange: (email: string) => void;
  onOpenSearch?: () => void;
  notificationProps?: {
    notifications: NotificationRecord[];
    unreadCount: number;
    loading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
    onMarkAsRead: (id: string) => void;
    onMarkAllAsRead: () => void;
    onRefresh: () => void;
  };
};

type DashboardPageProps = {
  refreshKey: number;
  role: Role;
  headerProps?: DashboardHeaderProps;
};

type KpiTone = 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'gray';

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
  EMPLOYEE: { title: 'My Dashboard', subtitle: 'Track your support requests' },
  AGENT: { title: 'Agent Dashboard', subtitle: 'Your assigned tickets and workload' },
  LEAD: { title: 'Team Lead Dashboard', subtitle: 'Team insights and performance' },
  TEAM_ADMIN: { title: 'Team Admin Dashboard', subtitle: 'Queue operations and SLA management' },
  OWNER: { title: 'Platform Dashboard', subtitle: 'Organization-wide metrics' },
  ADMIN: { title: 'Admin Dashboard', subtitle: 'Operational metrics' },
};

const EMPTY_TICKETS = {
  data: [] as TicketRecord[],
  meta: { page: 1, pageSize: 0, total: 0, totalPages: 0 },
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

function toRangeLabel(range: '3' | '7' | '30') {
  if (range === '3') return 'Last 3 days';
  if (range === '7') return 'Last 7 days';
  return 'Last 30 days';
}

function mapActivitySeries(data: TicketActivityPoint[], rangeDays: number): ActivityPoint[] {
  return data.map((point) => {
    const date = new Date(`${point.date}T00:00:00Z`);
    const day =
      rangeDays > 7
        ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
        : date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    return { ...point, day };
  });
}

function priorityLabel(priority?: string | null): string {
  switch (priority) {
    case 'P1':
      return 'Urgent';
    case 'P2':
      return 'High';
    case 'P3':
      return 'Medium';
    case 'P4':
    default:
      return 'Low';
  }
}

function priorityClass(priority?: string | null): string {
  switch (priority) {
    case 'P1':
      return 'bg-red-100 text-red-700';
    case 'P2':
      return 'bg-orange-100 text-orange-700';
    case 'P3':
      return 'bg-blue-100 text-blue-700';
    case 'P4':
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function activitySummary(ticket: TicketRecord): string {
  if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
    return 'Resolved';
  }
  if (ticket.status === 'WAITING_ON_REQUESTER') {
    return 'Waiting for requester';
  }
  if (ticket.status === 'WAITING_ON_VENDOR') {
    return 'Waiting for vendor';
  }
  return `Status changed to ${formatStatus(ticket.status)}`;
}

function safePercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function panelClass(): string {
  return 'rounded-lg border border-slate-200 bg-white p-4';
}

function kpiToneClass(tone: KpiTone): string {
  switch (tone) {
    case 'green':
      return 'bg-green-50 border-green-200';
    case 'purple':
      return 'bg-violet-50 border-violet-200';
    case 'orange':
      return 'bg-orange-50 border-orange-200';
    case 'red':
      return 'bg-red-50 border-red-200';
    case 'gray':
      return 'bg-slate-100 border-slate-200';
    case 'blue':
    default:
      return 'bg-blue-50 border-blue-200';
  }
}

function Panel({ title, right, children }: { title: string; right?: string; children: ReactNode }) {
  return (
    <div className={panelClass()}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {right ? <span className="text-xs text-slate-500">{right}</span> : null}
      </div>
      {children}
    </div>
  );
}

function KpiCard({ item }: { item: KpiItem }) {
  return (
    <div className={`rounded-lg border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${kpiToneClass(item.tone)}`}>
      <div className="text-sm text-slate-600">{item.label}</div>
      <div className="mt-1 text-3xl font-bold text-slate-900">{item.value}</div>
      {item.helper ? <div className="mt-1 text-xs text-slate-500">{item.helper}</div> : null}
    </div>
  );
}

function PriorityBadge({ priority }: { priority?: string | null }) {
  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${priorityClass(priority)}`}>
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
    <span className={`inline-flex rounded border px-2 py-1 text-xs font-medium ${tone.className}`}>
      {tone.label}
    </span>
  );
}

function ChartLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
      {items.map((item) => (
        <div key={item.label} className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function StatusDonutChart({ data }: { data: TicketStatusPoint[] }) {
  function statusColor(status: string): string {
    switch (status) {
      case 'NEW':
        return '#3b82f6';
      case 'TRIAGED':
        return '#8b5cf6';
      case 'ASSIGNED':
        return '#06b6d4';
      case 'IN_PROGRESS':
        return '#fbbf24';
      case 'WAITING_ON_REQUESTER':
        return '#f59e0b';
      case 'WAITING_ON_VENDOR':
        return '#d97706';
      case 'RESOLVED':
        return '#22c55e';
      case 'CLOSED':
        return '#71717a';
      case 'REOPENED':
        return '#ef4444';
      default:
        return '#94a3b8';
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
    return <div className="flex h-[200px] items-center justify-center text-sm text-slate-500">No tickets in range</div>;
  }

  return (
    <div className="space-y-3">
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={points} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={2}>
              {points.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip formatter={(value: number | undefined) => [value ?? 0, 'Tickets']} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={points.map((point) => ({ label: point.name, color: point.color }))} />
    </div>
  );
}

function PriorityDonutChart({ data }: { data: TicketsByPriorityResponse['data'] }) {
  const points = data
    .map((item) => ({
      name: priorityLabel(item.priority),
      value: item.count,
      color:
        item.priority === 'P1'
          ? '#ef4444'
          : item.priority === 'P2'
          ? '#fb923c'
          : item.priority === 'P3'
          ? '#3b82f6'
          : '#9ca3af',
    }))
    .filter((item) => item.value > 0);

  if (points.length === 0) {
    return <div className="flex h-[200px] items-center justify-center text-sm text-slate-500">No tickets in range</div>;
  }

  return (
    <div className="space-y-3">
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={points} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={2}>
              {points.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip formatter={(value: number | undefined) => [value ?? 0, 'Tickets']} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={points.map((point) => ({ label: point.name, color: point.color }))} />
    </div>
  );
}

function LeadAgentWorkloadBarChart({ data }: { data: AgentWorkloadResponse['data'] }) {
  const points = data.map((item) => ({
    name: item.name || item.email || 'Agent',
    openTickets: Math.max(0, item.assignedOpen ?? 0),
  }));

  if (points.length === 0) {
    return <div className="flex h-[250px] items-center justify-center text-sm text-slate-500">No assigned open tickets.</div>;
  }

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 5, right: 5, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#64748b" />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#64748b" />
          <Tooltip formatter={(value: number | undefined) => [value ?? 0, 'Open Tickets']} />
          <Bar dataKey="openTickets" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function LeadSlaBarChart({ data }: { data: { met: number; atRisk: number; breached: number } }) {
  const points = [
    { name: 'Met', value: data.met, color: '#22c55e' },
    { name: 'At Risk', value: data.atRisk, color: '#f59e0b' },
    { name: 'Breached', value: data.breached, color: '#ef4444' },
  ];

  if (points.every((item) => item.value <= 0)) {
    return <div className="flex h-[250px] items-center justify-center text-sm text-slate-500">No SLA data in range.</div>;
  }

  return (
    <div className="h-[250px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 5, right: 5, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="#64748b" />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#64748b" />
          <Tooltip formatter={(value: number | undefined) => [value ?? 0, 'Tickets']} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {points.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function LeadStatusPieChart({ data }: { data: TicketStatusPoint[] }) {
  function statusColor(status: string): string {
    switch (status) {
      case 'NEW':
        return '#3b82f6';
      case 'TRIAGED':
        return '#8b5cf6';
      case 'ASSIGNED':
        return '#06b6d4';
      case 'IN_PROGRESS':
        return '#fbbf24';
      case 'WAITING_ON_REQUESTER':
        return '#f59e0b';
      case 'WAITING_ON_VENDOR':
        return '#d97706';
      case 'RESOLVED':
        return '#22c55e';
      case 'CLOSED':
        return '#71717a';
      case 'REOPENED':
        return '#ef4444';
      default:
        return '#94a3b8';
    }
  }

  const points = data.map((item) => ({
    name: formatStatus(item.status),
    value: item.count,
    color: statusColor(item.status),
  }));

  const total = points.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) {
    return <div className="flex h-[250px] items-center justify-center text-sm text-slate-500">No tickets in range</div>;
  }

  return (
    <div className="space-y-3">
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={points} dataKey="value" nameKey="name" innerRadius={55} outerRadius={105}>
              {points.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip formatter={(value: number | undefined) => [value ?? 0, 'Tickets']} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend items={points.map((item) => ({ label: item.name, color: item.color }))} />
    </div>
  );
}

export function DashboardPage({ refreshKey, role, headerProps }: DashboardPageProps) {
  const navigate = useNavigate();
  const isEmployee = role === 'EMPLOYEE';
  const isAgent = role === 'AGENT';
  const isLead = role === 'LEAD';
  const isTeamAdmin = role === 'TEAM_ADMIN';
  const isOwner = role === 'OWNER';

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<'3' | '7' | '30'>('30');
  const [sort, setSort] = useState<'recent' | 'oldest'>('recent');

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
  const [statusBreakdown, setStatusBreakdown] = useState<TicketStatusPoint[]>([]);
  const [priorityBreakdown, setPriorityBreakdown] = useState<TicketsByPriorityResponse['data']>([]);
  const [ageBreakdown, setAgeBreakdown] = useState<TicketAgeBucketResponse['data']>([]);
  const [agentWorkload, setAgentWorkload] = useState<AgentWorkloadResponse['data']>([]);
  const [agentPerformance, setAgentPerformance] = useState<AgentPerformanceResponse['data']>([]);
  const [reopenSeries, setReopenSeries] = useState<ReopenRateResponse['data']>([]);
  const [queueCategories, setQueueCategories] = useState<TicketsByCategoryResponse['data']>([]);
  const [teamSummary, setTeamSummary] = useState<TeamSummaryResponse['data']>([]);
  const [volumeSeries, setVolumeSeries] = useState<{ date: string; count: number }[]>([]);
  const [transfers, setTransfers] = useState<TransfersResponse['data']>({ total: 0, series: [] });
  const [slaCompliance, setSlaCompliance] = useState({ met: 0, breached: 0, total: 0, atRisk: 0 });

  const loadedOnceRef = useRef(false);

  useEffect(() => {
    setRange('30');
    setSort('recent');
  }, [role]);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      if (loadedOnceRef.current) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const rangeDays = Number(range);
        const from = new Date();
        from.setDate(from.getDate() - rangeDays);
        const updatedFrom = from.toISOString();
        const reportFrom = updatedFrom.slice(0, 10);
        const reportTo = new Date().toISOString().slice(0, 10);
        const order = sort === 'oldest' ? 'asc' : 'desc';

        if (isEmployee) {
          const [recentRes, openRes, resolvedRes] = await Promise.all([
            fetchTickets({
              pageSize: RECENT_TICKETS_COUNT,
              sort: 'updatedAt',
              order,
              scope: 'created',
              updatedFrom,
            }).catch(() => EMPTY_TICKETS),
            fetchTickets({ pageSize: 1, statusGroup: 'open', scope: 'created' }).catch(() => EMPTY_TICKETS),
            fetchTickets({ pageSize: 1, statusGroup: 'resolved', scope: 'created' }).catch(() => EMPTY_TICKETS),
          ]);

          if (!active) return;

          const open = openRes.meta.total;
          const resolved = resolvedRes.meta.total;

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
          const needsSlaCounts = isLead || isTeamAdmin || isOwner;
          const [openRes, resolvedRes, unassignedRes, assignedToMeRes, resolvedByMeRes, atRiskRes, overdueRes] =
            await Promise.all([
              fetchTickets({ pageSize: 1, statusGroup: 'open' }).catch(() => EMPTY_TICKETS),
              fetchTickets({ pageSize: 1, statusGroup: 'resolved' }).catch(() => EMPTY_TICKETS),
              fetchTickets({ pageSize: 1, statusGroup: 'open', scope: 'unassigned' }).catch(() => EMPTY_TICKETS),
              fetchTickets({ pageSize: 1, statusGroup: 'open', scope: 'assigned' }).catch(() => EMPTY_TICKETS),
              fetchTickets({ pageSize: 1, statusGroup: 'resolved', scope: 'assigned' }).catch(() => EMPTY_TICKETS),
              needsSlaCounts
                ? fetchTickets({ pageSize: 1, slaStatus: ['at_risk'] }).catch(() => EMPTY_TICKETS)
                : Promise.resolve(EMPTY_TICKETS),
              needsSlaCounts
                ? fetchTickets({ pageSize: 1, slaStatus: ['breached'] }).catch(() => EMPTY_TICKETS)
                : Promise.resolve(EMPTY_TICKETS),
            ]);

          const [recentRes, activityRes, statusRes, slaRes, workloadRes, performanceRes, priorityRes, ageRes, reopenRes, categoryRes, teamSummaryRes, volumeRes, transferRes] =
            await Promise.all([
              isAgent
                ? fetchTickets({
                    pageSize: RECENT_TICKETS_COUNT,
                    sort: 'updatedAt',
                    order,
                    scope: 'assigned',
                    updatedFrom,
                  }).catch(() => EMPTY_TICKETS)
                : Promise.resolve(EMPTY_TICKETS),
              fetchTicketActivity({
                from: reportFrom,
                to: reportTo,
                ...(isAgent ? { scope: 'assigned' as const } : {}),
              }).catch(() => ({ data: [] })),
              fetchTicketStatusBreakdown({
                from: reportFrom,
                to: reportTo,
                ...(isAgent ? { scope: 'assigned' as const } : {}),
                dateField: 'updatedAt',
              }).catch(() => ({ data: [] })),
              isLead || isTeamAdmin || isOwner
                ? fetchReportSlaCompliance({ from: reportFrom, to: reportTo, dateField: 'updatedAt' }).catch(() => EMPTY_SLA)
                : Promise.resolve(EMPTY_SLA),
              isLead || isTeamAdmin || isOwner
                ? fetchReportAgentWorkload({ from: reportFrom, to: reportTo }).catch(() => ({ data: [] }))
                : Promise.resolve({ data: [] }),
              isLead || isOwner
                ? fetchReportAgentPerformance({ from: reportFrom, to: reportTo, dateField: 'updatedAt' }).catch(() => ({ data: [] }))
                : Promise.resolve({ data: [] }),
              isOwner
                ? fetchReportTicketsByPriority({ from: reportFrom, to: reportTo, dateField: 'updatedAt' }).catch(() => ({ data: [] }))
                : Promise.resolve({ data: [] }),
              isTeamAdmin
                ? fetchReportTicketsByAge({ from: reportFrom, to: reportTo, dateField: 'updatedAt' }).catch(() => ({ data: [] }))
                : Promise.resolve({ data: [] }),
              isTeamAdmin || isOwner
                ? fetchReportReopenRate({ from: reportFrom, to: reportTo }).catch(() => ({ data: [] }))
                : Promise.resolve({ data: [] }),
              isTeamAdmin
                ? fetchReportTicketsByCategory({
                    from: reportFrom,
                    to: reportTo,
                    statusGroup: 'open',
                    dateField: 'updatedAt',
                  }).catch(() => ({ data: [] }))
                : Promise.resolve({ data: [] }),
              isOwner
                ? fetchReportTeamSummary({ from: reportFrom, to: reportTo, dateField: 'updatedAt' }).catch(() => ({ data: [] }))
                : Promise.resolve({ data: [] }),
              isOwner
                ? fetchReportTicketVolume({ from: reportFrom, to: reportTo, dateField: 'updatedAt' }).catch(() => ({ data: [] }))
                : Promise.resolve({ data: [] }),
              isTeamAdmin || isOwner
                ? fetchReportTransfers({ from: reportFrom, to: reportTo, dateField: 'updatedAt' }).catch(() => ({ data: { total: 0, series: [] } }))
                : Promise.resolve({ data: { total: 0, series: [] } }),
            ]);

          if (!active) return;

          const open = openRes.meta.total;
          const resolved = resolvedRes.meta.total;

          setRecentTickets(recentRes.data);
          setStats({
            open,
            resolved,
            total: open + resolved,
            unassigned: unassignedRes.meta.total,
            assignedToMe: assignedToMeRes.meta.total,
            resolvedByMe: resolvedByMeRes.meta.total,
            atRisk: atRiskRes.meta.total,
            overdue: overdueRes.meta.total,
          });

          setActivity(mapActivitySeries(activityRes.data, rangeDays));
          setStatusBreakdown(statusRes.data);
          setSlaCompliance({
            met: slaRes.data.met,
            breached: slaRes.data.breached,
            total: slaRes.data.total,
            atRisk: atRiskRes.meta.total,
          });
          setAgentWorkload(workloadRes.data);
          setAgentPerformance(performanceRes.data);
          setPriorityBreakdown(priorityRes.data);
          setAgeBreakdown(ageRes.data);
          setReopenSeries(reopenRes.data);
          setQueueCategories(categoryRes.data.slice(0, 6));
          setTeamSummary(teamSummaryRes.data);
          setVolumeSeries(volumeRes.data);
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
  }, [refreshKey, role, range, sort, isEmployee, isAgent, isLead, isTeamAdmin, isOwner]);

  const roleMeta = ROLE_META[role] ?? ROLE_META.EMPLOYEE;
  const rangeLabel = toRangeLabel(range);

  const activeAgents = useMemo(
    () => agentWorkload.filter((item) => (item.assignedOpen ?? 0) > 0 || (item.inProgress ?? 0) > 0).length,
    [agentWorkload],
  );

  const reopenTotal = useMemo(
    () => reopenSeries.reduce((sum, item) => sum + item.count, 0),
    [reopenSeries],
  );

  const reopenRate = safePercent(reopenTotal, stats.resolved);
  const slaPercent = safePercent(slaCompliance.met, slaCompliance.total);
  const unassignedPercent = safePercent(stats.unassigned, stats.open);

  const kpis = useMemo<KpiItem[]>(() => {
    if (isEmployee) {
      return [
        { label: 'My open tickets', value: stats.open, tone: 'blue' },
        { label: 'My resolved & closed tickets', value: stats.resolved, tone: 'green' },
      ];
    }

    if (isAgent) {
      return [
        { label: 'Total open tickets', value: stats.open, tone: 'blue' },
        { label: 'Unassigned tickets', value: stats.unassigned, tone: 'gray' },
        { label: 'Assigned to me', value: stats.assignedToMe, tone: 'purple' },
        { label: 'Resolved by me', value: stats.resolvedByMe, tone: 'green' },
      ];
    }

    if (isLead) {
      return [
        { label: 'Total open tickets', value: stats.open, tone: 'blue' },
        { label: 'Unassigned tickets', value: stats.unassigned, tone: 'orange' },
        { label: 'Assigned to me', value: stats.assignedToMe, tone: 'purple' },
        { label: 'Resolved by me', value: stats.resolvedByMe, tone: 'green' },
      ];
    }

    if (isTeamAdmin) {
      return [
        { label: 'Open tickets', value: stats.open, tone: 'blue' },
        { label: 'At risk', value: stats.atRisk, helper: 'Near breach window', tone: 'orange' },
        { label: 'Overdue', value: stats.overdue, helper: 'Breached SLA', tone: 'red' },
        {
          label: 'Active agents',
          value: activeAgents,
          helper: `${unassignedPercent}% unassigned`,
          tone: 'purple',
        },
        { label: 'Total requests', value: stats.total, tone: 'gray' },
      ];
    }

    return [
      { label: 'Open tickets', value: stats.open, tone: 'blue' },
      { label: 'Closed tickets', value: stats.resolved, tone: 'green' },
      { label: 'Total requests', value: stats.total, tone: 'gray' },
      { label: 'Active agents', value: activeAgents, tone: 'purple' },
      { label: 'Transfers', value: transfers.total, tone: 'orange' },
    ];
  }, [activeAgents, isAgent, isEmployee, isLead, isTeamAdmin, stats, transfers.total, unassignedPercent]);

  return (
    <section className="min-h-full bg-slate-50">
      <div className="sticky top-0 z-30 border-b border-gray-200 bg-white">
        <div className="mx-auto w-full max-w-[1600px] pl-6 pr-2 py-4">
          {headerProps ? (
            <TopBar
              title={headerProps.title}
              subtitle={headerProps.subtitle}
              currentEmail={headerProps.currentEmail}
              personas={headerProps.personas}
              onEmailChange={headerProps.onEmailChange}
              onOpenSearch={headerProps.onOpenSearch}
              notificationProps={headerProps.notificationProps}
              leftContent={
                <div>
                  <h1 className="text-xl font-semibold text-slate-900">{headerProps.title}</h1>
                  <p className="text-sm text-slate-500">{headerProps.subtitle}</p>
                  {refreshing ? <p className="mt-1 text-xs text-slate-400">Refreshing...</p> : null}
                </div>
              }
            />
          ) : (
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{roleMeta.title}</h1>
              <p className="text-sm text-slate-500">{roleMeta.subtitle}</p>
              {refreshing ? <p className="mt-1 text-xs text-slate-400">Refreshing...</p> : null}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1600px] pl-6 pr-2 py-6">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div
            className={`mb-6 grid gap-4 ${
              kpis.length === 2 ? 'sm:grid-cols-2' : kpis.length === 4 ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-2 xl:grid-cols-5'
            }`}
          >
            {loading && !loadedOnceRef.current
              ? Array.from({ length: kpis.length }).map((_, idx) => (
                  <div key={`kpi-skeleton-${idx}`} className="h-28 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
                ))
              : kpis.map((item) => <KpiCard key={item.label} item={item} />)}
          </div>
          {isEmployee ? (
            <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">Recent Activity</h2>
                <div className="flex items-center gap-3">
                  <select
                    value={range}
                    onChange={(event) => setRange(event.target.value as '3' | '7' | '30')}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    aria-label="Activity range"
                  >
                    <option value="3">Last 3 days</option>
                    <option value="7">Last 7 days</option>
                    <option value="30">Last 30 days</option>
                  </select>
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as 'recent' | 'oldest')}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    <option value="recent">Most recent</option>
                    <option value="oldest">Oldest</option>
                  </select>
                </div>
              </div>

              {loading ? (
                <div className="h-56 animate-pulse rounded-md border border-slate-200 bg-slate-100" />
              ) : recentTickets.length === 0 ? (
                <EmptyState title="No recent activity" description={`No recent activity in the ${rangeLabel.toLowerCase()}.`} compact />
              ) : (
                <>
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full min-w-[1100px]">
                      <thead className="border-b border-slate-200 bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">ID</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Subject</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Activity</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Assignee</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Priority</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">SLA</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Updated</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white">
                        {recentTickets.map((ticket) => (
                          <tr
                            key={ticket.id}
                            onClick={() => navigate(`/tickets/${ticket.id}`)}
                            className="cursor-pointer transition hover:bg-slate-50"
                          >
                            <td className="px-4 py-3 text-sm font-semibold text-blue-600">{formatTicketId(ticket)}</td>
                            <td className="max-w-[330px] truncate px-4 py-3 text-sm text-slate-900">{ticket.subject}</td>
                            <td className="px-4 py-3 text-sm text-slate-600">{activitySummary(ticket)}</td>
                            <td className="px-4 py-3 text-sm text-slate-900">
                              {ticket.assignee?.displayName ?? ticket.assignee?.email ?? 'Unassigned'}
                            </td>
                            <td className="px-4 py-3">
                              <PriorityBadge priority={ticket.priority} />
                            </td>
                            <td className="px-4 py-3">
                              <SlaChip ticket={ticket} />
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={ticket.status} />
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-500">
                              <RelativeTime value={ticket.updatedAt} variant="compact" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 text-center">
                    <button
                      type="button"
                      onClick={() => navigate('/tickets?scope=created')}
                      className="text-sm font-medium text-blue-600 transition hover:text-blue-700"
                    >
                      View my tickets →
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {isAgent ? (
            <div className="grid gap-6 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-900">Recent Activity</h2>
                  <div className="flex items-center gap-2">
                    <select
                      value={range}
                      onChange={(event) => setRange(event.target.value as '3' | '7' | '30')}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    >
                      <option value="3">Last 3 days</option>
                      <option value="7">Last 7 days</option>
                      <option value="30">Last 30 days</option>
                    </select>
                    <select
                      value={sort}
                      onChange={(event) => setSort(event.target.value as 'recent' | 'oldest')}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    >
                      <option value="recent">Most recent</option>
                      <option value="oldest">Oldest</option>
                    </select>
                  </div>
                </div>

                {loading ? (
                  <div className="h-56 animate-pulse rounded-md border border-slate-200 bg-slate-100" />
                ) : recentTickets.length === 0 ? (
                  <EmptyState title="No recent tickets yet" description="Recent tickets will appear here." compact />
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-md border border-slate-200">
                      <table className="w-full min-w-[760px]">
                        <thead className="border-b border-slate-200 bg-slate-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">ID</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Subject</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Priority</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Status</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Updated</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                          {recentTickets.map((ticket) => (
                            <tr
                              key={ticket.id}
                              onClick={() => navigate(`/tickets/${ticket.id}`)}
                              className="cursor-pointer transition hover:bg-slate-50"
                            >
                              <td className="px-4 py-3 text-sm font-semibold text-blue-600">{formatTicketId(ticket)}</td>
                              <td className="max-w-[340px] truncate px-4 py-3 text-sm text-slate-900">{ticket.subject}</td>
                              <td className="px-4 py-3">
                                <PriorityBadge priority={ticket.priority} />
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge status={ticket.status} />
                              </td>
                              <td className="px-4 py-3 text-sm text-slate-500">
                                <RelativeTime value={ticket.updatedAt} variant="compact" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 text-center">
                      <button
                        type="button"
                        onClick={() => navigate('/tickets')}
                        className="text-sm font-medium text-blue-600 transition hover:text-blue-700"
                      >
                        View all tickets →
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="grid gap-6 lg:col-span-2 lg:grid-rows-2">
                <div className="flex min-h-[300px] flex-col">
                  <Panel title="Ticket Activity" right={rangeLabel}>
                    {loading ? (
                      <div className="min-h-[260px] animate-pulse rounded-md bg-slate-100" />
                    ) : (
                      <div className="min-h-[260px] space-y-3">
                        <TicketActivityChart data={activity} />
                        <ChartLegend
                          items={[
                            { label: 'Open', color: 'hsl(var(--status-progress))' },
                            { label: 'Resolved', color: 'hsl(var(--status-resolved))' },
                          ]}
                        />
                      </div>
                    )}
                  </Panel>
                </div>
                <div className="flex min-h-[300px] flex-col">
                  <Panel title="Tickets by Status" right={rangeLabel}>
                    {loading ? (
                      <div className="min-h-[260px] animate-pulse rounded-md bg-slate-100" />
                    ) : (
                      <div className="min-h-[260px]">
                        <StatusDonutChart data={statusBreakdown} />
                      </div>
                    )}
                  </Panel>
                </div>
              </div>
            </div>
          ) : null}

          {isLead ? (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Team Insights</h2>
                <select
                  value={range}
                  onChange={(event) => setRange(event.target.value as '3' | '7' | '30')}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  <option value="3">Last 3 days</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                </select>
              </div>

              <div className="grid gap-6 lg:grid-cols-5 lg:grid-rows-2">
                <div className="flex min-h-[300px] flex-col lg:col-span-3 lg:row-span-1">
                  <Panel title="Agent Workload" right={rangeLabel}>
                    {loading ? (
                      <div className="min-h-[260px] animate-pulse rounded-md bg-slate-100" />
                    ) : (
                      <div className="min-h-[260px]">
                        <LeadAgentWorkloadBarChart data={agentWorkload} />
                      </div>
                    )}
                  </Panel>
                </div>
                <div className="flex min-h-[300px] flex-col lg:col-span-2 lg:row-span-1">
                  <Panel title="SLA Performance" right={rangeLabel}>
                    {loading ? (
                      <div className="min-h-[260px] animate-pulse rounded-md bg-slate-100" />
                    ) : (
                      <div className="min-h-[260px]">
                        <LeadSlaBarChart
                          data={{ met: slaCompliance.met, atRisk: slaCompliance.atRisk, breached: slaCompliance.breached }}
                        />
                      </div>
                    )}
                  </Panel>
                </div>
                <div className="flex min-h-[300px] flex-col lg:col-span-3 lg:row-span-1">
                  <Panel title="Ticket Status Distribution" right={rangeLabel}>
                    {loading ? (
                      <div className="min-h-[260px] animate-pulse rounded-md bg-slate-100" />
                    ) : (
                      <div className="min-h-[260px]">
                        <LeadStatusPieChart data={statusBreakdown} />
                      </div>
                    )}
                  </Panel>
                </div>
                <div className="flex min-h-[300px] flex-col lg:col-span-2 lg:row-span-1">
                  <Panel title="Agent Performance">
                    {loading ? (
                      <div className="min-h-[260px] animate-pulse rounded-md bg-slate-100" />
                    ) : agentPerformance.length === 0 ? (
                      <p className="min-h-[260px] text-sm text-slate-500">No agent performance data in this range.</p>
                    ) : (
                      <div className="min-h-[260px] space-y-3">
                        {agentPerformance.slice(0, 4).map((agent) => (
                          <div key={agent.userId} className="flex items-center justify-between text-sm">
                            <span className="font-medium text-slate-900">{agent.name}</span>
                            <div className="flex items-center gap-3">
                              <span>{agent.ticketsResolved} resolved</span>
                              <span className="font-medium text-green-600">
                                {agent.ticketsResolved > 0
                                  ? `${Math.min(100, Math.round((agent.firstResponses / agent.ticketsResolved) * 100))}%`
                                  : '—'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </div>
              </div>
            </>
          ) : null}

          {isTeamAdmin ? (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Queue Operations</h2>
                <select
                  value={range}
                  onChange={(event) => setRange(event.target.value as '3' | '7' | '30')}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  <option value="3">Last 3 days</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                </select>
              </div>

              <div className="grid gap-6 lg:grid-cols-12">
                <div className="space-y-4 lg:col-span-4 lg:row-span-1">
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-red-900">Breached SLA</span>
                      <span className="text-2xl font-bold text-red-700">{stats.overdue}</span>
                    </div>
                    <p className="text-xs text-red-600">Immediate attention required</p>
                  </div>
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-orange-900">At Risk</span>
                      <span className="text-2xl font-bold text-orange-700">{stats.atRisk}</span>
                    </div>
                    <p className="text-xs text-orange-600">Due within breach window</p>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-blue-900">Unassigned</span>
                      <span className="text-2xl font-bold text-blue-700">{stats.unassigned}</span>
                    </div>
                    <p className="text-xs text-blue-600">{unassignedPercent}% of open tickets</p>
                  </div>
                </div>
                <div className="flex min-h-[300px] flex-col lg:col-span-5 lg:row-span-1">
                  <Panel title="Tickets by Age" right={rangeLabel}>
                    {loading ? (
                      <div className="min-h-[260px] animate-pulse rounded-md bg-slate-100" />
                    ) : (
                      <div className="min-h-[260px]">
                        <TicketsByAgeChart data={ageBreakdown} />
                      </div>
                    )}
                  </Panel>
                </div>
                <div className="flex min-h-[300px] flex-col lg:col-span-3 lg:row-span-1">
                  <Panel title="SLA Compliance">
                    {loading ? (
                      <div className="min-h-[260px] animate-pulse rounded-md bg-slate-100" />
                    ) : (
                      <>
                        <div className="min-h-[220px]">
                          <LeadSlaBarChart
                            data={{
                              met: slaCompliance.met,
                              atRisk: slaCompliance.atRisk,
                              breached: slaCompliance.breached,
                            }}
                          />
                        </div>
                        <div className="mt-3 text-center">
                          <span className="text-2xl font-bold text-green-600">{slaPercent}%</span>
                          <p className="text-xs text-slate-500">Overall compliance</p>
                        </div>
                      </>
                    )}
                  </Panel>
                </div>

                <div className="flex min-h-[260px] flex-col lg:col-span-4 lg:row-span-1">
                  <Panel title="Queues by Category">
                    {loading ? (
                      <div className="min-h-[220px] animate-pulse rounded-md bg-slate-100" />
                    ) : queueCategories.length === 0 ? (
                      <p className="text-sm text-slate-500">No category data in this range.</p>
                    ) : (
                      <div className="space-y-2">
                        {queueCategories.map((category) => (
                          <div key={category.id} className="flex items-center justify-between text-sm">
                            <span className="text-slate-700">{category.name}</span>
                            <span className="font-medium text-slate-900">{category.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </div>
                <div className="flex min-h-[260px] flex-col lg:col-span-5 lg:row-span-1">
                  <Panel title="Routing Exceptions">
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-700">Emails not parsed</span>
                        <span className="font-medium text-red-600">0</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-700">Auto-assigned</span>
                        <span className="font-medium text-blue-600">{stats.assignedToMe}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-700">Failed webhooks</span>
                        <span className="font-medium text-orange-600">0</span>
                      </div>
                    </div>
                  </Panel>
                </div>
                <div className="flex min-h-[260px] flex-col lg:col-span-3 lg:row-span-1">
                  <Panel title="Reopen Rate">
                    <div className="mb-3 text-center">
                      <span className="text-3xl font-bold text-orange-600">{reopenRate}%</span>
                      <p className="text-xs text-slate-500">{rangeLabel}</p>
                    </div>
                    <div className="text-xs text-slate-600">
                      <div className="mb-1 flex justify-between">
                        <span>Reopened</span>
                        <span className="font-medium">{reopenTotal}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Total resolved</span>
                        <span className="font-medium">{stats.resolved}</span>
                      </div>
                    </div>
                  </Panel>
                </div>

                <div className="lg:col-span-6">
                  <Panel title="Admin Controls">
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => navigate('/routing')}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-left text-sm font-medium text-blue-600 transition hover:bg-slate-50"
                      >
                        → Routing rules
                      </button>
                      <button
                        type="button"
                        disabled
                        className="w-full cursor-not-allowed rounded-md border border-slate-300 px-3 py-2 text-left text-sm text-slate-400"
                      >
                        Business hours (Coming soon)
                      </button>
                      <button
                        type="button"
                        disabled
                        className="w-full cursor-not-allowed rounded-md border border-slate-300 px-3 py-2 text-left text-sm text-slate-400"
                      >
                        Macros (Coming soon)
                      </button>
                    </div>
                  </Panel>
                </div>
                <div className="lg:col-span-6">
                  <Panel title="Reopen Trend" right={rangeLabel}>
                    {loading ? (
                      <div className="min-h-[220px] animate-pulse rounded-md bg-slate-100" />
                    ) : reopenSeries.length > 0 ? (
                      <div className="min-h-[220px]">
                        <ReopenRateChart data={reopenSeries} />
                      </div>
                    ) : (
                      <p className="flex min-h-[220px] items-center justify-center text-sm text-slate-500">
                        No reopen data in this range.
                      </p>
                    )}
                  </Panel>
                </div>
              </div>
            </div>
          ) : null}

          {isOwner ? (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Platform Overview</h2>
                <select
                  value={range}
                  onChange={(event) => setRange(event.target.value as '3' | '7' | '30')}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  <option value="3">Last 3 days</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                </select>
              </div>

              <div className="grid gap-6 lg:grid-cols-12 lg:grid-rows-2">
                <div className="flex min-h-[300px] flex-col lg:col-span-4 lg:row-span-1">
                  <Panel title="Team Summary">
                    {loading ? (
                      <div className="min-h-[260px] animate-pulse rounded-md bg-slate-100" />
                    ) : teamSummary.length === 0 ? (
                      <p className="text-sm text-slate-500">No team summary data in this range.</p>
                    ) : (
                      <div className="min-h-[260px] overflow-x-auto">
                        <table className="w-full min-w-[320px] text-sm">
                          <thead className="border-b border-slate-200">
                            <tr>
                              <th className="py-2 text-left text-xs text-slate-500">Team</th>
                              <th className="py-2 text-right text-xs text-slate-500">Open</th>
                              <th className="py-2 text-right text-xs text-slate-500">SLA</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {teamSummary.map((team) => (
                              <tr key={team.id}>
                                <td className="py-2 text-slate-900">{team.name}</td>
                                <td className="py-2 text-right font-medium text-slate-900">{team.open}</td>
                                <td className="py-2 text-right text-green-600">{safePercent(team.resolved, team.total)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Panel>
                </div>
                <div className="flex min-h-[300px] flex-col lg:col-span-5 lg:row-span-1">
                  <Panel title="Platform Activity" right={rangeLabel}>
                    {loading ? (
                      <div className="min-h-[260px] animate-pulse rounded-md bg-slate-100" />
                    ) : (
                      <div className="min-h-[260px]">
                        <TicketVolumeChart data={volumeSeries} />
                      </div>
                    )}
                  </Panel>
                </div>
                <div className="flex min-h-[300px] flex-col lg:col-span-3 lg:row-span-1">
                  <Panel title="SLA Compliance">
                    {loading ? (
                      <div className="min-h-[260px] animate-pulse rounded-md bg-slate-100" />
                    ) : (
                      <>
                        <div className="min-h-[220px]">
                          <LeadSlaBarChart
                            data={{
                              met: slaCompliance.met,
                              atRisk: slaCompliance.atRisk,
                              breached: slaCompliance.breached,
                            }}
                          />
                        </div>
                        <div className="mt-3 text-center">
                          <span className="text-2xl font-bold text-green-600">{slaPercent}%</span>
                          <p className="text-xs text-slate-500">Platform-wide</p>
                        </div>
                      </>
                    )}
                  </Panel>
                </div>

                <div className="flex min-h-[300px] flex-col lg:col-span-4 lg:row-span-1">
                  <Panel title="Tickets by Priority" right={rangeLabel}>
                    {loading ? (
                      <div className="min-h-[260px] animate-pulse rounded-md bg-slate-100" />
                    ) : (
                      <div className="min-h-[260px]">
                        <PriorityDonutChart data={priorityBreakdown} />
                      </div>
                    )}
                  </Panel>
                </div>
                <div className="flex min-h-[300px] flex-col lg:col-span-5 lg:row-span-1">
                  <div className="grid min-h-[300px] grid-cols-2 gap-4">
                    <Panel title="Transfers">
                      <div className="text-center">
                        <span className="text-3xl font-bold text-blue-600">{transfers.total}</span>
                        <p className="text-xs text-slate-500">{rangeLabel}</p>
                      </div>
                    </Panel>
                    <Panel title="Reopen Rate">
                      <div className="text-center">
                        <span className="text-3xl font-bold text-orange-600">{reopenRate}%</span>
                        <p className="text-xs text-slate-500">{rangeLabel}</p>
                      </div>
                    </Panel>
                  </div>
                </div>
                <div className="flex min-h-[300px] flex-col lg:col-span-3 lg:row-span-1">
                  <Panel title="Top Performers">
                    {loading ? (
                      <div className="min-h-[260px] animate-pulse rounded-md bg-slate-100" />
                    ) : agentPerformance.length === 0 ? (
                      <p className="min-h-[260px] text-sm text-slate-500">No agent performance data in this range.</p>
                    ) : (
                      <div className="min-h-[260px] space-y-2">
                        {agentPerformance.slice(0, 3).map((agent, idx) => (
                          <div key={agent.userId} className="flex items-center justify-between text-sm">
                            <span className="text-slate-900">#{idx + 1} {agent.name}</span>
                            <span className="font-medium text-green-600">
                              {agent.avgFirstResponseHours == null ? '—' : `${agent.avgFirstResponseHours.toFixed(1)}h`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
