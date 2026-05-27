import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit2, Merge, Plus, Trash2 } from "lucide-react";
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
import { useHeaderContext } from "../contexts/HeaderContext";
import type { Role } from "../types";

export function AdminTagsPage({ role }: { role: Role }) {
  const canEdit = role === "OWNER";
  const headerCtx = useHeaderContext();
  const [tags, setTags] = useState<AdminTagEntry[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDeleteTag, setConfirmDeleteTag] = useState<AdminTagEntry | null>(
    null,
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminTags();
      setTags(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tags");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const sortedTags = useMemo(
    () =>
      [...tags].sort((a, b) =>
        b.ticketCount === a.ticketCount
          ? a.name.localeCompare(b.name)
          : b.ticketCount - a.ticketCount,
      ),
    [tags],
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRenameSubmit = async (id: string) => {
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
  };

  const handleMerge = async () => {
    if (!mergeTarget || selectedIds.size < 2) return;
    const fromIds = Array.from(selectedIds).filter((id) => id !== mergeTarget);
    if (!fromIds.length) {
      setActionError("Pick at least one source tag plus a target");
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await mergeTags(fromIds, mergeTarget);
      setSelectedIds(new Set());
      setMergeTarget(null);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreate = async () => {
    const name = newTagName.trim().toLowerCase();
    if (!name) return;
    setCreating(true);
    setActionError(null);
    try {
      await createTagStandalone(name);
      setNewTagName("");
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const requestDelete = (id: string, ticketCount: number) => {
    if (ticketCount > 0) {
      setActionError(
        `"${tags.find((t) => t.id === id)?.name}" is attached to ${ticketCount} tickets. Remove or merge first.`,
      );
      return;
    }
    setActionError(null);
    setConfirmDeleteTag(tags.find((t) => t.id === id) ?? null);
  };

  const handleDelete = async (id: string) => {
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
  };

  const selectedCount = selectedIds.size;

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
                <div>
                  <h1 className="text-xl font-semibold text-foreground">Tags</h1>
                  <p className="text-sm text-muted-foreground">
                    {canEdit
                      ? "Rename, merge, or delete ticket tags"
                      : "Tags used on your team's tickets (view only)"}
                  </p>
                </div>
              }
            />
          ) : (
            <div>
              <h1 className="text-xl font-semibold text-foreground">Tags</h1>
              <p className="text-sm text-muted-foreground">
                {canEdit
                  ? "Rename, merge, or delete ticket tags"
                  : "Tags used on your team's tickets (view only)"}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-none px-6 py-6">
        <div className="glass-card rounded-xl p-6 shadow-sm">
          {canEdit && selectedCount >= 2 ? (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
              <div className="text-sm">
                <span className="font-semibold">{selectedCount}</span> tags
                selected. Pick one to keep, the rest will merge into it.
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={mergeTarget ?? ""}
                  onChange={(e) => setMergeTarget(e.target.value || null)}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
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
                  disabled={
                    !mergeTarget || selectedCount < 2 || actionLoading
                  }
                  className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Merge className="h-4 w-4" />
                  Merge
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIds(new Set());
                    setMergeTarget(null);
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {canEdit ? (
            <div className="mb-4 flex items-center gap-2">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
                placeholder="Create a new tag (lowercase, letters/numbers/dashes)"
                className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none"
                maxLength={50}
              />
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={creating || !newTagName.trim()}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                {creating ? "Creating…" : "New tag"}
              </button>
            </div>
          ) : (
            <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              Showing tags used on your team's tickets. Only owners can rename,
              merge, delete, or create new tags (those operations affect the
              whole organization).
            </div>
          )}

          {actionError ? (
            <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
              {actionError}
            </div>
          ) : null}

          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-600">{error}</p>
          ) : tags.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No tags yet. AI classification and manual tagging will populate
              this list.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {canEdit ? (
                    <th className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={
                          selectedCount > 0 && selectedCount === tags.length
                        }
                        onChange={(e) =>
                          setSelectedIds(
                            e.target.checked
                              ? new Set(tags.map((t) => t.id))
                              : new Set(),
                          )
                        }
                        aria-label="Select all"
                      />
                    </th>
                  ) : null}
                  <th className="px-2 py-2">Tag</th>
                  <th className="px-2 py-2 text-right">Tickets</th>
                  <th className="px-2 py-2">Last used</th>
                  {canEdit ? (
                    <th className="px-2 py-2 text-right">Actions</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {sortedTags.map((tag) => (
                  <tr
                    key={tag.id}
                    className="border-b border-border last:border-b-0 hover:bg-accent/40"
                  >
                    {canEdit ? (
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(tag.id)}
                          onChange={() => toggleSelect(tag.id)}
                          aria-label={`Select ${tag.name}`}
                        />
                      </td>
                    ) : null}
                    <td className="px-2 py-2 font-medium">
                      {canEdit && renamingId === tag.id ? (
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleRenameSubmit(tag.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onBlur={() => void handleRenameSubmit(tag.id)}
                          autoFocus
                          className="rounded border border-border bg-card px-2 py-0.5 text-sm"
                        />
                      ) : (
                        <span>{tag.name}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right text-muted-foreground">
                      {tag.ticketCount}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {tag.lastUsedAt
                        ? new Date(tag.lastUsedAt).toLocaleDateString()
                        : "—"}
                    </td>
                    {canEdit ? (
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingId(tag.id);
                              setRenameValue(tag.name);
                            }}
                            className="rounded p-1 text-muted-foreground hover:bg-accent"
                            title="Rename"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDelete(tag.id, tag.ticketCount)}
                            disabled={actionLoading}
                            className="rounded p-1 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                            title={
                              tag.ticketCount > 0
                                ? "Cannot delete — tag is in use"
                                : "Delete"
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
