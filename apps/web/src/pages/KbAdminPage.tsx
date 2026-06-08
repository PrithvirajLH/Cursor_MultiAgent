import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  CheckCircle2,
  Eye,
  FileText,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  createKbCategory,
  deleteKbArticle,
  deleteKbCategory,
  fetchKbArticles,
  fetchKbCategories,
  updateKbCategory,
  type KbArticleSummary,
  type KbCategoryRef,
} from "../api/client";
import { TopBar } from "../components/TopBar";
import { StatCard } from "../components/ui/StatCard";
import { PageTabs } from "../components/ui/PageTabs";
import { EmptyState } from "../components/ui/EmptyState";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useHeaderContext } from "../contexts/HeaderContext";
import { useToast } from "../hooks/useToast";
import { handleApiError } from "../utils/handleApiError";

type TabKey = "articles" | "categories";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

export function KbAdminPage() {
  const headerCtx = useHeaderContext();
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>("articles");

  const [articles, setArticles] = useState<KbArticleSummary[]>([]);
  const [categories, setCategories] = useState<KbCategoryRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<KbArticleSummary | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [catDeleteTarget, setCatDeleteTarget] = useState<KbCategoryRef | null>(
    null,
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([
        fetchKbArticles({ includeDrafts: true }),
        fetchKbCategories({ includeInactive: true }),
      ]);
      setArticles(a.data);
      setCategories(c.data);
    } catch (err) {
      toast.error(handleApiError(err));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const categoryName = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (map.get(id) ?? "—") : "—");
  }, [categories]);

  const stats = useMemo(() => {
    const published = articles.filter((a) => a.status === "PUBLISHED").length;
    return {
      total: articles.length,
      published,
      drafts: articles.length - published,
      internal: articles.filter((a) => a.isInternal).length,
    };
  }, [articles]);

  const visibleArticles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return articles
      .filter(
        (a) =>
          !q ||
          a.title.toLowerCase().includes(q) ||
          (a.summary ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [articles, search]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteKbArticle(deleteTarget.id);
      toast.success("Article deleted.");
      setDeleteTarget(null);
      await reload();
    } catch (err) {
      toast.error(handleApiError(err));
    } finally {
      setDeleting(false);
    }
  }

  async function handleCreateCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      await createKbCategory({ name });
      setNewCategoryName("");
      toast.success("Category created.");
      await reload();
    } catch (err) {
      toast.error(handleApiError(err));
    }
  }

  async function toggleCategoryActive(cat: KbCategoryRef) {
    try {
      await updateKbCategory(cat.id, { isActive: !cat.isActive });
      await reload();
    } catch (err) {
      toast.error(handleApiError(err));
    }
  }

  async function handleDeleteCategory() {
    if (!catDeleteTarget) return;
    try {
      await deleteKbCategory(catDeleteTarget.id);
      toast.success("Category deleted.");
      setCatDeleteTarget(null);
      await reload();
    } catch (err) {
      toast.error(handleApiError(err));
    }
  }

  const inputClass =
    "rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground text-sm focus:border-transparent focus:ring-2 focus:ring-ring";

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
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold text-foreground">
                    Knowledge Base
                  </h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Author help articles and internal runbooks.
                  </p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground">
                Knowledge Base
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Author help articles and internal runbooks.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-border bg-card">
          <div className="mx-auto max-w-[1600px] px-6 py-3">
            <div className="flex items-center justify-between">
              <PageTabs<TabKey>
                tabs={[
                  { id: "articles", label: "Articles", icon: FileText },
                  { id: "categories", label: "Categories", icon: BookOpen },
                ]}
                active={tab}
                onChange={setTab}
              />
              {tab === "articles" && (
                <button
                  type="button"
                  onClick={() => navigate("/admin/kb/new")}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" />
                  New Article
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] p-6">
        {tab === "articles" ? (
          <>
            <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard label="Total" value={stats.total} icon={FileText} tone="blue" />
              <StatCard
                label="Published"
                value={stats.published}
                icon={CheckCircle2}
                tone="green"
              />
              <StatCard label="Drafts" value={stats.drafts} icon={Pencil} tone="amber" />
              <StatCard
                label="Internal"
                value={stats.internal}
                icon={Lock}
                tone="purple"
              />
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="relative min-w-[240px] flex-1">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search articles…"
                  className={`${inputClass} w-full py-2 pl-9 pr-3`}
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {loading ? (
                <div className="divide-y divide-border">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                      <div className="h-4 w-48 skeleton-shimmer rounded" />
                      <div className="ml-auto h-4 w-20 skeleton-shimmer rounded" />
                    </div>
                  ))}
                </div>
              ) : visibleArticles.length === 0 ? (
                <EmptyState
                  bordered={false}
                  icon={<BookOpen className="h-6 w-6" />}
                  title={search ? "No matching articles" : "No articles yet"}
                  description={
                    search
                      ? "Try a different search term."
                      : "Write your first help article so employees can self-serve."
                  }
                  action={
                    !search ? (
                      <button
                        type="button"
                        onClick={() => navigate("/admin/kb/new")}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90"
                      >
                        <Plus className="h-4 w-4" /> New Article
                      </button>
                    ) : undefined
                  }
                />
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5">Title</th>
                      <th className="w-40 px-4 py-2.5">Category</th>
                      <th className="w-28 px-4 py-2.5">Status</th>
                      <th className="w-20 px-4 py-2.5 text-right">Views</th>
                      <th className="w-32 px-4 py-2.5">Updated</th>
                      <th className="w-24 px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleArticles.map((a) => (
                      <tr
                        key={a.id}
                        onClick={() => navigate(`/admin/kb/${a.slug}/edit`)}
                        className="cursor-pointer hover:bg-muted"
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">
                              {a.title}
                            </span>
                            {a.isInternal && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
                                <Lock className="h-3 w-3" /> Internal
                              </span>
                            )}
                          </div>
                          {a.summary && (
                            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                              {a.summary}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {categoryName(a.categoryId)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                              a.status === "PUBLISHED"
                                ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                                : "bg-accent text-muted-foreground"
                            }`}
                          >
                            {a.status === "PUBLISHED" ? "Published" : "Draft"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Eye className="h-3.5 w-3.5" />
                            {a.viewCount}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {fmtDate(a.updatedAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div
                            className="flex items-center justify-end gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => navigate(`/admin/kb/${a.slug}/edit`)}
                              aria-label="Edit article"
                              className="rounded p-1.5 text-muted-foreground hover:bg-blue-50 hover:text-primary dark:hover:bg-blue-500/10"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(a)}
                              aria-label="Delete article"
                              className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3">
              <input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreateCategory();
                }}
                placeholder="New category name…"
                className={`${inputClass} flex-1 px-3 py-2`}
              />
              <button
                type="button"
                onClick={() => void handleCreateCategory()}
                disabled={!newCategoryName.trim()}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {categories.length === 0 ? (
                <EmptyState
                  bordered={false}
                  icon={<BookOpen className="h-6 w-6" />}
                  title="No categories yet"
                  description="Group articles into categories so they're easy to browse."
                />
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5">Category</th>
                      <th className="w-24 px-4 py-2.5 text-right">Articles</th>
                      <th className="w-28 px-4 py-2.5">Status</th>
                      <th className="w-24 px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {categories.map((c) => (
                      <tr key={c.id} className="hover:bg-muted">
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          {c.name}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                          {c._count?.articles ?? 0}
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => void toggleCategoryActive(c)}
                            className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                              c.isActive
                                ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                                : "bg-accent text-muted-foreground"
                            }`}
                          >
                            {c.isActive ? "Active" : "Hidden"}
                          </button>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => setCatDeleteTarget(c)}
                              aria-label="Delete category"
                              className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete article?"
        destructive
        confirmLabel="Delete"
        loading={deleting}
        message={
          <>
            Delete <strong>{deleteTarget?.title}</strong>? This can’t be undone.
          </>
        }
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(catDeleteTarget)}
        title="Delete category?"
        destructive
        confirmLabel="Delete"
        message={
          <>
            Delete <strong>{catDeleteTarget?.name}</strong>? Articles in it will
            keep existing but become uncategorized.
          </>
        }
        onConfirm={() => void handleDeleteCategory()}
        onCancel={() => setCatDeleteTarget(null)}
      />
    </section>
  );
}
