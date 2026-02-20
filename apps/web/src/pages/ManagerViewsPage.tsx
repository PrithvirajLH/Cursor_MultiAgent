import { useEffect, useMemo, useRef, useState } from 'react';
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
  type TeamRef,
  type TicketRecord
} from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { RelativeTime } from '../components/RelativeTime';
import { TopBar } from '../components/TopBar';
import { useHeaderContext } from '../contexts/HeaderContext';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';
import { formatStatus, formatTicketId } from '../utils/format';
import { getPriorityTone, priorityBadgeClass } from '../utils/statusColors';

type TabKey = 'overview' | 'agents' | 'performance' | 'workload';
type SortKey = 'workload' | 'resolved' | 'response' | 'resolution';

type AgentStats = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  openTickets: number;
  inProgress: number;
  resolvedPeriod: number;
  firstResponses: number;
  avgResponseHours: number | null;
  avgResolutionHours: number | null;
};

type MetricSummary = {
  createdInRange: number;
  resolvedInRange: number;
  currentOpenTickets: number;
  avgFirstResponseTime: string;
  avgResolutionTime: string;
  slaCompliance: string;
  slaMet: number;
  slaBreached: number;
  firstResponseMet: number;
  firstResponseBreached: number;
  resolutionMet: number;
  resolutionBreached: number;
  firstResponseSla: string;
  resolutionSla: string;
};
const DATE_OPTIONS = [7, 14, 30] as const;
const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'workload', label: 'Workload' },
  { key: 'resolved', label: 'Resolved Tickets' },
  { key: 'response', label: 'First Response Time' },
  { key: 'resolution', label: 'Resolution Time' }
];
const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#64748b'];

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

function hfmt(hours: number | null) {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return '—';
  return `${hours.toFixed(1)}h`;
}

