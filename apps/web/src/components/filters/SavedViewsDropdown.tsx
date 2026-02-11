import { useCallback, useState } from 'react';
import { ChevronDown, Save, Trash2 } from 'lucide-react';
import {
  createSavedView,
  deleteSavedView,
  fetchSavedViews,
  type SavedViewRecord,
} from '../../api/client';
import type { TicketFilters } from '../../types';

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
  const [saveName, setSaveName] = useState('');
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
    setSaveName('');
  }

  function applyView(view: SavedViewRecord) {
    const raw = view.filters as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return;
    const partial: Partial<TicketFilters> = {
      statusGroup: raw.statusGroup as TicketFilters['statusGroup'],
      statuses: Array.isArray(raw.statuses) ? raw.statuses as string[] : [],
      priorities: Array.isArray(raw.priorities) ? raw.priorities as string[] : [],
      teamIds: Array.isArray(raw.teamIds) ? raw.teamIds as string[] : [],
      assigneeIds: Array.isArray(raw.assigneeIds) ? raw.assigneeIds as string[] : [],
      requesterIds: Array.isArray(raw.requesterIds) ? raw.requesterIds as string[] : [],
      slaStatus: Array.isArray(raw.slaStatus) ? raw.slaStatus as TicketFilters['slaStatus'] : [],
      createdFrom: typeof raw.createdFrom === 'string' ? raw.createdFrom : '',
      createdTo: typeof raw.createdTo === 'string' ? raw.createdTo : '',
      updatedFrom: typeof raw.updatedFrom === 'string' ? raw.updatedFrom : '',
      updatedTo: typeof raw.updatedTo === 'string' ? raw.updatedTo : '',
      dueFrom: typeof raw.dueFrom === 'string' ? raw.dueFrom : '',
      dueTo: typeof raw.dueTo === 'string' ? raw.dueTo : '',
      q: typeof raw.q === 'string' ? raw.q : '',
      scope: (raw.scope as TicketFilters['scope']) ?? 'all',
      sort: (raw.sort as TicketFilters['sort']) ?? 'updatedAt',
      order: (raw.order as TicketFilters['order']) ?? 'desc',
    };
    onApplyFilters(partial);
    setOpen(false);
  }

  function filtersToPayload(filters: TicketFilters): Record<string, unknown> {
    return {
      statusGroup: filters.statusGroup,
      statuses: filters.statuses,
      priorities: filters.priorities,
      teamIds: filters.teamIds,
      assigneeIds: filters.assigneeIds,
      requesterIds: filters.requesterIds,
      slaStatus: filters.slaStatus,
      createdFrom: filters.createdFrom || undefined,
      createdTo: filters.createdTo || undefined,
      updatedFrom: filters.updatedFrom || undefined,
      updatedTo: filters.updatedTo || undefined,
      dueFrom: filters.dueFrom || undefined,
      dueTo: filters.dueTo || undefined,
      q: filters.q || undefined,
      scope: filters.scope,
      sort: filters.sort,
      order: filters.order,
    };
  }

  async function handleSave() {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const payload = filtersToPayload(currentFilters);
      await createSavedView({ name: saveName.trim(), filters: payload });
      onSaveSuccess?.();
      setShowSaveInput(false);
      setSaveName('');
      loadViews();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Failed to save view');
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
      onError?.(err instanceof Error ? err.message : 'Failed to delete view');
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openDropdown}
        className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-sm hover:bg-muted/30 transition-colors"
      >
        Saved views
        <ChevronDown className={`h-4 w-4 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" aria-hidden onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-xl border border-border bg-popover py-2 shadow-elevated">
            {showSaveInput ? (
              <div className="px-3 py-2">
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="View name"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
                  autoFocus
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !saveName.trim()}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowSaveInput(false); setSaveName(''); }}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/30 transition-colors"
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
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-muted/30 transition-colors"
                >
                  <Save className="h-4 w-4" />
                  Save current filters
                </button>
                <div className="border-t border-border" />
                {loading ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground">Loading…</p>
                ) : views.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-muted-foreground">No saved views</p>
                ) : (
                  <ul className="max-h-48 overflow-y-auto">
                    {views.map((view) => (
                      <li key={view.id}>
                        <div className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/30 transition-colors">
                          <button
                            type="button"
                            onClick={() => applyView(view)}
                            className="min-w-0 flex-1 truncate text-left text-sm text-foreground"
                          >
                            {view.name}
                            {view.isDefault && (
                              <span className="ml-1 text-[10px] text-muted-foreground">(default)</span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, view.id)}
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
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
