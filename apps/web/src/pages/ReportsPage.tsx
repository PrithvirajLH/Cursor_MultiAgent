import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import {
  ApiError,
  fetchReportSummary,
  fetchReportTeamSummary,
  fetchReportTicketVolume,
  fetchReportTicketsByAge,
  fetchReportTicketsByCategory,
  fetchReportReopenRate,
  fetchReportTransfers,
  fetchTeams,
  type AgentPerformanceResponse,
  type NotificationRecord,
  type ReportQuery,
  type ReopenRateResponse,
  type SlaComplianceResponse,
  type TeamRef,
  type TeamSummaryResponse,
  type TicketAgeBucketResponse,
  type TicketsByCategoryResponse,
  type TicketsByStatusResponse
} from '../api/client';
import { TopBar } from '../components/TopBar';
import { useToast } from '../hooks/useToast';
import type { Role } from '../types';

type ReportsHeaderProps = {
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

type ReportsTab = 'overview' | 'sla' | 'volume' | 'agents' | 'csat' | 'backlog' | 'export';
type RangeKey = 'last_7' | 'last_14' | 'last_30' | 'custom';
type PriorityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';

type ReportsFilters = {
  range: RangeKey;
  teamId: string;
  channel: string;
  status: string;
  priority: PriorityFilter;
  assignee: string;
  tags: string[];
  compare: boolean;
};

type SavedView = {
  id: string;
  name: string;
  desc: string;
};

type SourceState = {
  summary: boolean;
  solvedSeries: boolean;
  backlogSeries: boolean;
  categories: boolean;
  aging: boolean;
  reopenRate: boolean;
  teamSummary: boolean;
  transfers: boolean;
};

type OverviewKpis = {
  tickets: number;
  resolved: number;
  backlog: number;
  frSla: number;
  resSla: number;
  csat: number;
  avgHandleMin: number;
};

type TopCategory = { name: string; count: number; trend: number };
type WorstBreach = {
  ticket: string;
  team: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  stage: string;
  breachBy: string;
  reason: string;
};
type AgentRow = { name: string; team: string; solved: number; fr: number; res: number; csat: number };
type AgeBucket = { bucket: string; count: number };

const CHANNELS = ['email', 'web', 'chat', 'phone'];
const STATUSES = ['new', 'open', 'pending', 'resolved', 'closed'];
const TAGS = ['vip', 'bug', 'billing', 'feature', 'outage', 'refund', 'onboarding'];

const PRIORITY_BADGES: Record<'critical' | 'high' | 'medium' | 'low', string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-blue-100 text-blue-700'
};

const UI_TO_API_PRIORITY: Record<Exclude<PriorityFilter, 'all'>, string> = {
  critical: 'P1',
  high: 'P2',
  medium: 'P3',
  low: 'P4'
};

const DEMO_KPIS: OverviewKpis = {
  tickets: 1248,
  resolved: 287,
  backlog: 611,
  frSla: 93.6,
  resSla: 89.2,
  csat: 4.42,
  avgHandleMin: 18.7
};

const DEMO_SERIES = {
  volume: [76, 81, 88, 92, 86, 94, 101, 97, 90, 104, 99, 95, 102, 108],
  solved: [70, 68, 74, 76, 72, 80, 84, 81, 78, 86, 82, 79, 88, 91],
  backlog: [49, 52, 56, 58, 55, 59, 61, 60, 62, 64, 63, 65, 66, 68],
  frSla: [93, 94, 92, 95, 94, 93, 95, 94, 92, 93, 94, 95, 93, 94],
  resSla: [88, 89, 87, 90, 89, 88, 90, 89, 88, 89, 90, 88, 89, 90],
  csat: [4.3, 4.4, 4.35, 4.45, 4.4, 4.5, 4.55, 4.5, 4.48, 4.52, 4.49, 4.53, 4.55, 4.57]
};

const DEMO_TOP_CATEGORIES: TopCategory[] = [
  { name: 'Billing and Invoices', count: 142, trend: 8 },
  { name: 'Login and MFA', count: 118, trend: 3 },
  { name: 'API Errors', count: 103, trend: -4 },
  { name: 'Integrations', count: 92, trend: 6 },
  { name: 'Bug Reports', count: 77, trend: 2 }
];

const DEMO_WORST_BREACHES: WorstBreach[] = [
  {
    ticket: 'TKT-25401',
    team: 'Technical Support',
    priority: 'critical',
    stage: 'Resolution',
    breachBy: '1h 12m',
    reason: 'Awaiting vendor response'
  },
  {
    ticket: 'TKT-25377',
    team: 'Billing',
    priority: 'high',
    stage: 'First response',
    breachBy: '38m',
    reason: 'Queue overload'
  },
  {
    ticket: 'TKT-25311',
    team: 'Customer Success',
    priority: 'medium',
    stage: 'Resolution',
    breachBy: '5h',
    reason: 'Missing customer info'
  },
  {
    ticket: 'TKT-25298',
    team: 'Sales',
    priority: 'high',
    stage: 'Resolution',
    breachBy: '2h',
    reason: 'Escalation gap'
  }
];

const DEMO_AGENTS: AgentRow[] = [
  { name: 'Emily R.', team: 'Technical Support', solved: 92, fr: 96, res: 91, csat: 4.6 },
  { name: 'Mike C.', team: 'Billing', solved: 61, fr: 93, res: 88, csat: 4.3 },
  { name: 'Lisa W.', team: 'Customer Success', solved: 74, fr: 95, res: 90, csat: 4.5 },
  { name: 'Robert K.', team: 'Sales', solved: 48, fr: 91, res: 85, csat: 4.2 }
];

const DEMO_AGE_BUCKETS: AgeBucket[] = [
  { bucket: '0-1 day', count: 233 },
  { bucket: '1-3 days', count: 171 },
  { bucket: '3-7 days', count: 128 },
  { bucket: '7-14 days', count: 54 },
  { bucket: '14+ days', count: 25 }
];

