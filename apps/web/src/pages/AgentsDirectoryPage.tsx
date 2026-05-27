import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight,
  Search,
  Users,
  UserCheck,
  Inbox,
  CheckCircle2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { fetchAgentsList, type AgentListRow } from "../api/client";
import { TopBar } from "../components/TopBar";
import { StatCard } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { useHeaderContext } from "../contexts/HeaderContext";

type SortKey = "name" | "team" | "open" | "resolved" | "mttr" | "lastActive";
type SortDir = "asc" | "desc";

const ROLE_BADGE: Record<string, string> = {
  OWNER: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
  TEAM_ADMIN: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  LEAD: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  AGENT: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300",
};
const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  TEAM_ADMIN: "Team Admin",
  LEAD: "Lead",
  AGENT: "Agent",
  EMPLOYEE: "Employee",
};

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

function fmtHours(h: number | null) {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function AgentsDirectoryPage() {
  const headerCtx = useHeaderContext();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AgentListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("resolved");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAgentsList()
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load agents");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.isActive).length;
    return {
      total: rows.length,
      active,
      open: rows.reduce((s, r) => s + r.openCount, 0),
      resolved: rows.reduce((s, r) => s + r.resolvedCount, 0),
    };
  }, [rows]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (!includeInactive && !r.isActive) return false;
      if (!q) return true;
      return (
        r.displayName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.primaryTeamName ?? "").toLowerCase().includes(q)
      );
    });
    return [...filtered].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const cmp = (() => {
        switch (sortKey) {
          case "name":
            return a.displayName.localeCompare(b.displayName);
          case "team":
            return (a.primaryTeamName ?? "").localeCompare(
              b.primaryTeamName ?? "",
            );
          case "open":
            return a.openCount - b.openCount;
          case "resolved":
            return a.resolvedCount - b.resolvedCount;
          case "mttr":
            return (
              (a.medianResolutionHours ?? Number.POSITIVE_INFINITY) -
              (b.medianResolutionHours ?? Number.POSITIVE_INFINITY)
            );
          case "lastActive":
            return (
              (a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0) -
              (b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0)
            );
        }
      })();
      return cmp * dir;
    });
  }, [rows, search, includeInactive, sortKey, sortDir]);

  function clickHeader(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "team" ? "asc" : "desc");
    }
  }

  function SortTh({
    label,
    sortKey: key,
    align = "left",
    className = "",
  }: {
    label: string;
    sortKey: SortKey;
    align?: "left" | "right";
    className?: string;
  }) {
    const active = sortKey === key;
    return (
      <th
        onClick={() => clickHeader(key)}
        className={`cursor-pointer select-none px-4 py-2.5 font-semibold ${
          align === "right" ? "text-right" : "text-left"
        } ${className}`}
      >
        <span
          className={`inline-flex items-center gap-1 ${
            align === "right" ? "flex-row-reverse" : ""
          } ${active ? "text-foreground" : ""}`}
        >
          {label}
          {active &&
            (sortDir === "asc" ? (
              <ArrowUp className="h-3 w-3" />
            ) : (
              <ArrowDown className="h-3 w-3" />
            ))}
        </span>
      </th>
    );
  }

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
                    Agents
                  </h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Workload and performance across all support roles.
                  </p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground">Agents</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Workload and performance across all support roles.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-none p-6">
        {/* Summary */}
        <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            label="Total Agents"
            value={stats.total}
            icon={Users}
            tone="blue"
          />
          <StatCard
            label="Active"
            value={stats.active}
            icon={UserCheck}
            tone="green"
          />
          <StatCard
            label="Open Tickets"
            value={stats.open}
            icon={Inbox}
            tone="amber"
          />
          <StatCard
            label="Resolved"
            value={stats.resolved}
            icon={CheckCircle2}
            tone="purple"
          />
        </div>

        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or team…"
              className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-ring"
            />
          </div>
          <label className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Include inactive
          </label>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={`skel-${i}`}
                  className="flex items-center gap-4 px-4 py-3.5"
                >
                  <div className="h-9 w-9 skeleton-shimmer rounded-full" />
                  <div className="space-y-1.5">
                    <div className="h-4 w-40 skeleton-shimmer rounded" />
                    <div className="h-3 w-56 skeleton-shimmer rounded" />
                  </div>
                  <div className="ml-auto h-4 w-24 skeleton-shimmer rounded" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-red-600">{error}</div>
          ) : filteredSorted.length === 0 ? (
            <EmptyState
              bordered={false}
              icon={<Users className="h-6 w-6" />}
              title="No agents match"
              description={
                search.trim()
                  ? "Try a different search term or include inactive agents."
                  : "No agents to show."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <SortTh label="Agent" sortKey="name" />
                    <SortTh label="Team" sortKey="team" />
                    <SortTh label="Open" sortKey="open" align="right" className="w-24" />
                    <SortTh
                      label="Resolved"
                      sortKey="resolved"
                      align="right"
                      className="w-28"
                    />
                    <SortTh label="MTTR" sortKey="mttr" align="right" className="w-24" />
                    <SortTh label="Last active" sortKey="lastActive" className="w-32" />
                    <th className="w-8 px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredSorted.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => navigate(`/admin/agents/${row.id}`)}
                      className="cursor-pointer hover:bg-muted"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarTone(
                              row.id,
                            )} ${!row.isActive ? "opacity-50" : ""}`}
                          >
                            {initials(row.displayName)}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium text-foreground">
                                {row.displayName}
                              </span>
                              <span
                                className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${ROLE_BADGE[row.role] ?? ROLE_BADGE.AGENT}`}
                              >
                                {ROLE_LABEL[row.role] ?? row.role}
                              </span>
                              {!row.isActive && (
                                <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  Inactive
                                </span>
                              )}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {row.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {row.primaryTeamName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.openCount > 0 ? (
                          <span className="font-medium text-foreground">
                            {row.openCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {row.resolvedCount}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {fmtHours(row.medianResolutionHours)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {fmtDate(row.lastActivityAt)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        <ChevronRight className="h-4 w-4" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {filteredSorted.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing {filteredSorted.length} of {rows.length} agent
            {rows.length === 1 ? "" : "s"}.
          </p>
        )}
      </div>
    </section>
  );
}
