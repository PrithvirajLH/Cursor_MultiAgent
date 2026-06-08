import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Tag as TagIcon,
  Info,
  Inbox,
  CheckCircle2,
  RotateCcw,
  Clock,
  Gauge,
} from "lucide-react";
import { fetchAgentProfile, type AgentProfile } from "../api/client";
import { TopBar } from "../components/TopBar";
import { StatCard, type StatTone } from "../components/ui/StatCard";
import { useHeaderContext } from "../contexts/HeaderContext";

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
const SEV_DOT: Record<string, string> = {
  SEV1: "bg-red-500",
  SEV2: "bg-orange-500",
  SEV3: "bg-amber-500",
  SEV4: "bg-blue-500",
};

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
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
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
function toTitleCase(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
function statusTone(status: string): string {
  if (status === "RESOLVED" || status === "CLOSED")
    return "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300";
  if (status.startsWith("WAITING"))
    return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  if (status === "REOPENED")
    return "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300";
  return "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300";
}

export function AgentProfilePage() {
  const headerCtx = useHeaderContext();
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAgentProfile(id)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load agent");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const maxDaily =
    profile?.dailyResolved.reduce((max, d) => Math.max(max, d.count), 0) ?? 0;
  const maxTagCount = profile?.topTags?.[0]?.count ?? 0;

  const sevList: ("SEV1" | "SEV2" | "SEV3" | "SEV4")[] = useMemo(
    () => ["SEV1", "SEV2", "SEV3", "SEV4"],
    [],
  );

  const slaTone: StatTone = useMemo(() => {
    const pct = profile?.timings.slaCompliancePct;
    if (pct == null) return "neutral";
    return pct >= 90 ? "green" : pct >= 75 ? "amber" : "red";
  }, [profile]);

  return (
    <section className="min-h-full bg-background animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto max-w-[1600px] px-6 py-4">
          {headerCtx ? (
            <TopBar
              title={headerCtx.title}
              subtitle={headerCtx.subtitle}
              currentEmail={headerCtx.currentEmail}
              onOpenSearch={headerCtx.onOpenSearch}
              notificationProps={headerCtx.notificationProps}
              leftContent={
                <div className="flex items-center gap-3">
                  <Link
                    to="/admin/agents"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Agents
                  </Link>
                  <div className="min-w-0">
                    <h1 className="truncate text-xl font-semibold text-foreground">
                      {profile?.user.displayName ?? "Agent"}
                    </h1>
                    <p className="truncate text-sm text-muted-foreground">
                      {profile?.user.email ?? ""}
                    </p>
                  </div>
                </div>
              }
            />
          ) : (
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                {profile?.user.displayName ?? "Agent"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {profile?.user.email ?? ""}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] space-y-6 p-6">
        {loading ? (
          <>
            <div className="h-24 skeleton-shimmer rounded-xl" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-24 skeleton-shimmer rounded-xl" />
              ))}
            </div>
            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="h-64 skeleton-shimmer rounded-xl" />
              <div className="h-64 skeleton-shimmer rounded-xl" />
            </div>
          </>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        ) : !profile ? null : (
          <>
            {/* Identity */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center gap-4">
                <span
                  className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full text-lg font-semibold ${avatarTone(
                    id ?? profile.user.email,
                  )} ${!profile.user.isActive ? "opacity-50" : ""}`}
                >
                  {initials(profile.user.displayName)}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-foreground">
                      {profile.user.displayName}
                    </span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${ROLE_BADGE[profile.user.role] ?? ROLE_BADGE.AGENT}`}
                    >
                      {ROLE_LABEL[profile.user.role] ?? profile.user.role}
                    </span>
                    {!profile.user.isActive && (
                      <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {profile.user.email}
                    {profile.user.primaryTeamName
                      ? ` · ${profile.user.primaryTeamName}`
                      : ""}
                  </div>
                  {profile.user.teamMemberships.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {profile.user.teamMemberships.map((m) => (
                        <span
                          key={m.teamId}
                          className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                        >
                          {m.teamName} · {m.role}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="ml-auto text-right text-xs text-muted-foreground">
                  <div className="uppercase tracking-wide">Last active</div>
                  <div className="mt-0.5 text-sm font-medium text-foreground">
                    {fmtDate(profile.timings.lastActivityAt)}
                  </div>
                </div>
              </div>
            </div>

            {/* KPIs */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard
                label="Open"
                value={profile.counts.open}
                icon={Inbox}
                tone="amber"
              />
              <StatCard
                label="Resolved"
                value={profile.counts.resolved}
                icon={CheckCircle2}
                tone="green"
              />
              <StatCard
                label="Reopened"
                value={profile.counts.reopened}
                icon={RotateCcw}
                tone={profile.counts.reopened > 0 ? "red" : "neutral"}
              />
              <StatCard
                label="Median Resolution"
                value={fmtHours(profile.timings.medianResolutionHours)}
                icon={Clock}
                tone="blue"
              />
              <StatCard
                label="SLA Hit Rate"
                value={
                  profile.timings.slaCompliancePct != null
                    ? `${profile.timings.slaCompliancePct}%`
                    : "—"
                }
                icon={Gauge}
                tone={slaTone}
                hint={
                  profile.timings.slaSampleSize > 0
                    ? `${profile.timings.slaSampleSize} resolved tickets`
                    : "no data"
                }
              />
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              {/* Left column */}
              <div className="space-y-6">
                {/* By priority */}
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="flex items-center justify-between border-b border-border px-5 py-3">
                    <h2 className="text-sm font-semibold text-foreground">
                      By priority
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      Median first response:{" "}
                      {fmtHours(profile.timings.medianFirstResponseHours)}
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-5 py-2 text-left">Priority</th>
                        <th className="px-5 py-2 text-right">Open</th>
                        <th className="px-5 py-2 text-right">Resolved</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sevList.map((sev) => (
                        <tr key={sev} className="hover:bg-muted">
                          <td className="px-5 py-2.5">
                            <span className="inline-flex items-center gap-2 font-medium text-foreground">
                              <span
                                className={`h-2 w-2 rounded-full ${SEV_DOT[sev]}`}
                              />
                              {sev}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-right tabular-nums text-foreground">
                            {profile.bySev[sev].open}
                          </td>
                          <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">
                            {profile.bySev[sev].resolved}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Daily resolved chart */}
                <div className="rounded-xl border border-border bg-card p-5">
                  <h2 className="mb-4 text-sm font-semibold text-foreground">
                    Daily resolved{" "}
                    <span className="font-normal text-muted-foreground">
                      · last 30 days
                    </span>
                  </h2>
                  {profile.dailyResolved.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No resolved tickets in this window.
                    </p>
                  ) : (
                    <div className="flex h-32 items-end gap-1.5">
                      {profile.dailyResolved.map((d) => {
                        const heightPct =
                          maxDaily > 0 ? (d.count / maxDaily) * 100 : 0;
                        return (
                          <div
                            key={d.date}
                            className="group flex flex-1 flex-col items-center justify-end"
                            title={`${d.date}: ${d.count} resolved`}
                          >
                            <div
                              className="w-full rounded-t bg-primary/70 transition-colors group-hover:bg-primary"
                              style={{
                                height: `${heightPct}%`,
                                minHeight: "2px",
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Recent tickets */}
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="border-b border-border px-5 py-3">
                    <h2 className="text-sm font-semibold text-foreground">
                      Recent tickets
                    </h2>
                  </div>
                  {profile.recentTickets.length === 0 ? (
                    <p className="px-5 py-4 text-xs text-muted-foreground">
                      No tickets.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {profile.recentTickets.map((t) => (
                        <li key={t.id}>
                          <Link
                            to={`/tickets/${t.id}`}
                            className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  {t.displayId ?? `#${t.number}`}
                                </span>
                                <span className="truncate font-medium text-foreground">
                                  {t.subject}
                                </span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${SEV_DOT[t.priority] ?? "bg-slate-400"}`}
                                  />
                                  {t.priority}
                                </span>
                                <span>·</span>
                                <span>updated {fmtDate(t.updatedAt)}</span>
                              </div>
                            </div>
                            <span
                              className={`flex-shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${statusTone(t.status)}`}
                            >
                              {toTitleCase(t.status)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Right column */}
              <div className="space-y-6">
                {/* Top tags */}
                <div className="rounded-xl border border-border bg-card p-5">
                  <h2 className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <TagIcon className="h-4 w-4 text-sky-500" />
                    Top tags worked
                  </h2>
                  {profile.topTags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tags yet.</p>
                  ) : (
                    <ul className="space-y-2.5">
                      {profile.topTags.map((t) => (
                        <li key={t.name} className="flex items-center gap-2 text-sm">
                          <span className="w-28 truncate font-medium text-foreground">
                            {t.name}
                          </span>
                          <div className="h-2 flex-1 rounded-full bg-accent">
                            <div
                              className="h-2 rounded-full bg-sky-500"
                              style={{
                                width: maxTagCount
                                  ? `${(t.count / maxTagCount) * 100}%`
                                  : "0%",
                              }}
                            />
                          </div>
                          <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
                            {t.count}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* About these metrics */}
                <div className="rounded-xl border border-border bg-muted/40 p-5 text-sm">
                  <h2 className="mb-2 inline-flex items-center gap-1.5 font-semibold text-foreground">
                    <Info className="h-4 w-4 text-muted-foreground" />
                    About these metrics
                  </h2>
                  <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                    <li>
                      <span className="font-medium text-foreground">
                        Median resolution
                      </span>{" "}
                      is the median time from ticket creation to resolution for
                      this agent (all-time).
                    </li>
                    <li>
                      <span className="font-medium text-foreground">
                        SLA hit rate
                      </span>{" "}
                      counts only resolved tickets that had a due date set;
                      non-SLA tickets are excluded.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">
                        Reopened
                      </span>{" "}
                      reflects the current count — a ticket reopened then
                      re-resolved no longer shows here.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
