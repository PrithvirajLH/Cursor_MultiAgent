import { cn } from '@/lib/utils';

/**
 * Skeleton matching the ticket detail layout:
 * subject banner, segmented tabs, conversation panel, composer, and sidebar cards.
 */
export function TicketDetailSkeleton({
  count = 5,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn('flex h-full min-h-0 w-full', className)} aria-hidden>
      <div className="flex min-w-0 flex-1 flex-col border-r border-slate-200 bg-white">
        <div className="px-6 pb-0 pt-6">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-sky-50 px-5 py-4 shadow-sm sm:px-7 sm:py-5">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-7 w-3/4 rounded skeleton-shimmer" />
                <div className="h-4 w-[92%] rounded skeleton-shimmer" />
                <div className="h-4 w-2/3 rounded skeleton-shimmer" />
              </div>
              <div className="h-9 w-9 rounded-full skeleton-shimmer" />
            </div>
          </div>
        </div>

        <div className="shrink-0 border-b border-slate-200 px-6 py-3">
          <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100/70 p-1">
            <div className="h-8 w-32 rounded-full skeleton-shimmer" />
            <div className="h-8 w-28 rounded-full skeleton-shimmer" />
            <div className="h-8 w-24 rounded-full skeleton-shimmer" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col bg-[#fafafa]">
          <div className="flex-1 overflow-hidden px-4 py-5 sm:px-6">
            <div className="space-y-4">
              {Array.from({ length: count }).map((_, index) => {
                const ownMessage = index % 2 === 1;
                return (
                  <div
                    key={index}
                    className={cn(
                      'flex items-end gap-2',
                      ownMessage ? 'justify-end' : 'justify-start',
                    )}
                  >
                    {!ownMessage ? (
                      <div className="h-9 w-9 shrink-0 rounded-xl skeleton-shimmer" />
                    ) : null}
                    <div
                      className={cn(
                        'space-y-1',
                        ownMessage ? 'items-end text-right' : 'items-start text-left',
                      )}
                    >
                      <div className="h-3 w-28 rounded skeleton-shimmer" />
                      <div className="inline-flex max-w-full flex-col gap-2 rounded-[20px] border border-slate-200 bg-white px-4 py-3">
                        <div className={cn('h-3 rounded skeleton-shimmer', ownMessage ? 'w-52' : 'w-64')} />
                        <div className={cn('h-3 rounded skeleton-shimmer', ownMessage ? 'w-44' : 'w-56')} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-6 sm:px-6 sm:py-7">
            <div className="mx-auto w-full max-w-4xl">
              <div className="h-14 w-full rounded-full skeleton-shimmer" />
            </div>
          </div>
        </div>
      </div>

      <aside className="hidden w-80 shrink-0 overflow-y-auto bg-slate-50 lg:block">
        <div className="space-y-3 px-3 pb-6 pt-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 h-4 w-24 rounded skeleton-shimmer" />
            <div className="space-y-2">
              <div className="h-9 w-full rounded-xl skeleton-shimmer" />
              <div className="h-9 w-full rounded-xl skeleton-shimmer" />
              <div className="h-9 w-full rounded-xl skeleton-shimmer" />
              <div className="h-9 w-full rounded-xl skeleton-shimmer" />
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 h-3 w-16 rounded skeleton-shimmer" />
            <div className="space-y-2">
              <div className="h-12 w-full rounded-xl skeleton-shimmer" />
              <div className="h-12 w-full rounded-xl skeleton-shimmer" />
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 h-3 w-14 rounded skeleton-shimmer" />
            <div className="space-y-2">
              <div className="h-4 w-full rounded skeleton-shimmer" />
              <div className="h-4 w-5/6 rounded skeleton-shimmer" />
              <div className="h-4 w-3/4 rounded skeleton-shimmer" />
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
