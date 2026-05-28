import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  Lock,
  Search,
  ArrowRight,
  FileText,
  Eye,
} from "lucide-react";
import {
  fetchKbArticles,
  fetchKbCategories,
  type KbArticleSummary,
  type KbCategoryRef,
} from "../api/client";
import { EmptyState } from "../components/ui/EmptyState";
import { handleApiError } from "../utils/handleApiError";

export function KbBrowsePage() {
  const navigate = useNavigate();
  const [articles, setArticles] = useState<KbArticleSummary[]>([]);
  const [categories, setCategories] = useState<KbCategoryRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | "all">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, c] = await Promise.all([
        fetchKbArticles({
          q: search.trim() || undefined,
          categoryId: activeCategory === "all" ? undefined : activeCategory,
        }),
        fetchKbCategories(),
      ]);
      setArticles(a.data);
      setCategories(c.data);
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setLoading(false);
    }
  }, [search, activeCategory]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);

  const articleCountByCat = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of articles) {
      if (a.categoryId) map.set(a.categoryId, (map.get(a.categoryId) ?? 0) + 1);
    }
    return map;
  }, [articles]);

  const isSearching = search.trim().length > 0 || activeCategory !== "all";

  return (
    <section className="min-h-full bg-background animate-fade-in">
      {/* Hero */}
      <div className="border-b border-border bg-gradient-to-b from-primary/5 to-transparent">
        <div className="mx-auto max-w-3xl px-6 py-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <BookOpen className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            How can we help?
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Search our knowledge base for answers, guides, and how-tos.
          </p>
          <div className="relative mx-auto mt-6 max-w-xl">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search for articles…"
              className="w-full rounded-xl border border-border bg-card py-3.5 pl-12 pr-4 text-sm text-foreground shadow-sm placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-8">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Category filter chips */}
        {categories.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveCategory("all")}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                activeCategory === "all"
                  ? "bg-foreground text-background"
                  : "border border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              All articles
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCategory(c.id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  activeCategory === c.id
                    ? "bg-primary text-white"
                    : "border border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {c.name}
                {articleCountByCat.get(c.id) ? (
                  <span className="ml-1.5 opacity-60">
                    {articleCountByCat.get(c.id)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-24 skeleton-shimmer rounded-xl border border-border"
              />
            ))}
          </div>
        ) : articles.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-6 w-6" />}
            title={
              isSearching ? "No articles match your search" : "No articles yet"
            }
            description={
              isSearching
                ? "Try different keywords — or open a ticket and we'll help."
                : "Help articles will appear here once they're published."
            }
            action={
              <button
                type="button"
                onClick={() => navigate("/submit")}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90"
              >
                Open a ticket
              </button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {articles.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => navigate(`/help/${a.slug}`)}
                className="group flex flex-col rounded-xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="h-4 w-4" />
                  </span>
                  {a.category && (
                    <span className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {a.category.name}
                    </span>
                  )}
                  {a.isInternal && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
                      <Lock className="h-3 w-3" /> Internal
                    </span>
                  )}
                </div>
                <h3 className="font-semibold text-foreground group-hover:text-primary">
                  {a.title}
                </h3>
                {a.summary && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {a.summary}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Eye className="h-3.5 w-3.5" />
                    {a.viewCount} {a.viewCount === 1 ? "view" : "views"}
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                    Read <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
