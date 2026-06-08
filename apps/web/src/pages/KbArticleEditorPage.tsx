import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Lock } from "lucide-react";
import {
  createKbArticle,
  fetchKbArticle,
  fetchKbCategories,
  updateKbArticle,
  type KbArticleStatus,
  type KbCategoryRef,
} from "../api/client";
import { ArticleEditor } from "../components/kb/ArticleEditor";
import { useToast } from "../hooks/useToast";
import { handleApiError } from "../utils/handleApiError";

export function KbArticleEditorPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { slug } = useParams<{ slug: string }>();
  const isEdit = Boolean(slug);

  const [id, setId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<KbArticleStatus>("DRAFT");
  const [isInternal, setIsInternal] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<KbCategoryRef[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchKbCategories({ includeInactive: true })
      .then((r) => setCategories(r.data))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    fetchKbArticle(slug)
      .then((a) => {
        if (cancelled) return;
        setId(a.id);
        setTitle(a.title);
        setSummary(a.summary ?? "");
        setContent(a.content);
        setStatus(a.status);
        setIsInternal(a.isInternal);
        setCategoryId(a.categoryId ?? "");
      })
      .catch((err) => toast.error(handleApiError(err)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, toast]);

  async function handleSave(publish?: boolean) {
    if (!title.trim()) {
      toast.error("Give the article a title.");
      return;
    }
    if (!content.trim()) {
      toast.error("Article content can't be empty.");
      return;
    }
    const nextStatus: KbArticleStatus = publish ? "PUBLISHED" : status;
    setSaving(true);
    try {
      if (isEdit && id) {
        await updateKbArticle(id, {
          title: title.trim(),
          summary: summary.trim() || null,
          content,
          status: nextStatus,
          isInternal,
          categoryId: categoryId || null,
        });
        toast.success(publish ? "Article published." : "Article saved.");
      } else {
        await createKbArticle({
          title: title.trim(),
          summary: summary.trim() || undefined,
          content,
          status: nextStatus,
          isInternal,
          categoryId: categoryId || undefined,
        });
        toast.success(publish ? "Article published." : "Draft saved.");
      }
      navigate("/admin/kb");
    } catch (err) {
      toast.error(handleApiError(err));
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground text-sm focus:border-transparent focus:ring-2 focus:ring-ring";

  return (
    <section className="min-h-full bg-background animate-fade-in">
      {/* Sticky action bar */}
      <div className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-6 py-3">
          <button
            type="button"
            onClick={() => navigate("/admin/kb")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave(false)}
              disabled={saving}
              className="rounded-lg border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              onClick={() => void handleSave(true)}
              disabled={saving}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
            >
              Publish
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] px-6 py-6">
        {loading ? (
          <div className="space-y-4">
            <div className="h-10 w-2/3 skeleton-shimmer rounded" />
            <div className="h-80 w-full skeleton-shimmer rounded-xl" />
          </div>
        ) : (
          <div className="space-y-5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Article title"
              className="w-full border-0 bg-transparent text-3xl font-bold text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-0"
            />

            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Short summary shown in lists and search (optional)"
              className={`${inputClass} w-full px-3 py-2`}
            />

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Category</span>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className={`${inputClass} px-2.5 py-1.5`}
                >
                  <option value="">No category</option>
                  {categories
                    .filter((c) => c.isActive)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Status</span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as KbArticleStatus)}
                  className={`${inputClass} px-2.5 py-1.5`}
                >
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                </select>
              </label>
              <label className="ml-auto flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={isInternal}
                  onChange={(e) => setIsInternal(e.target.checked)}
                />
                <span className="inline-flex items-center gap-1">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  Internal (agents only)
                </span>
              </label>
            </div>

            <ArticleEditor value={content} onChange={setContent} />
          </div>
        )}
      </div>
    </section>
  );
}
