import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Sparkles, Tag as TagIcon } from "lucide-react";
import { fetchAgentProfile, type AgentProfile } from "../api/client";
import { TopBar } from "../components/TopBar";
import { useHeaderContext } from "../contexts/HeaderContext";

function fmtHours(h: number | null) {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
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
                <div className="flex items-center gap-3">
                  <Link
                    to="/admin/agents"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Agents
                  </Link>
                  <div>
                    <h1 className="text-xl font-semibold text-foreground">
                      {profile?.user.displayName ?? "Agent"}
                    </h1>
                    <p className="text-sm text-muted-foreground">
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

      <div className="mx-auto w-full max-w-none px-6 py-6 space-y-6">
        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : error ? (
          <p className="py-12 text-center text-sm text-red-600">{error}</p>
        ) : !profile ? null : (
          <>
            {/* Identity strip */}
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-base font-semibold text-white">
                  {profile.user.displayName
                    .split(" ")
                    .map((p) => p[0] ?? "")
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-base font-semibold">
                    {profile.user.displayName}
                    {!profile.user.isActive ? (
                      <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        inactive
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {profile.user.email} · {profile.user.role}
                    {profile.user.primaryTeamName
                      ? ` · ${profile.user.primaryTeamName}`
                      : ""}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {profile.user.teamMemberships.map((m) => (
                      <span
                        key={m.teamId}
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {m.teamName} · {m.role}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="ml-auto text-right text-xs text-muted-foreground">
                  Last activity {fmtDate(profile.timings.lastActivityAt)}
                </div>
              </div>
            </div>

            {/* KPI cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <KpiCard label="Open" value={profile.counts.open} />
              <KpiCard label="Resolved" value={profile.counts.resolved} />
              <KpiCard label="Reopened" value={profile.counts.reopened} />
              <KpiCard
                label="Median resolution"
                value={fmtHours(profile.timings.medianResolutionHours)}
              />
              <KpiCard
                label="SLA hit rate"
                value={
                  profile.timings.slaCompliancePct != null
                    ? `${profile.timings.slaCompliancePct}%`
                    : "—"
                }
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
                <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                  <h2 className="mb-3 text-sm font-semibold">By priority</h2>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-1 text-left">Priority</th>
                        <th className="py-1 text-right">Open</th>
                        <th className="py-1 text-right">Resolved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sevList.map((sev) => (
                        <tr key={sev} className="border-t border-border">
                          <td className="py-1.5 font-medium">{sev}</td>
                          <td className="py-1.5 text-right">
                            {profile.bySev[sev].open}
                          </td>
                          <td className="py-1.5 text-right text-muted-foreground">
                            {profile.bySev[sev].resolved}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-3 text-xs text-muted-foreground">
                    Median first response:{" "}
                    {fmtHours(profile.timings.medianFirstResponseHours)}
                  </div>
                </div>

                {/* Daily resolved chart */}
                <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                  <h2 className="mb-3 text-sm font-semibold">
                    Daily resolved (last 30 days)
                  </h2>
                  {profile.dailyResolved.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No resolved tickets in this window.
                    </p>
                  ) : (
                    <div className="flex items-end gap-1.5 h-32">
                      {profile.dailyResolved.map((d) => {
                        const heightPct =
                          maxDaily > 0 ? (d.count / maxDaily) * 100 : 0;
                        return (
                          <div
                            key={d.date}
                            className="flex flex-1 flex-col items-center justify-end"
                            title={`${d.date}: ${d.count} resolved`}
                          >
                            <div
                              className="w-full rounded-t bg-primary"
                              style={{ height: `${heightPct}%`, minHeight: "2px" }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Recent tickets */}
                <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                  <h2 className="mb-3 text-sm font-semibold">Recent tickets</h2>
                  {profile.recentTickets.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tickets.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {profile.recentTickets.map((t) => (
                        <li key={t.id} className="py-2">
                          <Link
                            to={`/tickets/${t.id}`}
                            className="flex items-center justify-between gap-3 text-sm hover:bg-accent/40 rounded px-2 -mx-2 py-1"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  {t.displayId ?? `#${t.number}`}
                                </span>
                                <span className="font-medium truncate">
                                  {t.subject}
                                </span>
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {t.priority} · {t.status} · updated{" "}
                                {fmtDate(t.updatedAt)}
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {t.resolvedAt ? "✓ resolved" : "open"}
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
                <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                  <h2 className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold">
                    <TagIcon className="h-4 w-4 text-sky-500" />
                    Top tags worked
                  </h2>
                  {profile.topTags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tags yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {profile.topTags.map((t) => (
                        <li
                          key={t.name}
                          className="flex items-center gap-2 text-sm"
                        >
                          <span className="w-28 truncate font-medium">
                            {t.name}
                          </span>
                          <div className="flex-1 rounded-full bg-muted">
                            <div
                              className="h-2 rounded-full bg-sky-500"
                              style={{
                                width: maxTagCount
                                  ? `${(t.count / maxTagCount) * 100}%`
                                  : "0%",
                              }}
                            />
                          </div>
                          <span className="w-8 text-right text-xs text-muted-foreground">
                            {t.count}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Hints / context */}
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-5 text-sm dark:border-violet-500/40 dark:bg-violet-500/10">
                  <h2 className="mb-2 inline-flex items-center gap-1.5 font-semibold text-violet-700 dark:text-violet-300">
                    <Sparkles className="h-4 w-4" />
                    Context
                  </h2>
                  <ul className="space-y-1.5 text-violet-900 dark:text-violet-200">
                    <li>
                      MTTR is the median time from ticket creation to resolution
                      for this agent (all-time).
                    </li>
                    <li>
                      SLA hit rate counts only resolved tickets that had a due
                      date set; non-SLA tickets are excluded.
                    </li>
                    <li>
                      Reopened reflects current count — a ticket reopened then
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

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      {hint ? (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}
