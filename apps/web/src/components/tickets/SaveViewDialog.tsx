import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSavedView } from '../../api/client';
import { Icn, I } from '../atoms';
import type { TicketFilters } from '../../types';

interface SaveViewDialogProps {
  filters: TicketFilters;
  /** Whether to render the trigger button. Caller controls layout. */
  triggerLabel?: string;
}

/**
 * Compact "Save view" popover.
 *
 * Click the trigger → name input opens. Save persists the current filters
 * to /saved-views and invalidates the saved-views query so the sidebar
 * refreshes.
 */
export function SaveViewDialog({ filters, triggerLabel = 'Save view' }: SaveViewDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () =>
      createSavedView({
        name: name.trim(),
        filters: filtersForPersistence(filters),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-views'] });
      setName('');
      setOpen(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const canSave = name.trim().length > 0 && !save.isPending;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[11px] px-1.5 py-1 rounded border"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}
      >
        {triggerLabel}
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute right-0 top-full mt-1 z-20 rounded shadow-soft border w-[260px] p-3 flex flex-col gap-2"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <label className="text-[11px] font-semibold" style={{ color: 'var(--c-fg-3)' }}>
            View name
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && canSave) save.mutate();
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="e.g. P1 + my team"
            className="w-full text-[12px] px-2 py-1 rounded border outline-none focus:border-[var(--c-accent)]"
            style={{ backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', color: 'var(--c-fg)' }}
          />
          {save.isError && (
            <span className="text-[11px]" style={{ color: 'var(--c-red)' }}>
              Save failed — try again
            </span>
          )}
          <div className="flex justify-end gap-1.5 pt-1">
            <button
              onClick={() => setOpen(false)}
              className="text-[11px] px-2 py-1 rounded border"
              style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}
            >
              Cancel
            </button>
            <button
              onClick={() => save.mutate()}
              disabled={!canSave}
              className="text-[11px] px-2 py-1 rounded inline-flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--c-accent)', color: 'white' }}
            >
              <Icn d={I.check} s={11} />
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Strip undefined/empty fields and pagination so the persisted view is portable.
 */
function filtersForPersistence(f: TicketFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.statusGroup && f.statusGroup !== 'all') out.statusGroup = f.statusGroup;
  if (f.statuses?.length) out.statuses = f.statuses;
  if (f.priorities?.length) out.priorities = f.priorities;
  if (f.teamIds?.length) out.teamIds = f.teamIds;
  if (f.assigneeIds?.length) out.assigneeIds = f.assigneeIds;
  if (f.requesterIds?.length) out.requesterIds = f.requesterIds;
  if (f.slaStatus?.length) out.slaStatus = f.slaStatus;
  if (f.createdFrom) out.createdFrom = f.createdFrom;
  if (f.createdTo) out.createdTo = f.createdTo;
  if (f.updatedFrom) out.updatedFrom = f.updatedFrom;
  if (f.updatedTo) out.updatedTo = f.updatedTo;
  if (f.dueFrom) out.dueFrom = f.dueFrom;
  if (f.dueTo) out.dueTo = f.dueTo;
  if (f.q?.trim()) out.q = f.q.trim();
  if (f.scope && f.scope !== 'all') out.scope = f.scope;
  if (f.sort && f.sort !== 'updatedAt') out.sort = f.sort;
  if (f.order && f.order !== 'desc') out.order = f.order;
  return out;
}
