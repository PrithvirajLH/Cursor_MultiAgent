import { useEffect, useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  fetchAuditLog,
  fetchAuditLogExport,
  type AuditLogCategoryCounts,
  type AuditLogEntry
} from '../api/client';
import { TopBar } from '../components/TopBar';
import { useHeaderContext } from '../contexts/HeaderContext';
import { handleApiError } from '../utils/handleApiError';

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

const EMPTY_CATEGORY_COUNTS: AuditLogCategoryCounts = {
  sla: 0,
  routing: 0,
  automation: 0,
  custom_fields: 0,
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  TICKET_CREATED: 'Created Ticket',
  TICKET_ASSIGNED: 'Assigned Ticket',
  TICKET_TRANSFERRED: 'Transferred Ticket',
  TICKET_STATUS_CHANGED: 'Status Changed',
  TICKET_PRIORITY_CHANGED: 'Priority Changed',
  MESSAGE_ADDED: 'Message Added',
  ATTACHMENT_ADDED: 'Attachment Added',
  FOLLOWER_ADDED: 'Follower Added',
  FOLLOWER_REMOVED: 'Follower Removed',
  CUSTOM_FIELD_UPDATED: 'Custom Field Updated',
  CUSTOM_FIELD_CREATED: 'Custom Field Created',
  CUSTOM_FIELD_DELETED: 'Custom Field Deleted',
  AUTOMATION_RULE_CREATED: 'Automation Rule Created',
  AUTOMATION_RULE_UPDATED: 'Automation Rule Updated',
  AUTOMATION_RULE_DELETED: 'Automation Rule Deleted',
  AUTOMATION_RULE_EXECUTED: 'Automation Rule Executed',
  SLA_PAUSED: 'SLA Paused',
  SLA_RESUMED: 'SLA Resumed',
  SLA_BREACHED: 'SLA Breached'
};

