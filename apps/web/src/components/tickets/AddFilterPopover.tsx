import { useEffect, useRef, useState } from 'react';
import { Icn, I } from '../atoms';
import type { TicketFilters, TicketScope, SlaStatusFilter } from '../../types';

interface AddFilterPopoverProps {
  filters: TicketFilters;
  setFilters: (updates: Partial<TicketFilters>) => void;
}

const STATUSES = [
  'NEW',
  'TRIAGED',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_ON_REQUESTER',
  'WAITING_ON_VENDOR',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
];

const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

const SLA_STATES: Array<{ value: SlaStatusFilter; label: string }> = [
  { value: 'on_track', label: 'On track' },
  { value: 'at_risk',  label: 'At risk' },
  { value: 'breached', label: 'Breached' },
];

const SCOPES: Array<{ value: TicketScope; label: string }> = [
  { value: 'all',        label: 'All' },
  { value: 'assigned',   label: 'Assigned to me' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'created',    label: 'Created by me' },
];

export function AddFilterPopover({ filters, setFilters }: AddFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggleArray = <T extends string>(
    key: keyof TicketFilters,
    current: T[],
    value: T,
  ) => {
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    setFilters({ [key]: next } as Partial<TicketFilters>);
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[11px] px-1.5 py-1 rounded inline-flex items-center gap-1 border-dashed border"
        style={{ color: 'var(--c-fg-3)', borderColor: 'var(--c-border-strong)' }}
      >
        <Icn d={I.plus} s={11} /> Add filter
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute left-0 top-full mt-1 z-20 rounded shadow-soft border w-[300px] p-3 flex flex-col gap-3"
          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          <Group title="Status">
            <CheckboxGrid
              options={STATUSES.map(s => ({ value: s, label: s.replace(/_/g, ' ').toLowerCase() }))}
              selected={filters.statuses}
              onToggle={v => toggleArray('statuses', filters.statuses, v)}
            />
          </Group>
          <Group title="Priority">
            <CheckboxGrid
              options={PRIORITIES.map(p => ({ value: p, label: p }))}
              selected={filters.priorities}
              onToggle={v => toggleArray('priorities', filters.priorities, v)}
              compact
            />
          </Group>
          <Group title="SLA">
            <CheckboxGrid
              options={SLA_STATES.map(s => ({ value: s.value, label: s.label }))}
              selected={filters.slaStatus}
              onToggle={v => toggleArray('slaStatus', filters.slaStatus, v as SlaStatusFilter)}
            />
          </Group>
          <Group title="Scope">
            <div className="flex flex-col gap-0.5">
              {SCOPES.map(s => {
                const active = filters.scope === s.value;
                return (
                  <button
                    key={s.value}
                    onClick={() => setFilters({ scope: s.value })}
                    className="text-left text-[12px] px-2 py-1 rounded"
                    style={{
                      backgroundColor: active ? 'var(--c-accent-tint)' : 'transparent',
                      color: active ? 'var(--c-accent)' : 'var(--c-fg-2)',
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </Group>

          <div className="flex justify-end gap-1.5 pt-1 border-t" style={{ borderColor: 'var(--c-divider)' }}>
            <button
              onClick={() => setOpen(false)}
              className="text-[11px] px-2 py-1 rounded border"
              style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--c-fg-4)' }}>
        {title}
      </h4>
      {children}
    </div>
  );
}

interface CheckboxGridProps {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  compact?: boolean;
}

function CheckboxGrid({ options, selected, onToggle, compact }: CheckboxGridProps) {
  return (
    <div className={`grid ${compact ? 'grid-cols-4' : 'grid-cols-2'} gap-0.5`}>
      {options.map(o => {
        const checked = selected.includes(o.value);
        return (
          <label
            key={o.value}
            className="flex items-center gap-1.5 text-[11px] px-1.5 py-1 rounded cursor-pointer hover:bg-[var(--c-surface-2)]"
            style={{ color: checked ? 'var(--c-accent)' : 'var(--c-fg-2)' }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(o.value)}
              className="w-3 h-3"
            />
            <span className="truncate">{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}