function formatUtcShortDate(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatUtcTooltipDate(isoDate: string) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function csvCell(value: string | number | boolean | null | undefined) {
  const raw = value == null ? '' : String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function downloadCsv(filename: string, rows: Array<Array<string | number | boolean | null | undefined>>) {
  if (typeof window === 'undefined') {
    return;
  }
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = filename;
  window.document.body.appendChild(link);
  link.click();
  window.document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

function PriorityBadge({ priority }: { priority: string }) {
  const tone = getPriorityTone(priority);
  const label =
    tone === 'urgent'
      ? 'Urgent'
      : tone === 'high'
      ? 'High'
      : tone === 'medium'
      ? 'Medium'
      : tone === 'low'
      ? 'Low'
      : priority;
  return (
    <span className={`rounded-md px-2 py-1 text-xs font-medium ${priorityBadgeClass(priority)}`}>
      {label}
    </span>
  );
}

async function fetchTopOpenEscalations() {
  const priorities = ['P1', 'P2', 'P3', 'P4'] as const;
  const limit = 3;
  const selected: TicketRecord[] = [];
  const seenIds = new Set<string>();

  for (const priority of priorities) {
    if (selected.length >= limit) {
      break;
    }

    const remaining = limit - selected.length;
    const response = await fetchTickets({
      statusGroup: 'open',
      priority,
      sort: 'updatedAt',
      order: 'desc',
      pageSize: remaining,
      page: 1
    });

    for (const ticket of response.data) {
      if (seenIds.has(ticket.id)) {
        continue;
      }
      seenIds.add(ticket.id);
      selected.push(ticket);
      if (selected.length >= limit) {
        break;
      }
    }
  }

  return selected;
}

function AgentModal({ agent, onClose }: { agent: AgentStats; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap({ open: true, containerRef: dialogRef, onClose });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Agent details for ${agent.name}`}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-lg font-semibold text-white">{agent.avatar}</div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{agent.name}</h2>
              <p className="text-sm text-slate-500">{agent.email}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-700" aria-label="Close">
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="space-y-6 p-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-600">Open Tickets</div><div className="text-2xl font-bold text-slate-900">{agent.openTickets}</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-600">In Progress</div><div className="text-2xl font-bold text-slate-900">{agent.inProgress}</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-600">Resolved (Range)</div><div className="text-2xl font-bold text-slate-900">{agent.resolvedPeriod}</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-600">First Responses (Range)</div><div className="text-2xl font-bold text-slate-900">{agent.firstResponses}</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-600">Avg First Response</div><div className="text-2xl font-bold text-slate-900">{hfmt(agent.avgResponseHours)}</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-600">Avg Resolution</div><div className="text-2xl font-bold text-slate-900">{hfmt(agent.avgResolutionHours)}</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ManagerViewsPage({
  refreshKey,
  teamsList
}: {
  refreshKey: number;
  teamsList: TeamRef[];
}) {
  const headerCtx = useHeaderContext();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [dateRange, setDateRange] = useState<number>(30);
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('workload');
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MetricSummary | null>(null);
  const [agents, setAgents] = useState<AgentStats[]>([]);
  const [escalations, setEscalations] = useState<TicketRecord[]>([]);
  const [trendData, setTrendData] = useState<Array<{ date: string; newTickets: number; resolved: number }>>([]);
  const [responseData, setResponseData] = useState<Array<{ name: string; hours: number }>>([]);
  const [slaData, setSlaData] = useState<Array<{ name: string; value: number; color: string }>>([]);
  const [workloadData, setWorkloadData] = useState<Array<{ name: string; openTickets: number }>>([]);
  const [categoryData, setCategoryData] = useState<Array<{ name: string; count: number; color: string }>>([]);
  const [reopenData, setReopenData] = useState<Array<{ date: string; count: number }>>([]);
  const loadRequestIdRef = useRef(0);
  const userScopeKey = headerCtx?.currentEmail ?? '';

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
    void loadData();
  }, [refreshKey, dateRange, userScopeKey]);

  async function loadData() {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError(null);
    const now = new Date();
    const from = new Date(now);
    from.setDate(now.getDate() - (dateRange - 1));

    try {
      const [metricsRes, perfRes, workloadRes, slaRes, volumeRes, categoryRes, reopenRes, activityRes, escalationTickets] = await Promise.all([
        fetchTicketMetrics(),
        fetchReportAgentPerformance({ from: ymd(from), to: ymd(now) }),
        fetchReportAgentWorkload({ from: ymd(from), to: ymd(now) }),
        fetchReportSlaCompliance({ from: ymd(from), to: ymd(now) }),
        fetchReportTicketVolume({ from: ymd(from), to: ymd(now) }),
        fetchReportTicketsByCategory({ from: ymd(from), to: ymd(now) }),
        fetchReportReopenRate({ from: ymd(from), to: ymd(now) }),
        fetchTicketActivity({ from: ymd(from), to: ymd(now) }),
        fetchTopOpenEscalations()
      ]);
      if (loadRequestIdRef.current !== requestId) return;

      const perfMap = new Map(perfRes.data.map((item) => [item.userId, item]));
      const loadMap = new Map(workloadRes.data.map((item) => [item.userId, item]));
      const ids = new Set<string>([...perfRes.data.map((item) => item.userId), ...workloadRes.data.map((item) => item.userId)]);
      const builtAgents: AgentStats[] = Array.from(ids).map((id) => {
        const perf = perfMap.get(id);
        const load = loadMap.get(id);
        const name = perf?.name ?? load?.name ?? 'Unknown Agent';
        const openTickets = load?.assignedOpen ?? 0;
        const inProgress = load?.inProgress ?? 0;
        const resolvedPeriod = perf?.ticketsResolved ?? 0;
        const firstResponses = perf?.firstResponses ?? 0;
        const avgResponseHours = perf?.avgFirstResponseHours ?? null;
        const avgResolutionHours = perf?.avgResolutionHours ?? null;
        return {
          id,
          name,
          email: perf?.email ?? load?.email ?? '',
          avatar: initials(name),
          openTickets,
          inProgress,
          resolvedPeriod,
          firstResponses,
          avgResponseHours,
          avgResolutionHours,
        };
      });
      setAgents(builtAgents);

      const totalFirstResponses = builtAgents.reduce((sum, item) => sum + item.firstResponses, 0);
      const totalResolved = builtAgents.reduce((sum, item) => sum + item.resolvedPeriod, 0);
      const avgFirstResponseHours =
        totalFirstResponses > 0
          ? builtAgents.reduce((sum, item) => {
              const response = item.avgResponseHours ?? 0;
              return sum + response * item.firstResponses;
            }, 0) / totalFirstResponses
          : null;
      const avgResolutionHours =
        totalResolved > 0
          ? builtAgents.reduce((sum, item) => {
              const resolution = item.avgResolutionHours ?? 0;
              return sum + resolution * item.resolvedPeriod;
            }, 0) / totalResolved
          : null;

      const firstResponseTotal = slaRes.data.firstResponseMet + slaRes.data.firstResponseBreached;
      const resolutionTotal = slaRes.data.resolutionMet + slaRes.data.resolutionBreached;
      const slaPct = slaRes.data.total > 0 ? Math.round((slaRes.data.met / slaRes.data.total) * 100) : 0;
      const createdInRange = volumeRes.data.reduce((sum, item) => sum + item.count, 0);
      const resolvedInRange = activityRes.data.reduce((sum, item) => sum + item.resolved, 0);
      setMetrics({
        createdInRange,
        resolvedInRange,
        currentOpenTickets: metricsRes.open,
        avgFirstResponseTime: hfmt(avgFirstResponseHours),
        avgResolutionTime: hfmt(avgResolutionHours),
        slaCompliance: `${slaPct}%`,
        slaMet: slaRes.data.met,
        slaBreached: slaRes.data.breached,
        firstResponseMet: slaRes.data.firstResponseMet,
        firstResponseBreached: slaRes.data.firstResponseBreached,
        resolutionMet: slaRes.data.resolutionMet,
        resolutionBreached: slaRes.data.resolutionBreached,
        firstResponseSla: firstResponseTotal > 0 ? `${Math.round((slaRes.data.firstResponseMet / firstResponseTotal) * 100)}%` : `${slaPct}%`,
        resolutionSla: resolutionTotal > 0 ? `${Math.round((slaRes.data.resolutionMet / resolutionTotal) * 100)}%` : `${slaPct}%`
      });

      setTrendData(
        activityRes.data.map((item) => ({
          date: item.date,
          newTickets: item.open,
          resolved: item.resolved
        }))
      );
      setResponseData(
        [...builtAgents]
          .filter((item) => item.avgResponseHours != null)
          .sort((a, b) => (a.avgResponseHours ?? Number.MAX_VALUE) - (b.avgResponseHours ?? Number.MAX_VALUE))
          .slice(0, 8)
          .map((item) => ({
          name: item.name.split(' ')[0],
          hours: Number((item.avgResponseHours ?? 0).toFixed(2))
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

      const slaBars = [
        { name: 'Met', value: slaRes.data.met, color: '#22c55e' },
        { name: 'Breached', value: slaRes.data.breached, color: '#ef4444' },
      ].filter((item) => item.value > 0);
      setSlaData(slaBars.length ? slaBars : [{ name: 'No Data', value: 1, color: '#cbd5e1' }]);

      setReopenData(
        reopenRes.data.map((item) => ({
          date: item.date,
          count: item.count
        }))
      );

      setEscalations(escalationTickets);
    } catch {
      if (loadRequestIdRef.current !== requestId) return;
      setError('Unable to load manager insights.');
      setMetrics(null);
      setAgents([]);
      setEscalations([]);
      setTrendData([]);
      setResponseData([]);
      setSlaData([]);
      setWorkloadData([]);
      setCategoryData([]);
      setReopenData([]);
    } finally {
      if (loadRequestIdRef.current === requestId) setLoading(false);
    }
  }

  const sortedAgents = useMemo(() => {
    const list = [...agents];
    if (sortBy === 'workload') return list.sort((a, b) => b.openTickets - a.openTickets);
    if (sortBy === 'resolved') return list.sort((a, b) => b.resolvedPeriod - a.resolvedPeriod);
    if (sortBy === 'response') {
      return list.sort(
        (a, b) => (a.avgResponseHours ?? Number.MAX_VALUE) - (b.avgResponseHours ?? Number.MAX_VALUE)
      );
    }
    return list.sort(
      (a, b) => (a.avgResolutionHours ?? Number.MAX_VALUE) - (b.avgResolutionHours ?? Number.MAX_VALUE)
    );
  }, [agents, sortBy]);

  const hasData = Boolean(metrics && (metrics.createdInRange > 0 || agents.length > 0));

  function handleExportReport() {
    const rows: Array<Array<string | number | boolean | null | undefined>> = [
      ['Generated At', new Date().toISOString()],
      ['Date Range (days)', dateRange],
      ['Tickets Created (range)', metrics?.createdInRange ?? 0],
      ['Tickets Resolved (range)', metrics?.resolvedInRange ?? 0],
      ['Current Open Tickets', metrics?.currentOpenTickets ?? 0],
      ['Avg First Response Time', metrics?.avgFirstResponseTime ?? '—'],
      ['Avg Resolution Time', metrics?.avgResolutionTime ?? '—'],
      ['SLA Compliance', metrics?.slaCompliance ?? '0%'],
      ['SLA Met', metrics?.slaMet ?? 0],
      ['SLA Breached', metrics?.slaBreached ?? 0],
      ['First Response Met', metrics?.firstResponseMet ?? 0],
      ['First Response Breached', metrics?.firstResponseBreached ?? 0],
      ['Resolution Met', metrics?.resolutionMet ?? 0],
      ['Resolution Breached', metrics?.resolutionBreached ?? 0],
      [],
      ['Agent Name', 'Email', 'Open Tickets', 'In Progress', 'First Responses', 'Resolved (Period)', 'Avg First Response Hours', 'Avg Resolution Hours']
    ];

    for (const agent of sortedAgents) {
      rows.push([
        agent.name,
        agent.email,
        agent.openTickets,
        agent.inProgress,
        agent.firstResponses,
        agent.resolvedPeriod,
        agent.avgResponseHours != null ? Number(agent.avgResponseHours.toFixed(2)) : '—',
        agent.avgResolutionHours != null ? Number(agent.avgResolutionHours.toFixed(2)) : '—'
      ]);
    }

    if (escalations.length > 0) {
      rows.push([]);
      rows.push(['Critical Escalations']);
      rows.push(['Ticket', 'Subject', 'Priority', 'Status']);
      for (const ticket of escalations) {
        rows.push([
          formatTicketId(ticket),
          ticket.subject,
          ticket.priority,
          formatStatus(ticket.status)
        ]);
      }
    }

    downloadCsv(`manager-view-${ymd(new Date())}.csv`, rows);
  }

  return (
    <section className="min-h-full bg-slate-50 animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1600px] px-6 py-4">
          {headerCtx ? (
            <TopBar
              title={headerCtx.title}
              subtitle={headerCtx.subtitle}
              currentEmail={headerCtx.currentEmail}
              personas={headerCtx.personas}
              onEmailChange={headerCtx.onEmailChange}
              onOpenSearch={headerCtx.onOpenSearch}
              notificationProps={headerCtx.notificationProps}
              leftContent={
                <div>
                  <h1 className="text-xl font-semibold text-slate-900">{headerCtx.title}</h1>
                  <p className="text-sm text-slate-500">{headerCtx.subtitle}</p>
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

      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-6 py-4">
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
                  activeTab === key ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
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
                className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
              >
                <CalendarDays className="h-4 w-4 text-slate-500" />
                Last {dateRange} days
                <ChevronDown className="h-4 w-4 text-slate-500" />
              </button>
              {showDateDropdown ? (
                <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-md border border-slate-200 bg-white shadow-lg">
                  {DATE_OPTIONS.map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => {
                        setDateRange(days);
                        setShowDateDropdown(false);
                      }}
                      className={`block w-full px-4 py-2 text-left text-sm hover:bg-slate-100 ${
                        dateRange === days ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
                      }`}
                    >
                      Last {days} days
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button type="button" onClick={handleExportReport} className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700">
              <Download className="h-4 w-4" />
              Export Report
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] p-6">
        {loading ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`kpi-skeleton-${index}`} className="h-28 rounded-lg border border-slate-200 bg-white skeleton-shimmer" />
              ))}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="h-80 rounded-lg border border-slate-200 bg-white skeleton-shimmer" />
              <div className="h-80 rounded-lg border border-slate-200 bg-white skeleton-shimmer" />
            </div>
          </div>
        ) : null}

        {!loading && error ? (
            <EmptyState
              title="Unable to load manager insights"
              description={error}
              secondaryAction={{ label: 'Retry', onClick: () => void loadData() }}
            />
          ) : null}

        {!loading && !error && !hasData ? (
          <EmptyState
            title="No manager data yet"
            description={teamsList.length === 0 ? 'Add teams first to start collecting insights.' : 'Data will appear once tickets are active.'}
            secondaryAction={{ label: 'Refresh', onClick: () => void loadData() }}
          />
        ) : null}

        {!loading && !error && hasData && activeTab === 'overview' ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-sm text-slate-600">Tickets Created</div><div className="text-3xl font-bold text-slate-900">{metrics?.createdInRange ?? 0}</div><div className="mt-1 text-xs text-slate-500">Last {dateRange} days</div></div>
              <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-sm text-slate-600">Tickets Resolved</div><div className="text-3xl font-bold text-slate-900">{metrics?.resolvedInRange ?? 0}</div><div className="mt-1 text-xs text-slate-500">Last {dateRange} days</div></div>
              <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-sm text-slate-600">Current Open Tickets</div><div className="text-3xl font-bold text-slate-900">{metrics?.currentOpenTickets ?? 0}</div><div className="mt-1 text-xs text-slate-500">Current snapshot</div></div>
              <div className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-sm text-slate-600">SLA Compliance</div><div className="text-3xl font-bold text-slate-900">{metrics?.slaCompliance}</div><div className="mt-1 text-xs text-slate-500">First {metrics?.firstResponseSla} • Resolution {metrics?.resolutionSla}</div></div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-slate-900">Ticket Trends</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value) => formatUtcShortDate(String(value))}
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        minTickGap={24}
                      />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                      <Tooltip labelFormatter={(value) => formatUtcTooltipDate(String(value))} />
                      <Line type="monotone" dataKey="newTickets" stroke="#3b82f6" strokeWidth={2.5} dot={false} name="New Tickets" />
                      <Line type="monotone" dataKey="resolved" stroke="#22c55e" strokeWidth={2.5} dot={false} name="Resolved" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-slate-900">SLA Compliance</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={slaData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                        {slaData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-slate-900">SLA Breakdown</h3>
                <div className="space-y-2 text-sm text-slate-700">
                  <div className="flex items-center justify-between"><span>Overall Met</span><span className="font-medium text-slate-900">{metrics?.slaMet ?? 0}</span></div>
                  <div className="flex items-center justify-between"><span>Overall Breached</span><span className="font-medium text-slate-900">{metrics?.slaBreached ?? 0}</span></div>
                  <div className="mt-3 border-t border-slate-100 pt-3 flex items-center justify-between"><span>First Response Met</span><span className="font-medium text-slate-900">{metrics?.firstResponseMet ?? 0}</span></div>
                  <div className="flex items-center justify-between"><span>First Response Breached</span><span className="font-medium text-slate-900">{metrics?.firstResponseBreached ?? 0}</span></div>
                  <div className="mt-3 border-t border-slate-100 pt-3 flex items-center justify-between"><span>Resolution Met</span><span className="font-medium text-slate-900">{metrics?.resolutionMet ?? 0}</span></div>
                  <div className="flex items-center justify-between"><span>Resolution Breached</span><span className="font-medium text-slate-900">{metrics?.resolutionBreached ?? 0}</span></div>
                  <div className="mt-3 border-t border-slate-100 pt-3 flex items-center justify-between"><span>Avg First Response</span><span className="font-medium text-slate-900">{metrics?.avgFirstResponseTime ?? '—'}</span></div>
                  <div className="flex items-center justify-between"><span>Avg Resolution</span><span className="font-medium text-slate-900">{metrics?.avgResolutionTime ?? '—'}</span></div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-slate-900">Highest Priority Open Tickets</h3>
                <div className="space-y-3">
                  {escalations.length === 0 ? (
                    <p className="text-sm text-slate-500">No open tickets in this range.</p>
                  ) : (
                    escalations.map((ticket) => (
                      <div key={ticket.id} className="rounded-lg border border-red-200 bg-red-50 p-3">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-sm font-medium text-blue-600">{formatTicketId(ticket)}</span>
                          <PriorityBadge priority={ticket.priority} />
                        </div>
                        <p className="mb-1 text-sm text-slate-900">{ticket.subject}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
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
              <h2 className="text-lg font-semibold text-slate-900">Team Members ({sortedAgents.length})</h2>
              <div className="relative" data-sort-dropdown>
                <button
                  type="button"
                  onClick={() => setShowSortDropdown((prev) => !prev)}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Sort by: {SORT_OPTIONS.find((item) => item.key === sortBy)?.label}
                  <ChevronDown className="h-4 w-4 text-slate-500" />
                </button>
                {showSortDropdown ? (
                  <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border border-slate-200 bg-white shadow-lg">
                    {SORT_OPTIONS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setSortBy(item.key);
                          setShowSortDropdown(false);
                        }}
                        className={`block w-full px-4 py-2 text-left text-sm hover:bg-slate-100 ${
                          item.key === sortBy ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
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
                <button key={agent.id} type="button" onClick={() => setSelectedAgent(agent)} className="rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-sm">
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-lg font-semibold text-white">{agent.avatar}</div>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">{agent.name}</h3>
                        <p className="text-xs text-slate-500">{agent.email}</p>
                      </div>
                    </div>
                  </div>
                  <div className="mb-3 grid grid-cols-4 gap-3">
                    <div className="text-center"><div className="text-lg font-bold text-blue-600">{agent.openTickets}</div><div className="text-xs text-slate-500">Open</div></div>
                    <div className="text-center"><div className="text-lg font-bold text-amber-600">{agent.inProgress}</div><div className="text-xs text-slate-500">In Progress</div></div>
                    <div className="text-center"><div className="text-lg font-bold text-purple-600">{agent.resolvedPeriod}</div><div className="text-xs text-slate-500">Period</div></div>
                    <div className="text-center"><div className="text-lg font-bold text-emerald-600">{agent.firstResponses}</div><div className="text-xs text-slate-500">1st Resp.</div></div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-600"><span>Avg First Response: {hfmt(agent.avgResponseHours)}</span><span>Avg Resolution: {hfmt(agent.avgResolutionHours)}</span></div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {!loading && !error && hasData && activeTab === 'performance' ? (
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-slate-900">Avg First Response Hours by Agent</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={responseData}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} /><YAxis tick={{ fontSize: 11, fill: '#64748b' }} /><Tooltip /><Bar dataKey="hours" fill="#6366f1" radius={[6, 6, 0, 0]} /></BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-slate-900">Reopened Tickets Trend</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={reopenData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value) => formatUtcShortDate(String(value))}
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        minTickGap={24}
                      />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                      <Tooltip labelFormatter={(value) => formatUtcTooltipDate(String(value))} />
                      <Line type="monotone" dataKey="count" stroke="#a855f7" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {!loading && !error && hasData && activeTab === 'workload' ? (
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-slate-900">Current Workload Distribution</h3>
                <div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={workloadData}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} /><YAxis tick={{ fontSize: 11, fill: '#64748b' }} /><Tooltip /><Bar dataKey="openTickets" fill="#3b82f6" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-6">
                <h3 className="mb-4 text-sm font-semibold text-slate-900">Tickets by Category</h3>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart><Pie data={categoryData} dataKey="count" nameKey="name" innerRadius={55} outerRadius={100}>{categoryData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip /></PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-6">
              <h3 className="mb-4 text-sm font-semibold text-slate-900">Workload Snapshot</h3>
              <div className="space-y-4">
                {[...agents]
                  .sort((a, b) => b.openTickets - a.openTickets)
                  .map((agent) => {
                    return (
                      <div key={`workload-${agent.id}`} className="rounded-lg border border-slate-200 p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                              {agent.avatar}
                            </div>
                            <div>
                              <h4 className="text-sm font-semibold text-slate-900">{agent.name}</h4>
                              <p className="text-xs text-slate-500">{agent.email}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-slate-900">{agent.openTickets} open tickets</div>
                            <div className="text-xs text-slate-500">{agent.inProgress} in progress</div>
                          </div>
                        </div>

                        <div className="grid gap-2 text-xs text-slate-600 md:grid-cols-3">
                          <div className="rounded-md bg-slate-50 px-3 py-2">Open: <span className="font-medium text-slate-900">{agent.openTickets}</span></div>
                          <div className="rounded-md bg-slate-50 px-3 py-2">In Progress: <span className="font-medium text-slate-900">{agent.inProgress}</span></div>
                          <div className="rounded-md bg-slate-50 px-3 py-2">Resolved: <span className="font-medium text-slate-900">{agent.resolvedPeriod}</span></div>
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
