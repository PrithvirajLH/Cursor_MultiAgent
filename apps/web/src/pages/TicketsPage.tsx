import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  bulkAssignTickets,
  bulkPriorityTickets,
  bulkStatusTickets,
  bulkTransferTickets,
  fetchTickets,
  fetchUsers,
  type TicketRecord,
  type TeamRef,
  type UserRef,
} from '../api/client';
import { BulkActionsToolbar } from '../components/BulkActionsToolbar';
import { TopBar } from '../components/TopBar';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { FilterPanel } from '../components/filters/FilterPanel';
import { TicketTableView } from '../components/TicketTableView';
import { useFilters } from '../hooks/useFilters';
import { useFocusSearchOnShortcut } from '../hooks/useKeyboardShortcuts';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';
import { useTicketSelection } from '../hooks/useTicketSelection';
import { useToast } from '../hooks/useToast';
import type { Role, StatusFilter, TicketFilters, TicketScope } from '../types';
import { useHeaderContext } from '../contexts/HeaderContext';
import { useTicketDataInvalidation } from '../contexts/TicketDataInvalidationContext';

type SortPreset = 'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc' | 'completed_desc';
const DEFAULT_PAGE_SIZE = 50;
const PAGE_KEYS: Array<keyof TicketFilters> = ['page', 'pageSize'];

function sortPresetFromFilters(sort: string, order: string): SortPreset {
  if (sort === 'createdAt' && order === 'asc') return 'created_asc';
  if (sort === 'createdAt' && order === 'desc') return 'created_desc';
  if (sort === 'updatedAt' && order === 'asc') return 'updated_asc';
  if (sort === 'updatedAt' && order === 'desc') return 'updated_desc';
  return 'completed_desc';
}

function countActiveFilterGroups(filters: ReturnType<typeof useFilters>['filters']) {
  let count = 0;
  if (filters.statuses.length > 0) count += 1;
  if (filters.priorities.length > 0) count += 1;
  if (filters.teamIds.length > 0) count += 1;
  if (filters.assigneeIds.length > 0) count += 1;
  if (filters.requesterIds.length > 0) count += 1;
  if (filters.slaStatus.length > 0) count += 1;
  if (filters.createdFrom || filters.createdTo || filters.updatedFrom || filters.updatedTo || filters.dueFrom || filters.dueTo) count += 1;
  if (filters.q.trim()) count += 1;
  return count;
}

function cloneTicketFilters(filters: TicketFilters): TicketFilters {
  return {
    ...filters,
    statuses: [...filters.statuses],
    priorities: [...filters.priorities],
    teamIds: [...filters.teamIds],
    assigneeIds: [...filters.assigneeIds],
    requesterIds: [...filters.requesterIds],
    slaStatus: [...filters.slaStatus],
  };
}

