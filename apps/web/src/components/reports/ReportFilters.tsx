import type { CategoryRef, TeamRef } from "../../api/client";

const DATE_PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
] as const;

export type ReportFiltersState = {
  from: string;
  to: string;
  teamId: string;
  priority: string;
  categoryId: string;
};

function defaultFilters(): ReportFiltersState {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    teamId: "",
    priority: "",
    categoryId: "",
  };
}

export function getDefaultReportFilters(): ReportFiltersState {
  return defaultFilters();
}

export function ReportFilters({
  filters,
  onChange,
  teams,
  categories,
}: {
  filters: ReportFiltersState;
  onChange: (f: ReportFiltersState) => void;
  teams: TeamRef[];
  categories: CategoryRef[];
}) {
  function setPreset(days: number) {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - days);
    onChange({
      ...filters,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label className="text-xs text-muted-foreground block">Date range</label>
        <div className="mt-1 flex gap-2">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setPreset(p.days)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2 items-center">
          <input
            type="date"
            value={filters.from}
            onChange={(e) => onChange({ ...filters, from: e.target.value })}
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => onChange({ ...filters, to: e.target.value })}
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
          />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground block">Team</label>
        <select
          value={filters.teamId}
          onChange={(e) => onChange({ ...filters, teamId: e.target.value })}
          className="mt-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground min-w-[140px]"
        >
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-muted-foreground block">Priority</label>
        <select
          value={filters.priority}
          onChange={(e) => onChange({ ...filters, priority: e.target.value })}
          className="mt-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground min-w-[100px]"
        >
          <option value="">All</option>
          <option value="SEV1">SEV1</option>
          <option value="SEV2">SEV2</option>
          <option value="SEV3">SEV3</option>
          <option value="SEV4">SEV4</option>
        </select>
      </div>
      <div>
        <label className="text-xs text-muted-foreground block">Category</label>
        <select
          value={filters.categoryId}
          onChange={(e) => onChange({ ...filters, categoryId: e.target.value })}
          className="mt-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground min-w-[140px]"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function reportFiltersToQuery(f: ReportFiltersState): {
  from?: string;
  to?: string;
  teamId?: string;
  priority?: string;
  categoryId?: string;
  groupBy?: "team" | "priority";
} {
  const q: Record<string, string> = {};
  if (f.from) q.from = f.from + "T00:00:00.000Z";
  if (f.to) q.to = f.to + "T23:59:59.999Z";
  if (f.teamId) q.teamId = f.teamId;
  if (f.priority) q.priority = f.priority;
  if (f.categoryId) q.categoryId = f.categoryId;
  return q;
}
