import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  createCategory,
  fetchCategories,
  type CategoryRef,
} from "../api/client";
import { TopBar } from "../components/TopBar";
import { useHeaderContext } from "../contexts/HeaderContext";
import { useToast } from "../hooks/useToast";
import { handleApiError } from "../utils/handleApiError";

type CategoryForm = {
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
    name: "",
    slug: "",
    description: "",
    parentId: "",
    isActive: true,
  };
}

export function NewCategoryPage() {
  const headerCtx = useHeaderContext();
  const toast = useToast();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<CategoryRef[]>([]);
  const [form, setForm] = useState<CategoryForm>(() => emptyForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchCategories({ includeInactive: true })
      .then((response) => {
        setCategories(
          [...response.data].sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch((err) => {
        const message = handleApiError(err);
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [toast]);

  const parentOptions = useMemo(
    () =>
      categories
        .filter((category) => !category.parentId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [categories],
  );

  async function handleSubmit() {
    if (!form.name.trim()) {
      const message = "Category name is required.";
      setError(message);
      toast.error(message);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await createCategory({
        name: form.name.trim(),
        slug: form.slug.trim() || toSlug(form.name) || undefined,
        description: form.description.trim() || undefined,
        parentId: form.parentId || undefined,
        isActive: form.isActive,
      });
      toast.success("Category created.");
      navigate("/categories");
    } catch (err) {
      const message = handleApiError(err);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  const headerValue = headerCtx;

  return (
    <section className="min-h-full bg-background animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-sm">
        <div className="mx-auto max-w-[1600px] py-4 px-6">
          {headerValue ? (
            <TopBar
              title={headerValue.title}
              subtitle={headerValue.subtitle}
              currentEmail={headerValue.currentEmail}
              onOpenSearch={headerValue.onOpenSearch}
              notificationProps={headerValue.notificationProps}
              leftContent={
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold text-foreground">
                    New Category
                  </h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Define a new category to organize tickets and reporting.
                  </p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground">
                New Category
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Define a new category to organize tickets and reporting.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[900px] px-6 py-8">
        <button
          type="button"
          onClick={() => navigate("/categories")}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to categories</span>
        </button>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold text-foreground">
              Category details
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a clear, human-friendly name and optional slug and parent.
            </p>
          </div>

          <div className="space-y-6 px-6 py-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                  placeholder="e.g. Billing, Access Requests, Facilities"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Slug
                </label>
                <input
                  value={form.slug}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, slug: event.target.value }))
                  }
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                  placeholder="Auto-generated from name if left blank"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
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
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-ring"
                placeholder="Short description to help your team understand when to use this category."
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Parent category
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
                  disabled={loading}
                >
                  <option value="">No parent</option>
                  {parentOptions.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use parents to group related subcategories.
                </p>
              </div>

              <div className="flex items-center rounded-lg border border-border bg-muted px-4 py-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">Active</p>
                  <p className="text-xs text-muted-foreground">
                    Inactive categories are hidden from new tickets but kept for
                    history.
                  </p>
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
            </div>
          </div>

          <div className="flex items-center justify-between rounded-b-2xl border-t border-border bg-muted px-6 py-4">
            <span className="text-xs text-muted-foreground">
              * Required fields. Categories are used across reports and ticket
              routing.
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate("/categories")}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={saving || loading}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/40"
              >
                <Plus className="h-4 w-4" />
                <span>Create category</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
