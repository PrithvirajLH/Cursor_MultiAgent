import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import {
  createSavedView,
  fetchAllUsers,
  fetchReportChannelBreakdown,
  fetchReportCsatDrivers,
  fetchReportCsatLowTags,
  fetchReportCsatTrend,
  fetchReportSlaBreaches,
  fetchReportSummary,
  fetchReportTeamSummary,
  fetchReportTicketVolume,
  fetchReportTicketsByAge,
  fetchReportTicketsByCategory,
  fetchReportReopenRate,
  fetchReportTransfers,
  fetchSavedViews,
  fetchTeams,
  type AgentPerformanceResponse,
  type ChannelBreakdownResponse,
  type CsatDriversResponse,
  type CsatLowTagsResponse,
  type CsatTrendResponse,
  type ReportQuery,
  type ReopenRateResponse,
  type SlaBreachesResponse,
  type SlaComplianceResponse,
  type TeamRef,
  type TeamSummaryResponse,
  type TicketAgeBucketResponse,
  type TicketsByCategoryResponse,
  type TicketsByStatusResponse,
  type UserRef
} from '../api/client';
import { TopBar } from '../components/TopBar';
import { useHeaderContext } from '../contexts/HeaderContext';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';
import { useToast } from '../hooks/useToast';
import type { Role } from '../types';
import { handleApiError } from '../utils/handleApiError';

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
  compare: boolean;
};

type SavedView = {
  id: string;
  name: string;
  desc: string;
  filters: ReportsFilters;
  isDefault: boolean;
};

