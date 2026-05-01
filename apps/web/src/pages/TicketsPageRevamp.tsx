import { useState } from 'react';
import { AppShell } from '../components/shell/AppShell';
import { Pill, Icn, I } from '../components/atoms';
import { FilterChip } from '../components/tickets/FilterChip';
import { BulkActionBar } from '../components/tickets/BulkActionBar';
import { TicketsTable } from '../components/tickets/TicketsTable';
import { MOCK_TICKETS } from '../components/tickets/mock-tickets';

export default function TicketsPageRevamp() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState([
    { label: 'status',   value: 'open, in_progress', active: true  },
    { label: 'priority', value: 'P1, P2',            active: false },
    { label: 'assignee', value: 'me',                active: false },
    { label: 'tier',     value: 'enterprise',        active: false },
  ]);

  return (
    <AppShell crumbs={['Inbox', 'All open']}>
      {/* Page header */}
      <div className="border-b" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)', padding: '12px 18px' }}>
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
            <h1 className="text-[18px] font-semibold tracking-[-0.01em]">All open</h1>
            <Pill tone="gray"><span className="font-mono">{MOCK_TICKETS.length}</span></Pill>
            <span className="text-[11px]" style={{ color: 'var(--c-fg-4)' }}>· updated <span className="font-mono">14:32</span></span>
          </div>
          <div className="flex gap-1.5">
            <button className="text-[11px] px-1.5 py-1 rounded border" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Save view</button>
            <button className="text-[11px] px-1.5 py-1 rounded border inline-flex items-center gap-1" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Export <Icn d={I.chevD} s={11} /></button>
            <button className="text-[11px] px-1.5 py-1 rounded inline-flex items-center gap-1" style={{ backgroundColor: 'var(--c-accent)', color: 'white' }}>
              <Icn d={I.plus} s={11} /> New ticket
            </button>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {filters.map((f, i) => (
            <FilterChip
              key={f.label}
              label={f.label}
              value={f.value}
              active={f.active}
              onRemove={() => setFilters(filters.filter((_, j) => j !== i))}
            />
          ))}
          <button className="text-[11px] px-1.5 py-1 rounded inline-flex items-center gap-1 border-dashed border" style={{ color: 'var(--c-fg-3)', borderColor: 'var(--c-border-strong)' }}>
            <Icn d={I.plus} s={11} /> Add filter
          </button>
          <span className="flex-1" />
          <button className="text-[11px] px-1.5 py-1 rounded border inline-flex items-center gap-1" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>
            Group · <span className="font-semibold">None</span> <Icn d={I.chevD} s={11} />
          </button>
          <button className="text-[11px] px-1.5 py-1 rounded border inline-flex items-center gap-1" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>
            Sort · <span className="font-semibold">SLA ↓</span> <Icn d={I.chevD} s={11} />
          </button>
        </div>
      </div>

      <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())} />

      <TicketsTable
        tickets={MOCK_TICKETS}
        selected={selected}
        onSelectionChange={setSelected}
        onRowClick={(id) => console.log('row clicked', id)}
      />

      {/* Footer */}
      <div
        className="flex items-center justify-between text-[11px] border-t"
        style={{ backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', color: 'var(--c-fg-4)', padding: '6px 18px' }}
      >
        <div className="font-mono">Showing 1–{MOCK_TICKETS.length} of 142</div>
        <div className="flex items-center gap-1.5">
          <span>
            <span className="font-mono text-[10px] px-1 rounded-sm border" style={{ backgroundColor: 'var(--c-surface-3)', borderColor: 'var(--c-border)' }}>J</span>
            <span className="font-mono text-[10px] px-1 rounded-sm border" style={{ backgroundColor: 'var(--c-surface-3)', borderColor: 'var(--c-border)' }}>K</span>
            {' '}nav ·{' '}
            <span className="font-mono text-[10px] px-1 rounded-sm border" style={{ backgroundColor: 'var(--c-surface-3)', borderColor: 'var(--c-border)' }}>X</span>
            {' '}select ·{' '}
            <span className="font-mono text-[10px] px-1 rounded-sm border" style={{ backgroundColor: 'var(--c-surface-3)', borderColor: 'var(--c-border)' }}>E</span>
            {' '}assign
          </span>
          <span className="w-px h-3.5" style={{ backgroundColor: 'var(--c-border)' }} />
          <button className="text-[11px] px-1.5 py-0.5 rounded border" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>‹</button>
          <span className="font-mono">1 / 12</span>
          <button className="text-[11px] px-1.5 py-0.5 rounded border" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>›</button>
        </div>
      </div>
    </AppShell>
  );
}
