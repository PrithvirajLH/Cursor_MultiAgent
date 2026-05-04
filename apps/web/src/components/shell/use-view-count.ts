import { useQueries } from '@tanstack/react-query';
import { fetchTickets } from '../../api/client';

/**
 * Returns the live count for a single filter set by hitting `/tickets`
 * with `pageSize=1` and reading `meta.total`. Caching dedupes identical filters.
 *
 * Use `useViewCounts` (plural) for an array of filter sets — issues parallel
 * queries and returns counts in the same order.
 */

type FilterParams = Record<string, string | number | boolean | undefined | string[]>;

const DEFAULT_STALE_MS = 60_000;

/**
 * Parallel count fetch for an array of filter sets.
 * Each entry is keyed by stringified params for cache stability.
 *
 * Returns `{ count: number | undefined, isLoading: boolean }` per input,
 * in the same order.
 */
export function useViewCounts(filters: FilterParams[], options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;

  return useQueries({
    queries: filters.map(f => ({
      queryKey: ['view-count', f] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchTickets({ ...f, pageSize: 1 }, { signal }),
      staleTime: DEFAULT_STALE_MS,
      enabled,
      // Counts are not user-visible during loading — keep stale data.
      placeholderData: (prev: { meta?: { total: number } } | undefined) => prev,
    })),
    combine: (results: Array<{ data?: { meta?: { total: number } }; isLoading: boolean }>) =>
      results.map(r => ({
        count: r.data?.meta?.total,
        isLoading: r.isLoading,
      })),
  });
}

/**
 * Convert a saved view's filters object (as stored in the SavedView record)
 * into the params shape `fetchTickets` expects.
 *
 * The shape is the same — just makes intent explicit at call sites.
 */
export function viewFiltersToParams(filters: Record<string, unknown>): FilterParams {
  const out: FilterParams = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      const arr = v.filter(x => x != null).map(x => String(x));
      if (arr.length) out[k] = arr;
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Convert a `?key=value&...` query string (e.g. from preset.buildQuery())
 * to a FilterParams object suitable for `fetchTickets`.
 */
export function querystringToParams(query: string): FilterParams {
  const sp = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const out: FilterParams = {};
  for (const [k, v] of sp.entries()) {
    // Values that look like comma-lists become arrays — matches how
    // fetchTickets serializes arrays back to comma-joined strings.
    if (v.includes(',')) out[k] = v.split(',');
    else out[k] = v;
  }
  return out;
}
