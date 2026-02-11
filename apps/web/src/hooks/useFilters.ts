import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SortField, SortOrder, StatusFilter, SlaStatusFilter, TicketFilters, TicketScope } from '../types';

function parseArray(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : value;
}

const DEFAULT_PAGE_SIZE = 50;

function parseFilters(searchParams: URLSearchParams, presetScope?: TicketScope, presetStatus?: StatusFilter): TicketFilters {
  const scope = (searchParams.get('scope') as TicketScope) || presetScope || 'all';
  const statusGroup = (searchParams.get('statusGroup') as StatusFilter) || presetStatus || undefined;
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  return {
    statusGroup,
    statuses: parseArray(searchParams.get('statuses')),
    priorities: parseArray(searchParams.get('priorities')),
    teamIds: parseArray(searchParams.get('teamIds')),
    assigneeIds: parseArray(searchParams.get('assigneeIds')),
    requesterIds: parseArray(searchParams.get('requesterIds')),
    slaStatus: parseArray(searchParams.get('slaStatus')) as SlaStatusFilter[],
    createdFrom: parseDate(searchParams.get('createdFrom')),
    createdTo: parseDate(searchParams.get('createdTo')),
    updatedFrom: parseDate(searchParams.get('updatedFrom')),
    updatedTo: parseDate(searchParams.get('updatedTo')),
    dueFrom: parseDate(searchParams.get('dueFrom')),
    dueTo: parseDate(searchParams.get('dueTo')),
    q: searchParams.get('q') ?? '',
    scope,
    sort: (searchParams.get('sort') as SortField) || 'updatedAt',
    order: (searchParams.get('order') as SortOrder) || 'desc',
    page,
    pageSize,
  };
}

function filtersToSearchParams(filters: Partial<TicketFilters>): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.statusGroup) params.set('statusGroup', filters.statusGroup);
  if (filters.statuses && filters.statuses.length > 0) params.set('statuses', filters.statuses.join(','));
  if (filters.priorities && filters.priorities.length > 0) params.set('priorities', filters.priorities.join(','));
  if (filters.teamIds && filters.teamIds.length > 0) params.set('teamIds', filters.teamIds.join(','));
  if (filters.assigneeIds && filters.assigneeIds.length > 0) params.set('assigneeIds', filters.assigneeIds.join(','));
  if (filters.requesterIds && filters.requesterIds.length > 0) params.set('requesterIds', filters.requesterIds.join(','));
  if (filters.slaStatus && filters.slaStatus.length > 0) params.set('slaStatus', filters.slaStatus.join(','));
  if (filters.createdFrom) params.set('createdFrom', filters.createdFrom);
  if (filters.createdTo) params.set('createdTo', filters.createdTo);
  if (filters.updatedFrom) params.set('updatedFrom', filters.updatedFrom);
  if (filters.updatedTo) params.set('updatedTo', filters.updatedTo);
  if (filters.dueFrom) params.set('dueFrom', filters.dueFrom);
  if (filters.dueTo) params.set('dueTo', filters.dueTo);
  if (filters.q) params.set('q', filters.q);
  if (filters.scope && filters.scope !== 'all') params.set('scope', filters.scope);
  if (filters.sort && filters.sort !== 'updatedAt') params.set('sort', filters.sort);
  if (filters.order && filters.order !== 'desc') params.set('order', filters.order);
  if (filters.page != null && filters.page > 1) params.set('page', String(filters.page));
  if (filters.pageSize != null && filters.pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(filters.pageSize));
  return params;
}

export function useFilters(presetScope?: TicketScope, presetStatus?: StatusFilter) {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(
    () => parseFilters(searchParams, presetScope, presetStatus),
    [searchParams, presetScope, presetStatus],
  );

  const PAGE_KEYS = ['page', 'pageSize'] as const;

  const setFilters = useCallback(
    (updates: Partial<TicketFilters>, options?: { replace?: boolean }) => {
      const hasNonPageUpdates = Object.keys(updates).some(
        (k) => !PAGE_KEYS.includes(k as (typeof PAGE_KEYS)[number]),
      );
      const next = { ...filters, ...updates };
      if (hasNonPageUpdates) {
        next.page = 1;
      }
      const params = filtersToSearchParams(next);
      setSearchParams(params, { replace: options?.replace ?? false });
    },
    [filters, setSearchParams],
  );

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams();
    const scope = presetScope ?? 'all';
    if (scope !== 'all') params.set('scope', scope);
    if (presetStatus) params.set('statusGroup', presetStatus);
    setSearchParams(params, { replace: true });
  }, [presetScope, presetStatus, setSearchParams]);

  const hasActiveFilters = useMemo(() => {
    return (
      filters.statuses.length > 0 ||
      filters.priorities.length > 0 ||
      filters.teamIds.length > 0 ||
      filters.assigneeIds.length > 0 ||
      filters.requesterIds.length > 0 ||
      filters.slaStatus.length > 0 ||
      !!filters.createdFrom ||
      !!filters.createdTo ||
      !!filters.updatedFrom ||
      !!filters.updatedTo ||
      !!filters.dueFrom ||
      !!filters.dueTo ||
      !!filters.q.trim()
    );
  }, [filters]);

  const apiParams = useMemo(() => {
    const p: Record<string, string | number | undefined | string[]> = {
      page: filters.page ?? 1,
      pageSize: filters.pageSize ?? DEFAULT_PAGE_SIZE,
      scope: filters.scope === 'all' ? undefined : filters.scope,
      sort: filters.sort,
      order: filters.order,
    };
    if (filters.statuses.length) {
      p.statuses = filters.statuses;
    } else if (filters.statusGroup) {
      p.statusGroup = filters.statusGroup;
    }
    if (filters.priorities.length) p.priorities = filters.priorities;
    if (filters.teamIds.length) p.teamIds = filters.teamIds;
    if (filters.assigneeIds.length) p.assigneeIds = filters.assigneeIds;
    if (filters.requesterIds.length) p.requesterIds = filters.requesterIds;
    if (filters.slaStatus.length) p.slaStatus = filters.slaStatus;
    if (filters.createdFrom) p.createdFrom = filters.createdFrom;
    if (filters.createdTo) p.createdTo = filters.createdTo;
    if (filters.updatedFrom) p.updatedFrom = filters.updatedFrom;
    if (filters.updatedTo) p.updatedTo = filters.updatedTo;
    if (filters.dueFrom) p.dueFrom = filters.dueFrom;
    if (filters.dueTo) p.dueTo = filters.dueTo;
    if (filters.q.trim()) p.q = filters.q.trim();
    return p;
  }, [filters]);

  return { filters, setFilters, clearFilters, hasActiveFilters, apiParams };
}
