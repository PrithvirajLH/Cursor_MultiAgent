import { useEffect, useMemo, useState } from "react";
import { Download, Search, Copy, ArrowRight, X } from "lucide-react";
import { Link } from "react-router-dom";
import {
  fetchAuditLog,
  fetchAuditLogExport,
  type AuditLogCategory,
  type AuditLogCategoryCounts,
  type AuditLogEntry,
} from "../api/client";
import { TopBar } from "../components/TopBar";
import { Drawer } from "../components/ui/Drawer";
import { EmptyState } from "../components/ui/EmptyState";
import { useHeaderContext } from "../contexts/HeaderContext";
import { handleApiError } from "../utils/handleApiError";

const CATEGORY_META: Record<
  AuditLogCategory,
  { label: string; chip: string; dot: string }
> = {
  tickets: {
    label: "Tickets",
    chip: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
    dot: "bg-slate-400",
  },
  routing: {
    label: "Routing",
    chip: "bg-green-500/10 text-green-600 dark:text-green-400",
    dot: "bg-green-500",
  },
  sla: {
    label: "SLA",
    chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  automation: {
    label: "Automation",
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  custom_fields: {
    label: "Custom Fields",
    chip: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    dot: "bg-purple-500",
  },
  ai: {
    label: "AI",
    chip: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    dot: "bg-cyan-500",
  },
};

const CATEGORY_ORDER: AuditLogCategory[] = [
  "tickets",
  "routing",
  "sla",
  "automation",
  "custom_fields",
  "ai",
];

const EMPTY_CATEGORY_COUNTS: AuditLogCategoryCounts = {
  tickets: 0,
  routing: 0,
  sla: 0,
  automation: 0,
  custom_fields: 0,
  ai: 0,
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  TICKET_CREATED: "Created Ticket",
  TICKET_ASSIGNED: "Assigned Ticket",
  TICKET_TRANSFERRED: "Transferred Ticket",
  TICKET_STATUS_CHANGED: "Status Changed",
  TICKET_PRIORITY_CHANGED: "Priority Changed",
  TICKET_CATEGORY_CHANGED: "Category Changed",
  MESSAGE_ADDED: "Message Added",
  ATTACHMENT_ADDED: "Attachment Added",
  FOLLOWER_ADDED: "Follower Added",
  FOLLOWER_REMOVED: "Follower Removed",
  CUSTOM_FIELD_UPDATED: "Custom Field Updated",
  CUSTOM_FIELD_CREATED: "Custom Field Created",
  CUSTOM_FIELD_DELETED: "Custom Field Deleted",
  AUTOMATION_RULE_CREATED: "Automation Rule Created",
  AUTOMATION_RULE_UPDATED: "Automation Rule Updated",
  AUTOMATION_RULE_DELETED: "Automation Rule Deleted",
  AUTOMATION_RULE_EXECUTED: "Automation Rule Executed",
  SLA_PAUSED: "SLA Paused",
  SLA_RESUMED: "SLA Resumed",
  SLA_BREACHED: "SLA Breached",
  SLA_AT_RISK: "SLA At Risk",
  PRIORITY_BUMPED: "Priority Auto-Bumped",
  AI_CLASSIFICATION: "AI Classification",
  AI_PIPELINE_TRACE: "AI Pipeline Trace",
  INBOUND_EMAIL_RECEIVED: "Inbound Email Received",
  CSAT_SUBMITTED: "CSAT Submitted",
  ATTACHMENT_SCAN_STATUS_CHANGED: "Attachment Scanned",
  INTERNAL: "Internal Note",
};

function toTitleCase(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? toTitleCase(type);
}

function actorName(entry: AuditLogEntry): string {
  return entry.createdBy?.displayName || entry.createdBy?.email || "System";
}

function actorKey(entry: AuditLogEntry): string {
  return entry.createdBy?.id || "system";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

const AVATAR_TONES = [
  "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
  "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300",
];
function avatarTone(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1)
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFullTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function relativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  return `${Math.round(mo / 12)} year(s) ago`;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const DETAIL_KEY_LABELS: Record<string, string> = {
  from: "From",
  to: "To",
  assigneeName: "Assignee",
  assigneeEmail: "Assignee",
  assigneeId: "Assignee ID",
  toTeamName: "Team",
  toTeamId: "Team ID",
  fileName: "File",
  messageType: "Message Type",
  fieldName: "Field",
  customFieldName: "Field",
  customFieldId: "Field ID",
  requesterEmail: "Requester",
  requesterId: "Requester ID",
  dueAt: "Due",
};

function detailLabel(key: string): string {
  return DETAIL_KEY_LABELS[key] ?? toTitleCase(key);
}

function detailValue(value: unknown): string {
  if (value == null) return "—";
  if (Array.isArray(value)) {
    return value
      .map((item) => detailValue(item))
      .filter(Boolean)
      .join(", ");
  }
  if (value && typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  }
  const text = String(value).trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/** One-line human summary used in the table's Summary column. */
function summarize(entry: AuditLogEntry): string {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  const fromTo =
    payload.from != null && payload.to != null
      ? `${String(payload.from)} → ${String(payload.to)}`
      : null;
  switch (entry.type) {
    case "TICKET_STATUS_CHANGED":
      return fromTo ? `Status: ${fromTo}` : "Status updated";
    case "TICKET_PRIORITY_CHANGED":
      return fromTo ? `Priority: ${fromTo}` : "Priority updated";
    case "TICKET_ASSIGNED": {
      const a = payload.assigneeName ?? payload.assigneeEmail ?? null;
      return a ? `Assigned to ${String(a)}` : "Ticket assigned";
    }
    case "TICKET_TRANSFERRED": {
      const t = payload.toTeamName ?? payload.toTeamId ?? null;
      return t ? `Transferred to ${String(t)}` : "Ticket transferred";
    }
    case "ATTACHMENT_ADDED":
      return payload.fileName
        ? `Uploaded ${String(payload.fileName)}`
        : "Attachment uploaded";
    case "MESSAGE_ADDED":
      return "Message added";
    case "CUSTOM_FIELD_UPDATED": {
      const f = payload.customFieldName ?? payload.fieldName ?? null;
      return f ? `Updated field ${String(f)}` : "Custom field updated";
    }
    default: {
      const keys = Object.keys(payload).filter((k) => payload[k] != null);
      if (keys.length === 0) return eventTypeLabel(entry.type);
      const first = keys[0];
      return `${detailLabel(first)}: ${detailValue(payload[first])}`;
    }
  }
}

function downloadCsvContent(content: string, fileName: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type QuickRange = "today" | "7d" | "30d" | "all";

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

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | AuditLogCategory>(
    "all",
  );
  const [userFilter, setUserFilter] = useState("all");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [quickRange, setQuickRange] = useState<QuickRange>("all");

  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  useEffect(() => {
    void loadAuditLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    page,
    search,
    categoryFilter,
    userFilter,
    eventTypeFilter,
    dateFrom,
    dateTo,
    headerCtx?.currentEmail,
  ]);

  async function loadAuditLog() {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setError("'From' date must be before 'To' date.");
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchAuditLog({
        page,
        pageSize,
        userId: userFilter === "all" ? undefined : userFilter,
        type: eventTypeFilter === "all" ? undefined : eventTypeFilter,
        category: categoryFilter === "all" ? undefined : categoryFilter,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search: search.trim() || undefined,
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

  const eventTypeOptions = useMemo(() => {
    const values = new Set<string>(Object.keys(EVENT_TYPE_LABELS));
    entries.forEach((e) => values.add(e.type));
    if (eventTypeFilter !== "all") values.add(eventTypeFilter);
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [entries, eventTypeFilter]);

  const userOptions = useMemo(() => {
    const map = new Map<string, string>();
    entries.forEach((e) => map.set(actorKey(e), actorName(e)));
    return Array.from(map.entries()).map(([value, label]) => ({
      value,
      label,
    }));
  }, [entries]);

  // Group the (server-sorted) entries into day buckets for the table.
  const dayGroups = useMemo(() => {
    const groups: { label: string; rows: AuditLogEntry[] }[] = [];
    for (const entry of entries) {
      const label = dayLabel(entry.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.rows.push(entry);
      else groups.push({ label, rows: [entry] });
    }
    return groups;
  }, [entries]);

  const totalActive = meta.total;
  const userLabel = userOptions.find((u) => u.value === userFilter)?.label;

  function setRange(range: QuickRange) {
    setQuickRange(range);
    setPage(1);
    const today = new Date();
    if (range === "all") {
      setDateFrom("");
      setDateTo("");
      return;
    }
    setDateTo(ymd(today));
    if (range === "today") {
      setDateFrom(ymd(today));
    } else {
      const from = new Date(today);
      from.setDate(today.getDate() - (range === "7d" ? 6 : 29));
      setDateFrom(ymd(from));
    }
  }

  function clearFilters() {
    setSearch("");
    setCategoryFilter("all");
    setUserFilter("all");
    setEventTypeFilter("all");
    setDateFrom("");
    setDateTo("");
    setQuickRange("all");
    setPage(1);
  }

  const hasActiveFilters =
    Boolean(search.trim()) ||
    categoryFilter !== "all" ||
    userFilter !== "all" ||
    eventTypeFilter !== "all" ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  async function exportCsv() {
    setExporting(true);
    setError(null);
    try {
      const csv = await fetchAuditLogExport({
        userId: userFilter === "all" ? undefined : userFilter,
        type: eventTypeFilter === "all" ? undefined : eventTypeFilter,
        category: categoryFilter === "all" ? undefined : categoryFilter,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search: search.trim() || undefined,
      });
      downloadCsvContent(csv, "audit-log.csv");
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setExporting(false);
    }
  }

  const inputClass =
    "rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground text-sm focus:border-transparent focus:ring-2 focus:ring-ring";

  return (
    <section className="min-h-full bg-background animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto max-w-none px-6 py-4">
          {headerCtx ? (
            <TopBar
              title={headerCtx.title}
              subtitle={headerCtx.subtitle}
              currentEmail={headerCtx.currentEmail}
              onOpenSearch={headerCtx.onOpenSearch}
              notificationProps={headerCtx.notificationProps}
              leftContent={
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold text-foreground">
                    Audit Log
                  </h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    An immutable record of every change, for compliance and
                    investigation.
                  </p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground">
                Audit Log
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                An immutable record of every change, for compliance and
                investigation.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-none p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search events, users, tickets, payloads…"
              className={`${inputClass} w-full py-2 pl-9 pr-3`}
            />
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          </div>

          {/* Quick ranges */}
          <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
            {(
              [
                ["today", "Today"],
                ["7d", "7d"],
                ["30d", "30d"],
                ["all", "All"],
              ] as [QuickRange, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setRange(value)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  quickRange === value
                    ? "bg-primary text-white"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            value={userFilter}
            onChange={(event) => {
              setUserFilter(event.target.value);
              setPage(1);
            }}
            className={`${inputClass} min-w-[130px] px-3 py-2`}
          >
            <option value="all">All users</option>
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
            className={`${inputClass} min-w-[150px] px-3 py-2`}
          >
            <option value="all">All event types</option>
            {eventTypeOptions.map((type) => (
              <option key={type} value={type}>
                {eventTypeLabel(type)}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={exporting}
            onClick={() => void exportCsv()}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            <span>{exporting ? "Exporting…" : "Export CSV"}</span>
          </button>
        </div>

        {/* Category pills */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setCategoryFilter("all");
              setPage(1);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              categoryFilter === "all"
                ? "bg-foreground text-background"
                : "bg-card text-muted-foreground hover:text-foreground border border-border"
            }`}
          >
            All <span className="ml-1 tabular-nums opacity-70">{totalActive}</span>
          </button>
          {CATEGORY_ORDER.map((category) => {
            const active = categoryFilter === category;
            return (
              <button
                key={category}
                type="button"
                onClick={() => {
                  setCategoryFilter(active ? "all" : category);
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${CATEGORY_META[category].dot}`}
                />
                {CATEGORY_META[category].label}
                <span className="tabular-nums opacity-70">
                  {meta.categoryCounts[category]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Applied filter chips */}
        {hasActiveFilters && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Filters:</span>
            {search.trim() && (
              <FilterChip
                label={`“${search.trim()}”`}
                onClear={() => {
                  setSearch("");
                  setPage(1);
                }}
              />
            )}
            {categoryFilter !== "all" && (
              <FilterChip
                label={CATEGORY_META[categoryFilter].label}
                onClear={() => {
                  setCategoryFilter("all");
                  setPage(1);
                }}
              />
            )}
            {userFilter !== "all" && (
              <FilterChip
                label={userLabel ?? "User"}
                onClear={() => {
                  setUserFilter("all");
                  setPage(1);
                }}
              />
            )}
            {eventTypeFilter !== "all" && (
              <FilterChip
                label={eventTypeLabel(eventTypeFilter)}
                onClear={() => {
                  setEventTypeFilter("all");
                  setPage(1);
                }}
              />
            )}
            {(dateFrom || dateTo) && (
              <FilterChip
                label={`${dateFrom || "…"} → ${dateTo || "…"}`}
                onClear={() => {
                  setDateFrom("");
                  setDateTo("");
                  setQuickRange("all");
                  setPage(1);
                }}
              />
            )}
            <button
              type="button"
              onClick={clearFilters}
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={`skel-${i}`}
                  className="flex items-center gap-4 px-4 py-3.5"
                >
                  <div className="h-7 w-7 skeleton-shimmer rounded-full" />
                  <div className="h-4 w-32 skeleton-shimmer rounded" />
                  <div className="h-4 w-20 skeleton-shimmer rounded" />
                  <div className="h-4 w-40 skeleton-shimmer rounded" />
                  <div className="ml-auto h-4 w-16 skeleton-shimmer rounded" />
                </div>
              ))}
            </div>
          ) : entries.length === 0 ? (
            <EmptyState
              bordered={false}
              icon={<Search className="h-6 w-6" />}
              title="No matching events"
              description={
                hasActiveFilters
                  ? "No audit events match these filters. Try widening the date range or clearing filters."
                  : "Activity will appear here as changes happen across the system."
              }
              action={
                hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    Clear filters
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="w-24 px-4 py-2.5">Time</th>
                    <th className="w-52 px-4 py-2.5">User</th>
                    <th className="w-32 px-4 py-2.5">Category</th>
                    <th className="w-48 px-4 py-2.5">Event</th>
                    <th className="w-32 px-4 py-2.5">Ticket</th>
                    <th className="px-4 py-2.5">Summary</th>
                    <th className="w-8 px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {dayGroups.map((group) => (
                    <DayGroup key={group.label} label={group.label}>
                      {group.rows.map((entry) => (
                        <tr
                          key={entry.id}
                          onClick={() => setSelected(entry)}
                          className="cursor-pointer border-b border-border last:border-0 hover:bg-muted"
                        >
                          <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                            {formatTime(entry.createdAt)}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="flex items-center gap-2.5">
                              <span
                                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${avatarTone(
                                  actorKey(entry),
                                )}`}
                              >
                                {initials(actorName(entry))}
                              </span>
                              <span className="truncate font-medium text-foreground">
                                {actorName(entry)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <span
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${CATEGORY_META[entry.category].chip}`}
                            >
                              {CATEGORY_META[entry.category].label}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top font-medium text-foreground">
                            {eventTypeLabel(entry.type)}
                          </td>
                          <td className="px-4 py-3 align-top">
                            {entry.ticketId && entry.ticketNumber > 0 ? (
                              <Link
                                to={`/tickets/${entry.ticketId}`}
                                onClick={(e) => e.stopPropagation()}
                                className="font-medium text-primary hover:underline"
                              >
                                {entry.ticketDisplayId ?? `#${entry.ticketNumber}`}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 align-top text-muted-foreground">
                            <span className="line-clamp-1" title={summarize(entry)}>
                              {summarize(entry)}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top text-muted-foreground">
                            <ArrowRight className="h-3.5 w-3.5" />
                          </td>
                        </tr>
                      ))}
                    </DayGroup>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {meta.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Page {meta.page} of {meta.totalPages} · {meta.total} events
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page <= 1 || loading}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() =>
                  setPage((prev) => Math.min(meta.totalPages, prev + 1))
                }
                disabled={page >= meta.totalPages || loading}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <AuditDetailDrawer entry={selected} onClose={() => setSelected(null)} />
      )}
    </section>
  );
}

function FilterChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 font-medium text-foreground">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label="Remove filter"
        className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function DayGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={7}
          className="border-b border-border bg-background/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {label}
        </td>
      </tr>
      {children}
    </>
  );
}

function AuditDetailDrawer({
  entry,
  onClose,
}: {
  entry: AuditLogEntry;
  onClose: () => void;
}) {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  const hasDiff = payload.from != null && payload.to != null;
  const payloadKeys = Object.keys(payload).filter(
    (k) => !(hasDiff && (k === "from" || k === "to")),
  );
  const meta = CATEGORY_META[entry.category];
  const name = actorName(entry);

  return (
    <Drawer
      open
      onClose={onClose}
      widthClassName="max-w-xl"
      icon={
        <span
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${meta.chip}`}
        >
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
        </span>
      }
      title={eventTypeLabel(entry.type)}
      description={meta.label}
      headerActions={
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(entry.id)}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          title={entry.id}
        >
          <Copy className="h-3.5 w-3.5" /> Event ID
        </button>
      }
    >
      <div className="space-y-5">
        {/* Actor + time */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-4">
          <span
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarTone(
              actorKey(entry),
            )}`}
          >
            {initials(name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {name}
            </p>
            {entry.createdBy?.email && (
              <p className="truncate text-xs text-muted-foreground">
                {entry.createdBy.email}
              </p>
            )}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            When
          </p>
          <p className="text-sm text-foreground">
            {formatFullTimestamp(entry.createdAt)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {relativeTime(entry.createdAt)} ·{" "}
            {new Date(entry.createdAt).toISOString()} UTC
          </p>
        </div>

        {entry.ticketId && entry.ticketNumber > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ticket
            </p>
            <Link
              to={`/tickets/${entry.ticketId}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              {entry.ticketDisplayId ?? `#${entry.ticketNumber}`}
            </Link>
          </div>
        )}

        {hasDiff && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Change
            </p>
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded-md bg-red-50 px-2 py-1 font-medium text-red-700 line-through dark:bg-red-500/10 dark:text-red-400">
                {String(payload.from)}
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="rounded-md bg-green-50 px-2 py-1 font-medium text-green-700 dark:bg-green-500/10 dark:text-green-400">
                {String(payload.to)}
              </span>
            </div>
          </div>
        )}

        {payloadKeys.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Details
            </p>
            <dl className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {payloadKeys.map((key) => (
                <div
                  key={key}
                  className="flex items-start justify-between gap-4 bg-card px-3 py-2"
                >
                  <dt className="text-xs font-medium text-muted-foreground">
                    {detailLabel(key)}
                  </dt>
                  <dd className="max-w-[60%] break-words text-right text-xs text-foreground">
                    {detailValue(payload[key])}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Raw payload
          </p>
          <pre className="max-h-72 overflow-auto rounded-xl border border-border bg-muted/50 p-3 text-[11px] leading-relaxed text-foreground">
            {JSON.stringify(entry.payload ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    </Drawer>
  );
}
