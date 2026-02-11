import { useEffect, useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import {
  ApiError,
  fetchAuditLog,
  type AuditLogEntry,
  type NotificationRecord
} from '../api/client';
import { TopBar } from '../components/TopBar';

type AuditHeaderProps = {
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

type LogCategory = 'sla' | 'routing' | 'automation' | 'custom_fields';

const CATEGORY_LABELS: Record<LogCategory, string> = {
  sla: 'SLA',
  routing: 'Routing',
  automation: 'Automation',
  custom_fields: 'Custom Fields'
};

const CATEGORY_COLORS: Record<LogCategory, string> = {
  sla: 'bg-blue-100 text-blue-700',
  routing: 'bg-green-100 text-green-700',
  automation: 'bg-amber-100 text-amber-700',
  custom_fields: 'bg-purple-100 text-purple-700'
};

function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    try {
      const parsed = JSON.parse(error.message) as { message?: string };
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return parsed.message;
      }
    } catch {
      // keep fallback
    }
    return error.message || 'Request failed';
  }
  if (error instanceof Error) return error.message;
  return 'Request failed';
}

function toTitleCase(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferCategory(entry: AuditLogEntry): LogCategory {
  const type = entry.type.toLowerCase();
  const payloadKeys = Object.keys(entry.payload ?? {}).map((key) => key.toLowerCase());

  if (type.includes('custom') || type.includes('field') || payloadKeys.some((key) => key.includes('customfield'))) {
    return 'custom_fields';
  }
  if (type.includes('automation') || type.includes('auto') || payloadKeys.some((key) => key.includes('automation'))) {
    return 'automation';
  }
  if (type.includes('assign') || type.includes('transfer') || type.includes('team')) {
    return 'routing';
  }
  return 'sla';
}

function actorName(entry: AuditLogEntry): string {
  return entry.createdBy?.displayName || entry.createdBy?.email || 'System';
}

function actorKey(entry: AuditLogEntry): string {
  return entry.createdBy?.id || 'system';
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatDetails(entry: AuditLogEntry): string {
  const payload = entry.payload ?? {};
  const keys = Object.keys(payload);
  if (keys.length === 0) {
    return `Ticket ${entry.ticketDisplayId ?? `#${entry.ticketNumber}`}`;
  }

  const parts = keys.slice(0, 3).map((key) => {
    const value = payload[key];
    if (Array.isArray(value)) {
      return `${toTitleCase(key)}: ${value.join(', ')}`;
    }
    if (value && typeof value === 'object') {
      return `${toTitleCase(key)}: ${JSON.stringify(value)}`;
    }
    return `${toTitleCase(key)}: ${String(value)}`;
  });
  return parts.join(' | ');
}

function initials(name: string): string {
  const letters = name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return letters.slice(0, 2) || 'SY';
}

function avatarClass(name: string): string {
  const classes = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-teal-500', 'bg-rose-500'];
  return classes[name.charCodeAt(0) % classes.length];
}

export function AuditLogPage({ headerProps }: { headerProps?: AuditHeaderProps }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | LogCategory>('all');
  const [userFilter, setUserFilter] = useState('all');

  useEffect(() => {
    void loadAuditLog();
  }, []);

  async function loadAuditLog() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAuditLog({ page: 1, pageSize: 200 });
      setEntries(response.data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    return entries.map((entry) => {
      const category = inferCategory(entry);
      const action = toTitleCase(entry.type);
      const actor = actorName(entry);
      return {
        ...entry,
        category,
        action,
        actor,
        actorId: actorKey(entry),
        details: formatDetails(entry),
        timestamp: formatTimestamp(entry.createdAt)
      };
    });
  }, [entries]);

  const userOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((row) => {
      map.set(row.actorId, row.actor);
    });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchCategory = categoryFilter === 'all' || row.category === categoryFilter;
      const matchUser = userFilter === 'all' || row.actorId === userFilter;
      const matchSearch =
        !query ||
        row.action.toLowerCase().includes(query) ||
        row.details.toLowerCase().includes(query) ||
        row.actor.toLowerCase().includes(query) ||
        row.ticketDisplayId?.toLowerCase().includes(query) ||
        String(row.ticketNumber).includes(query);
      return matchCategory && matchUser && matchSearch;
    });
  }, [rows, categoryFilter, userFilter, search]);

  const countsByCategory = useMemo(() => {
    return (Object.keys(CATEGORY_LABELS) as LogCategory[]).reduce(
      (acc, category) => {
        acc[category] = rows.filter((row) => row.category === category).length;
        return acc;
      },
      {} as Record<LogCategory, number>
    );
  }, [rows]);

  function clearFilters() {
    setSearch('');
    setCategoryFilter('all');
    setUserFilter('all');
  }

  function exportCsv() {
    const csvRows = [
      ['Timestamp', 'User', 'Category', 'Action', 'Details', 'Ticket'],
      ...filteredRows.map((row) => [
        row.timestamp,
        row.actor,
        CATEGORY_LABELS[row.category],
        row.action,
        row.details,
        row.ticketDisplayId ?? `#${row.ticketNumber}`
      ])
    ];
    const csv = csvRows
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'audit-logs.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="min-h-full bg-gray-50 animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-gray-200 bg-white">
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
                  <h1 className="text-xl font-semibold text-gray-900">Audit Logs</h1>
                  <p className="mt-0.5 text-sm text-gray-500">Track changes and activity.</p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-gray-900">Audit Logs</h1>
              <p className="mt-0.5 text-sm text-gray-500">Track changes and activity.</p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] p-6">
        <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          Data is live from backend audit events. Category grouping is UI-mapped to match the admin design.
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search logs..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
            />
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          </div>

          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value as 'all' | LogCategory)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Categories</option>
            {(Object.keys(CATEGORY_LABELS) as LogCategory[]).map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>

          <select
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Users</option>
            {userOptions.map((user) => (
              <option key={user.value} value={user.value}>
                {user.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={clearFilters}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
          >
            Clear
          </button>

          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center space-x-2 rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 hover:text-blue-700"
          >
            <Download className="h-4 w-4" />
            <span>Export</span>
          </button>

          <span className="ml-auto text-xs text-gray-400">
            {filteredRows.length} of {rows.length} entries
          </span>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {(Object.keys(CATEGORY_LABELS) as LogCategory[]).map((category) => (
            <button
              key={category}
              type="button"
              onClick={() =>
                setCategoryFilter((prev) => (prev === category ? 'all' : category))
              }
              className={`flex items-center space-x-3 rounded-xl border border-gray-200 bg-white p-3 text-left transition-all ${
                categoryFilter === category ? 'ring-2 ring-blue-500' : ''
              }`}
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                  CATEGORY_COLORS[category].split(' ')[0]
                }`}
              >
                <span
                  className={`text-sm font-semibold ${
                    CATEGORY_COLORS[category].split(' ')[1]
                  }`}
                >
                  {CATEGORY_LABELS[category].charAt(0)}
                </span>
              </div>
              <div>
                <p className="text-xs text-gray-500">{CATEGORY_LABELS[category]}</p>
                <p className="text-sm font-bold text-gray-900">{countsByCategory[category]}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {loading ? (
            <div className="p-6 text-sm text-gray-500">Loading audit logs...</div>
          ) : error ? (
            <div className="p-6 text-sm text-red-600">{error}</div>
          ) : filteredRows.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-semibold text-gray-700">No matching log entries</p>
              <p className="mt-1 text-xs text-gray-400">Try adjusting your filters.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredRows.map((row) => (
                <div key={row.id} className="px-5 py-4 transition-colors hover:bg-gray-50">
                  <div className="flex items-start space-x-4">
                    <div
                      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${
                        row.actor === 'System' ? 'bg-gray-400' : avatarClass(row.actor)
                      }`}
                    >
                      {initials(row.actor)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-gray-900">{row.action}</p>
                          <p className="mt-0.5 text-xs text-gray-500">
                            <span className="font-medium text-gray-700">{row.actor}</span>
                            <span className="mx-1 text-gray-300">•</span>
                            <span>{row.timestamp}</span>
                          </p>
                        </div>
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-medium ${CATEGORY_COLORS[row.category]}`}
                        >
                          {CATEGORY_LABELS[row.category]}
                        </span>
                      </div>

                      <p className="mt-2 text-sm leading-relaxed text-gray-600">{row.details}</p>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                          Event ID: <code>{row.id}</code>
                        </span>
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                          Ticket: <code>{row.ticketDisplayId ?? `#${row.ticketNumber}`}</code>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 text-xs text-gray-400">
          Tip: search keywords like <code>deleted</code>, <code>status</code>, or ticket IDs.
        </div>
      </div>
    </section>
  );
}
