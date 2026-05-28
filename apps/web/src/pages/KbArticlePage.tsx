import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Lock, MessageCirclePlus } from "lucide-react";
import { fetchKbArticle, type KbArticleDetail } from "../api/client";
import { TopBar } from "../components/TopBar";
import { EmptyState } from "../components/ui/EmptyState";
import { useHeaderContext } from "../contexts/HeaderContext";
import { handleApiError } from "../utils/handleApiError";
import { renderArticleMarkdown } from "../utils/articleMarkdown";

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
}

export function KbArticlePage() {
  const headerCtx = useHeaderContext();
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const [article, setArticle] = useState<KbArticleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchKbArticle(slug)
      .then((data) => {
        if (!cancelled) setArticle(data);
      })
      .catch((err) => {
        if (!cancelled) setError(handleApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

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
                <button
                  type="button"
                  onClick={() => navigate("/help")}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Help Center
                </button>
              }
            />
          ) : null}
        </div>
      </div>

      <div className="mx-auto max-w-3xl p-6">
        {loading ? (
          <div className="space-y-3">
            <div className="h-8 w-2/3 skeleton-shimmer rounded" />
            <div className="h-4 w-1/3 skeleton-shimmer rounded" />
            <div className="mt-6 h-64 w-full skeleton-shimmer rounded-xl" />
          </div>
        ) : error || !article ? (
          <EmptyState
            icon={<ArrowLeft className="h-6 w-6" />}
            title="Article not available"
            description={
              error ?? "This article may have been moved or unpublished."
            }
            action={
              <Link
                to="/help"
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Back to Help Center
              </Link>
            }
          />
        ) : (
          <article>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {article.category && (
                <span className="rounded-md bg-accent px-2 py-0.5 font-medium text-foreground">
                  {article.category.name}
                </span>
              )}
              {article.isInternal && (
                <span className="inline-flex items-center gap-1 rounded-md bg-purple-100 px-2 py-0.5 font-medium text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
                  <Lock className="h-3 w-3" /> Internal
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              {article.title}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {article.author?.displayName
                ? `By ${article.author.displayName} · `
                : ""}
              Updated {fmtDate(article.updatedAt)}
            </p>

            <div
              className="kb-article prose-sm mt-6 max-w-none text-sm leading-relaxed text-foreground"
              dangerouslySetInnerHTML={{
                __html: renderArticleMarkdown(article.content),
              }}
            />

            {article.related && article.related.length > 0 && (
              <div className="mt-10 border-t border-border pt-6">
                <h2 className="mb-3 text-sm font-semibold text-foreground">
                  Related articles
                </h2>
                <div className="space-y-1.5">
                  {article.related.map((r) => (
                    <Link
                      key={r.id}
                      to={`/help/${r.slug}`}
                      className="block rounded-lg px-3 py-2 text-sm text-primary hover:bg-muted"
                    >
                      {r.title}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-10 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-4">
              <p className="text-sm text-muted-foreground">
                Didn’t find what you need?
              </p>
              <button
                type="button"
                onClick={() => navigate("/submit")}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90"
              >
                <MessageCirclePlus className="h-4 w-4" />
                Open a ticket
              </button>
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
