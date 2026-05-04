import { useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchTickets } from '../../api/client';
import { ticketToRow } from '../tickets/mappers';
import { useFilters } from '../../hooks/useFilters';
import { useAuthSession } from '../../hooks/useAuthSession';
import { Pill, Prio, Avatar } from '../atoms';

interface MidListProps {
  /** Ticket id for the row that should appear highlighted (the one currently open). */
  currentTicketId: string | undefined;
}

/**
 * Compact ticket-list rail for the detail screen.
 *
 *  - Reuses `useFilters` so URL params keep the list in sync with `/tickets-revamp`.
 *  - Same `tickets-revamp` queryKey as the list page → React Query dedupes the fetch.
 *  - Each row links to `/tickets-revamp/:id` preserving the current `location.search`,
 *    so swapping tickets keeps filters/sort intact.
 */
export function MidList({ currentTicketId }: MidListProps) {
  const { apiParams } = useFilters();
  const search = window.location.search; // raw query string, preserves order
  const { user, loading: authLoading } = useAuthSession();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tickets-revamp', apiParams],
    queryFn: ({ signal }) => fetchTickets(apiParams, { signal }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled: !!user && !authLoading,
  });

  const rows = useMemo(
    () => (data?.data ?? []).map(ticketToRow),
    [data],
  );

  if (isLoading && rows.length === 0) {
    return (
      <div className="p-3 text-[12px]" style={{ color: 'var(--c-fg-4)' }}>
        Loading…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-3 text-[12px]" style={{ color: 'var(--c-red)' }}>
        Couldn't load
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-3 text-[12px]" style={{ color: 'var(--c-fg-4)' }}>
        No tickets match the current filters.
      </div>
    );
  }

  return (
    <ul className="flex flex-col">
      {rows.map(t => {
        const isCurrent = t.id === currentTicketId;
        return (
          <li key={t.id}>
            <Link
              to={`/tickets-revamp/${t.id}${search}`}
              className="block px-3 py-2 border-b text-[12px]"
              style={{
                borderColor: 'var(--c-divider)',
                backgroundColor: isCurrent ? 'var(--c-accent-tint)' : 'transparent',
                boxShadow: isCurrent
                  ? 'inset 3px 0 0 0 var(--c-accent)'
                  : undefined,
                color: 'var(--c-fg)',
              }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Prio level={t.priority} />
                <span
                  className="font-mono text-[10px]"
                  style={{ color: 'var(--c-fg-4)' }}
                >
                  {t.displayId}
                </span>
                <span className="flex-1" />
                <Pill tone={t.statusTone} dot>
                  {t.status}
                </Pill>
              </div>

              <div
                className="font-medium leading-tight mb-1"
                style={{ color: 'var(--c-fg)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
              >
                {t.subject}
              </div>

              <div
                className="flex items-center gap-1.5 text-[11px]"
                style={{ color: 'var(--c-fg-4)' }}
              >
                <Avatar
                  name={t.assigneeInitials}
                  size="sm"
                  tone={t.assigneeTone}
                />
                <span className="truncate flex-1">
                  {t.customer}
                </span>
                <span className="font-mono">{t.updated}</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
