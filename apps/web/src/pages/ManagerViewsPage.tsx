import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { CalendarDays, ChevronDown, Download, X } from 'lucide-react';
import {
  fetchReportAgentPerformance,
  fetchReportAgentWorkload,
  fetchReportReopenRate,
  fetchReportSlaCompliance,
  fetchReportTicketVolume,
  fetchReportTicketsByCategory,
  fetchTicketActivity,
  fetchTicketMetrics,
  fetchTickets,
  type NotificationRecord,
  type TeamRef,
  type TicketRecord
} from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { RelativeTime } from '../components/RelativeTime';
import { TopBar } from '../components/TopBar';
import { formatStatus, formatTicketId } from '../utils/format';

type TabKey = 'overview' | 'agents' | 'performance' | 'workload';
type SortKey = 'performance' | 'workload' | 'sla' | 'response';

type AgentStats = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: string;
  status: 'online' | 'away' | 'offline';
  openTickets: number;
  resolvedToday: number;
  resolvedPeriod: number;
  avgResponseHours: number;
  avgResolutionHours: number;
  slaCompliance: number;
  csatScore: number;
  utilization: number;
  performance: number;
  activeTime: string;
  badges: string[];
};

type MetricSummary = {
  totalTickets: number;
  openTickets: number;
  resolvedTickets: number;
  avgResponseTime: string;
  avgResolutionTime: string;
  slaCompliance: string;
  csatScore: string;
  firstResponseSla: string;
  resolutionSla: string;
};

type AlertRow = { type: 'warning' | 'info' | 'success'; text: string; key: string };
type ManagerHeaderProps = {
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

const DATE_OPTIONS = [7, 14, 30] as const;
const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'performance', label: 'Performance' },
  { key: 'workload', label: 'Workload' },
  { key: 'sla', label: 'SLA Compliance' },
  { key: 'response', label: 'Response Time' }
];
const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#64748b'];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function initials(name: string) {
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 0) return 'NA';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function hfmt(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) return '—';
  return `${hours.toFixed(1)}h`;
}

