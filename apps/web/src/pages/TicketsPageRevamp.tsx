import { useState, useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../components/shell/AppShell';
import { Pill, Icn, I } from '../components/atoms';
import { FilterRow } from '../components/tickets/FilterRow';
import { SortDropdown } from '../components/tickets/SortDropdown';
import { BulkActionBar } from '../components/tickets/BulkActionBar';
import { TicketsTable } from '../components/tickets/TicketsTable';
import { ticketToRow } from '../components/tickets/mappers';
import { fetchTickets } from '../api/client';
import { useFilters } from '../hooks/useFilters';
import { useAuthSession } from '../hooks/useAuthSession';
import { useTicketListKeyboard } from '../components/tickets/use-ticket-list-keyboard';

export default function TicketsPageRevamp() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { user } = useAuthSession();
  const role = user?.role ?? 'EMPLOYEE';
  const canBulkEdit = role !== 'EMPLOYEE';

  const { filters, setFilters, clearFilters, hasActiveFilters, apiParams } =
    useFilters();

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['tickets-revamp', apiParams],
    queryFn: ({ signal }) => fetchTickets(apiParams, { signal }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(
    () => (data?.data ?? []).map(ticketToRow),
    [data],
  );

  const { focusedRowId, setFocusedRowIndex } = useTicketListKeyboard({
    tickets: rows,
    selected,
    onSelectionChange: setSelected,
    onOpenTicket: id => navigate(`/tickets/${id}`),
    canSelect: canBulkEdit,
  });
  const total = data?.meta?.total ?? rows.length;
  const meta = data?.meta;

  const pageStart = meta ? (meta.page - 1) * meta.pageSize + 1 : rows.length ? 1 : 0;
  const pageEnd = meta ? Math.min(meta.page * meta.pageSize, meta.total) : rows.length;

  const headingTitle =
    filters.statusGroup === 'open' ? 'All open' :
    filters.statusGroup === 'resolved' ? 'Resolved' :
    'All tickets';

  return (
    <AppShell crumbs={['Inbox', headingTitle]}>
      {/* Page header */}
      <div className="border-b" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border)', padding: '12px 18px' }}>
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
            <h1 className="text-[18px] font-semibold tracking-[-0.01em]">{headingTitle}</h1>
            <Pill tone="gray"><span className="font-mono">{total}</span></Pill>
            <span className="text-[11px]" style={{ color: 'var(--c-fg-4)' }}>
              · {isLoading || isFetching ? 'loading…' : `updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
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

        <div className="flex items-center gap-3 flex-wrap">
          <FilterRow
            filters={filters}
            setFilters={setFilters}
            hasActiveFilters={hasActiveFilters}
            onClearAll={clearFilters}
          />
          <span className="flex-1" />
          <button className="text-[11px] px-1.5 py-1 rounded border inline-flex items-center gap-1" style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}>
            Group · <span className="font-semibold">None</span> <Icn d={I.chevD} s={11} />
          </button>
          <SortDropdown
            sort={filters.sort}
            order={filters.order}
            onChange={(sort, order) => setFilters({ sort, order })}
          />
        </div>
      </div>

      <BulkActionBar
        ticketIds={Array.from(selected)}
        currentUserId={user?.id}
        onClear={() => setSelected(new Set())}
        onActionComplete={() => refetch()}
      />

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
          sort={filters.sort}
          order={filters.order}
          onSortChange={(sort, order) => setFilters({ sort, order })}
          showCheckbox={canBulkEdit}
          focusedRowId={focusedRowId}
          onFocusRow={setFocusedRowIndex}
        />
      )}

      {/* Footer */}
      <div
        className="flex items-center justify-between text-[11px] border-t"
        style={{ backgroundColor: 'var(--c-surface-2)', borderColor: 'var(--c-border)', color: 'var(--c-fg-4)', padding: '6px 18px' }}
      >
        <div className="font-mono">
          {total === 0 ? 'No results' : `Showing ${pageStart}–${pageEnd} of ${total}`}
        </div>
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
          <button
            disabled={!meta || meta.page <= 1}
            onClick={() => meta && setFilters({ page: meta.page - 1 })}
            className="text-[11px] px-1.5 py-0.5 rounded border disabled:opacity-40"
            style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}
          >‹</button>
          <span className="font-mono">{meta ? `${meta.page} / ${meta.totalPages}` : '1 / 1'}</span>
          <button
            disabled={!meta || meta.page >= meta.totalPages}
            onClick={() => meta && setFilters({ page: meta.page + 1 })}
            className="text-[11px] px-1.5 py-0.5 rounded border disabled:opacity-40"
            style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-border-strong)', color: 'var(--c-fg-2)' }}
          >›</button>
        </div>
      </div>
    </AppShell>
  );
}
