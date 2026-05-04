import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../components/shell/AppShell';
import { Pill, Icn, I } from '../components/atoms';
import { FilterChip } from '../components/tickets/FilterChip';
import { BulkActionBar } from '../components/tickets/BulkActionBar';
import { TicketsTable } from '../components/tickets/TicketsTable';
import { ticketToRow } from '../components/tickets/mappers';
import { fetchTickets } from '../api/client';

export default function TicketsPageRevamp() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState([
    { label: 'status',   value: 'open, in_progress', active: true  },
    { label: 'priority', value: 'P1, P2',            active: false },
    { label: 'assignee', value: 'me',                active: false },
  ]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['tickets-revamp'],
    queryFn: ({ signal }) => fetchTickets({ pageSize: 50 }, { signal }),
    staleTime: 30_000,
  });

  const rows = useMemo(
    () => (data?.data ?? []).map(ticketToRow),
    [data],
  );
  const total = data?.meta?.total ?? rows.length;

  return (
    <AppShell crumbs={['Inbox', 'All open']}>
      {/* Page header */}
      <div className="border-b" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)', padding: '12px 18px' }}>
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
            <h1 className="text-[18px] font-semibold tracking-[-0.01em]">All open</h1>
            <Pill tone="gray"><span className="font-mono">{total}</span></Pill>
            <span className="text-[11px]" style={{ color: 'var(--c-fg-4)' }}>
              · {isLoading ? 'loading…' : `updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
            </span>
          </div>
          <div className="flex gap-1.5">
            <button className="text-[11px] px-1.5 py-1 rounded border" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Save view</button>
            <button className="text-[11px] px-1.5 py-1 rounded border inline-flex items-center gap-1" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>Export <Icn d={I.chevD} s={11} /></button>
            <button onClick={() => refetch()} className="text-[11px] px-1.5 py-1 rounded inline-flex items-center gap-1" style={{ backgroundColor: 'var(--c-accent)', color: 'white' }}>
              <Icn d={I.plus} s={11} /> New ticket
            </button>
          </div>
        </div>

        {/* Filter row (visual only — wiring is a follow-up) */}
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

      {isError ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-[13px]" style={{ color: 'var(--c-fg-3)' }}>
          <Icn d={I.alert} s={32} />
          <div className="font-semibold" style={{ color: 'var(--c-fg)' }}>Couldn't load tickets</div>
          <button onClick={() => refetch()} className="text-[11px] px-2 py-1 rounded border" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)' }}>
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-[13px]" style={{ color: 'var(--c-fg-4)' }}>
          <Icn d={I.clock} s={20} />
          <span>Loading tickets…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-[13px]" style={{ color: 'var(--c-fg-4)' }}>
          <Icn d={I.inbox} s={32} />
          <span>No tickets match the current filters.</span>
        </div>
      ) : (
        <TicketsTable
          tickets={rows}
          selected={selected}
          onSelectionChange={setSelected}
          onRowClick={(id) => navigate(`/tickets/${id}`)}
        />
      )}

      {/* Footer */}
      <div
        className="flex items-center justify-between text-[11px] border-t"
        style={{ backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', color: 'var(--c-fg-4)', padding: '6px 18px' }}
      >
        <div className="font-mono">Showing 1–{rows.length} of {total}</div>
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
          <span className="font-mono">1 / 1</span>
          <button className="text-[11px] px-1.5 py-0.5 rounded border" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>›</button>
        </div>
      </div>
    </AppShell>
  );
}