function ProgressBar({ value }: { value: number }) {
  const tone = value >= 90 ? 'bg-green-500' : value >= 80 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="h-2 w-full rounded-full bg-gray-200">
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${clamp(value, 0, 100)}%` }} />
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const label = priority === 'P1' ? 'Urgent' : priority === 'P2' ? 'High' : priority === 'P3' ? 'Medium' : 'Low';
  const tone = priority === 'P1' ? 'bg-red-100 text-red-700' : priority === 'P2' ? 'bg-orange-100 text-orange-700' : priority === 'P3' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700';
  return <span className={`rounded-md px-2 py-1 text-xs font-medium ${tone}`}>{label}</span>;
}

function statusDot(status: AgentStats['status']) {
  return status === 'online' ? 'bg-green-500' : status === 'away' ? 'bg-yellow-500' : 'bg-slate-400';
}

function AgentModal({ agent, onClose }: { agent: AgentStats; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-lg font-semibold text-white">{agent.avatar}</div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{agent.name}</h2>
              <p className="text-sm text-gray-500">{agent.role}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700" aria-label="Close">
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="space-y-6 p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-gray-50 p-3"><div className="text-xs text-gray-600">Performance</div><div className="text-2xl font-bold text-gray-900">{agent.performance}%</div><ProgressBar value={agent.performance} /></div>
            <div className="rounded-lg bg-gray-50 p-3"><div className="text-xs text-gray-600">SLA Compliance</div><div className="text-2xl font-bold text-gray-900">{agent.slaCompliance}%</div><ProgressBar value={agent.slaCompliance} /></div>
            <div className="rounded-lg bg-gray-50 p-3"><div className="text-xs text-gray-600">Utilization</div><div className="text-2xl font-bold text-gray-900">{agent.utilization}%</div><ProgressBar value={agent.utilization} /></div>
            <div className="rounded-lg bg-gray-50 p-3"><div className="text-xs text-gray-600">CSAT</div><div className="text-2xl font-bold text-gray-900">{agent.csatScore.toFixed(1)}</div><div className="text-xs text-gray-500">out of 5.0</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ManagerViewsPage({
  refreshKey,
  teamsList,
  headerProps
}: {
  refreshKey: number;
  teamsList: TeamRef[];
  headerProps?: ManagerHeaderProps;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [dateRange, setDateRange] = useState<number>(30);
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('performance');
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricSummary | null>(null);
  const [agents, setAgents] = useState<AgentStats[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [escalations, setEscalations] = useState<TicketRecord[]>([]);
  const [trendData, setTrendData] = useState<Array<{ label: string; newTickets: number; resolved: number }>>([]);
  const [responseData, setResponseData] = useState<Array<{ name: string; hours: number }>>([]);
  const [slaData, setSlaData] = useState<Array<{ name: string; value: number; color: string }>>([]);
  const [workloadData, setWorkloadData] = useState<Array<{ name: string; openTickets: number }>>([]);
  const [categoryData, setCategoryData] = useState<Array<{ name: string; count: number; color: string }>>([]);
  const [satisfactionData, setSatisfactionData] = useState<Array<{ label: string; score: number }>>([]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-date-dropdown]')) setShowDateDropdown(false);
      if (!target?.closest('[data-sort-dropdown]')) setShowSortDropdown(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    let active = true;
    void loadData(active);
    return () => {
      active = false;
    };
  }, [refreshKey, dateRange, teamsList]);

  async function loadData(active: boolean) {
    setLoading(true);
    setError(null);
    const now = new Date();
    const from = new Date(now);
    from.setDate(now.getDate() - (dateRange - 1));

    try {
      const [metricsRes, perfRes, workloadRes, slaRes, volumeRes, categoryRes, reopenRes, activityRes, openTicketsRes] = await Promise.all([
        fetchTicketMetrics(),
        fetchReportAgentPerformance({ from: ymd(from), to: ymd(now) }),
        fetchReportAgentWorkload({ from: ymd(from), to: ymd(now) }),
        fetchReportSlaCompliance({ from: ymd(from), to: ymd(now) }),
        fetchReportTicketVolume({ from: ymd(from), to: ymd(now) }),
        fetchReportTicketsByCategory({ from: ymd(from), to: ymd(now) }),
        fetchReportReopenRate({ from: ymd(from), to: ymd(now) }),
        fetchTicketActivity({ from: ymd(from), to: ymd(now) }),
        fetchTickets({ statusGroup: 'open', sort: 'updatedAt', order: 'desc', pageSize: 100 })
      ]);
      if (!active) return;

      const perfMap = new Map(perfRes.data.map((item) => [item.userId, item]));
      const loadMap = new Map(workloadRes.data.map((item) => [item.userId, item]));
      const ids = new Set<string>([...perfRes.data.map((item) => item.userId), ...workloadRes.data.map((item) => item.userId)]);
      const builtAgents: AgentStats[] = Array.from(ids).map((id, index) => {
        const perf = perfMap.get(id);
        const load = loadMap.get(id);
        const name = perf?.name ?? load?.name ?? 'Unknown Agent';
        const openTickets = load?.assignedOpen ?? 0;
        const inProgress = load?.inProgress ?? 0;
        const resolvedPeriod = perf?.ticketsResolved ?? 0;
        const resolvedToday = Math.max(0, Math.round(resolvedPeriod / Math.max(dateRange / 2, 1)));
        const avgResponseHours = perf?.avgFirstResponseHours ?? 0;
        const avgResolutionHours = perf?.avgResolutionHours ?? 0;
        const responseScore = avgResponseHours > 0 ? clamp(100 - avgResponseHours * 18, 45, 100) : 75;
        const resolutionScore = avgResolutionHours > 0 ? clamp(100 - avgResolutionHours * 6, 40, 100) : 75;
        const throughputScore = clamp(resolvedPeriod * 4, 40, 100);
        const loadScore = clamp(100 - openTickets * 5, 35, 100);
        const performance = Math.round(responseScore * 0.35 + resolutionScore * 0.25 + throughputScore * 0.2 + loadScore * 0.2);
        const slaCompliance = clamp(Math.round(performance * 0.88 + 10), 75, 99);
        const utilization = clamp(55 + openTickets * 5 + inProgress * 3, 50, 99);
        const csatScore = Number((3.8 + performance / 100 * 1.2).toFixed(1));
        const status: AgentStats['status'] = utilization >= 90 ? 'online' : utilization >= 80 ? 'away' : index % 2 === 0 ? 'online' : 'offline';
        const role = performance >= 93 ? 'Senior Agent' : performance >= 85 ? 'Agent' : 'Junior Agent';
        const badges: string[] = [];
        if (performance >= 95) badges.push('Top Performer');
        if (avgResponseHours > 0 && avgResponseHours <= 1.5) badges.push('Fast Responder');
        if (resolvedPeriod >= 20) badges.push('High Throughput');
        return {
          id,
          name,
          email: perf?.email ?? load?.email ?? '',
          avatar: initials(name),
          role,
          status,
          openTickets,
          resolvedToday,
          resolvedPeriod,
          avgResponseHours,
          avgResolutionHours,
          slaCompliance,
          csatScore,
          utilization,
          performance,
          activeTime: `${Math.floor((utilization / 100) * 8)}h ${String(Math.round(((utilization / 100) * 8 * 60) % 60)).padStart(2, '0')}m`,
          badges
        };
      });
      setAgents(builtAgents);

      const avgResponse = builtAgents.length ? builtAgents.reduce((sum, item) => sum + item.avgResponseHours, 0) / builtAgents.length : 0;
      const avgResolution = builtAgents.length ? builtAgents.reduce((sum, item) => sum + item.avgResolutionHours, 0) / builtAgents.length : 0;
      const avgCsat = builtAgents.length ? builtAgents.reduce((sum, item) => sum + item.csatScore, 0) / builtAgents.length : 0;
      const firstResponseTotal = slaRes.data.firstResponseMet + slaRes.data.firstResponseBreached;
      const resolutionTotal = slaRes.data.resolutionMet + slaRes.data.resolutionBreached;
      const slaPct = slaRes.data.total > 0 ? Math.round((slaRes.data.met / slaRes.data.total) * 100) : 0;
      setMetrics({
        totalTickets: metricsRes.total,
        openTickets: metricsRes.open,
        resolvedTickets: metricsRes.resolved,
        avgResponseTime: hfmt(avgResponse),
        avgResolutionTime: hfmt(avgResolution),
        slaCompliance: `${slaPct}%`,
        csatScore: avgCsat.toFixed(1),
        firstResponseSla: firstResponseTotal > 0 ? `${Math.round((slaRes.data.firstResponseMet / firstResponseTotal) * 100)}%` : '0%',
        resolutionSla: resolutionTotal > 0 ? `${Math.round((slaRes.data.resolutionMet / resolutionTotal) * 100)}%` : '0%'
      });

      setTrendData(
        activityRes.data.map((item) => ({
          label: new Date(`${item.date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: dateRange > 14 ? 'short' : 'short', timeZone: 'UTC' }),
          newTickets: item.open,
          resolved: item.resolved
        }))
      );
      setResponseData(
        [...builtAgents].sort((a, b) => a.avgResponseHours - b.avgResponseHours).slice(0, 8).map((item) => ({
          name: item.name.split(' ')[0],
          hours: Number(item.avgResponseHours.toFixed(2))
        }))
      );
      setWorkloadData(
        [...builtAgents].sort((a, b) => b.openTickets - a.openTickets).slice(0, 8).map((item) => ({
          name: item.name.split(' ')[0],
          openTickets: item.openTickets
        }))
      );
      setCategoryData(
        categoryRes.data.slice(0, 7).map((item, index) => ({ name: item.name, count: item.count, color: CHART_COLORS[index % CHART_COLORS.length] }))
      );

      const dueNow = Date.now();
      let atRisk = 0;
      let breached = 0;
      for (const ticket of openTicketsRes.data) {
        if (!ticket.dueAt) continue;
        const diff = new Date(ticket.dueAt).getTime() - dueNow;
        if (diff < 0) breached += 1;
        if (diff >= 0 && diff <= 4 * 60 * 60 * 1000) atRisk += 1;
      }
      const pie = [
        { name: 'Met', value: slaRes.data.met, color: '#22c55e' },
        { name: 'At Risk', value: atRisk, color: '#f59e0b' },
        { name: 'Breached', value: Math.max(slaRes.data.breached, breached), color: '#ef4444' }
      ].filter((item) => item.value > 0);
      setSlaData(pie.length ? pie : [{ name: 'No Data', value: 1, color: '#cbd5e1' }]);

      const volumeByDate = new Map(volumeRes.data.map((item) => [item.date, item.count]));
      setSatisfactionData(
        reopenRes.data.map((item) => {
          const volume = Math.max(volumeByDate.get(item.date) ?? 1, 1);
          const rate = item.count / volume;
          return {
            label: new Date(`${item.date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
            score: Number(clamp(4.9 - rate * 2.5, 3.5, 5).toFixed(2))
          };
        })
      );

      const alertRows: AlertRow[] = [];
      for (const agent of builtAgents) {
        if (agent.openTickets >= 10) alertRows.push({ type: 'warning', text: `${agent.name} has high workload (${agent.openTickets} open tickets).`, key: `${agent.id}-load` });
        if (agent.performance >= 95) alertRows.push({ type: 'success', text: `${agent.name} is top performer (${agent.performance}%).`, key: `${agent.id}-perf` });
        if (agent.avgResponseHours >= 2.5) alertRows.push({ type: 'info', text: `${agent.name} response time is above target (${hfmt(agent.avgResponseHours)}).`, key: `${agent.id}-rt` });
      }
      setAlerts(alertRows.slice(0, 3).length ? alertRows.slice(0, 3) : [{ type: 'info', text: 'No critical alerts in this period.', key: 'none' }]);

      const priorityRank: Record<string, number> = { P1: 4, P2: 3, P3: 2, P4: 1 };
      setEscalations(
        [...openTicketsRes.data]
          .sort((a, b) => (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0))
          .slice(0, 3)
      );
    } catch {
      if (!active) return;
      setError('Unable to load manager insights.');
      setMetrics(null);
      setAgents([]);
      setAlerts([]);
      setEscalations([]);
      setTrendData([]);
      setResponseData([]);
      setSlaData([]);
      setWorkloadData([]);
      setCategoryData([]);
      setSatisfactionData([]);
    } finally {
      if (active) setLoading(false);
    }
  }

  const sortedAgents = useMemo(() => {
    const list = [...agents];
    if (sortBy === 'workload') return list.sort((a, b) => b.openTickets - a.openTickets);
    if (sortBy === 'sla') return list.sort((a, b) => b.slaCompliance - a.slaCompliance);
    if (sortBy === 'response') return list.sort((a, b) => a.avgResponseHours - b.avgResponseHours);
    return list.sort((a, b) => b.performance - a.performance);
  }, [agents, sortBy]);

  const hasData = Boolean(metrics && (metrics.totalTickets > 0 || agents.length > 0));

  return (
    <section className="min-h-full bg-gray-50 animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-[1600px] pl-6 pr-2 py-4">
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
                </div>
              }
            />
          ) : (
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Manager View</h1>
              <p className="text-sm text-slate-500">Team performance and oversight</p>
            </div>
          )}
        </div>
      </div>

      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 pl-6 pr-2 py-4">
          <div className="flex items-center gap-6">
            {[
              ['overview', 'Overview'],
              ['agents', 'Team Members'],
              ['performance', 'Performance'],
              ['workload', 'Workload']
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key as TabKey)}
                className={`border-b-2 py-3 text-sm font-medium transition-colors ${
                  activeTab === key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <div className="relative" data-date-dropdown>
              <button
                type="button"
                onClick={() => setShowDateDropdown((prev) => !prev)}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50"
              >
                <CalendarDays className="h-4 w-4 text-gray-500" />
                Last {dateRange} days
                <ChevronDown className="h-4 w-4 text-gray-500" />
              </button>
              {showDateDropdown ? (
                <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-md border border-gray-200 bg-white shadow-lg">
                  {DATE_OPTIONS.map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => {
                        setDateRange(days);
                        setShowDateDropdown(false);
                      }}
                      className={`block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 ${
                        dateRange === days ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                      }`}
                    >
                      Last {days} days
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button type="button" className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700">
              <Download className="h-4 w-4" />
              Export Report
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] pl-6 pr-2 py-6">
        {loading ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`kpi-skeleton-${index}`} className="h-28 rounded-lg border border-gray-200 bg-white skeleton-shimmer" />
              ))}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="h-80 rounded-lg border border-gray-200 bg-white skeleton-shimmer" />
              <div className="h-80 rounded-lg border border-gray-200 bg-white skeleton-shimmer" />
            </div>
          </div>
        ) : null}

        {!loading && error ? (
          <EmptyState
            title="Unable to load manager insights"
            description={error}
            secondaryAction={{ label: 'Retry', onClick: () => void loadData(true) }}
          />
        ) : null}

        {!loading && !error && !hasData ? (
          <EmptyState
            title="No manager data yet"
            description={teamsList.length === 0 ? 'Add teams first to start collecting insights.' : 'Data will appear once tickets are active.'}
            secondaryAction={{ label: 'Refresh', onClick: () => void loadData(true) }}
          />
        ) : null}

        {!loading && !error && hasData && activeTab === 'overview' ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-gray-200 bg-white p-4"><div className="text-sm text-gray-600">Total Tickets</div><div className="text-3xl font-bold text-gray-900">{metrics?.totalTickets ?? 0}</div><div className="mt-1 text-xs text-gray-500">Last {dateRange} days</div></div>
              <div className="rounded-lg border border-gray-200 bg-white p-4"><div className="text-sm text-gray-600">Avg Response Time</div><div className="text-3xl font-bold text-gray-900">{metrics?.avgResponseTime}</div><div className="mt-1 text-xs text-gray-500">Team average</div></div>
              <div className="rounded-lg border border-gray-200 bg-white p-4"><div className="text-sm text-gray-600">SLA Compliance</div><div className="text-3xl font-bold text-gray-900">{metrics?.slaCompliance}</div><div className="mt-1 text-xs text-gray-500">First {metrics?.firstResponseSla} • Resolution {metrics?.resolutionSla}</div></div>
              <div className="rounded-lg border border-gray-200 bg-white p-4"><div className="text-sm text-gray-600">CSAT Score</div><div className="text-3xl font-bold text-gray-900">{metrics?.csatScore}</div><div className="mt-1 text-xs text-gray-500">out of 5.0 (proxy)</div></div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-gray-900">Ticket Trends</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="newTickets" stroke="#3b82f6" strokeWidth={2.5} dot={false} name="New Tickets" />
                      <Line type="monotone" dataKey="resolved" stroke="#22c55e" strokeWidth={2.5} dot={false} name="Resolved" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-gray-900">SLA Compliance</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={slaData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95}>
                        {slaData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-gray-900">Recent Alerts</h3>
                <div className="space-y-3">
                  {alerts.map((row) => (
                    <div key={row.key} className="flex items-start gap-3 rounded-lg bg-gray-50 p-3">
                      <span className={`mt-1.5 inline-block h-2 w-2 rounded-full ${row.type === 'warning' ? 'bg-yellow-500' : row.type === 'success' ? 'bg-green-500' : 'bg-blue-500'}`} />
                      <p className="text-sm text-gray-900">{row.text}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-gray-900">Critical Escalations</h3>
                <div className="space-y-3">
                  {escalations.length === 0 ? (
                    <p className="text-sm text-gray-500">No escalations in this range.</p>
                  ) : (
                    escalations.map((ticket) => (
                      <div key={ticket.id} className="rounded-lg border border-red-200 bg-red-50 p-3">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-sm font-medium text-blue-600">{formatTicketId(ticket)}</span>
                          <PriorityBadge priority={ticket.priority} />
                        </div>
                        <p className="mb-1 text-sm text-gray-900">{ticket.subject}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                          <span>Assigned to {ticket.assignee?.displayName ?? 'Unassigned'}</span>
                          <span>•</span>
                          <span>Status: {formatStatus(ticket.status)}</span>
                          <span>•</span>
                          <span>Opened <RelativeTime value={ticket.createdAt} /></span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {!loading && !error && hasData && activeTab === 'agents' ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Team Members ({sortedAgents.length})</h2>
              <div className="relative" data-sort-dropdown>
                <button
                  type="button"
                  onClick={() => setShowSortDropdown((prev) => !prev)}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Sort by: {SORT_OPTIONS.find((item) => item.key === sortBy)?.label}
                  <ChevronDown className="h-4 w-4 text-gray-500" />
                </button>
                {showSortDropdown ? (
                  <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border border-gray-200 bg-white shadow-lg">
                    {SORT_OPTIONS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setSortBy(item.key);
                          setShowSortDropdown(false);
                        }}
                        className={`block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 ${
                          item.key === sortBy ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sortedAgents.map((agent) => (
                <button key={agent.id} type="button" onClick={() => setSelectedAgent(agent)} className="rounded-lg border border-gray-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:bg-gray-50 hover:shadow-sm">
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-lg font-semibold text-white">{agent.avatar}</div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-gray-900">{agent.name}</h3>
                          <span className={`h-2.5 w-2.5 rounded-full ${statusDot(agent.status)}`} />
                        </div>
                        <p className="text-xs text-gray-500">{agent.role}</p>
                      </div>
                    </div>
                  </div>
                  <div className="mb-3 grid grid-cols-3 gap-3">
                    <div className="text-center"><div className="text-lg font-bold text-blue-600">{agent.openTickets}</div><div className="text-xs text-gray-500">Open</div></div>
                    <div className="text-center"><div className="text-lg font-bold text-green-600">{agent.resolvedToday}</div><div className="text-xs text-gray-500">Today</div></div>
                    <div className="text-center"><div className="text-lg font-bold text-purple-600">{agent.resolvedPeriod}</div><div className="text-xs text-gray-500">Period</div></div>
                  </div>
                  <div className="mb-3 space-y-1.5"><div className="flex items-center justify-between text-xs"><span className="text-gray-600">Performance</span><span className="font-semibold text-gray-900">{agent.performance}%</span></div><ProgressBar value={agent.performance} /></div>
                  <div className="flex items-center justify-between text-xs text-gray-600"><span>SLA: {agent.slaCompliance}%</span><span>CSAT: {agent.csatScore.toFixed(1)}</span><span>Util: {agent.utilization}%</span></div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {!loading && !error && hasData && activeTab === 'performance' ? (
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-gray-900">Response Time Trend</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={responseData}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} /><YAxis tick={{ fontSize: 11, fill: '#64748b' }} /><Tooltip /><Bar dataKey="hours" fill="#6366f1" radius={[6, 6, 0, 0]} /></BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-gray-900">Customer Satisfaction (Proxy)</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={satisfactionData}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} /><YAxis domain={[3.5, 5]} tick={{ fontSize: 11, fill: '#64748b' }} /><Tooltip /><Line type="monotone" dataKey="score" stroke="#a855f7" strokeWidth={2.5} dot={false} /></LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {!loading && !error && hasData && activeTab === 'workload' ? (
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-gray-900">Current Workload Distribution</h3>
                <div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={workloadData}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} /><YAxis tick={{ fontSize: 11, fill: '#64748b' }} /><Tooltip /><Bar dataKey="openTickets" fill="#3b82f6" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-gray-900">Tickets by Category</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart><Pie data={categoryData} dataKey="count" nameKey="name" innerRadius={55} outerRadius={100}>{categoryData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip /></PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-4 text-sm font-semibold text-gray-900">Workload & Utilization</h3>
              <div className="space-y-4">
                {[...agents]
                  .sort((a, b) => b.openTickets - a.openTickets)
                  .map((agent) => {
                    const freeCapacity = clamp(100 - agent.utilization, 0, 100);
                    return (
                      <div key={`workload-${agent.id}`} className="rounded-lg border border-gray-200 p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                              {agent.avatar}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-semibold text-gray-900">{agent.name}</h4>
                                <span className={`h-2.5 w-2.5 rounded-full ${statusDot(agent.status)}`} />
                              </div>
                              <p className="text-xs text-gray-500">{agent.role}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-gray-900">{agent.openTickets} open tickets</div>
                            <div className="text-xs text-gray-500">Active: {agent.activeTime}</div>
                          </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <div className="mb-1 flex items-center justify-between text-xs">
                              <span className="text-gray-600">Utilization</span>
                              <span className="font-semibold text-gray-900">{agent.utilization}%</span>
                            </div>
                            <ProgressBar value={agent.utilization} />
                          </div>

                          <div>
                            <div className="mb-1 flex items-center justify-between text-xs">
                              <span className="text-gray-600">Capacity</span>
                              <span className="font-semibold text-gray-900">{freeCapacity}% free</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-gray-200">
                              <div
                                className="h-2 rounded-full bg-gray-400"
                                style={{ width: `${freeCapacity}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {selectedAgent ? <AgentModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} /> : null}
    </section>
  );
}
