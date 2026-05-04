import { useEffect, useRef, useState } from 'react';
import { Icn, I } from '../atoms';
import type { SortField, SortOrder } from '../../types';

interface SortDropdownProps {
  sort: SortField;
  order: SortOrder;
  onChange: (sort: SortField, order: SortOrder) => void;
}

const SORT_OPTIONS: Array<{ field: SortField; label: string }> = [
  { field: 'updatedAt',   label: 'Updated' },
  { field: 'createdAt',   label: 'Created' },
  { field: 'completedAt', label: 'Completed' },
];

const FIELD_LABEL: Record<SortField, string> = {
  updatedAt:   'Updated',
  createdAt:   'Created',
  completedAt: 'Completed',
};

export function SortDropdown({ sort, order, onChange }: SortDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function pick(field: SortField) {
    if (field === sort) {
      // toggle order
      onChange(field, order === 'asc' ? 'desc' : 'asc');
    } else {
      onChange(field, 'desc');
    }
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[11px] px-1.5 py-1 rounded border inline-flex items-center gap-1"
        style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}
      >
        Sort · <span className="font-semibold">{FIELD_LABEL[sort]} {order === 'asc' ? '↑' : '↓'}</span>
        <Icn d={I.chevD} s={11} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-10 rounded shadow-soft border min-w-[160px]"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          {SORT_OPTIONS.map(o => {
            const active = o.field === sort;
            return (
              <button
                key={o.field}
                role="menuitem"
                onClick={() => pick(o.field)}
                className="w-full text-left px-2.5 py-1.5 text-[12px] flex items-center justify-between hover:bg-[var(--c-surface-2)]"
                style={{ color: active ? 'var(--c-accent)' : 'var(--c-fg-2)', fontWeight: active ? 600 : 400 }}
              >
                <span>{o.label}</span>
                {active && (
                  <span className="font-mono text-[10px]">{order === 'asc' ? '↑' : '↓'}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