const FIXED_BACKEND_TODO = [
  'Persist saved report views in backend.',
  'Add backend support for channel/status/assignee/tag report filters.',
  'Expose CSAT and quality-trend report endpoints.'
];

function ymd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function rangeToDates(range: RangeKey): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  const days = range === 'last_7' ? 7 : range === 'last_14' ? 14 : 30;
  from.setDate(to.getDate() - days);
  return { from: ymd(from), to: ymd(to) };
}

function sumCounts(rows: Array<{ count: number }>): number {
  return rows.reduce((sum, row) => sum + row.count, 0);
}

function toPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function toSafePercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const parsed = JSON.parse(err.message) as { message?: string };
      if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message;
    } catch {
      // noop
    }
    return err.message || 'Request failed';
  }
  if (err instanceof Error) return err.message;
  return 'Request failed';
}

function toneForMetric(value: number, target: number): string {
  if (value >= target) return 'text-green-600';
  if (value >= target - 5) return 'text-amber-600';
  return 'text-red-600';
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="relative inline-flex h-[22px] w-10 items-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="absolute inset-0 cursor-pointer rounded-full bg-slate-300 transition peer-checked:bg-blue-600" />
      <span className="absolute bottom-[3px] left-[3px] h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-[18px]" />
    </label>
  );
}

