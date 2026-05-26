import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { fetchTagAnalytics, type TagAnalytics } from "../../api/client";

type Props = { days?: number };

export function TagAnalyticsPanel({ days = 30 }: Props) {
  const [data, setData] = useState<TagAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTagAnalytics(days)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load tags");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const maxTopCount = data?.topTags?.[0]?.count ?? 0;
  const maxMttr =
    data?.mttrByTag?.reduce((max, row) => Math.max(max, row.medianHours), 0) ?? 0;

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-violet-500" />
              Tag analytics
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Last {days} days · AI + manual tags
          </p>
        </div>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : error ? (
        <p className="py-8 text-center text-sm text-red-600">{error}</p>
      ) : !data ||
        (data.topTags.length === 0 &&
          data.mttrByTag.length === 0 &&
          data.perTeam.length === 0) ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No tag data yet for this window.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Top tags */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Top tags by volume
            </h3>
            {data.topTags.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data</p>
            ) : (
              <ul className="space-y-1.5">
                {data.topTags.slice(0, 12).map((tag) => (
                  <li key={tag.name} className="flex items-center gap-2 text-sm">
                    <span className="w-32 truncate font-medium text-foreground">
                      {tag.name}
                    </span>
                    <div className="flex-1 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-primary"
                        style={{
                          width: maxTopCount
                            ? `${(tag.count / maxTopCount) * 100}%`
                            : "0%",
                        }}
                      />
                    </div>
                    <span className="w-8 text-right text-xs text-muted-foreground">
                      {tag.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* MTTR */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Median resolution time
            </h3>
            {data.mttrByTag.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Need at least 3 resolved tickets per tag
              </p>
            ) : (
              <ul className="space-y-1.5">
                {data.mttrByTag.slice(0, 12).map((row) => (
                  <li key={row.name} className="flex items-center gap-2 text-sm">
                    <span className="w-32 truncate font-medium text-foreground">
                      {row.name}
                    </span>
                    <div className="flex-1 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-amber-500"
                        style={{
                          width: maxMttr
                            ? `${(row.medianHours / maxMttr) * 100}%`
                            : "0%",
                        }}
                      />
                    </div>
                    <span className="w-16 text-right text-xs text-muted-foreground">
                      {row.medianHours.toFixed(1)}h
                      <span className="ml-1 text-[10px]">({row.sampleSize})</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Per-team */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Top tags per team
            </h3>
            {data.perTeam.length === 0 ? (
              <p className="text-xs text-muted-foreground">No data</p>
            ) : (
              <ul className="space-y-3">
                {data.perTeam.map((team) => (
                  <li key={team.teamName}>
                    <div className="mb-1 text-xs font-semibold text-foreground">
                      {team.teamName}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {team.tags.map((t) => (
                        <span
                          key={`${team.teamName}:${t.name}`}
                          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]"
                        >
                          <span className="font-medium">{t.name}</span>
                          <span className="text-muted-foreground">
                            {t.count}
                          </span>
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
