import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Search } from "lucide-react";
import { fetchAgentsList, type AgentListRow } from "../api/client";
import { TopBar } from "../components/TopBar";
import { useHeaderContext } from "../contexts/HeaderContext";

type SortKey = "name" | "team" | "open" | "resolved" | "mttr" | "lastActive";
type SortDir = "asc" | "desc";

export function AgentsDirectoryPage() {
  const headerCtx = useHeaderContext();
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

  function fmtHours(h: number | null) {
    if (h == null) return "—";
    if (h < 1) return `${Math.round(h * 60)}m`;
    return `${h.toFixed(1)}h`;
  }
  function fmtDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString();
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

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
                <div>
                  <h1 className="text-xl font-semibold text-foreground">
                    Agents
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Performance overview across all support roles
                  </p>
                </div>
              }
            />
          ) : (
            <div>
              <h1 className="text-xl font-semibold text-foreground">Agents</h1>
              <p className="text-sm text-muted-foreground">
                Performance overview across all support roles
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-none px-6 py-6">
        <div className="glass-card rounded-xl p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[260px] flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, or team…"
                className="h-10 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              Include inactive
            </label>
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-600">{error}</p>
          ) : filteredSorted.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No agents match.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th
                    className="cursor-pointer px-2 py-2"
                    onClick={() => clickHeader("name")}
                  >
                    Agent{sortIndicator("name")}
                  </th>
                  <th
                    className="cursor-pointer px-2 py-2"
                    onClick={() => clickHeader("team")}
                  >
                    Team{sortIndicator("team")}
                  </th>
                  <th
                    className="cursor-pointer px-2 py-2 text-right"
                    onClick={() => clickHeader("open")}
                  >
                    Open{sortIndicator("open")}
                  </th>
                  <th
                    className="cursor-pointer px-2 py-2 text-right"
                    onClick={() => clickHeader("resolved")}
                  >
                    Resolved{sortIndicator("resolved")}
                  </th>
                  <th
                    className="cursor-pointer px-2 py-2 text-right"
                    onClick={() => clickHeader("mttr")}
                  >
                    MTTR{sortIndicator("mttr")}
                  </th>
                  <th
                    className="cursor-pointer px-2 py-2"
                    onClick={() => clickHeader("lastActive")}
                  >
                    Last active{sortIndicator("lastActive")}
                  </th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {filteredSorted.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-b-0 hover:bg-accent/40"
                  >
                    <td className="px-2 py-2">
                      <Link
                        to={`/admin/agents/${row.id}`}
                        className="block"
                      >
                        <div className="font-medium text-foreground">
                          {row.displayName}
                          {!row.isActive ? (
                            <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              inactive
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {row.email} · {row.role}
                        </div>
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {row.primaryTeamName ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-right font-medium">
                      {row.openCount}
                    </td>
                    <td className="px-2 py-2 text-right">{row.resolvedCount}</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">
                      {fmtHours(row.medianResolutionHours)}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {fmtDate(row.lastActivityAt)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Link
                        to={`/admin/agents/${row.id}`}
                        className="inline-flex items-center text-muted-foreground hover:text-foreground"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