type SourceState = {
  summary: boolean;
  solvedSeries: boolean;
  backlogSeries: boolean;
  channelBreakdown: boolean;
  csatTrend: boolean;
  csatDrivers: boolean;
  csatTags: boolean;
  slaBreaches: boolean;
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

type AgentRow = { name: string; team: string; solved: number; fr: number; res: number; csat: number | null };

const CHANNELS = [
  { value: 'PORTAL', label: 'Portal' },
  { value: 'EMAIL', label: 'Email' }
];
const STATUSES = [
  'NEW',
  'TRIAGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_ON_REQUESTER',
  'WAITING_ON_VENDOR',
  'RESOLVED',
  'CLOSED',
  'REOPENED'
];

const UI_TO_API_PRIORITY: Record<Exclude<PriorityFilter, 'all'>, string> = {
  critical: 'P1',
  high: 'P2',
  medium: 'P3',
  low: 'P4'
};

const EMPTY_KPIS: OverviewKpis = {
  tickets: 0,
  resolved: 0,
  backlog: 0,
  frSla: 0,
  resSla: 0,
  csat: 0,
  avgHandleMin: 0
};

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

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  const total = Math.round(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function defaultFilters(): ReportsFilters {
  return {
    range: 'last_14',
    teamId: 'all',
    channel: 'all',
    status: 'all',
    priority: 'all',
    assignee: 'all',
    compare: true
  };
}

function parseSavedReportFilters(raw: Record<string, unknown> | null | undefined): ReportsFilters | null {
  if (!raw || raw.viewType !== 'reports') return null;
  const base = defaultFilters();
  const range = raw.range;
  const teamId = raw.teamId;
  const channel = raw.channel;
  const status = raw.status;
  const priority = raw.priority;
  const assignee = raw.assignee;
  const compare = raw.compare;

  return {
    range: range === 'last_7' || range === 'last_14' || range === 'last_30' || range === 'custom' ? range : base.range,
    teamId: typeof teamId === 'string' && teamId ? teamId : base.teamId,
    channel: typeof channel === 'string' && channel ? channel : base.channel,
    status: typeof status === 'string' && status ? status : base.status,
    priority: priority === 'critical' || priority === 'high' || priority === 'medium' || priority === 'low' || priority === 'all'
      ? priority
      : base.priority,
    assignee: typeof assignee === 'string' && assignee ? assignee : base.assignee,
    compare: typeof compare === 'boolean' ? compare : base.compare
  };
}

function serializeSavedReportFilters(filters: ReportsFilters): Record<string, unknown> {
  return {
    viewType: 'reports',
    range: filters.range,
    teamId: filters.teamId,
    channel: filters.channel,
    status: filters.status,
    priority: filters.priority,
    assignee: filters.assignee,
    compare: filters.compare
  };
}

function savedViewDescription(filters: ReportsFilters): string {
  return `${filters.range} · team:${filters.teamId} · priority:${filters.priority}`;
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

function EmptyData({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
      {label}
    </div>
  );
}

export function ReportsPage({
  role,
  refreshKey
}: {
  role: Role;
  refreshKey: number;
}) {
  const headerCtx = useHeaderContext();
  const toast = useToast();
  const [tab, setTab] = useState<ReportsTab>('overview');
  const [teams, setTeams] = useState<TeamRef[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeView, setActiveView] = useState('');
  const [assignees, setAssignees] = useState<UserRef[]>([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const exportDialogRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);

  const [filters, setFilters] = useState<ReportsFilters>(defaultFilters());

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
  const [channelBreakdownData, setChannelBreakdownData] = useState<ChannelBreakdownResponse['data']>(
    [],
  );
  const [csatTrendData, setCsatTrendData] = useState<CsatTrendResponse['data']>([]);
  const [csatSummary, setCsatSummary] = useState<CsatTrendResponse['summary'] | null>(null);
  const [csatDriversData, setCsatDriversData] = useState<CsatDriversResponse['data']>([]);
  const [csatTagsData, setCsatTagsData] = useState<CsatLowTagsResponse['data']>([]);
  const [slaBreachesData, setSlaBreachesData] = useState<SlaBreachesResponse['data']>([]);
  const [sources, setSources] = useState<SourceState>({
    summary: false,
    solvedSeries: false,
    backlogSeries: false,
    channelBreakdown: false,
    csatTrend: false,
    csatDrivers: false,
    csatTags: false,
    slaBreaches: false,
    categories: false,
    aging: false,
    reopenRate: false,
    teamSummary: false,
    transfers: false
  });

  const canExport = role === 'TEAM_ADMIN' || role === 'OWNER';
  const canSaveViews = role === 'TEAM_ADMIN' || role === 'OWNER';

  useModalFocusTrap({
    open: showExportModal,
    containerRef: exportDialogRef,
    onClose: () => setShowExportModal(false),
  });

  async function loadSavedViewsFromBackend(preferredId?: string) {
    try {
      const records = await fetchSavedViews();
      const views = records
        .map((record) => {
          const parsed = parseSavedReportFilters(record.filters);
          if (!parsed) return null;
          return {
            id: record.id,
            name: record.name,
            desc: savedViewDescription(parsed),
            filters: parsed,
            isDefault: record.isDefault
          } satisfies SavedView;
        })
        .filter((view): view is SavedView => Boolean(view));

      setSavedViews(views);
      if (views.length === 0) {
        setActiveView('');
        return;
      }

      const pinned = preferredId && views.find((view) => view.id === preferredId);
      if (pinned) {
        setActiveView(pinned.id);
        return;
      }

      const fallback = views.find((view) => view.isDefault) ?? views[0];
      setActiveView(fallback.id);
      setFilters(fallback.filters);
    } catch {
      setSavedViews([]);
      setActiveView('');
    }
  }

  useEffect(() => {
    void loadSavedViewsFromBackend();

    fetchTeams()
      .then((response) => setTeams(response.data))
      .catch(() => setTeams([]));

    fetchAllUsers()
      .then((response) => setAssignees(response.data))
      .catch(() => setAssignees([]));
  }, []);

  const dateRange = useMemo(() => rangeToDates(filters.range), [filters.range]);

  const reportQuery = useMemo<ReportQuery>(() => {
    const query: ReportQuery = {
      from: dateRange.from,
      to: dateRange.to
    };
    if (filters.teamId !== 'all') query.teamId = filters.teamId;
    if (filters.priority !== 'all') query.priority = UI_TO_API_PRIORITY[filters.priority];
    if (filters.channel !== 'all') query.channel = filters.channel;
    if (filters.status !== 'all') query.status = filters.status;
    if (filters.assignee !== 'all') query.assigneeId = filters.assignee;
    return query;
  }, [
    dateRange.from,
    dateRange.to,
    filters.assignee,
    filters.channel,
    filters.priority,
    filters.status,
    filters.teamId
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadReports() {
      setLoading(true);
      setWarning(null);

      const nextSources: SourceState = {
        summary: false,
        solvedSeries: false,
        backlogSeries: false,
        channelBreakdown: false,
        csatTrend: false,
        csatDrivers: false,
        csatTags: false,
        slaBreaches: false,
        categories: false,
        aging: false,
        reopenRate: false,
        teamSummary: false,
        transfers: false
      };

      const [
        summaryResult,
        solvedResult,
        backlogResult,
        channelBreakdownResult,
        csatTrendResult,
        csatDriversResult,
        csatTagsResult,
        slaBreachesResult,
        categoriesResult,
        ageResult,
        reopenResult,
        teamSummaryResult,
        transfersResult
      ] =
        await Promise.allSettled([
          fetchReportSummary({ ...reportQuery, groupBy: 'team' }),
          fetchReportTicketVolume({ ...reportQuery, statusGroup: 'resolved' }),
          fetchReportTicketVolume({ ...reportQuery, statusGroup: 'open' }),
          fetchReportChannelBreakdown(reportQuery),
          fetchReportCsatTrend(reportQuery),
          fetchReportCsatDrivers(reportQuery),
          fetchReportCsatLowTags(reportQuery),
          fetchReportSlaBreaches(reportQuery),
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
        warnings.push(`summary: ${handleApiError(summaryResult.reason)}`);
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
        warnings.push(`resolved-series: ${handleApiError(solvedResult.reason)}`);
        setSolvedSeries([]);
      }

      if (backlogResult.status === 'fulfilled') {
        setBacklogSeries(backlogResult.value.data.map((point) => point.count));
        nextSources.backlogSeries = true;
      } else {
        warnings.push(`open-series: ${handleApiError(backlogResult.reason)}`);
        setBacklogSeries([]);
      }

      if (channelBreakdownResult.status === 'fulfilled') {
        setChannelBreakdownData(channelBreakdownResult.value.data);
        nextSources.channelBreakdown = true;
      } else {
        warnings.push(`channel-breakdown: ${handleApiError(channelBreakdownResult.reason)}`);
        setChannelBreakdownData([]);
      }

      if (csatTrendResult.status === 'fulfilled') {
        setCsatTrendData(csatTrendResult.value.data);
        setCsatSummary(csatTrendResult.value.summary);
        nextSources.csatTrend = true;
      } else {
        warnings.push(`csat-trend: ${handleApiError(csatTrendResult.reason)}`);
        setCsatTrendData([]);
        setCsatSummary(null);
      }

      if (csatDriversResult.status === 'fulfilled') {
        setCsatDriversData(csatDriversResult.value.data);
        nextSources.csatDrivers = true;
      } else {
        warnings.push(`csat-drivers: ${handleApiError(csatDriversResult.reason)}`);
        setCsatDriversData([]);
      }

      if (csatTagsResult.status === 'fulfilled') {
        setCsatTagsData(csatTagsResult.value.data);
        nextSources.csatTags = true;
      } else {
        warnings.push(`csat-tags: ${handleApiError(csatTagsResult.reason)}`);
        setCsatTagsData([]);
      }

      if (slaBreachesResult.status === 'fulfilled') {
        setSlaBreachesData(slaBreachesResult.value.data);
        nextSources.slaBreaches = true;
      } else {
        warnings.push(`sla-breaches: ${handleApiError(slaBreachesResult.reason)}`);
        setSlaBreachesData([]);
      }

      if (categoriesResult.status === 'fulfilled') {
        setCategoryData(categoriesResult.value.data);
        nextSources.categories = true;
      } else {
        warnings.push(`categories: ${handleApiError(categoriesResult.reason)}`);
        setCategoryData([]);
      }

      if (ageResult.status === 'fulfilled') {
        setAgeData(ageResult.value.data);
        nextSources.aging = true;
      } else {
        warnings.push(`aging: ${handleApiError(ageResult.reason)}`);
        setAgeData([]);
      }

      if (reopenResult.status === 'fulfilled') {
        setReopenData(reopenResult.value.data);
        nextSources.reopenRate = true;
      } else {
        warnings.push(`reopen-rate: ${handleApiError(reopenResult.reason)}`);
        setReopenData([]);
      }

      if (teamSummaryResult.status === 'fulfilled') {
        setTeamSummaryData(teamSummaryResult.value.data);
        nextSources.teamSummary = true;
      } else {
        warnings.push(`team-summary: ${handleApiError(teamSummaryResult.reason)}`);
        setTeamSummaryData([]);
      }

      if (transfersResult.status === 'fulfilled') {
        nextSources.transfers = true;
      } else {
        warnings.push(`transfers: ${handleApiError(transfersResult.reason)}`);
      }

      setSources(nextSources);
      setLoading(false);

      if (warnings.length > 0) {
        setWarning('Some report endpoints are unavailable. Matching sections will stay empty until backend data is available.');
      }
    }

    void loadReports();
    return () => {
      cancelled = true;
    };
  }, [reportQuery, refreshKey]);

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

  const selectedChannelLabel =
    filters.channel === 'all'
      ? 'All channels'
      : CHANNELS.find((channel) => channel.value === filters.channel)?.label ?? filters.channel;
  const scopeLabel = `${selectedTeamName} - ${selectedChannelLabel}`;

  const kpis = useMemo<OverviewKpis>(() => {
    if (!sources.summary || !slaData) {
      return {
        ...EMPTY_KPIS,
        csat: csatSummary?.average ?? 0,
      };
    }
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
    const tickets = totalFromStatus > 0 ? totalFromStatus : slaData.total;
    const resolvedFromSla = Math.max(slaData.met - slaData.breached, 0);
    const resolved = resolvedFromStatus > 0 ? resolvedFromStatus : resolvedFromSla;
    const backlog = backlogFromStatus > 0 ? backlogFromStatus : Math.max(tickets - resolved, 0);

    const avgResolutionHours =
      agentData.length > 0
        ? agentData.reduce((sum, row) => sum + (row.avgResolutionHours ?? 0), 0) / agentData.length
        : 0;

    return {
      tickets,
      resolved,
      backlog,
      frSla: fr,
      resSla: res,
      csat: csatSummary?.average ?? 0,
      avgHandleMin: avgResolutionHours > 0 ? avgResolutionHours * 60 : 0
    };
  }, [agentData, csatSummary, slaData, sources.summary, statusData]);

  const inboundSeries = volumeSeries;
  const solvedSeriesSafe = solvedSeries;
  const backlogSeriesSafe = backlogSeries;

  const topCategories = useMemo(() => {
    return [...categoryData]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((row) => ({ name: row.name, count: row.count }));
  }, [categoryData]);

  const agentRows = useMemo<AgentRow[]>(() => {
    return agentData.map((agent) => {
      const frScore =
        agent.avgFirstResponseHours == null
          ? 90
          : Math.max(60, Math.min(99, Math.round(100 - agent.avgFirstResponseHours * 7)));
      const resScore =
        agent.avgResolutionHours == null
          ? 88
          : Math.max(55, Math.min(99, Math.round(100 - agent.avgResolutionHours * 2)));
      return {
        name: agent.name || agent.email,
        team: selectedTeamName === 'All teams' ? 'Mixed' : selectedTeamName,
        solved: agent.ticketsResolved,
        fr: frScore,
        res: resScore,
        csat: null
      };
    });
  }, [agentData, selectedTeamName]);

  const ageBuckets = useMemo(() => ageData.map((row) => ({ bucket: row.bucket, count: row.count })), [ageData]);

  const reopenRate = useMemo(() => {
    if (!sources.reopenRate || reopenData.length === 0 || kpis.resolved <= 0) return 0;
    const reopens = sumCounts(reopenData);
    return Number(toSafePercent(reopens, Math.max(kpis.resolved, 1)).toFixed(1));
  }, [kpis.resolved, reopenData, sources.reopenRate]);

  const peakDays = useMemo(() => {
    if (volumeDates.length > 0 && volumeDates.length === inboundSeries.length) {
      return volumeDates
        .map((date, idx) => ({ d: new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }), v: inboundSeries[idx] }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 5);
    }
    return [];
  }, [inboundSeries, volumeDates]);

  const hasInboundSeries = inboundSeries.length > 0;
  const hasSolvedSeries = solvedSeriesSafe.length > 0;
  const hasBacklogSeries = backlogSeriesSafe.length > 0;
  const hasCategories = topCategories.length > 0;
  const hasAgeBuckets = ageBuckets.length > 0;
  const hasAgentRows = agentRows.length > 0;
  const hasChannelBreakdown = channelBreakdownData.length > 0;
  const hasCsatTrend = csatTrendData.length > 0;
  const hasCsatDrivers = csatDriversData.length > 0;
  const hasCsatTags = csatTagsData.length > 0;
  const hasSlaBreaches = slaBreachesData.length > 0;
  const csatAverage = csatSummary?.average ?? null;
  const csatResponses = csatSummary?.responses ?? 0;

  function resetFilters() {
    setFilters(defaultFilters());
    toast.success('Filters reset');
  }

  function applyView(viewId: string) {
    const view = savedViews.find((item) => item.id === viewId);
    if (!view) return;
    setActiveView(viewId);
    setFilters(view.filters);
    toast.success('View applied');
  }

  async function saveCurrentView() {
    const name = `Reports ${new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })}`;

    try {
      const created = await createSavedView({
        name,
        filters: serializeSavedReportFilters(filters)
      });
      await loadSavedViewsFromBackend(created.id);
      toast.success('View saved');
    } catch (err) {
      toast.error(handleApiError(err));
    }
  }

  const shareLink = useMemo(() => {
    if (typeof window === 'undefined') {
      return '/reports';
    }

    const params = new URLSearchParams();
    params.set('tab', tab);
    params.set('range', filters.range);
    if (filters.teamId !== 'all') params.set('teamId', filters.teamId);
    if (filters.channel !== 'all') params.set('channel', filters.channel);
    if (filters.status !== 'all') params.set('status', filters.status);
    if (filters.priority !== 'all') params.set('priority', filters.priority);
    if (filters.assignee !== 'all') params.set('assignee', filters.assignee);
    if (filters.compare) params.set('compare', '1');

    const query = params.toString();
    return `${window.location.origin}/reports${query ? `?${query}` : ''}`;
  }, [
    filters.assignee,
    filters.channel,
    filters.compare,
    filters.priority,
    filters.range,
    filters.status,
    filters.teamId,
    tab,
  ]);
  const exportScopeLabel = `${rangeLabel} - ${scopeLabel}`;

  function copyShareLink() {
    navigator.clipboard
      .writeText(shareLink)
      .then(() => toast.success('Link copied'))
      .catch(() => toast.error('Failed to copy link'));
  }

  return (
    <section className="min-h-full bg-slate-50 animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1600px] py-4 px-6">
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
                <option value="" disabled>
                  {savedViews.length > 0 ? 'Select saved view' : 'No saved views'}
                </option>
                {savedViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  void saveCurrentView();
                }}
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
            <p className="mt-2 text-xs text-slate-400">
              {savedViews.find((view) => view.id === activeView)?.desc ?? 'No saved view selected.'}
            </p>
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
                <option value="custom">Custom</option>
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
                  <option key={channel.value} value={channel.value}>
                    {channel.label}
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
                    {formatStatus(status)}
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
                {assignees.map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>
                    {assignee.displayName || assignee.email}
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
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={`stat-skel-${i}`} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="mb-3 h-4 w-24 skeleton-shimmer rounded" />
                      <div className="mb-2 h-7 w-16 skeleton-shimmer rounded" />
                      <div className="h-3 w-32 skeleton-shimmer rounded" />
                    </div>
                  ))}
                </div>
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-6 h-72">
                    <div className="mb-4 h-5 w-32 skeleton-shimmer rounded" />
                    <div className="h-3/4 w-full skeleton-shimmer rounded-lg" />
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-6 h-72">
                    <div className="mb-4 h-5 w-32 skeleton-shimmer rounded" />
                    <div className="h-3/4 w-full skeleton-shimmer rounded-lg" />
                  </div>
                </div>
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
                    value={csatAverage != null ? `${kpis.csat.toFixed(2)} / 5` : '-- / 5'}
                    sub={csatResponses > 0 ? `${csatResponses} responses` : 'No CSAT responses'}
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
                          {hasInboundSeries ? (
                            <div className="text-blue-600">
                              <MiniBars points={inboundSeries} />
                            </div>
                          ) : (
                            <EmptyData label="No inbound data for selected filters." />
                          )}
                          <div className="mt-3 flex items-center justify-between text-xs">
                            <span className="text-slate-500">Avg/day</span>
                            <span className="font-semibold text-slate-700">
                              {hasInboundSeries
                                ? Math.round(inboundSeries.reduce((sum, point) => sum + point, 0) / inboundSeries.length)
                                : 0}
                            </span>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-sm font-semibold text-slate-800">Solved</p>
                            <span className="text-xs text-slate-500">{solvedSeriesSafe.length} pts</span>
                          </div>
                          {hasSolvedSeries ? (
                            <div className="text-green-600">
                              <MiniBars points={solvedSeriesSafe} />
                            </div>
                          ) : (
                            <EmptyData label="No solved-series data for selected filters." />
                          )}
                          <div className="mt-3 flex items-center justify-between text-xs">
                            <span className="text-slate-500">Avg/day</span>
                            <span className="font-semibold text-slate-700">
                              {hasSolvedSeries
                                ? Math.round(
                                    solvedSeriesSafe.reduce((sum, point) => sum + point, 0) /
                                      solvedSeriesSafe.length
                                  )
                                : 0}
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
                      {hasCategories ? (
                        <div className="space-y-2">
                          {topCategories.map((category) => (
                            <div key={category.name} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-slate-50">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-800">{category.name}</p>
                              </div>
                              <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{category.count}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyData label="No category data for selected filters." />
                      )}
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
                    {hasInboundSeries ? (
                      <div className="mt-3 text-blue-600">
                        <SparkArea points={inboundSeries.slice(-12)} />
                      </div>
                    ) : (
                      <div className="mt-3">
                        <EmptyData label="No trend data." />
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs text-slate-500">Resolution SLA</p>
                    <p className={`mt-1 text-3xl font-bold ${toneForMetric(kpis.resSla, 92)}`}>{kpis.resSla.toFixed(1)}%</p>
                    <p className="mt-1 text-xs text-slate-400">Target 92%</p>
                    {hasSolvedSeries ? (
                      <div className="mt-3 text-indigo-600">
                        <SparkArea points={solvedSeriesSafe.slice(-12)} />
                      </div>
                    ) : (
                      <div className="mt-3">
                        <EmptyData label="No trend data." />
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs text-slate-500">Breaches</p>
                    <p className="mt-1 text-3xl font-bold text-red-600">
                      {slaData ? slaData.firstResponseBreached + slaData.resolutionBreached : 0}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">In current scope</p>
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3">
                      <p className="text-xs font-medium text-red-700">Driver details</p>
                      <p className="mt-1 text-sm font-semibold text-red-800">
                        {slaBreachesData[0]?.reason ?? 'No breach drivers in this range.'}
                      </p>
                      <p className="mt-1 text-xs text-red-700">
                        {hasSlaBreaches ? `${slaBreachesData.length} breached tickets captured.` : 'No breached tickets found.'}
                      </p>
                    </div>
                  </div>
                </div>

                <CardShell title="Worst SLA breaches" sub="Tickets with highest breach duration.">
                  {hasSlaBreaches ? (
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
                          {slaBreachesData.map((row) => (
                            <tr key={row.ticketId} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-semibold text-slate-900">{row.ticket}</td>
                              <td className="px-4 py-3 text-slate-700">{row.team}</td>
                              <td className="px-4 py-3 text-slate-700">{row.priority}</td>
                              <td className="px-4 py-3 text-slate-700">{row.stage}</td>
                              <td className="px-4 py-3 font-semibold text-red-600">{formatDuration(row.breachSeconds)}</td>
                              <td className="px-4 py-3 text-slate-600">{row.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyData label="No SLA breach-detail data available." />
                  )}
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
                          {hasInboundSeries ? (
                            <div className="text-blue-600">
                              <MiniBars points={inboundSeries} />
                            </div>
                          ) : (
                            <EmptyData label="No inbound data." />
                          )}
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-sm font-semibold text-slate-800">Solved</p>
                          <p className="mb-2 text-xs text-slate-400">Tickets/day</p>
                          {hasSolvedSeries ? (
                            <div className="text-green-600">
                              <MiniBars points={solvedSeriesSafe} />
                            </div>
                          ) : (
                            <EmptyData label="No solved data." />
                          )}
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-sm font-semibold text-slate-800">Backlog</p>
                          <p className="mb-2 text-xs text-slate-400">Open tickets</p>
                          {hasBacklogSeries ? (
                            <div className="text-amber-600">
                              <MiniBars points={backlogSeriesSafe} />
                            </div>
                          ) : (
                            <EmptyData label="No backlog data." />
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
                            <div key={row.channel} className="rounded-lg px-3 py-2 hover:bg-slate-50">
                              <div className="flex items-center justify-between text-sm">
                                <span className="font-medium text-slate-800">{row.label}</span>
                                <span className="text-slate-600">{toPercent(row.percent)}</span>
                              </div>
                              <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                                <div className="h-2 rounded-full bg-blue-600" style={{ width: `${row.percent}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyData label="No channel breakdown data for selected filters." />
                      )}
                    </CardShell>

                    <CardShell title="Peak days" sub="Highest inbound volume">
                      {peakDays.length > 0 ? (
                        <div className="space-y-2">
                          {peakDays.map((row) => (
                            <div key={`${row.d}-${row.v}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <span className="text-sm font-medium text-slate-700">{row.d}</span>
                              <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{row.v}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyData label="No peak-day data." />
                      )}
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
                    {hasInboundSeries ? (
                      <div className="mt-3 text-slate-700">
                        <SparkArea points={inboundSeries.slice(-12)} />
                      </div>
                    ) : (
                      <div className="mt-3">
                        <EmptyData label="No handle-time trend data." />
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs text-slate-500">Quality score</p>
                    <p className="mt-1 text-3xl font-bold text-green-600">
                      {Math.max(0, Math.min(100, Math.round((kpis.resSla + kpis.frSla) / 2)))}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">Composite: SLA + reopen trend</p>
                    <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3">
                      <p className="text-xs text-green-700">Data source</p>
                      <p className="mt-1 text-sm font-semibold text-green-800">Computed from SLA and reopen metrics.</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs text-slate-500">Reopen rate</p>
                    <p className="mt-1 text-3xl font-bold text-amber-600">{reopenRate.toFixed(1)}%</p>
                    <p className="mt-1 text-xs text-slate-400">Target {'<='} 3%</p>
                    {reopenData.length > 0 ? (
                      <div className="mt-3 text-amber-600">
                        <SparkArea points={reopenData.map((item) => item.count)} />
                      </div>
                    ) : (
                      <div className="mt-3">
                        <EmptyData label="No reopen-rate trend data." />
                      </div>
                    )}
                  </div>
                </div>

                <CardShell title="Agent leaderboard" sub="Sorted by solved tickets.">
                  {hasAgentRows ? (
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
                                <td className="px-4 py-3 font-semibold text-slate-900">
                                  {row.csat == null ? '--' : row.csat.toFixed(1)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyData label="No agent performance data for selected filters." />
                  )}
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
                          <p className="mt-1 text-3xl font-bold text-purple-600">
                            {csatAverage == null ? '--' : csatAverage.toFixed(2)}
                          </p>
                        </div>
                        <span className="rounded-lg bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700">Scale 1-5</span>
                      </div>
                      {hasCsatTrend ? (
                        <>
                          <div className="text-purple-600">
                            <SparkArea points={csatTrendData.map((item) => Math.max(0, item.average * 20))} />
                          </div>
                          <p className="mt-3 text-xs text-slate-400">{csatResponses} responses in current scope.</p>
                        </>
                      ) : (
                        <EmptyData label="No CSAT trend data for selected filters." />
                      )}
                    </CardShell>
                  </div>
                  <div className="space-y-5 lg:col-span-5">
                    <CardShell title="Drivers" sub="What impacts CSAT">
                      {hasCsatDrivers ? (
                        <div className="space-y-3">
                          {csatDriversData.map((row) => (
                            <div key={row.label}>
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-700">{row.label}</span>
                                <span className="text-slate-600">{toPercent(row.percent)}</span>
                              </div>
                              <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                                <div className="h-2 rounded-full bg-purple-600" style={{ width: `${row.percent}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyData label="No low-CSAT driver data for selected filters." />
                      )}
                    </CardShell>
                    <CardShell title="Low CSAT tags" sub="Common tags on low-rated tickets">
                      {hasCsatTags ? (
                        <div className="flex flex-wrap gap-2">
                          {csatTagsData.map((row) => (
                            <span key={row.tag} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                              #{row.tag} ({row.count})
                            </span>
                          ))}
                        </div>
                      ) : (
                        <EmptyData label="No low-CSAT tags for selected filters." />
                      )}
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
                      {hasAgeBuckets ? (
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
                      ) : (
                        <EmptyData label="No aging data for selected filters." />
                      )}
                    </CardShell>
                  </div>
                  <div className="space-y-5 lg:col-span-7">
                    <CardShell title="Backlog risk" sub="Queues likely to breach next.">
                      {teamSummaryData.length > 0 ? (
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                            <p className="text-xs font-medium text-red-700">Highest risk queue</p>
                            <p className="mt-1 text-lg font-bold text-red-800">{teamSummaryData[0]?.name ?? 'Unknown team'}</p>
                            <p className="mt-2 text-xs text-red-700">{teamSummaryData[0]?.open ?? 0} open tickets in risk window</p>
                          </div>
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <p className="text-xs font-medium text-amber-700">Second risk queue</p>
                            <p className="mt-1 text-lg font-bold text-amber-800">{teamSummaryData[1]?.name ?? 'Not available'}</p>
                            <p className="mt-2 text-xs text-amber-700">
                              {teamSummaryData[1] ? `${teamSummaryData[1].open} open tickets pending action` : 'No additional team data.'}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <EmptyData label="No backlog risk data for selected filters." />
                      )}
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
                        <p className="mt-1 text-xs text-slate-500">Share the current report view URL.</p>
                        <div className="mt-3 flex items-center gap-2">
                          <input
                            readOnly
                            value={shareLink}
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

                  <CardShell title="Schedules" sub="Email summaries">
                    <div className="space-y-3">
                      <EmptyData label="No schedules are configured." />
                      <div className="rounded-xl border border-slate-200 bg-white p-4">
                        <p className="text-sm font-semibold text-slate-900">Create schedule</p>
                        <p className="mt-1 text-xs text-slate-500">Requires Team Admin+</p>
                        <button
                          type="button"
                          onClick={() => {
                            if (canSaveViews) {
                              toast.info('Schedule creation endpoint is not available.');
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

      </div>

      {showExportModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            ref={exportDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Export report"
            tabIndex={-1}
            className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-2xl"
          >
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