function StatCard({
  label,
  value,
  sub,
  iconPath,
  tone = 'blue'
}: {
  label: string;
  value: string | number;
  sub?: string;
  iconPath: string;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'gray';
}) {
  const toneMap: Record<string, { bg: string; icon: string; ring: string }> = {
    blue: { bg: 'bg-blue-50', icon: 'text-blue-600', ring: 'ring-blue-200' },
    green: { bg: 'bg-green-50', icon: 'text-green-600', ring: 'ring-green-200' },
    amber: { bg: 'bg-amber-50', icon: 'text-amber-600', ring: 'ring-amber-200' },
    red: { bg: 'bg-red-50', icon: 'text-red-600', ring: 'ring-red-200' },
    purple: { bg: 'bg-purple-50', icon: 'text-purple-600', ring: 'ring-purple-200' },
    gray: { bg: 'bg-slate-50', icon: 'text-slate-600', ring: 'ring-slate-200' }
  };
  const palette = toneMap[tone] ?? toneMap.blue;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className={`mt-1 text-2xl font-bold ${palette.icon}`}>{value}</p>
          {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${palette.bg} ${palette.ring}`}>
          <svg className={`h-5 w-5 ${palette.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
          </svg>
        </div>
      </div>
    </div>
  );
}

function SparkArea({ points, height = 60 }: { points: number[]; height?: number }) {
  const width = 220;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const norm = (value: number) => (max === min ? 0.5 : (value - min) / (max - min));
  const xCoords = points.map((_, idx) => idx * (width / Math.max(points.length - 1, 1)));
  const yCoords = points.map((value) => (1 - norm(value)) * (height - 8) + 4);
  const line = xCoords.map((x, idx) => `${x.toFixed(1)},${yCoords[idx].toFixed(1)}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block">
      <path d={`M ${area}`} fill="currentColor" opacity="0.12" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MiniBars({ points, height = 60 }: { points: number[]; height?: number }) {
  const width = 220;
  const max = Math.max(...points, 1);
  const barWidth = width / Math.max(points.length, 1);
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block">
      {points.map((point, idx) => {
        const barHeight = (point / max) * (height - 10);
        return (
          <rect
            key={`bar-${idx}`}
            x={idx * barWidth + 3}
            y={height - barHeight}
            width={Math.max(barWidth - 6, 2)}
            height={barHeight}
            rx="3"
          />
        );
      })}
    </svg>
  );
}

function Donut({ value, label, sub }: { value: number; label: string; sub: string }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const dash = (clamped / 100) * circumference;
  return (
    <div className="flex items-center space-x-4">
      <svg width="56" height="56" viewBox="0 0 56 56">
        <g transform="translate(28,28)">
          <circle r={radius} fill="none" stroke="currentColor" opacity="0.15" strokeWidth="8" />
          <circle
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            transform="rotate(-90)"
          />
        </g>
      </svg>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-xl font-bold text-slate-900">{toPercent(clamped)}</p>
        <p className="text-xs text-slate-400">{sub}</p>
      </div>
    </div>
  );
}

function CardShell({
  title,
  sub,
  right,
  children
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center space-x-2 rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
      <span>{label}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} className="opacity-70 hover:opacity-100">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      ) : null}
    </span>
  );
}

export function ReportsPage({
  role,
  headerProps
}: {
  role: Role;
  headerProps?: ReportsHeaderProps;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<ReportsTab>('overview');
  const [teams, setTeams] = useState<TeamRef[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([
    { id: 'v1', name: 'Exec Weekly', desc: 'Last 7d - All teams - Compare' },
    { id: 'v2', name: 'Billing SLA', desc: 'Last 30d - Billing - High/Critical' }
  ]);
  const [activeView, setActiveView] = useState('v1');
  const [showExportModal, setShowExportModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const [filters, setFilters] = useState<ReportsFilters>({
    range: 'last_14',
    teamId: 'all',
    channel: 'all',
    status: 'all',
    priority: 'all',
    assignee: 'all',
    tags: [],
    compare: true
  });

  const [volumeSeries, setVolumeSeries] = useState<number[]>([]);
  const [volumeDates, setVolumeDates] = useState<string[]>([]);
  const [solvedSeries, setSolvedSeries] = useState<number[]>([]);
  const [backlogSeries, setBacklogSeries] = useState<number[]>([]);
  const [slaData, setSlaData] = useState<SlaComplianceResponse['data'] | null>(null);
  const [statusData, setStatusData] = useState<TicketsByStatusResponse['data']>([]);
  const [agentData, setAgentData] = useState<AgentPerformanceResponse['data']>([]);
  const [categoryData, setCategoryData] = useState<TicketsByCategoryResponse['data']>([]);
  const [ageData, setAgeData] = useState<TicketAgeBucketResponse['data']>([]);
  const [reopenData, setReopenData] = useState<ReopenRateResponse['data']>([]);
  const [teamSummaryData, setTeamSummaryData] = useState<TeamSummaryResponse['data']>([]);
  const [sources, setSources] = useState<SourceState>({
    summary: false,
    solvedSeries: false,
    backlogSeries: false,
    categories: false,
    aging: false,
    reopenRate: false,
    teamSummary: false,
    transfers: false
  });

  const canExport = role === 'LEAD' || role === 'TEAM_ADMIN' || role === 'OWNER';
  const canSaveViews = role === 'TEAM_ADMIN' || role === 'OWNER';

  useEffect(() => {
    fetchTeams()
      .then((response) => setTeams(response.data))
      .catch(() => setTeams([]));
  }, []);

  const dateRange = useMemo(() => rangeToDates(filters.range), [filters.range]);

  const reportQuery = useMemo<ReportQuery>(() => {
    const query: ReportQuery = {
      from: dateRange.from,
      to: dateRange.to
    };
    if (filters.teamId !== 'all') query.teamId = filters.teamId;
    if (filters.priority !== 'all') query.priority = UI_TO_API_PRIORITY[filters.priority];
    return query;
  }, [dateRange.from, dateRange.to, filters.priority, filters.teamId]);

  useEffect(() => {
    let cancelled = false;

    async function loadReports() {
      setLoading(true);
      setWarning(null);

      const nextSources: SourceState = {
        summary: false,
        solvedSeries: false,
        backlogSeries: false,
        categories: false,
        aging: false,
        reopenRate: false,
        teamSummary: false,
        transfers: false
      };

      const [summaryResult, solvedResult, backlogResult, categoriesResult, ageResult, reopenResult, teamSummaryResult, transfersResult] =
        await Promise.allSettled([
          fetchReportSummary({ ...reportQuery, groupBy: 'team' }),
          fetchReportTicketVolume({ ...reportQuery, statusGroup: 'resolved' }),
          fetchReportTicketVolume({ ...reportQuery, statusGroup: 'open' }),
          fetchReportTicketsByCategory(reportQuery),
          fetchReportTicketsByAge(reportQuery),
          fetchReportReopenRate(reportQuery),
          fetchReportTeamSummary(reportQuery),
          fetchReportTransfers(reportQuery)
        ]);

      if (cancelled) return;

      const warnings: string[] = [];

      if (summaryResult.status === 'fulfilled') {
        const summary = summaryResult.value;
        setVolumeSeries(summary.ticketVolume.data.map((point) => point.count));
        setVolumeDates(summary.ticketVolume.data.map((point) => point.date));
        setSlaData(summary.slaCompliance.data);
        setStatusData(summary.ticketsByStatus.data);
        setAgentData(summary.agentPerformance.data);
        nextSources.summary = true;
      } else {
        warnings.push(`summary: ${apiErrorMessage(summaryResult.reason)}`);
        setVolumeSeries([]);
        setVolumeDates([]);
        setSlaData(null);
        setStatusData([]);
        setAgentData([]);
      }

      if (solvedResult.status === 'fulfilled') {
        setSolvedSeries(solvedResult.value.data.map((point) => point.count));
        nextSources.solvedSeries = true;
      } else {
        warnings.push(`resolved-series: ${apiErrorMessage(solvedResult.reason)}`);
        setSolvedSeries([]);
      }

      if (backlogResult.status === 'fulfilled') {
        setBacklogSeries(backlogResult.value.data.map((point) => point.count));
        nextSources.backlogSeries = true;
      } else {
        warnings.push(`open-series: ${apiErrorMessage(backlogResult.reason)}`);
        setBacklogSeries([]);
      }

      if (categoriesResult.status === 'fulfilled') {
        setCategoryData(categoriesResult.value.data);
        nextSources.categories = true;
      } else {
        warnings.push(`categories: ${apiErrorMessage(categoriesResult.reason)}`);
        setCategoryData([]);
      }

      if (ageResult.status === 'fulfilled') {
        setAgeData(ageResult.value.data);
        nextSources.aging = true;
      } else {
        warnings.push(`aging: ${apiErrorMessage(ageResult.reason)}`);
        setAgeData([]);
      }

      if (reopenResult.status === 'fulfilled') {
        setReopenData(reopenResult.value.data);
        nextSources.reopenRate = true;
      } else {
        warnings.push(`reopen-rate: ${apiErrorMessage(reopenResult.reason)}`);
        setReopenData([]);
      }

      if (teamSummaryResult.status === 'fulfilled') {
        setTeamSummaryData(teamSummaryResult.value.data);
        nextSources.teamSummary = true;
      } else {
        warnings.push(`team-summary: ${apiErrorMessage(teamSummaryResult.reason)}`);
        setTeamSummaryData([]);
      }

      if (transfersResult.status === 'fulfilled') {
        nextSources.transfers = true;
      } else {
        warnings.push(`transfers: ${apiErrorMessage(transfersResult.reason)}`);
      }

      setSources(nextSources);
      setLoading(false);

      if (warnings.length > 0) {
        setWarning('Some report endpoints are unavailable. Matching sections are shown with demo fallback.');
      }
    }

    void loadReports();
    return () => {
      cancelled = true;
    };
  }, [reportQuery]);

  const selectedTeamName = useMemo(() => {
    if (filters.teamId === 'all') return 'All teams';
    return teams.find((team) => team.id === filters.teamId)?.name ?? 'Selected team';
  }, [filters.teamId, teams]);

  const rangeLabel = useMemo(() => {
    if (filters.range === 'last_7') return 'Last 7 days';
    if (filters.range === 'last_14') return 'Last 14 days';
    if (filters.range === 'last_30') return 'Last 30 days';
    return 'Custom';
  }, [filters.range]);

  const scopeLabel = `${selectedTeamName} - ${filters.channel === 'all' ? 'All channels' : filters.channel}`;

  const kpis = useMemo<OverviewKpis>(() => {
    if (!sources.summary || !slaData) return DEMO_KPIS;
    const totalFromStatus = sumCounts(statusData);
    const resolvedFromStatus = statusData
      .filter((row) => ['resolved', 'closed'].includes(row.status.toLowerCase()))
      .reduce((sum, row) => sum + row.count, 0);
    const backlogFromStatus = statusData
      .filter((row) => ['new', 'open', 'pending', 'in_progress'].includes(row.status.toLowerCase()))
      .reduce((sum, row) => sum + row.count, 0);

    const frTotal = slaData.firstResponseMet + slaData.firstResponseBreached;
    const resTotal = slaData.resolutionMet + slaData.resolutionBreached;
    const fr = toSafePercent(slaData.firstResponseMet, frTotal);
    const res = toSafePercent(slaData.resolutionMet, resTotal);

    const avgResolutionHours =
      agentData.length > 0
        ? agentData.reduce((sum, row) => sum + (row.avgResolutionHours ?? 0), 0) / agentData.length
        : 0;

    return {
      tickets: totalFromStatus || slaData.total || DEMO_KPIS.tickets,
      resolved: resolvedFromStatus || Math.max(slaData.met - slaData.breached, 0) || DEMO_KPIS.resolved,
      backlog: backlogFromStatus || DEMO_KPIS.backlog,
      frSla: fr || DEMO_KPIS.frSla,
      resSla: res || DEMO_KPIS.resSla,
      csat: DEMO_KPIS.csat,
      avgHandleMin: avgResolutionHours > 0 ? avgResolutionHours * 60 : DEMO_KPIS.avgHandleMin
    };
  }, [agentData, slaData, sources.summary, statusData]);

  const inboundSeries = volumeSeries.length > 0 ? volumeSeries : DEMO_SERIES.volume;
  const solvedSeriesSafe = solvedSeries.length > 0 ? solvedSeries : DEMO_SERIES.solved;
  const backlogSeriesSafe = backlogSeries.length > 0 ? backlogSeries : DEMO_SERIES.backlog;

  const topCategories = useMemo<TopCategory[]>(() => {
    if (!sources.categories || categoryData.length === 0) return DEMO_TOP_CATEGORIES;
    return [...categoryData]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((row) => ({ name: row.name, count: row.count, trend: 0 }));
  }, [categoryData, sources.categories]);

  const agentRows = useMemo<AgentRow[]>(() => {
    if (!sources.summary || agentData.length === 0) return DEMO_AGENTS;
    return agentData.map((agent) => {
      const frScore =
        agent.avgFirstResponseHours == null
          ? 90
          : Math.max(60, Math.min(99, Math.round(100 - agent.avgFirstResponseHours * 7)));
      const resScore =
        agent.avgResolutionHours == null
          ? 88
          : Math.max(55, Math.min(99, Math.round(100 - agent.avgResolutionHours * 2)));
      const csat = Number((3.6 + (frScore + resScore) / 200).toFixed(1));
      return {
        name: agent.name || agent.email,
        team: selectedTeamName === 'All teams' ? 'Mixed' : selectedTeamName,
        solved: agent.ticketsResolved,
        fr: frScore,
        res: resScore,
        csat
      };
    });
  }, [agentData, selectedTeamName, sources.summary]);

  const ageBuckets = useMemo<AgeBucket[]>(() => {
    if (!sources.aging || ageData.length === 0) return DEMO_AGE_BUCKETS;
    return ageData.map((row) => ({ bucket: row.bucket, count: row.count }));
  }, [ageData, sources.aging]);

  const reopenRate = useMemo(() => {
    if (!sources.reopenRate || reopenData.length === 0) return 4.1;
    const reopens = sumCounts(reopenData);
    return Number(toSafePercent(reopens, Math.max(kpis.resolved, 1)).toFixed(1));
  }, [kpis.resolved, reopenData, sources.reopenRate]);

  const peakDays = useMemo(() => {
    if (volumeDates.length === inboundSeries.length && volumeDates.length > 0) {
      return volumeDates
        .map((date, idx) => ({ d: new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }), v: inboundSeries[idx] }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 5);
    }
    return [
      { d: 'Mon', v: 112 },
      { d: 'Tue', v: 104 },
      { d: 'Wed', v: 98 },
      { d: 'Thu', v: 91 },
      { d: 'Fri', v: 86 }
    ];
  }, [inboundSeries, volumeDates]);

  const backendTodo = useMemo(() => {
    const list = [...FIXED_BACKEND_TODO];
    if (!sources.categories) list.push('Add or restore /reports/tickets-by-category endpoint.');
    if (!sources.aging) list.push('Add or restore /reports/tickets-by-age endpoint.');
    if (!sources.reopenRate) list.push('Add or restore /reports/reopen-rate endpoint.');
    if (!sources.teamSummary) list.push('Add or restore /reports/team-summary endpoint.');
    if (!sources.transfers) list.push('Add or restore /reports/transfers endpoint.');
    return list;
  }, [sources.aging, sources.categories, sources.reopenRate, sources.teamSummary, sources.transfers]);

  function toggleTag(tag: string) {
    setFilters((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter((item) => item !== tag) : [...prev.tags, tag]
    }));
  }

  function resetFilters() {
    setFilters({
      range: 'last_14',
      teamId: 'all',
      channel: 'all',
      status: 'all',
      priority: 'all',
      assignee: 'all',
      tags: [],
      compare: true
    });
    toast.success('Filters reset');
  }

  function applyView(viewId: string) {
    setActiveView(viewId);
    if (viewId === 'v1') {
      setFilters((prev) => ({ ...prev, range: 'last_7', teamId: 'all', priority: 'all', compare: true, tags: [] }));
    } else if (viewId === 'v2') {
      const billingTeam = teams.find((team) => team.name.toLowerCase().includes('billing'));
      setFilters((prev) => ({
        ...prev,
        range: 'last_30',
        teamId: billingTeam?.id ?? 'all',
        priority: 'high',
        compare: false,
        tags: ['billing']
      }));
    }
    toast.success('View applied');
  }

  function saveCurrentView() {
    setSavedViews((prev) => [
      ...prev,
      { id: `v${Date.now()}`, name: 'New View', desc: `${rangeLabel} - ${scopeLabel}` }
    ]);
    toast.success('View saved');
  }

  function copyShareLink() {
    navigator.clipboard
      .writeText('https://app.helpdesk.local/reports/snapshots/abc123')
      .then(() => toast.success('Link copied'))
      .catch(() => toast.error('Failed to copy link'));
  }

  const exportScopeLabel = `${rangeLabel} - ${scopeLabel}`;

  return (
    <section className="min-h-full bg-slate-50 animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1600px] py-4 pl-6 pr-2">
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
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
                  <p className="mt-0.5 text-sm text-slate-500">Analytics and insights for your helpdesk.</p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
              <p className="mt-0.5 text-sm text-slate-500">Analytics and insights for your helpdesk.</p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] space-y-6 p-6">
        {warning ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            {warning}
          </div>
        ) : null}

        <div className="max-w-[560px]">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Saved views</p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={activeView}
                onChange={(event) => applyView(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
              >
                {savedViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={saveCurrentView}
                disabled={!canSaveViews}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  canSaveViews
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'cursor-not-allowed border border-slate-300 bg-slate-100 text-slate-400'
                }`}
              >
                Save current
              </button>
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Reset
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">{savedViews.find((view) => view.id === activeView)?.desc}</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px]">
              <label className="mb-1 block text-xs font-medium text-slate-700">Date range</label>
              <select
                value={filters.range}
                onChange={(event) => setFilters((prev) => ({ ...prev, range: event.target.value as RangeKey }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
              >
                <option value="last_7">Last 7 days</option>
                <option value="last_14">Last 14 days</option>
                <option value="last_30">Last 30 days</option>
                <option value="custom">Custom (mock)</option>
              </select>
            </div>
            <div className="min-w-[180px]">
              <label className="mb-1 block text-xs font-medium text-slate-700">Team</label>
              <select
                value={filters.teamId}
                onChange={(event) => setFilters((prev) => ({ ...prev, teamId: event.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All teams</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[160px]">
              <label className="mb-1 block text-xs font-medium text-slate-700">Channel</label>
              <select
                value={filters.channel}
                onChange={(event) => setFilters((prev) => ({ ...prev, channel: event.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All channels</option>
                {CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[160px]">
              <label className="mb-1 block text-xs font-medium text-slate-700">Status</label>
              <select
                value={filters.status}
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All status</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[160px]">
              <label className="mb-1 block text-xs font-medium text-slate-700">Priority</label>
              <select
                value={filters.priority}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, priority: event.target.value as PriorityFilter }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All priority</option>
                <option value="critical">critical</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
            </div>
            <div className="min-w-[180px]">
              <label className="mb-1 block text-xs font-medium text-slate-700">Assignee</label>
              <select
                value={filters.assignee}
                onChange={(event) => setFilters((prev) => ({ ...prev, assignee: event.target.value }))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All assignees</option>
                {agentRows.map((row) => (
                  <option key={row.name} value={row.name}>
                    {row.name} ({row.team})
                  </option>
                ))}
              </select>
            </div>
            <div className="ml-auto flex items-center space-x-2">
              <Toggle
                checked={filters.compare}
                onChange={(next) => setFilters((prev) => ({ ...prev, compare: next }))}
              />
              <span className="text-sm text-slate-700">Compare</span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <p className="mr-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Tags</p>
            {TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                  filters.tags.includes(tag)
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-4 pt-3">
          <div className="flex flex-wrap gap-6 border-b border-slate-200">
            {[
              ['overview', 'Overview'],
              ['sla', 'SLA'],
              ['volume', 'Volume'],
              ['agents', 'Agents'],
              ['csat', 'CSAT'],
              ['backlog', 'Backlog'],
              ['export', 'Export and sharing']
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id as ReportsTab)}
                className={`pb-3 text-sm font-medium transition-all ${
                  tab === id ? 'border-b-2 border-blue-600 text-blue-600' : 'border-b-2 border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="py-5">
            {loading ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                Loading report data...
              </div>
            ) : null}

            {tab === 'overview' ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <StatCard
                    tone="blue"
                    label="Tickets in scope"
                    value={kpis.tickets}
                    sub="All tickets matching filters"
                    iconPath="M9 17v-6a2 2 0 012-2h2a2 2 0 012 2v6m-10 0h10"
                  />
                  <StatCard
                    tone="green"
                    label="Resolved"
                    value={kpis.resolved}
                    sub="Current scope"
                    iconPath="M5 13l4 4L19 7"
                  />
                  <StatCard
                    tone="amber"
                    label="Backlog"
                    value={kpis.backlog}
                    sub="Open + pending"
                    iconPath="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                  <StatCard
                    tone="purple"
                    label="CSAT"
                    value={`${kpis.csat.toFixed(2)} / 5`}
                    sub={sources.summary ? 'Demo metric (API pending)' : 'Demo metric'}
                    iconPath="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.95a1 1 0 00.95.69h4.155c.969 0 1.371 1.24.588 1.81l-3.36 2.44a1 1 0 00-.364 1.118l1.286 3.95c.3.921-.755 1.688-1.538 1.118l-3.36-2.44a1 1 0 00-1.175 0l-3.36 2.44c-.783.57-1.838-.197-1.538-1.118l1.286-3.95a1 1 0 00-.364-1.118l-3.36-2.44c-.783-.57-.38-1.81.588-1.81h4.155a1 1 0 00.95-.69l1.286-3.95z"
                  />
                </div>

                <div className="grid gap-5 lg:grid-cols-12">
                  <div className="lg:col-span-7">
                    <CardShell
                      title="Volume vs solved"
                      sub="Daily trend. Compare uses current UI state."
                      right={<span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">Daily</span>}
                    >
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-sm font-semibold text-slate-800">Inbound</p>
                            <span className="text-xs text-slate-500">{inboundSeries.length} pts</span>
                          </div>
                          <div className="text-blue-600">
                            <MiniBars points={inboundSeries} />
                          </div>
                          <div className="mt-3 flex items-center justify-between text-xs">
                            <span className="text-slate-500">Avg/day</span>
                            <span className="font-semibold text-slate-700">
                              {Math.round(inboundSeries.reduce((sum, point) => sum + point, 0) / inboundSeries.length)}
                            </span>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-sm font-semibold text-slate-800">Solved</p>
                            <span className="text-xs text-slate-500">{solvedSeriesSafe.length} pts</span>
                          </div>
                          <div className="text-green-600">
                            <MiniBars points={solvedSeriesSafe} />
                          </div>
                          <div className="mt-3 flex items-center justify-between text-xs">
                            <span className="text-slate-500">Avg/day</span>
                            <span className="font-semibold text-slate-700">
                              {Math.round(
                                solvedSeriesSafe.reduce((sum, point) => sum + point, 0) / solvedSeriesSafe.length
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </CardShell>
                  </div>

                  <div className="space-y-5 lg:col-span-5">
                    <CardShell
                      title="SLA health"
                      sub="First response and resolution compliance."
                    >
                      <div className="grid grid-cols-2 gap-4">
                        <div className="text-blue-600">
                          <Donut value={kpis.frSla} label="First response" sub="Compliance" />
                        </div>
                        <div className="text-indigo-600">
                          <Donut value={kpis.resSla} label="Resolution" sub="Compliance" />
                        </div>
                      </div>
                      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">At-risk tickets (est.)</p>
                        <p className="mt-1 text-xl font-bold text-slate-900">
                          {Math.max(0, Math.round((kpis.backlog * (100 - kpis.resSla)) / 100))}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">Based on active backlog and current SLA trends.</p>
                      </div>
                    </CardShell>

                    <CardShell
                      title="Top categories"
                      sub="Highest volume categories"
                    >
                      <div className="space-y-2">
                        {topCategories.map((category) => (
                          <div key={category.name} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-slate-50">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-800">{category.name}</p>
                              <p className="text-xs text-slate-400">
                                Trend: {category.trend > 0 ? `+${category.trend}%` : `${category.trend}%`}
                              </p>
                            </div>
                            <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{category.count}</span>
                          </div>
                        ))}
                      </div>
                    </CardShell>
                  </div>
                </div>
              </div>
            ) : null}

            {tab === 'sla' ? (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs text-slate-500">First response SLA</p>
                    <p className={`mt-1 text-3xl font-bold ${toneForMetric(kpis.frSla, 95)}`}>{kpis.frSla.toFixed(1)}%</p>
                    <p className="mt-1 text-xs text-slate-400">Target 95%</p>
                    <div className="mt-3 text-blue-600">
                      <SparkArea points={sources.summary ? inboundSeries.slice(-12) : DEMO_SERIES.frSla} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs text-slate-500">Resolution SLA</p>
                    <p className={`mt-1 text-3xl font-bold ${toneForMetric(kpis.resSla, 92)}`}>{kpis.resSla.toFixed(1)}%</p>
                    <p className="mt-1 text-xs text-slate-400">Target 92%</p>
                    <div className="mt-3 text-indigo-600">
                      <SparkArea points={sources.summary ? solvedSeriesSafe.slice(-12) : DEMO_SERIES.resSla} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs text-slate-500">Breaches</p>
                    <p className="mt-1 text-3xl font-bold text-red-600">
                      {slaData ? slaData.firstResponseBreached + slaData.resolutionBreached : 23}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">In current scope</p>
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
                      <p className="text-xs font-medium text-red-700">Top driver</p>
                      <p className="mt-1 text-sm font-semibold text-red-800">Queue overload</p>
                      <p className="mt-1 text-xs text-red-700">Improve routing and staffing peaks</p>
                    </div>
                  </div>
                </div>

                <CardShell title="Worst SLA breaches" sub="Tickets with highest breach duration.">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50">
                        <tr>
                          {['Ticket', 'Team', 'Priority', 'Stage', 'Breach by', 'Reason'].map((heading) => (
                            <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {DEMO_WORST_BREACHES.map((row) => (
                          <tr key={row.ticket} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-semibold text-slate-900">{row.ticket}</td>
                            <td className="px-4 py-3 text-slate-700">{row.team}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded-lg px-2 py-1 text-xs font-medium ${PRIORITY_BADGES[row.priority]}`}>
                                {row.priority}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{row.stage}</td>
                            <td className="px-4 py-3 font-semibold text-red-600">{row.breachBy}</td>
                            <td className="px-4 py-3 text-slate-600">{row.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardShell>
              </div>
            ) : null}

            {tab === 'volume' ? (
              <div className="space-y-5">
                <div className="grid gap-5 lg:grid-cols-12">
                  <div className="lg:col-span-8">
                    <CardShell title="Inbound vs solved vs backlog" sub="Daily trend">
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-sm font-semibold text-slate-800">Inbound</p>
                          <p className="mb-2 text-xs text-slate-400">Tickets/day</p>
                          <div className="text-blue-600">
                            <MiniBars points={inboundSeries} />
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-sm font-semibold text-slate-800">Solved</p>
                          <p className="mb-2 text-xs text-slate-400">Tickets/day</p>
                          <div className="text-green-600">
                            <MiniBars points={solvedSeriesSafe} />
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-sm font-semibold text-slate-800">Backlog</p>
                          <p className="mb-2 text-xs text-slate-400">Open tickets</p>
                          <div className="text-amber-600">
                            <MiniBars points={backlogSeriesSafe} />
                          </div>
                        </div>
                      </div>
                    </CardShell>
                  </div>

                  <div className="space-y-5 lg:col-span-4">
                    <CardShell title="By channel" sub="Share of inbound">
                      <div className="space-y-2">
                        {[
                          { c: 'email', v: 46 },
                          { c: 'web', v: 28 },
                          { c: 'chat', v: 18 },
                          { c: 'phone', v: 8 }
                        ].map((row) => (
                          <div key={row.c} className="rounded-lg px-3 py-2 hover:bg-slate-50">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium text-slate-800">{row.c}</span>
                              <span className="text-slate-600">{toPercent(row.v)}</span>
                            </div>
                            <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                              <div className="h-2 rounded-full bg-blue-600" style={{ width: `${row.v}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardShell>

                    <CardShell title="Peak days" sub="Highest inbound volume">
                      <div className="space-y-2">
                        {peakDays.map((row) => (
                          <div key={`${row.d}-${row.v}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            <span className="text-sm font-medium text-slate-700">{row.d}</span>
                            <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{row.v}</span>
                          </div>
                        ))}
                      </div>
                    </CardShell>
                  </div>
                </div>
              </div>
            ) : null}

            {tab === 'agents' ? (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs text-slate-500">Avg handle time</p>
                    <p className="mt-1 text-3xl font-bold text-slate-900">{kpis.avgHandleMin.toFixed(1)}m</p>
                    <p className="mt-1 text-xs text-slate-400">Lower is better</p>
                    <div className="mt-3 text-slate-700">
                      <SparkArea points={inboundSeries.slice(-12)} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs text-slate-500">Quality score</p>
                    <p className="mt-1 text-3xl font-bold text-green-600">
                      {Math.max(0, Math.min(100, Math.round((kpis.resSla + kpis.frSla) / 2)))}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">Composite: SLA + reopen trend</p>
                    <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3">
                      <p className="text-xs text-green-700">Biggest win</p>
                      <p className="mt-1 text-sm font-semibold text-green-800">Faster triage</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs text-slate-500">Reopen rate</p>
                    <p className="mt-1 text-3xl font-bold text-amber-600">{reopenRate.toFixed(1)}%</p>
                    <p className="mt-1 text-xs text-slate-400">Target {'<='} 3%</p>
                    <div className="mt-3 text-amber-600">
                      <SparkArea points={sources.reopenRate ? reopenData.map((item) => item.count) : [4, 3, 5, 4, 4, 5, 3, 4, 4, 5, 4, 4]} />
                    </div>
                  </div>
                </div>

                <CardShell title="Agent leaderboard" sub="Sorted by solved tickets.">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50">
                        <tr>
                          {['Agent', 'Team', 'Solved', 'FR SLA', 'RES SLA', 'CSAT'].map((heading) => (
                            <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {[...agentRows]
                          .sort((a, b) => b.solved - a.solved)
                          .map((row) => (
                            <tr key={row.name} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-semibold text-slate-900">{row.name}</td>
                              <td className="px-4 py-3 text-slate-700">{row.team}</td>
                              <td className="px-4 py-3">
                                <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{row.solved}</span>
                              </td>
                              <td className={`px-4 py-3 font-semibold ${row.fr >= 95 ? 'text-green-600' : row.fr >= 92 ? 'text-amber-600' : 'text-red-600'}`}>
                                {toPercent(row.fr)}
                              </td>
                              <td className={`px-4 py-3 font-semibold ${row.res >= 92 ? 'text-green-600' : row.res >= 88 ? 'text-amber-600' : 'text-red-600'}`}>
                                {toPercent(row.res)}
                              </td>
                              <td className="px-4 py-3 font-semibold text-slate-900">{row.csat.toFixed(1)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </CardShell>
              </div>
            ) : null}

            {tab === 'csat' ? (
              <div className="space-y-5">
                <div className="grid gap-5 lg:grid-cols-12">
                  <div className="lg:col-span-7">
                    <CardShell title="CSAT trend" sub="Average rating per day.">
                      <div className="mb-2 flex items-end justify-between">
                        <div>
                          <p className="text-xs text-slate-500">Average</p>
                          <p className="mt-1 text-3xl font-bold text-purple-600">{DEMO_KPIS.csat.toFixed(2)}</p>
                        </div>
                        <span className="rounded-lg bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700">Scale 1-5</span>
                      </div>
                      <div className="text-purple-600">
                        <SparkArea points={DEMO_SERIES.csat.map((value) => value * 10)} />
                      </div>
                      <p className="mt-3 text-xs text-slate-400">Tip: correlate low CSAT with breach and reopens.</p>
                    </CardShell>
                  </div>
                  <div className="space-y-5 lg:col-span-5">
                    <CardShell title="Drivers" sub="What impacts CSAT (demo)">
                      <div className="space-y-3">
                        {[
                          { label: 'Slow response', value: 31 },
                          { label: 'Unclear resolution', value: 24 },
                          { label: 'Multiple handoffs', value: 18 },
                          { label: 'Bug persists', value: 15 },
                          { label: 'Other', value: 12 }
                        ].map((row) => (
                          <div key={row.label}>
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-slate-700">{row.label}</span>
                              <span className="text-slate-600">{toPercent(row.value)}</span>
                            </div>
                            <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                              <div className="h-2 rounded-full bg-purple-600" style={{ width: `${row.value}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardShell>
                    <CardShell title="Low CSAT tags" sub="Common tags on low-rated tickets (demo)">
                      <div className="flex flex-wrap gap-2">
                        {['outage', 'bug', 'refund', 'vip', 'billing'].map((tag) => (
                          <span key={tag} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </CardShell>
                  </div>
                </div>
              </div>
            ) : null}

            {tab === 'backlog' ? (
              <div className="space-y-5">
                <div className="grid gap-5 lg:grid-cols-12">
                  <div className="lg:col-span-5">
                    <CardShell title="Aging distribution" sub="Open tickets by age bucket.">
                      <div className="space-y-3">
                        {ageBuckets.map((bucket) => (
                          <div key={bucket.bucket} className="rounded-lg px-3 py-2 hover:bg-slate-50">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-slate-800">{bucket.bucket}</span>
                              <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{bucket.count}</span>
                            </div>
                            <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                              <div
                                className="h-2 rounded-full bg-amber-600"
                                style={{ width: `${Math.min(100, (bucket.count / Math.max(ageBuckets[0]?.count || 1, 1)) * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardShell>
                  </div>
                  <div className="space-y-5 lg:col-span-7">
                    <CardShell title="Backlog risk" sub="Queues likely to breach next.">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                          <p className="text-xs font-medium text-red-700">Highest risk queue</p>
                          <p className="mt-1 text-lg font-bold text-red-800">
                            {teamSummaryData[0]?.name ?? 'Technical Support'} - Critical
                          </p>
                          <p className="mt-2 text-xs text-red-700">
                            {teamSummaryData[0] ? `${teamSummaryData[0].open} open tickets in risk window` : '12 tickets within 80-100% SLA window'}
                          </p>
                        </div>
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                          <p className="text-xs font-medium text-amber-700">Second risk queue</p>
                          <p className="mt-1 text-lg font-bold text-amber-800">
                            {teamSummaryData[1]?.name ?? 'Billing'} - High
                          </p>
                          <p className="mt-2 text-xs text-amber-700">
                            {teamSummaryData[1] ? `${teamSummaryData[1].open} open tickets pending action` : '9 tickets stuck pending customer'}
                          </p>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-sm font-semibold text-slate-900">Suggested actions</p>
                        <ul className="mt-2 list-inside list-disc space-y-2 text-sm text-slate-600">
                          <li>Enable escalation automation at 75% for critical tickets.</li>
                          <li>Add routing rule: tag outage -&gt; priority critical -&gt; Technical Support queue.</li>
                          <li>Staff peak inbound windows on Monday and Tuesday for email channel.</li>
                        </ul>
                      </div>
                    </CardShell>
                  </div>
                </div>
              </div>
            ) : null}

            {tab === 'export' ? (
              <div className="space-y-5">
                <div className="grid gap-5 md:grid-cols-2">
                  <CardShell title="Export datasets" sub="CSV/XLSX/JSON/PDF snapshot">
                    <div className="space-y-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-sm font-semibold text-slate-900">One-time export</p>
                        <p className="mt-1 text-xs text-slate-500">Use current scope and filters.</p>
                        <button
                          type="button"
                          onClick={() => setShowExportModal(true)}
                          disabled={!canExport}
                          className={`mt-3 rounded-lg px-4 py-2 text-sm font-medium ${
                            canExport
                              ? 'bg-blue-600 text-white hover:bg-blue-700'
                              : 'cursor-not-allowed bg-slate-100 text-slate-400'
                          }`}
                        >
                          Open export
                        </button>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <p className="text-sm font-semibold text-slate-900">Share link</p>
                        <p className="mt-1 text-xs text-slate-500">Share a read-only snapshot URL (demo)</p>
                        <div className="mt-3 flex items-center gap-2">
                          <input
                            readOnly
                            value="https://app.helpdesk.local/reports/snapshots/abc123"
                            className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                          />
                          <button
                            type="button"
                            onClick={copyShareLink}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    </div>
                  </CardShell>

                  <CardShell title="Schedules" sub="Email summaries (UI mock)">
                    <div className="space-y-3">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Weekly exec summary</p>
                            <p className="mt-1 text-xs text-slate-500">Every Monday at 9:00 AM</p>
                          </div>
                          <Toggle checked={true} onChange={() => toast.success('Schedule toggled')} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">PDF snapshot</span>
                          <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">Include SLA + CSAT</span>
                          <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">Recipients: 5</span>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <p className="text-sm font-semibold text-slate-900">Create schedule</p>
                        <p className="mt-1 text-xs text-slate-500">Requires Team Admin+</p>
                        <button
                          type="button"
                          onClick={() => {
                            if (canSaveViews) {
                              toast.success('Schedule created (demo)');
                            }
                          }}
                          disabled={!canSaveViews}
                          className={`mt-3 rounded-lg px-4 py-2 text-sm font-medium ${
                            canSaveViews
                              ? 'bg-blue-600 text-white hover:bg-blue-700'
                              : 'cursor-not-allowed bg-slate-100 text-slate-400'
                          }`}
                        >
                          New schedule
                        </button>
                      </div>
                    </div>
                  </CardShell>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900">Backend TODO (tracked)</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-800">
            {backendTodo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      {showExportModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <p className="text-base font-semibold text-slate-900">Export report</p>
                <p className="mt-0.5 text-xs text-slate-500">Choose dataset and format</p>
              </div>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto p-6">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-800">Current scope</p>
                <p className="mt-1 text-xs text-slate-500">{exportScopeLabel}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {filters.priority !== 'all' ? (
                    <Chip
                      label={`Priority: ${filters.priority}`}
                      onRemove={() => setFilters((prev) => ({ ...prev, priority: 'all' }))}
                    />
                  ) : null}
                  {filters.status !== 'all' ? (
                    <Chip
                      label={`Status: ${filters.status}`}
                      onRemove={() => setFilters((prev) => ({ ...prev, status: 'all' }))}
                    />
                  ) : null}
                  {filters.tags.map((tag) => (
                    <Chip key={tag} label={`Tag: ${tag}`} onRemove={() => toggleTag(tag)} />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'tickets', label: 'Tickets', desc: 'All ticket records in scope' },
                  { key: 'sla', label: 'SLA events', desc: 'Timers, breaches, escalations' },
                  { key: 'agent', label: 'Agent metrics', desc: 'Solved, SLA, CSAT per agent' },
                  { key: 'csat', label: 'CSAT responses', desc: 'Survey answers and tags' }
                ].map((dataset) => (
                  <button
                    key={dataset.key}
                    type="button"
                    className="rounded-xl border border-slate-200 p-4 text-left transition-all hover:border-blue-300 hover:bg-blue-50"
                  >
                    <p className="text-sm font-semibold text-slate-900">{dataset.label}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{dataset.desc}</p>
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-900">Format</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {['CSV', 'XLSX', 'PDF (summary)', 'JSON'].map((format) => (
                    <button
                      key={format}
                      type="button"
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      {format}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-slate-400">PDF exports a snapshot of the dashboard cards and tables.</p>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowExportModal(false);
                    toast.success('Export started');
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Download className="h-4 w-4" />
                  Export
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

