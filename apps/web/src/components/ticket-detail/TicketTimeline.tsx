import { memo } from 'react';
import { Clock3, MessageSquare } from 'lucide-react';
import type { TicketEvent } from '../../api/client';
import { RelativeTime } from '../RelativeTime';
import { formatEventText, getEventKind } from './utils';

export type TicketTimelineProps = {
  events: TicketEvent[];
  eventsHasMore: boolean;
  eventsLoading: boolean;
  onLoadMore: () => void;
};

export const TicketTimeline = memo(function TicketTimeline({
  events,
  eventsHasMore,
  eventsLoading,
  onLoadMore,
}: TicketTimelineProps) {
  return (
    <div className="px-4 py-5 sm:px-6">
      {eventsHasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={eventsLoading}
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          {eventsLoading ? 'Loading...' : '↑ Load older events'}
        </button>
      ) : null}

      <div className="mt-5 max-h-[660px] space-y-4 overflow-y-auto">
        {events.length === 0 && !eventsLoading ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No events yet.
          </div>
        ) : null}

        {events.map((event, index) => {
          const eventKind = getEventKind(event);
          return (
            <div key={event.id} className="flex items-start gap-3">
              <div className="relative">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl border ${
                    eventKind === 'message'
                      ? 'border-blue-200 bg-blue-50'
                      : eventKind === 'internal'
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-slate-200 bg-slate-100'
                  }`}
                >
                  {eventKind === 'message' || eventKind === 'internal' ? (
                    <MessageSquare className="h-4 w-4 text-slate-600" />
                  ) : (
                    <Clock3 className="h-4 w-4 text-slate-600" />
                  )}
                </div>
                {index < events.length - 1 ? (
                  <div className="absolute left-1/2 top-9 h-6 w-px -translate-x-1/2 bg-slate-200" />
                ) : null}
              </div>
              <div className="pt-1">
                <p className="text-sm text-slate-900">{formatEventText(event)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  <RelativeTime value={event.createdAt} />
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
