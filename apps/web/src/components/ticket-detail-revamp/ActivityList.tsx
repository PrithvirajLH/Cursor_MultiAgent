import { useQuery } from '@tanstack/react-query';
import {
  fetchTicketEvents,
  type TicketEvent,
} from '../../api/client';
import { useAuthSession } from '../../hooks/useAuthSession';
import { Icn, I } from '../atoms';

interface ActivityListProps {
  ticketId: string;
}

const ICON_FOR_TYPE: Record<string, typeof I.inbox> = {
  TICKET_CREATED:           I.plus,
  TICKET_STATUS_CHANGED:    I.flag,
  TICKET_ASSIGNED:          I.users,
  TICKET_TRANSFERRED:       I.link,
  TICKET_PRIORITY_CHANGED:  I.alert,
  TICKET_MESSAGE_ADDED:     I.msg,
  TICKET_REOPENED:          I.history,
  TICKET_RESOLVED:          I.check,
  TICKET_CLOSED:            I.check,
};

function humanize(type: string): string {
  return type
    .replace(/^TICKET_/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, c => c.toUpperCase());
}

function summarize(event: TicketEvent): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  switch (event.type) {
    case 'TICKET_STATUS_CHANGED': {
      const to = payload.to as string | undefined;
      return to ? `Status → ${to.replace(/_/g, ' ').toLowerCase()}` : 'Status changed';
    }
    case 'TICKET_PRIORITY_CHANGED': {
      const to = payload.to as string | undefined;
      return to ? `Priority → ${to}` : 'Priority changed';
    }
    case 'TICKET_ASSIGNED': {
      const name = (payload.assigneeName ?? payload.toName) as string | undefined;
      return name ? `Assigned to ${name}` : 'Assigned';
    }
    case 'TICKET_TRANSFERRED': {
      const teamName = (payload.toTeamName ?? payload.teamName) as string | undefined;
      return teamName ? `Transferred to ${teamName}` : 'Transferred';
    }
    case 'TICKET_CREATED':
      return 'Created';
    default:
      return humanize(event.type);
  }
}

function relTime(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ActivityList({ ticketId }: ActivityListProps) {
  const { user, loading: authLoading } = useAuthSession();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ticket-events-revamp', ticketId],
    queryFn: () => fetchTicketEvents(ticketId, { take: 30 }),
    enabled: !!user && !authLoading,
  });

  if (isLoading) {
    return (
      <div className="text-[11px]" style={{ color: 'var(--c-fg-4)' }}>
        Loading activity…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-[11px]" style={{ color: 'var(--c-red)' }}>
        Couldn't load activity
      </div>
    );
  }

  const events = data?.data ?? [];

  if (events.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--c-fg-4)' }}>
        <Icn d={I.history} s={12} />
        <span>No activity yet</span>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {events.map(ev => {
        const icon = ICON_FOR_TYPE[ev.type] ?? I.history;
        const text = summarize(ev);
        const who = ev.createdBy?.displayName;
        return (
          <li key={ev.id} className="flex items-start gap-2 text-[11px]">
            <span
              className="flex-none w-4 h-4 rounded-full inline-flex items-center justify-center mt-px"
              style={{ backgroundColor: 'var(--c-surface-3)', color: 'var(--c-fg-3)' }}
            >
              <Icn d={icon} s={10} />
            </span>
            <div className="flex-1 min-w-0 leading-tight">
              <div style={{ color: 'var(--c-fg-2)' }}>
                {text}
                {who && (
                  <span style={{ color: 'var(--c-fg-4)' }}>
                    {' · '}
                    {who}
                  </span>
                )}
              </div>
              <div className="font-mono mt-0.5" style={{ color: 'var(--c-fg-4)' }}>
                {relTime(ev.createdAt)}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
