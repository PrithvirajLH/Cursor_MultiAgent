import { memo } from "react";
import { Clock3, MessageSquare } from "lucide-react";
import type { TicketEvent } from "../../api/client";
import { RelativeTime } from "../RelativeTime";
import { formatEventText, getEventKind } from "./utils";

export type TicketTimelineProps = {
  events: TicketEvent[];
  eventsHasMore: boolean;
  eventsLoading: boolean;
  eventsError: string | null;
  onLoadMore: () => void;
  onRetryLoad: () => void;
};

export const TicketTimeline = memo(function TicketTimeline({
  events,
  eventsHasMore,
  eventsLoading,
  eventsError,
  onLoadMore,
  onRetryLoad,
}: TicketTimelineProps) {
  return (
    <div className="px-4 py-5 sm:px-6">
      {eventsHasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={eventsLoading}
          className="text-sm font-medium text-primary hover:text-primary/80"
        >
          {eventsLoading ? "Loading..." : "↑ Load older events"}
        </button>
      ) : null}

      {/*
        ⚠️ CARD 1.120: THE PANEL IS THE SCROLLER NOW, SO THIS ONE GOES.
        `max-h-[660px] overflow-y-auto` was a workaround from when the tab panel
        could not scroll at all - it bounded the list so SOMETHING was reachable.
        With the panel scrolling, keeping it nests two scrollbars: measured at a
        700px viewport the panel was 415px tall and this list was still capped at
        660px, so a reader scrolled the inner list and then had to scroll the
        panel as well. One scroller per panel.

        The "Load older events" button above now scrolls with the content, which
        is the right way round: it sits at the TOP, so scrolling up to reach it
        is the same gesture as looking for older items.
      */}
      <div className="mt-5 space-y-4">
        {eventsError ? (
          <div
            className="rounded-xl border border-amber-200 bg-amber-500/10 p-4 text-left"
            role="alert"
          >
            <p className="text-sm font-semibold text-amber-200">
              Timeline unavailable
            </p>
            <p className="mt-1 text-sm text-amber-300">{eventsError}</p>
            <button
              type="button"
              onClick={onRetryLoad}
              className="mt-3 inline-flex rounded-lg border border-amber-500/50 bg-amber-950/30 px-3 py-1.5 text-sm font-medium text-amber-200 hover:bg-amber-900/40"
            >
              Retry loading timeline
            </button>
          </div>
        ) : null}

        {events.length === 0 && !eventsLoading && !eventsError ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
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
                    eventKind === "message"
                      ? "border-blue-200 bg-primary/10"
                      : eventKind === "internal"
                        ? "border-amber-200 bg-amber-500/10"
                        : "border-border bg-muted"
                  }`}
                >
                  {eventKind === "message" || eventKind === "internal" ? (
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Clock3 className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                {index < events.length - 1 ? (
                  <div className="absolute left-1/2 top-9 h-6 w-px -translate-x-1/2 bg-accent" />
                ) : null}
              </div>
              <div className="pt-1">
                <p className="text-sm text-foreground">
                  {formatEventText(event)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
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
