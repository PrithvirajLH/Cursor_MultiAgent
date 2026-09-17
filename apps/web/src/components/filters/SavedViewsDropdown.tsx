import { useCallback, useState } from "react";
import { ChevronDown, Save, Trash2 } from "lucide-react";
import {
  createSavedView,
  deleteSavedView,
  fetchSavedViews,
  type SavedViewRecord,
} from "../../api/client";
import { TICKET_VIEW_FILTERS } from "../../hooks/ticket-view-filters";
import type { TicketFilters } from "../../types";

export function SavedViewsDropdown({
  currentFilters,
  onApplyFilters,
  onSaveSuccess,
  onError,
}: {
  currentFilters: TicketFilters;
  onApplyFilters: (filters: Partial<TicketFilters>) => void;
  onSaveSuccess?: () => void;
  onError?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedViewRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);

  const loadViews = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchSavedViews();
      setViews(Array.isArray(list) ? list : []);
    } catch {
      setViews([]);
    } finally {
      setLoading(false);
    }
  }, []);

  function openDropdown() {
    if (!open) loadViews();
    setOpen(!open);
    setShowSaveInput(false);
    setSaveName("");
  }

  function applyView(view: SavedViewRecord) {
    const raw = view.filters as Record<string, unknown>;
    if (!raw || typeof raw !== "object") return;
    // ⚠️ CARD 1.127: THIS HAND-WROTE ITS OWN FIELD LIST AND SO DID THE SAVE,
    // six lines below, and so did `filtersForPersistence` in SaveViewButton -
    // three copies that had all drifted from the URL builder's. Fixing only the
    // save would not have fixed the bug: `applyView` dropped the tag again on
    // the way back in.
    onApplyFilters(TICKET_VIEW_FILTERS.toApplied(raw));
    setOpen(false);
  }

  function filtersToPayload(filters: TicketFilters): Record<string, unknown> {
    return TICKET_VIEW_FILTERS.toPayload(filters);
  }

  async function handleSave() {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const payload = filtersToPayload(currentFilters);
      await createSavedView({ name: saveName.trim(), filters: payload });
      onSaveSuccess?.();
      setShowSaveInput(false);
      setSaveName("");
      loadViews();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to save view");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    try {
      await deleteSavedView(id);
      loadViews();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to delete view");
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openDropdown}
        className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-[13px] font-semibold text-foreground shadow-sm hover:bg-muted transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      >
        Saved views
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-20 mt-1.5 w-72 rounded-[16px] border border-border bg-popover py-2 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
            {showSaveInput ? (
              <div className="px-3 py-2 space-y-3">
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="View name"
                  className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-card transition-colors"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !saveName.trim()}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm focus:ring-2 focus:ring-blue-500/50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSaveInput(false);
                      setSaveName("");
                    }}
                    className="rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted transition-colors shadow-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setShowSaveInput(true)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <Save className="h-4 w-4 text-slate-400" />
                  Save current filters
                </button>
                <div className="border-t border-border" />
                {loading ? (
                  <p className="px-3 py-4 text-[12px] text-muted-foreground text-center">
                    Loading…
                  </p>
                ) : views.length === 0 ? (
                  <p className="px-3 py-4 text-[12px] text-muted-foreground text-center">
                    No saved views
                  </p>
                ) : (
                  <ul className="max-h-48 overflow-y-auto">
                    {views.map((view) => (
                      <li key={view.id}>
                        <div className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted transition-colors">
                          <button
                            type="button"
                            onClick={() => applyView(view)}
                            className="min-w-0 flex-1 truncate text-left text-[13px] text-foreground"
                          >
                            {view.name}
                            {view.isDefault && (
                              <span className="ml-1.5 text-[11px] font-medium text-slate-400">
                                (default)
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, view.id)}
                            className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                            aria-label="Delete view"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
