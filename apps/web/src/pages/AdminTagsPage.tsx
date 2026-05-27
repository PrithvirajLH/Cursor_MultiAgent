import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Edit2,
  Merge,
  Plus,
  Search,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import {
  createTagStandalone,
  deleteTag,
  fetchAdminTags,
  mergeTags,
  renameTag,
  type AdminTagEntry,
} from "../api/client";
import { TopBar } from "../components/TopBar";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatCard } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { useHeaderContext } from "../contexts/HeaderContext";
import type { Role } from "../types";

type SortKey = "most" | "least" | "name" | "recent" | "newest";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "most", label: "Most used" },
  { value: "least", label: "Least used" },
  { value: "name", label: "Name (A–Z)" },
  { value: "recent", label: "Recently used" },
  { value: "newest", label: "Newest" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function TagPill({ tag }: { tag: AdminTagEntry }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-foreground">
      <span
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ backgroundColor: tag.color ?? "#94a3b8" }}
      />
      {tag.name}
    </span>
  );
}

export function AdminTagsPage({ role }: { role: Role }) {
  const canEdit = role === "OWNER";
  const headerCtx = useHeaderContext();
  const [tags, setTags] = useState<AdminTagEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("most");

  const [composing, setComposing] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [creating, setCreating] = useState(false);
  const composeRef = useRef<HTMLInputElement>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [confirmDeleteTag, setConfirmDeleteTag] =
    useState<AdminTagEntry | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTags(await fetchAdminTags());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tags");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (composing) composeRef.current?.focus();
  }, [composing]);

  const stats = useMemo(() => {
    const total = tags.length;
    const inUse = tags.filter((t) => t.ticketCount > 0).length;
    const top = [...tags].sort((a, b) => b.ticketCount - a.ticketCount)[0];
    return { total, inUse, unused: total - inUse, top };
  }, [tags]);

  const visibleTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tags.filter((t) => !q || t.name.toLowerCase().includes(q));
    const time = (iso: string | null) =>
      iso ? new Date(iso).getTime() : 0;
    switch (sortBy) {
      case "least":
        return list.sort(
          (a, b) => a.ticketCount - b.ticketCount || a.name.localeCompare(b.name),
        );
      case "name":
        return list.sort((a, b) => a.name.localeCompare(b.name));
      case "recent":
        return list.sort((a, b) => time(b.lastUsedAt) - time(a.lastUsedAt));
      case "newest":
        return list.sort((a, b) => time(b.createdAt) - time(a.createdAt));
      default:
        return list.sort(
          (a, b) => b.ticketCount - a.ticketCount || a.name.localeCompare(b.name),
        );
    }
  }, [tags, search, sortBy]);

  const selectedCount = selectedIds.size;
  const allVisibleSelected =
    visibleTags.length > 0 &&
    visibleTags.every((t) => selectedIds.has(t.id));

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setMergeTarget(null);
  }

  async function handleCreate() {
    const name = newTagName.trim().toLowerCase();
    if (!name) return;
    setCreating(true);
    setActionError(null);
    try {
      await createTagStandalone(name);
      setNewTagName("");
      setComposing(false);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function handleRenameSubmit(id: string) {
    const name = renameValue.trim().toLowerCase();
    if (!name) {
      setRenamingId(null);
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await renameTag(id, name);
      setRenamingId(null);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleMerge() {
    if (!mergeTarget || selectedCount < 2) return;
    const fromIds = Array.from(selectedIds).filter((id) => id !== mergeTarget);
    if (!fromIds.length) {
      setActionError("Pick at least one source tag plus a target.");
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await mergeTags(fromIds, mergeTarget);
      clearSelection();
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setActionLoading(false);
    }
  }

  function requestDelete(tag: AdminTagEntry) {
    if (tag.ticketCount > 0) {
      setActionError(
        `“${tag.name}” is attached to ${tag.ticketCount} ticket${tag.ticketCount === 1 ? "" : "s"}. Remove or merge it first.`,
      );
      return;
    }
    setActionError(null);
    setConfirmDeleteTag(tag);
  }

  async function handleDelete(id: string) {
    setConfirmDeleteTag(null);
    setActionLoading(true);
    setActionError(null);
    try {
      await deleteTag(id);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setActionLoading(false);
    }
  }

  const inputClass =
    "rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground text-sm focus:border-transparent focus:ring-2 focus:ring-ring";

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
                <div className="min-w-0">
                  <h1 className="text-xl font-semibold text-foreground">Tags</h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {canEdit
                      ? "Organize the tag vocabulary — rename, merge, or remove tags across the org."
                      : "Tags used on your team's tickets (view only)."}
                  </p>
                </div>
              }
            />
          ) : (
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-foreground">Tags</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {canEdit
                  ? "Organize the tag vocabulary — rename, merge, or remove tags across the org."
                  : "Tags used on your team's tickets (view only)."}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-none p-6">
        {/* Summary */}
        <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            label="Total Tags"
            value={stats.total}
            icon={TagIcon}
            tone="blue"
          />
          <StatCard label="In Use" value={stats.inUse} tone="green" />
          <StatCard
            label="Unused"
            value={stats.unused}
            tone={stats.unused > 0 ? "amber" : "neutral"}
          />
          <StatCard
            label="Most Used"
            value={stats.top && stats.top.ticketCount > 0 ? stats.top.name : "—"}
            hint={
              stats.top && stats.top.ticketCount > 0
                ? `${stats.top.ticketCount} tickets`
                : undefined
            }
          />
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        )}
        {actionError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {actionError}
          </div>
        )}

        {/* Toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tags…"
              className={`${inputClass} w-full py-2 pl-9 pr-3`}
            />
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className={`${inputClass} px-3 py-2`}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Sort: {opt.label}
              </option>
            ))}
          </select>
          {canEdit && (
            <button
              type="button"
              onClick={() => setComposing((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> New tag
            </button>
          )}
        </div>

        {/* Inline create composer */}
        {canEdit && composing && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-card p-3">
            <input
              ref={composeRef}
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
                if (e.key === "Escape") setComposing(false);
              }}
              placeholder="New tag name (lowercase, letters / numbers / dashes)"
              maxLength={50}
              className={`${inputClass} flex-1 px-3 py-2`}
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating || !newTagName.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Check className="h-4 w-4" />
              {creating ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => {
                setComposing(false);
                setNewTagName("");
              }}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Selection / merge bar */}
        {canEdit && selectedCount >= 1 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
            <div className="text-sm text-foreground">
              <span className="font-semibold">{selectedCount}</span> selected
              {selectedCount < 2 && (
                <span className="text-muted-foreground">
                  {" "}
                  · select one more to merge
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedCount >= 2 && (
                <>
                  <span className="text-xs text-muted-foreground">
                    Merge into
                  </span>
                  <select
                    value={mergeTarget ?? ""}
                    onChange={(e) => setMergeTarget(e.target.value || null)}
                    className={`${inputClass} px-2.5 py-1.5`}
                  >
                    <option value="">Keep tag…</option>
                    {Array.from(selectedIds).map((id) => {
                      const t = tags.find((x) => x.id === id);
                      if (!t) return null;
                      return (
                        <option key={id} value={id}>
                          {t.name}
                        </option>
                      );
                    })}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleMerge()}
                    disabled={!mergeTarget || actionLoading}
                    className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Merge className="h-4 w-4" /> Merge
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={`skel-${i}`} className="flex items-center gap-4 px-4 py-3.5">
                  <div className="h-5 w-28 skeleton-shimmer rounded-full" />
                  <div className="ml-auto h-4 w-10 skeleton-shimmer rounded" />
                  <div className="h-4 w-20 skeleton-shimmer rounded" />
                </div>
              ))}
            </div>
          ) : visibleTags.length === 0 ? (
            <EmptyState
              bordered={false}
              icon={<TagIcon className="h-6 w-6" />}
              title={search.trim() ? "No matching tags" : "No tags yet"}
              description={
                search.trim()
                  ? "Try a different search term."
                  : "AI classification and manual tagging will populate this list — or create one above."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {canEdit && (
                      <th className="w-10 px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={(e) =>
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              visibleTags.forEach((t) =>
                                e.target.checked
                                  ? next.add(t.id)
                                  : next.delete(t.id),
                              );
                              return next;
                            })
                          }
                          aria-label="Select all"
                        />
                      </th>
                    )}
                    <th className="px-4 py-2.5">Tag</th>
                    <th className="w-28 px-4 py-2.5 text-right">Tickets</th>
                    <th className="w-32 px-4 py-2.5">Last used</th>
                    <th className="w-32 px-4 py-2.5">Created</th>
                    {canEdit && <th className="w-24 px-4 py-2.5 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visibleTags.map((tag) => (
                    <tr key={tag.id} className="hover:bg-muted">
                      {canEdit && (
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(tag.id)}
                            onChange={() => toggleSelect(tag.id)}
                            aria-label={`Select ${tag.name}`}
                          />
                        </td>
                      )}
                      <td className="px-4 py-2.5">
                        {canEdit && renamingId === tag.id ? (
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                void handleRenameSubmit(tag.id);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            onBlur={() => void handleRenameSubmit(tag.id)}
                            autoFocus
                            maxLength={50}
                            className={`${inputClass} px-2 py-1`}
                          />
                        ) : (
                          <TagPill tag={tag} />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                        {tag.ticketCount > 0 ? (
                          tag.ticketCount
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {formatDate(tag.lastUsedAt)}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {formatDate(tag.createdAt)}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingId(tag.id);
                                setRenameValue(tag.name);
                              }}
                              className="rounded p-1.5 text-muted-foreground hover:bg-blue-50 hover:text-primary dark:hover:bg-blue-500/10"
                              title="Rename"
                              aria-label={`Rename ${tag.name}`}
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDelete(tag)}
                              disabled={actionLoading}
                              className="rounded p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-500/10"
                              title={
                                tag.ticketCount > 0
                                  ? "In use — remove or merge first"
                                  : "Delete"
                              }
                              aria-label={`Delete ${tag.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!canEdit && (
          <p className="mt-3 text-xs text-muted-foreground">
            Only owners can rename, merge, delete, or create tags — those
            operations affect the whole organization.
          </p>
        )}
        {visibleTags.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing {visibleTags.length} of {tags.length} tag
            {tags.length === 1 ? "" : "s"}.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDeleteTag}
        destructive
        title="Delete tag?"
        confirmLabel="Delete"
        message={
          <>
            Delete{" "}
            <span className="font-medium text-foreground">
              {confirmDeleteTag?.name}
            </span>
            ? This can’t be undone.
          </>
        }
        loading={actionLoading}
        onConfirm={() => {
          if (confirmDeleteTag) void handleDelete(confirmDeleteTag.id);
        }}
        onCancel={() => setConfirmDeleteTag(null)}
      />
    </section>
  );
}
