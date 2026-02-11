import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TicketDetail, TicketEvent, TicketMessage } from '../api/client';
import { TimelineEvent } from './TimelineEvent';
import { formatDate } from '../utils/format';

const EVENT_TYPE_LABELS: Record<string, string> = {
  TICKET_CREATED: 'Ticket created',
  TICKET_STATUS_CHANGED: 'Status changed',
  TICKET_ASSIGNED: 'Assigned',
  TICKET_TRANSFERRED: 'Team transferred',
  TICKET_PRIORITY_CHANGED: 'Priority changed',
  PRIORITY_BUMPED: 'Priority bumped',
  MESSAGE_ADDED: 'Message',
  ATTACHMENT_ADDED: 'Attachment',
  SLA_BREACHED: 'SLA breached',
  SLA_AT_RISK: 'SLA at risk'
};

function getDateKey(createdAt: string): string {
  const d = new Date(createdAt);
  return d.toISOString().slice(0, 10);
}

type ActivityTimelineProps = {
  ticket: TicketDetail;
  events: TicketEvent[];
  messages: TicketMessage[];
  /** When 'EMPLOYEE', internal note events are excluded from the timeline. */
  role?: string;
  /** Event type filter: show only these types (empty = all). */
  eventTypeFilter?: string[];
  /** Collapse same-day groups by default. */
  collapseGroups?: boolean;
};

export function ActivityTimeline({
  ticket,
  events: timelineEvents,
  messages,
  role,
  eventTypeFilter = [],
  collapseGroups = false
}: ActivityTimelineProps) {
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(() => new Set());
  const [typeFilter, setTypeFilter] = useState<string[]>(eventTypeFilter);

  const rawEvents = timelineEvents ?? [];

  const events = useMemo(() => {
    if (role !== 'EMPLOYEE') return rawEvents;
    return rawEvents.filter((e) => {
      if (e.type !== 'MESSAGE_ADDED') return true;
      const payloadType = e.payload?.type as string | undefined;
      return payloadType !== 'INTERNAL';
    });
  }, [rawEvents, role]);

  useEffect(() => {
    setTypeFilter(eventTypeFilter);
  }, [eventTypeFilter]);

  useEffect(() => {
    if (collapseGroups && events.length > 0) {
      setCollapsedDates(new Set(events.map((e) => getDateKey(e.createdAt))));
    } else if (!collapseGroups) {
      setCollapsedDates(new Set());
    }
  }, [collapseGroups, events]);

  const messageById = useMemo(() => {
    const map = new Map<string, TicketMessage>();
    messages.forEach((m) => map.set(m.id, m));
    return map;
  }, [messages]);

  const sortedEvents = useMemo(() => {
    const list = [...events].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    if (typeFilter.length === 0) return list;
    return list.filter((e) => typeFilter.includes(e.type));
  }, [events, typeFilter]);

  const groupedByDate = useMemo(() => {
    const groups: { dateKey: string; dateLabel: string; events: TicketEvent[] }[] = [];
    let current: { dateKey: string; dateLabel: string; events: TicketEvent[] } | null = null;
    for (const event of sortedEvents) {
      const dateKey = getDateKey(event.createdAt);
      const dateLabel = formatDate(event.createdAt) ?? dateKey;
      if (!current || current.dateKey !== dateKey) {
        current = { dateKey, dateLabel, events: [] };
        groups.push(current);
      }
      current.events.push(event);
    }
    return groups;
  }, [sortedEvents]);

  // From filtered events only so EMPLOYEE never sees "Message" chip when only internal notes exist
  const uniqueTypes = useMemo(() => {
    const set = new Set(events.map((e) => e.type));
    return Array.from(set).sort();
  }, [events]);

  const toggleDate = (dateKey: string) => {
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  };

  if (events.length === 0) {
    return (
      <div className="py-10 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
        <p className="text-sm font-medium text-slate-600">No activity yet</p>
        <p className="text-xs text-slate-500 mt-1">
          Events will appear here as the ticket is updated (status changes, assignments, messages, and more).
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {uniqueTypes.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Filter:</span>
          {uniqueTypes.map((type) => {
            const active = typeFilter.length === 0 || typeFilter.includes(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setTypeFilter((prev) => {
                    if (prev.includes(type)) {
                      const next = prev.filter((t) => t !== type);
                      return next;
                    }
                    return [...prev, type];
                  });
                }}
                className={`text-xs px-2 py-1 rounded-full border transition ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {EVENT_TYPE_LABELS[type] ?? type.replace(/_/g, ' ')}
              </button>
            );
          })}
          {typeFilter.length > 0 && (
            <button
              type="button"
              onClick={() => setTypeFilter([])}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {groupedByDate.map(({ dateKey, dateLabel, events }) => {
          const isCollapsed = collapsedDates.has(dateKey);
          return (
            <div key={dateKey} className="py-2 first:pt-0">
              <button
                type="button"
                onClick={() => toggleDate(dateKey)}
                className="flex items-center gap-2 w-full text-left text-xs font-medium text-slate-500 hover:text-slate-700 py-1"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
                )}
                {dateLabel}
                <span className="text-slate-400 font-normal">({events.length})</span>
              </button>
              {!isCollapsed &&
                events.map((event) => {
                  const message =
                    event.type === 'MESSAGE_ADDED' && event.payload?.messageId
                      ? messageById.get(String(event.payload.messageId))
                      : null;
                  return (
                    <TimelineEvent
                      key={event.id}
                      event={event}
                      message={message ?? undefined}
                      ticket={ticket}
                    />
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