function toTitleCase(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? toTitleCase(type);
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

const DETAIL_KEY_LABELS: Record<string, string> = {
  from: 'From',
  to: 'To',
  assigneeName: 'Assignee',
  assigneeEmail: 'Assignee',
  assigneeId: 'Assignee ID',
  toTeamName: 'Team',
  toTeamId: 'Team ID',
  fileName: 'File',
  messageType: 'Message Type',
  fieldName: 'Field',
  customFieldName: 'Field',
  customFieldId: 'Field ID',
  requesterEmail: 'Requester',
  requesterId: 'Requester ID',
  dueAt: 'Due'
};

function detailLabel(key: string): string {
  return DETAIL_KEY_LABELS[key] ?? toTitleCase(key);
}

function detailValue(value: unknown): string {
  if (value == null) return '—';
  if (Array.isArray(value)) {
    const rendered = value.map((item) => detailValue(item)).filter(Boolean);
    return rendered.join(', ');
  }
  if (value && typeof value === 'object') {
    const text = JSON.stringify(value);
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  }
  const text = String(value).trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function payloadChips(
  payload: Record<string, unknown>,
  omit: string[] = [],
  max = 3
): string[] {
  const omitted = new Set(omit);
  const chips: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (omitted.has(key) || value == null) continue;
    const rendered = detailValue(value);
    if (!rendered || rendered === '—') continue;
    chips.push(`${detailLabel(key)}: ${rendered}`);
    if (chips.length >= max) break;
  }
  return chips;
}

function formatDetails(entry: AuditLogEntry): { summary: string; chips: string[] } {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  const ticketLabel =
    entry.ticketDisplayId ?? (entry.ticketNumber > 0 ? `#${entry.ticketNumber}` : null);
  switch (entry.type) {
    case 'TICKET_STATUS_CHANGED': {
      const from = payload.from != null ? String(payload.from) : null;
      const to = payload.to != null ? String(payload.to) : null;
      const summary = from && to ? `Status changed: ${from} -> ${to}` : 'Status updated';
      return { summary, chips: payloadChips(payload, ['from', 'to']) };
    }
    case 'TICKET_PRIORITY_CHANGED': {
      const from = payload.from != null ? String(payload.from) : null;
      const to = payload.to != null ? String(payload.to) : null;
      const summary = from && to ? `Priority changed: ${from} -> ${to}` : 'Priority updated';
      return { summary, chips: payloadChips(payload, ['from', 'to']) };
    }
    case 'TICKET_ASSIGNED': {
      const assignee =
        payload.assigneeName ?? payload.assigneeEmail ?? payload.assigneeId ?? null;
      const summary = assignee ? `Assigned to ${String(assignee)}` : 'Ticket assigned';
      return {
        summary,
        chips: payloadChips(payload, ['assigneeName', 'assigneeEmail', 'assigneeId'])
      };
    }
    case 'TICKET_TRANSFERRED': {
      const team = payload.toTeamName ?? payload.toTeamId ?? null;
      const summary = team ? `Transferred to team ${String(team)}` : 'Ticket transferred';
      return {
        summary,
        chips: payloadChips(payload, ['toTeamName', 'toTeamId'])
      };
    }
    case 'ATTACHMENT_ADDED': {
      const fileName = payload.fileName;
      const summary = fileName ? `Attachment uploaded: ${String(fileName)}` : 'Attachment uploaded';
      return { summary, chips: payloadChips(payload, ['fileName']) };
    }
    case 'MESSAGE_ADDED':
      return {
        summary: 'Message added',
        chips: payloadChips(payload)
      };
    case 'FOLLOWER_ADDED':
      return {
        summary: 'Follower added',
        chips: payloadChips(payload)
      };
    case 'FOLLOWER_REMOVED':
      return {
        summary: 'Follower removed',
        chips: payloadChips(payload)
      };
    case 'CUSTOM_FIELD_UPDATED': {
      const field = payload.customFieldName ?? payload.fieldName ?? payload.customFieldId ?? null;
      const summary = field ? `Updated custom field: ${String(field)}` : 'Custom field updated';
      return {
        summary,
        chips: payloadChips(payload, ['customFieldName', 'fieldName', 'customFieldId'])
      };
    }
    default:
      return {
        summary: eventTypeLabel(entry.type) || (ticketLabel ? `Ticket ${ticketLabel}` : 'No additional details'),
        chips: payloadChips(payload)
      };
  }
}

function downloadCsvContent(content: string, fileName: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

export function AuditLogPage() {
  const headerCtx = useHeaderContext();
  const pageSize = 50;
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({
    page: 1,
    pageSize,
    total: 0,
    totalPages: 1,
    categoryCounts: EMPTY_CATEGORY_COUNTS,
  });
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | LogCategory>('all');
  const [userFilter, setUserFilter] = useState('all');
  const [eventTypeFilter, setEventTypeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    void loadAuditLog();
  }, [page, search, userFilter, eventTypeFilter, dateFrom, dateTo, headerCtx?.currentEmail]);

  async function loadAuditLog() {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setError('Date from must be before date to.');
      setEntries([]);
      setMeta((prev) => ({
        ...prev,
        page: 1,
        total: 0,
        totalPages: 1,
        categoryCounts: EMPTY_CATEGORY_COUNTS,
      }));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAuditLog({
        page,
        pageSize,
        userId: userFilter === 'all' ? undefined : userFilter,
        type: eventTypeFilter === 'all' ? undefined : eventTypeFilter,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search: search.trim() || undefined
      });
      setEntries(response.data);
      setMeta({
        page: response.meta.page,
        pageSize: response.meta.pageSize,
        total: response.meta.total,
        totalPages: response.meta.totalPages,
        categoryCounts: response.meta.categoryCounts ?? EMPTY_CATEGORY_COUNTS,
      });
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    return entries.map((entry) => {
      const category = inferCategory(entry);
      const action = eventTypeLabel(entry.type);
      const actor = actorName(entry);
      const details = formatDetails(entry);
      return {
        ...entry,
        category,
        action,
        actor,
        actorId: actorKey(entry),
        details: details.summary,
        detailChips: details.chips,
        timestamp: formatTimestamp(entry.createdAt)
      };
    });
  }, [entries]);

  const eventTypeOptions = useMemo(() => {
    const values = new Set<string>(Object.keys(EVENT_TYPE_LABELS));
    rows.forEach((row) => values.add(row.type));
    if (eventTypeFilter !== 'all') values.add(eventTypeFilter);
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [rows, eventTypeFilter]);

  const userOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((row) => {
      map.set(row.actorId, row.actor);
    });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);

  const filteredRows = useMemo(
    () => rows.filter((row) => categoryFilter === 'all' || row.category === categoryFilter),
    [rows, categoryFilter]
  );

  const countsByCategory = useMemo(() => {
    return meta.categoryCounts;
  }, [meta.categoryCounts]);

  function clearFilters() {
    setSearch('');
    setCategoryFilter('all');
    setUserFilter('all');
    setEventTypeFilter('all');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      if (categoryFilter === 'all') {
        const csv = await fetchAuditLogExport({
          userId: userFilter === 'all' ? undefined : userFilter,
          type: eventTypeFilter === 'all' ? undefined : eventTypeFilter,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          search: search.trim() || undefined
        });
        downloadCsvContent(csv, 'audit-logs.csv');
        return;
      }

      const csvRows = [
        ['Timestamp', 'User', 'Category', 'Action', 'Details', 'Ticket'],
        ...filteredRows.map((row) => [
          row.timestamp,
          row.actor,
          CATEGORY_LABELS[row.category],
          row.action,
          row.detailChips.length > 0 ? `${row.details} | ${row.detailChips.join(' | ')}` : row.details,
          row.ticketDisplayId ?? (row.ticketNumber > 0 ? `#${row.ticketNumber}` : 'N/A')
        ])
      ];
      const csv = csvRows
        .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
        .join('\n');
      downloadCsvContent(csv, `audit-logs-${categoryFilter}.csv`);
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setExporting(false);
    }
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
                  <h1 className="text-xl font-semibold text-slate-900">Audit Logs</h1>
                  <p className="mt-0.5 text-sm text-slate-500">Track changes and activity.</p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-slate-900">Audit Logs</h1>
              <p className="mt-0.5 text-sm text-slate-500">Track changes and activity.</p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] p-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search logs..."
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
            />
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          </div>

          <select
            value={categoryFilter}
            onChange={(event) => {
              setCategoryFilter(event.target.value as 'all' | LogCategory);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
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
            onChange={(event) => {
              setUserFilter(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Users</option>
            {userOptions.map((user) => (
              <option key={user.value} value={user.value}>
                {user.label}
              </option>
            ))}
          </select>

          <select
            value={eventTypeFilter}
            onChange={(event) => {
              setEventTypeFilter(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Event Types</option>
            {eventTypeOptions.map((type) => (
              <option key={type} value={type}>
                {eventTypeLabel(type)}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">
            <span className="text-xs font-medium text-slate-500">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
              className="rounded border-0 p-0 text-sm text-slate-700 focus:ring-0"
            />
          </label>

          <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">
            <span className="text-xs font-medium text-slate-500">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPage(1);
              }}
              className="rounded border-0 p-0 text-sm text-slate-700 focus:ring-0"
            />
          </label>

          <button
            type="button"
            onClick={clearFilters}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700"
          >
            Clear
          </button>

          <button
            type="button"
            disabled={exporting}
            onClick={() => {
              void exportCsv();
            }}
            className="inline-flex items-center space-x-2 rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
          >
            <Download className="h-4 w-4" />
            <span>{exporting ? 'Exporting...' : 'Export'}</span>
          </button>

          <span className="ml-auto text-xs text-slate-400">
            {categoryFilter === 'all'
              ? `Page ${meta.page} of ${meta.totalPages} (${meta.total} total)`
              : `${filteredRows.length} of ${rows.length} entries on current page`}
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
              className={`flex items-center space-x-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-all ${
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
                <p className="text-xs text-slate-500">{CATEGORY_LABELS[category]}</p>
                <p className="text-sm font-bold text-slate-900">{countsByCategory[category]}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {loading ? (
            <>
              <div className="flex items-center gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div className="h-4 w-40 skeleton-shimmer rounded" />
                <div className="h-4 w-24 skeleton-shimmer rounded" />
                <div className="h-4 w-24 skeleton-shimmer rounded" />
                <div className="h-4 w-32 skeleton-shimmer rounded" />
                <div className="h-4 w-20 skeleton-shimmer rounded" />
              </div>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={`row-skel-${i}`} className="flex items-center gap-4 border-b border-slate-100 px-4 py-3.5 last:border-0">
                  <div className="h-4 w-40 skeleton-shimmer rounded" />
                  <div className="h-4 w-24 skeleton-shimmer rounded" />
                  <div className="h-4 w-24 skeleton-shimmer rounded" />
                  <div className="h-4 w-32 skeleton-shimmer rounded" />
                  <div className="h-4 w-20 skeleton-shimmer rounded" />
                </div>
              ))}
            </>
          ) : error ? (
            <div className="p-6 text-sm text-red-600">{error}</div>
          ) : filteredRows.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-semibold text-slate-700">No matching log entries</p>
              <p className="mt-1 text-xs text-slate-400">Try adjusting your filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full table-fixed divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="w-44 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Date
                    </th>
                    <th className="w-48 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      User
                    </th>
                    <th className="w-36 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Category
                    </th>
                    <th className="w-48 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Event
                    </th>
                    <th className="w-40 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Ticket
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Details
                    </th>
                    <th className="w-56 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Event ID
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 align-top text-xs text-slate-600">{row.timestamp}</td>
                      <td className="px-4 py-3 align-top">
                        <p className="truncate font-medium text-slate-900" title={row.actor}>
                          {row.actor}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${CATEGORY_COLORS[row.category]}`}
                        >
                          {CATEGORY_LABELS[row.category]}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-800">{row.action}</td>
                      <td className="px-4 py-3 align-top">
                        {row.ticketId && row.ticketNumber > 0 ? (
                          <Link
                            to={`/tickets/${row.ticketId}`}
                            className="font-medium text-blue-700 hover:text-blue-800 hover:underline"
                          >
                            {row.ticketDisplayId ?? `#${row.ticketNumber}`}
                          </Link>
                        ) : (
                          <span className="text-slate-500">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        <p className="line-clamp-2 font-medium text-slate-900" title={row.details}>
                          {row.details}
                        </p>
                        {row.detailChips.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {row.detailChips.map((chip, index) => (
                              <span
                                key={`${row.id}-chip-${index}`}
                                className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                                title={chip}
                              >
                                {chip}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top font-mono text-xs text-slate-500">{row.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {categoryFilter === 'all' && meta.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page <= 1 || loading}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              Prev
            </button>
            <span className="text-xs text-slate-500">
              Page {meta.page} of {meta.totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(meta.totalPages, prev + 1))}
              disabled={page >= meta.totalPages || loading}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              Next
            </button>
          </div>
        )}

        {categoryFilter !== 'all' && meta.totalPages > 1 && (
          <p className="mt-3 text-xs text-amber-600">
            Category filtering applies to the currently loaded page. Clear category filter to page through all logs.
          </p>
        )}

        <div className="mt-4 text-xs text-slate-400">
          Tip: search keywords like <code>deleted</code>, <code>status</code>, or ticket IDs.
        </div>
      </div>
    </section>
  );
}
