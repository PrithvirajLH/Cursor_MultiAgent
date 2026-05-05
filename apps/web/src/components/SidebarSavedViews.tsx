import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { X } from "lucide-react";
import {
  deleteSavedView,
  fetchSavedViews,
  fetchTeams,
  type SavedViewRecord,
} from "../api/client";
import { useAuthSession } from "../hooks/useAuthSession";
import {
  SAVED_VIEWS,
  type SidebarPreset,
  type ToneKey,
} from "./shell/saved-views";
import {
  querystringToParams,
  useViewCounts,
  viewFiltersToParams,
} from "./shell/use-view-count";

const TONE_COLOR: Record<ToneKey, string> = {
  red: "var(--c-red)",
  amber: "var(--c-amber)",
  green: "var(--c-green)",
  gray: "var(--c-fg-5, #94a3b8)",
};

const TEAM_COLORS = [
  "hsl(245 58% 55%)",
  "#b54708",
  "#1d7a4d",
  "#7c3aed",
  "#1d4ed8",
  "#475569",
];

function filtersToQueryString(filters: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v == null) return;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(","));
    } else if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      sp.set(k, String(v));
    }
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function userViewMatches(
  actual: URLSearchParams,
  expected: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(([k, v]) => {
    if (v == null) return true;
    const a = actual.get(k);
    if (Array.isArray(v)) return a === v.join(",");
    return a === String(v);
  });
}

function rowClass(theme: "light" | "dark", active: boolean): string {
  const dk = theme === "dark";
  if (active) {
    return dk
      ? "text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]"
      : "text-primary bg-primary/[0.08] font-semibold";
  }
  return dk
    ? "text-white/35 hover:text-white/62 hover:bg-white/[0.05]"
    : "text-foreground/75 hover:text-foreground hover:bg-accent";
}

function countTextClass(theme: "light" | "dark", active: boolean): string {
  const dk = theme === "dark";
  if (active) return "text-primary";
  return dk ? "text-white/30" : "text-foreground/55";
}

/* ── Inside All Tickets branch: presets + user-saved "Mine" ─── */

interface SidebarTicketsSavedViewsProps {
  theme: "light" | "dark";
  onBeforeNavigate?: () => void;
}

export function SidebarTicketsSavedViews({
  theme,
  onBeforeNavigate,
}: SidebarTicketsSavedViewsProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuthSession();
  const authReady = !!user && !authLoading;
  const onTickets = pathname === "/tickets" || pathname.startsWith("/tickets/");
  const dk = theme === "dark";

  const { data: userSavedViews } = useQuery({
    queryKey: ["saved-views"],
    queryFn: () => fetchSavedViews(),
    staleTime: 60_000,
    enabled: authReady,
  });

  const presetCounts = useViewCounts(
    SAVED_VIEWS.map((v) => querystringToParams(v.buildQuery())),
    { enabled: authReady },
  );

  const userViewCounts = useViewCounts(
    (userSavedViews ?? []).map((v) => viewFiltersToParams(v.filters)),
    { enabled: authReady && !!userSavedViews?.length },
  );

  const presetIsActive = (preset: SidebarPreset) =>
    onTickets && preset.matches(searchParams);

  return (
    <>
      {SAVED_VIEWS.map((v, i) => {
        const active = presetIsActive(v);
        const liveCount = presetCounts[i]?.count;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => {
              onBeforeNavigate?.();
              navigate(`/tickets${v.buildQuery()}`);
            }}
            className={`w-full flex items-center gap-2 px-2.5 py-[7px] rounded-md text-[12.5px] font-medium transition-all duration-150 ${rowClass(theme, active)}`}
          >
            <span
              className="h-1.5 w-1.5 rounded-full flex-none"
              style={{ backgroundColor: TONE_COLOR[v.tone ?? "gray"] }}
            />
            <span className="flex-1 text-left truncate">{v.label}</span>
            {liveCount !== undefined && (
              <span
                className={`text-[10px] tabular-nums font-semibold ${countTextClass(theme, active)}`}
              >
                {liveCount > 99 ? "99+" : liveCount}
              </span>
            )}
          </button>
        );
      })}

      {userSavedViews && userSavedViews.length > 0 && (
        <>
          <div
            className={`px-2.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.07em] ${
              dk ? "text-white/30" : "text-foreground/45"
            }`}
          >
            Mine
          </div>
          {userSavedViews.map((v, i) => (
            <UserSavedViewRow
              key={v.id}
              view={v}
              count={userViewCounts[i]?.count}
              onTickets={onTickets}
              searchParams={searchParams}
              theme={theme}
              onBeforeNavigate={onBeforeNavigate}
            />
          ))}
        </>
      )}
    </>
  );
}