function clearedTicketFilters(presetScope: TicketScope, presetStatus: StatusFilter): TicketFilters {
  return {
    statusGroup: presetStatus,
    statuses: [],
    priorities: [],
    teamIds: [],
    assigneeIds: [],
    requesterIds: [],
    slaStatus: [],
    createdFrom: '',
    createdTo: '',
    updatedFrom: '',
    updatedTo: '',
    dueFrom: '',
    dueTo: '',
    q: '',
    scope: presetScope,
    sort: 'updatedAt',
    order: 'desc',
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

export function TicketsPage({
  role,
  currentEmail: _currentEmail,
  presetStatus,
  presetScope,
  refreshKey,
  teamsList,
  onCreateTicket,
}: {
  role: Role;
  currentEmail: string;
  presetStatus: StatusFilter;
  presetScope: TicketScope;
  refreshKey: number;
  teamsList: TeamRef[];
  onCreateTicket?: () => void;
}) {
  const headerCtx = useHeaderContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { filters, setFilters, clearFilters, hasActiveFilters, apiParams } = useFilters(
    presetScope,
    presetStatus,
  );
  const toast = useToast();

  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [listMeta, setListMeta] = useState<{ page: number; pageSize: number; total: number; totalPages: number } | null>(null);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [assignableUsers, setAssignableUsers] = useState<UserRef[]>([]);
  const [requesterOptions, setRequesterOptions] = useState<UserRef[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [advancedDraft, setAdvancedDraft] = useState<TicketFilters | null>(null);
  const [searchDraft, setSearchDraft] = useState(filters.q);
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);
  const [rangeAnchorIndex, setRangeAnchorIndex] = useState<number | null>(null);
  const ticketsRequestSeqRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const advancedFiltersDialogRef = useRef<HTMLDivElement>(null);
  const { notifyTicketAggregatesChanged, notifyTicketReportsChanged } = useTicketDataInvalidation();

  useFocusSearchOnShortcut(searchInputRef);

  useEffect(() => {
    setSearchDraft(filters.q);
  }, [filters.q]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchDraft === filters.q) return;
      setFilters({ q: searchDraft }, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.q, searchDraft, setFilters]);

  const openAdvancedFilters = useCallback(() => {
    setAdvancedDraft(cloneTicketFilters(filters));
    setShowAdvancedFilters(true);
  }, [filters]);

  const closeAdvancedFilters = useCallback(() => {
    setShowAdvancedFilters(false);
    setAdvancedDraft(null);
  }, []);

  useModalFocusTrap({
    open: showAdvancedFilters && role !== 'EMPLOYEE',
    containerRef: advancedFiltersDialogRef,
    onClose: closeAdvancedFilters,
  });

  const setAdvancedDraftFilters = useCallback(
    (updates: Partial<TicketFilters>) => {
      setAdvancedDraft((prev) => {
        const base = prev ?? cloneTicketFilters(filters);
        const hasNonPageUpdates = Object.keys(updates).some(
          (key) => !PAGE_KEYS.includes(key as keyof TicketFilters),
        );
        const next = { ...base, ...updates };
        if (hasNonPageUpdates) {
          next.page = 1;
        }
        return next;
      });
    },
    [filters],
  );

  const clearAdvancedDraft = useCallback(() => {
    setAdvancedDraft(clearedTicketFilters(presetScope, presetStatus));
  }, [presetScope, presetStatus]);

  const applyAdvancedDraft = useCallback(() => {
    if (advancedDraft) {
      setFilters(advancedDraft);
    }
    closeAdvancedFilters();
  }, [advancedDraft, closeAdvancedFilters, setFilters]);

  const hasOnlyResolvedStatuses = useMemo(
    () =>
      filters.statuses.length > 0 &&
      filters.statuses.every((status) => status === 'RESOLVED' || status === 'CLOSED'),
    [filters.statuses],
  );

  const effectiveSort = useMemo(
    () =>
      filters.sort === 'completedAt' &&
      filters.statusGroup !== 'resolved' &&
      !hasOnlyResolvedStatuses
        ? 'createdAt'
        : filters.sort,
    [filters.sort, filters.statusGroup, hasOnlyResolvedStatuses],
  );

  const loadTickets = useCallback(async () => {
    const requestSeq = ++ticketsRequestSeqRef.current;
    setLoadingTickets(true);
    setTicketError(null);
    try {
      const response = await fetchTickets({
        ...apiParams,
        sort: effectiveSort,
      });
      if (ticketsRequestSeqRef.current !== requestSeq) return;
      setTickets(response.data);
      setListMeta(response.meta ?? null);
    } catch {
      if (ticketsRequestSeqRef.current !== requestSeq) return;
      setTicketError('Unable to load tickets.');
      setListMeta(null);
    } finally {
      if (ticketsRequestSeqRef.current === requestSeq) {
        setLoadingTickets(false);
      }
    }
  }, [apiParams, effectiveSort]);

  const searchParamsString = searchParams.toString();
  useEffect(() => {
    loadTickets();
  }, [searchParamsString, refreshKey, loadTickets]);

  useEffect(() => {
    if (role === 'EMPLOYEE') {
      setAssignableUsers([]);
      setRequesterOptions([]);
      return;
    }
    setUsersLoading(true);
    fetchUsers()
      .then((res) => {
        setAssignableUsers(res.data);
        setRequesterOptions(res.data);
      })
      .catch(() => {
        setAssignableUsers([]);
        setRequesterOptions([]);
      })
      .finally(() => setUsersLoading(false));
  }, [role]);

  useEffect(() => {
    if (role !== 'OWNER' && filters.teamIds.length > 0) {
      setFilters({ teamIds: [] }, { replace: true });
    }
  }, [filters.teamIds.length, role, setFilters]);

  const ticketIds = useMemo(() => tickets.map((t) => t.id), [tickets]);
  const selection = useTicketSelection(ticketIds);
  const focusedTicketId = tickets[focusedRowIndex]?.id ?? null;

  useEffect(() => {
    if (tickets.length === 0) {
      setFocusedRowIndex(0);
      setRangeAnchorIndex(null);
      return;
    }
    setFocusedRowIndex((prev) => Math.min(prev, tickets.length - 1));
  }, [tickets.length]);

  useEffect(() => {
    function handleTicketListKeyboardShortcuts(event: KeyboardEvent) {
      if (location.pathname !== '/tickets') {
        return;
      }

      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingContext =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isTypingContext) {
        return;
      }

      if (event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setFocusedRowIndex((prev) => Math.min(prev + 1, Math.max(tickets.length - 1, 0)));
        return;
      }

      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setFocusedRowIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (event.key.toLowerCase() === 'x' && role !== 'EMPLOYEE') {
        const currentTicket = tickets[focusedRowIndex];
        if (!currentTicket) return;
        event.preventDefault();

        if (
          event.shiftKey &&
          rangeAnchorIndex !== null &&
          rangeAnchorIndex !== focusedRowIndex
        ) {
          const start = Math.min(rangeAnchorIndex, focusedRowIndex);
          const end = Math.max(rangeAnchorIndex, focusedRowIndex);
          for (let index = start; index <= end; index++) {
            const ticketId = tickets[index]?.id;
            if (ticketId && !selection.isSelected(ticketId)) {
              selection.toggle(ticketId);
            }
          }
          return;
        }

        selection.toggle(currentTicket.id);
        setRangeAnchorIndex(focusedRowIndex);
        return;
      }

      if (event.key === 'Enter') {
        const currentTicket = tickets[focusedRowIndex];
        if (!currentTicket) return;
        event.preventDefault();
        navigate(`/tickets/${currentTicket.id}`, {
          state: { fromTicketsPath: `${location.pathname}${location.search}` },
        });
      }
    }

    window.addEventListener('keydown', handleTicketListKeyboardShortcuts);
    return () => window.removeEventListener('keydown', handleTicketListKeyboardShortcuts);
  }, [
    focusedRowIndex,
    location.pathname,
    location.search,
    navigate,
    rangeAnchorIndex,
    role,
    selection,
    tickets,
  ]);

  async function handleBulkAssign(assigneeId?: string) {
    return bulkAssignTickets(selection.selectedIds, assigneeId);
  }

  async function handleBulkTransfer(newTeamId: string, assigneeId?: string) {
    return bulkTransferTickets(selection.selectedIds, newTeamId, assigneeId);
  }

  async function handleBulkStatus(status: string) {
    return bulkStatusTickets(selection.selectedIds, status);
  }

  async function handleBulkPriority(priority: string) {
    return bulkPriorityTickets(selection.selectedIds, priority);
  }

  const quickAssigneeValue = filters.assigneeIds.length === 1 ? filters.assigneeIds[0] : '';
  const quickPriorityValue = filters.priorities.length === 1 ? filters.priorities[0] : '';
  const sortPreset = sortPresetFromFilters(effectiveSort, filters.order);
  const activeFilterCount = countActiveFilterGroups(filters);
  const drawerFilters = advancedDraft ?? filters;

  const totalCount = listMeta?.total ?? tickets.length;
  const countLabel =
    filters.statuses.length > 0
      ? `${totalCount} tickets`
      : filters.statusGroup === 'open'
      ? `${totalCount} open tickets`
      : filters.statusGroup === 'resolved'
        ? `${totalCount} resolved tickets`
        : `${totalCount} tickets`;

  const pageStart = listMeta ? (listMeta.page - 1) * listMeta.pageSize + 1 : 0;
  const pageEnd = listMeta ? Math.min(listMeta.page * listMeta.pageSize, listMeta.total) : 0;
  const visiblePages = useMemo(() => {
    if (!listMeta) return [] as number[];
    const current = listMeta.page;
    const total = listMeta.totalPages;
    if (total <= 3) return Array.from({ length: total }, (_, index) => index + 1);
    if (current <= 2) return [1, 2, 3];
    if (current >= total - 1) return [total - 2, total - 1, total];
    return [current - 1, current, current + 1];
  }, [listMeta]);

  return (
    <section className="min-h-full bg-slate-50 animate-fade-in">
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1600px] px-6 py-4">
          {headerCtx ? (
            <TopBar
              title={headerCtx.title}
              subtitle={headerCtx.subtitle}
              currentEmail={headerCtx.currentEmail}
              personas={headerCtx.personas}
              onEmailChange={headerCtx.onEmailChange}
              onOpenSearch={headerCtx.onOpenSearch}
              notificationProps={headerCtx.notificationProps}
              leftContent={
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-xl font-semibold text-slate-900">Tickets</h1>
                  <span className="text-sm text-slate-500">({totalCount} tickets)</span>
                </div>
              }
            />
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-semibold text-slate-900">Tickets</h1>
                <span className="text-sm text-slate-500">({totalCount} tickets)</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1600px] px-6 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 border-r border-slate-200 pr-4">
              {(['all', 'open', 'resolved'] as StatusFilter[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={(filters.statusGroup ?? 'all') === value}
                  aria-label={`Filter: ${value === 'all' ? 'All' : value === 'open' ? 'Open' : 'Resolved'}`}
                  onClick={() => setFilters({ statusGroup: value, statuses: [] })}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    (filters.statusGroup ?? 'all') === value
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {value === 'all' ? 'All' : value === 'open' ? 'Open' : 'Resolved'}
                </button>
              ))}
            </div>

            <div className="relative min-w-[240px] flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Search by ticket ID, subject, or description..."
                className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>

            {role !== 'EMPLOYEE' ? (
              <select
                aria-label="Filter by assignee"
                value={quickAssigneeValue}
                onChange={(event) => setFilters({ assigneeIds: event.target.value ? [event.target.value] : [] })}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              >
                <option value="">{usersLoading ? 'Loading users...' : 'Assignee'}</option>
                {assignableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            ) : null}

            <select
              aria-label="Filter by priority"
              value={quickPriorityValue}
              onChange={(event) => setFilters({ priorities: event.target.value ? [event.target.value] : [] })}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              <option value="">Priority</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="P3">P3</option>
              <option value="P4">P4</option>
            </select>

            <select
              aria-label="Sort tickets"
              value={sortPreset}
              onChange={(event) => {
                const preset = event.target.value as SortPreset;
                if (preset === 'updated_desc') setFilters({ sort: 'updatedAt', order: 'desc' });
                if (preset === 'updated_asc') setFilters({ sort: 'updatedAt', order: 'asc' });
                if (preset === 'created_desc') setFilters({ sort: 'createdAt', order: 'desc' });
                if (preset === 'created_asc') setFilters({ sort: 'createdAt', order: 'asc' });
                if (preset === 'completed_desc') setFilters({ sort: 'completedAt', order: 'desc' });
              }}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            >
              <option value="updated_desc">Sort: Newest</option>
              <option value="updated_asc">Sort: Oldest</option>
              <option value="created_desc">Sort: Created</option>
              <option value="created_asc">Sort: Created (oldest)</option>
              <option value="completed_desc">Sort: Completed</option>
            </select>

            {role !== 'EMPLOYEE' ? (
              <button
                type="button"
                onClick={openAdvancedFilters}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 transition-colors hover:bg-slate-50"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Advanced
                {activeFilterCount > 0 ? (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                    {activeFilterCount}
                  </span>
                ) : null}
              </button>
            ) : null}

            {onCreateTicket ? (
              <button
                type="button"
                onClick={onCreateTicket}
                className="ml-auto inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                New Ticket
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] p-6">
        <p className="text-sm text-slate-600">{countLabel}</p>

        {selection.isSomeSelected && role !== 'EMPLOYEE' ? (
          <div className="mt-4">
            <BulkActionsToolbar
              selectedCount={selection.selectedCount}
              onClearSelection={selection.clearSelection}
              onBulkAssign={handleBulkAssign}
              onBulkTransfer={handleBulkTransfer}
              onBulkStatus={handleBulkStatus}
              onBulkPriority={handleBulkPriority}
              teamsList={teamsList}
              assignableUsers={assignableUsers}
              onSuccess={(message) => {
                toast.success(message);
                loadTickets();
                notifyTicketAggregatesChanged();
                notifyTicketReportsChanged();
              }}
              onError={(message) => toast.error(message)}
            />
          </div>
        ) : null}

        {ticketError ? (
          <div className="mt-4">
            <ErrorState
              title="Unable to load tickets"
              description={ticketError}
              onRetry={loadTickets}
              secondaryAction={{ label: 'Go to Dashboard', onClick: () => navigate('/dashboard') }}
            />
          </div>
        ) : null}

        {loadingTickets ? (
          <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-white p-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={`ticket-row-skeleton-${index}`}
                className="h-14 rounded-md border border-slate-200 bg-slate-100 skeleton-shimmer"
              />
            ))}
          </div>
        ) : null}

        {!loadingTickets && !ticketError && tickets.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No tickets found"
              description="Try adjusting your filters or create a new ticket to get started."
              primaryAction={onCreateTicket ? { label: 'Create Ticket', onClick: onCreateTicket } : undefined}
              secondaryAction={hasActiveFilters ? { label: 'Clear filters', onClick: clearFilters } : undefined}
            />
          </div>
        ) : null}

        {!loadingTickets && tickets.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <TicketTableView
              tickets={tickets}
              role={role}
              focusedTicketId={focusedTicketId}
              selection={{
                isSelected: selection.isSelected,
                toggle: selection.toggle,
                toggleAll: selection.toggleAll,
                isAllSelected: selection.isAllSelected,
              }}
              onRowClick={(ticket) =>
                navigate(`/tickets/${ticket.id}`, {
                  state: { fromTicketsPath: `${location.pathname}${location.search}` },
                })
              }
            />
          </div>
        ) : null}

        {!loadingTickets && listMeta && listMeta.total > 0 ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-b-lg border border-t-0 border-slate-200 bg-slate-50 px-6 py-4">
            <div className="text-sm text-slate-700">
              Showing <span className="font-medium">{pageStart}</span> to <span className="font-medium">{pageEnd}</span> of{' '}
              <span className="font-medium">{listMeta.total}</span> results
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                Rows
                <select
                  value={filters.pageSize}
                  onChange={(event) => setFilters({ pageSize: Number(event.target.value), page: 1 })}
                  className="bg-transparent text-sm text-slate-700 focus:outline-none"
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>

              <button
                type="button"
                disabled={listMeta.page <= 1}
                onClick={() => setFilters({ page: listMeta.page - 1 })}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>

              {visiblePages.map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setFilters({ page })}
                  className={`rounded-md px-3 py-2 text-sm ${
                    page === listMeta.page
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {page}
                </button>
              ))}

              <button
                type="button"
                disabled={listMeta.page >= listMeta.totalPages}
                onClick={() => setFilters({ page: listMeta.page + 1 })}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {showAdvancedFilters && role !== 'EMPLOYEE' ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/50"
          onClick={closeAdvancedFilters}
        >
        <div
          ref={advancedFiltersDialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Advanced ticket filters"
          tabIndex={-1}
          className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl animate-fade-in"
          onClick={(event) => event.stopPropagation()}
        >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Advanced Filters</h2>
              <button
                type="button"
                onClick={closeAdvancedFilters}
                className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close advanced filters"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6">
              <FilterPanel
                filters={drawerFilters}
                setFilters={setAdvancedDraftFilters}
                clearFilters={clearAdvancedDraft}
                hasActiveFilters={countActiveFilterGroups(drawerFilters) > 0}
                showTeamFilter={role === 'OWNER'}
                teamsList={teamsList}
                assignableUsers={assignableUsers}
                requesterOptions={requesterOptions}
                drawerMode
                onSaveSuccess={() => {
                  toast.success('View saved');
                }}
                onError={(message) => toast.error(message)}
                onClose={closeAdvancedFilters}
              />
            </div>

            <div className="sticky bottom-0 flex items-center justify-between border-t border-slate-200 bg-white px-6 py-4">
              <button
                type="button"
                onClick={clearAdvancedDraft}
                className="text-sm text-slate-600 transition-colors hover:text-slate-900"
              >
                Clear all
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={closeAdvancedFilters}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyAdvancedDraft}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
