import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  type CategoryRef,
  updateCategory,
} from "../api/client";
import { TopBar } from "../components/TopBar";
import { useHeaderContext } from "../contexts/HeaderContext";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";
import {
  REALTIME_ADMIN_CHANGED_EVENT,
  type RealtimeAdminChangedEventPayload,
} from "../realtime/events";
import { handleApiError } from "../utils/handleApiError";

type CategoryForm = {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  parentId: string;
  isActive: boolean;
};

function toSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function emptyForm(): CategoryForm {
  return {
    id: null,
    name: "",
    slug: "",
    description: "",
    parentId: "",
    isActive: true,
  };
}

export function CategoriesPage({ role }: { role?: string } = {}) {
  const canEdit = role === "OWNER";
  const headerCtx = useHeaderContext();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<CategoryRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");

  const [showEditor, setShowEditor] = useState(false);
  const [form, setForm] = useState<CategoryForm>(emptyForm());
  const [deleteTarget, setDeleteTarget] = useState<CategoryRef | null>(null);
  const editorDialogRef = useRef<HTMLDivElement>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadCategories();
  }, []);

  useEffect(() => {
    const handleAdminChanged = (event: Event) => {
      const payload = (event as CustomEvent<RealtimeAdminChangedEventPayload>)
        .detail;
      if (payload?.scope !== "category") {
        return;
      }
      void loadCategories();
    };

    window.addEventListener(
      REALTIME_ADMIN_CHANGED_EVENT,
      handleAdminChanged as EventListener,
    );
    return () =>
      window.removeEventListener(
        REALTIME_ADMIN_CHANGED_EVENT,
        handleAdminChanged as EventListener,
      );
  }, []);

  async function loadCategories() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchCategories({ includeInactive: true });
      setCategories(
        [...response.data].sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setLoading(false);
    }
  }

  const parentOptions = useMemo(
    () =>
      categories
        .filter((category) => !category.parentId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [categories],
  );

  const childCountByParent = useMemo(() => {
    return categories.reduce(
      (acc, category) => {
        if (!category.parentId) return acc;
        acc[category.parentId] = (acc[category.parentId] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }, [categories]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return categories.filter((category) => {
      const matchSearch =
        !query ||
        category.name.toLowerCase().includes(query) ||
        category.slug.toLowerCase().includes(query) ||
        (category.description ?? "").toLowerCase().includes(query);
      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "active" ? category.isActive : !category.isActive);
      return matchSearch && matchStatus;
    });
  }, [categories, search, statusFilter]);

  function startCreate() {
    navigate("/categories/new");
  }

  function startEdit(category: CategoryRef) {
    setError(null);
    setNotice(null);
    setForm({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description ?? "",
      parentId: category.parentId ?? "",
      isActive: category.isActive,
    });
    setShowEditor(true);
  }

  function closeEditor() {
    setShowEditor(false);
    setForm(emptyForm());
  }

  useModalFocusTrap({
    open: showEditor,
    containerRef: editorDialogRef,
    onClose: closeEditor,
  });

  useModalFocusTrap({
    open: Boolean(deleteTarget),
    containerRef: deleteDialogRef,
    onClose: () => setDeleteTarget(null),
  });

  async function saveCategory() {
    if (!form.name.trim()) {
      setError("Category name is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (form.id) {
        const updated = await updateCategory(form.id, {
          name: form.name.trim(),
          slug: form.slug.trim() || toSlug(form.name) || undefined,
          description: form.description.trim() || null,
          parentId: form.parentId || null,
          isActive: form.isActive,
        });
        setCategories((prev) =>
          prev
            .map((category) =>
              category.id === updated.id ? updated : category,
            )
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        setNotice("Category updated.");
      } else {
        const created = await createCategory({
          name: form.name.trim(),
          slug: form.slug.trim() || toSlug(form.name) || undefined,
          description: form.description.trim() || undefined,
          parentId: form.parentId || undefined,
          isActive: form.isActive,
        });
        setCategories((prev) =>
          [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setNotice("Category created.");
      }
      closeEditor();
    } catch (err) {
      setError(handleApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(category: CategoryRef) {
    const hasChildren = categories.some(
      (item) => item.parentId === category.id,
    );
    if (hasChildren) {
      setError("Cannot delete a category that has subcategories.");
      setDeleteTarget(null);
      return;
    }

    setError(null);
    setNotice(null);
    try {
      await deleteCategory(category.id);
      setCategories((prev) => prev.filter((item) => item.id !== category.id));
      setDeleteTarget(null);
      setNotice("Category deleted.");
    } catch (err) {
      setError(handleApiError(err));
    }
  }

  function parentName(parentId: string | null | undefined): string {
    if (!parentId) return "None";
    return (
      categories.find((category) => category.id === parentId)?.name ?? parentId
    );
  }

  return (
    <section className="min-h-full bg-background animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto max-w-[1600px] py-4 px-6">
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
                    Categories
                  </h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Manage ticket taxonomy.
                  </p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground">
                Categories
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Manage ticket taxonomy.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] p-6">
        {error && (
          <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}
        {notice && (
          <div className="mb-5 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
            {notice}
          </div>
        )}

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search categories..."
              className="w-full rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value as "all" | "active" | "inactive",
              )
            }
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
            className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Clear
          </button>

          <button
            type="button"
            onClick={() => void loadCategories()}
            className="rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            Refresh
          </button>

          {canEdit ? (
            <button
              type="button"
              onClick={startCreate}
              className="inline-flex items-center space-x-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              <span>New Category</span>
            </button>
          ) : null}
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="mt-0.5 text-2xl font-bold text-primary">
              {categories.length}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Active</p>
            <p className="mt-0.5 text-2xl font-bold text-green-600">
              {categories.filter((category) => category.isActive).length}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Inactive</p>
            <p className="mt-0.5 text-2xl font-bold text-muted-foreground">
              {categories.filter((category) => !category.isActive).length}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Parent Categories</p>
            <p className="mt-0.5 text-2xl font-bold text-purple-600">
              {categories.filter((category) => !category.parentId).length}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted">
                <tr>
                  {[
                    "Name",
                    "Slug",
                    "Parent",
                    "Children",
                    "Status",
                    "Description",
                    "Actions",
                  ].map((heading) => (
                    <th
                      key={heading}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr
                      key={`skel-${i}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3">
                        <div className="h-4 w-6 skeleton-shimmer rounded" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 w-32 skeleton-shimmer rounded" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 w-24 skeleton-shimmer rounded" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 w-20 skeleton-shimmer rounded" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-5 w-14 skeleton-shimmer rounded-full" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 w-16 skeleton-shimmer rounded" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-4 w-12 skeleton-shimmer rounded" />
                      </td>
                    </tr>
                  ))
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center">
                      <p className="text-sm font-semibold text-foreground">
                        No categories found
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Try a different search or create a new category.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((category) => (
                    <tr
                      key={category.id}
                      className="transition-colors hover:bg-muted"
                    >
                      <td className="px-4 py-3 text-sm font-semibold text-foreground">
                        {category.name}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {category.slug}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {parentName(category.parentId)}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">
                        {childCountByParent[category.id] ?? 0}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-medium ${
                            category.isActive
                              ? "bg-green-500/10 text-green-400"
                              : "bg-accent text-muted-foreground"
                          }`}
                        >
                          {category.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {category.description || "—"}
                      </td>
                      <td className="px-4 py-3">
                        {canEdit ? (
                          <div className="flex items-center space-x-1">
                            <button
                              type="button"
                              onClick={() => startEdit(category)}
                              className="rounded p-1.5 text-muted-foreground hover:bg-blue-50 hover:text-primary"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(category)}
                              className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showEditor && form.id && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEditor();
          }}
        >
          <div
            ref={editorDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={form.id ? "Edit category" : "Create category"}
            tabIndex={-1}
            className="flex w-full max-w-lg flex-col rounded-xl bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <p className="text-base font-semibold text-foreground">
                {form.id ? "Edit Category" : "Create Category"}
              </p>
              <button
                type="button"
                onClick={closeEditor}
                className="text-muted-foreground hover:text-muted-foreground"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="space-y-4 p-6">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">
                  Name *
                </label>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className="w-full rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                  placeholder="e.g. Billing"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">
                  Slug
                </label>
                <input
                  value={form.slug}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, slug: event.target.value }))
                  }
                  className="w-full rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                  placeholder="auto-generated if empty"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  rows={3}
                  className="w-full rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                  placeholder="Short description..."
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">
                  Parent
                </label>
                <select
                  value={form.parentId}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      parentId: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                >
                  <option value="">No parent</option>
                  {parentOptions
                    .filter((category) => category.id !== form.id)
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                </select>
              </div>

              <label className="inline-flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      isActive: event.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded text-primary"
                />
                <span className="text-sm text-foreground">Active</span>
              </label>
            </div>

            <div className="flex justify-end space-x-3 rounded-b-xl border-t border-border bg-muted px-6 py-4">
              <button
                type="button"
                onClick={closeEditor}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveCategory()}
                disabled={saving}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/40"
              >
                {saving
                  ? "Saving..."
                  : form.id
                    ? "Save Category"
                    : "Create Category"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteTarget(null);
          }}
        >
          <div
            ref={deleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Delete category"
            tabIndex={-1}
            className="w-full max-w-md rounded-xl bg-card p-6 shadow-2xl"
          >
            <div className="mb-3 flex items-center space-x-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                Delete Category
              </h3>
            </div>
            <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
              Delete "{deleteTarget.name}"? You cannot delete categories that
              still have subcategories.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete(deleteTarget)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