/* ── Top-level Teams section ───────────────────────────────────── */

interface SidebarTeamsProps {
  collapsed: boolean;
  theme: "light" | "dark";
  onBeforeNavigate?: () => void;
}

export function SidebarTeams({
  collapsed,
  theme,
  onBeforeNavigate,
}: SidebarTeamsProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuthSession();
  const authReady = !!user && !authLoading;
  const onTickets = pathname === "/tickets" || pathname.startsWith("/tickets/");
  const dk = theme === "dark";

  const { data: teams } = useQuery({
    queryKey: ["sidebar-teams"],
    queryFn: ({ signal }) => fetchTeams({ signal }),
    staleTime: 5 * 60_000,
    enabled: authReady,
  });

  if (collapsed) return null;

  const teamList = (teams?.data ?? []).map((t, i) => ({
    id: t.id,
    label: t.name,
    color: TEAM_COLORS[i % TEAM_COLORS.length],
  }));

  if (teamList.length === 0) return null;

  return (
    <>
      <div
        className={`px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.07em] ${
          dk ? "text-white/35" : "text-foreground/45"
        }`}
      >
        Teams
      </div>
      {teamList.map((t) => {
        const active = onTickets && searchParams.get("teamIds") === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              onBeforeNavigate?.();
              navigate(`/tickets?teamIds=${encodeURIComponent(t.id)}`);
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors duration-150 ${
              active
                ? dk
                  ? "bg-white/[0.09] text-white"
                  : "bg-primary/[0.08] text-primary font-semibold"
                : dk
                  ? "text-white/45 hover:bg-white/[0.06] hover:text-white/75"
                  : "text-foreground/75 hover:bg-accent hover:text-foreground"
            }`}
          >
            <span
              className="h-2 w-2 rounded-sm flex-none"
              style={{ backgroundColor: t.color }}
            />
            <span className="flex-1 text-left truncate">{t.label}</span>
          </button>
        );
      })}
    </>
  );
}

/* ── User-saved view row with hover-X delete ───────────────────── */

function UserSavedViewRow({
  view,
  count,
  onTickets,
  searchParams,
  theme,
  onBeforeNavigate,
}: {
  view: SavedViewRecord;
  count: number | undefined;
  onTickets: boolean;
  searchParams: URLSearchParams;
  theme: "light" | "dark";
  onBeforeNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteSavedView(view.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-views"] }),
  });

  const dk = theme === "dark";
  const active = onTickets && userViewMatches(searchParams, view.filters);
  const query = filtersToQueryString(view.filters);

  return (
    <div
      className={`group w-full flex items-center gap-2 px-2.5 py-[7px] rounded-md text-[12.5px] font-medium transition-all duration-150 ${rowClass(theme, active)}`}
    >
      <button
        type="button"
        onClick={() => {
          onBeforeNavigate?.();
          navigate(`/tickets${query}`);
        }}
        className="flex-1 min-w-0 flex items-center gap-2 text-left"
        style={{ color: "inherit" }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full flex-none"
          style={{ backgroundColor: "var(--c-fg-5, #94a3b8)" }}
        />
        <span className="flex-1 min-w-0 truncate">{view.name}</span>
        {count !== undefined && (
          <span
            className={`text-[10px] tabular-nums font-semibold ${countTextClass(theme, active)}`}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (window.confirm(`Delete saved view "${view.name}"?`)) {
            remove.mutate();
          }
        }}
        disabled={remove.isPending}
        className={`opacity-0 group-hover:opacity-100 transition-opacity flex-none ${
          dk
            ? "text-white/45 hover:text-white/85"
            : "text-foreground/55 hover:text-foreground"
        }`}
        aria-label={`Delete ${view.name}`}
        title="Delete view"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
