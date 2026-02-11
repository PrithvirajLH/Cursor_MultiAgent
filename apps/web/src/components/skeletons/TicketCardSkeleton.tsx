import { cn } from '@/lib/utils';

/**
 * Skeleton for ticket grid card. Matches TicketsPage grid row:
 * [checkbox?] [subject + meta line | status badge + date]
 */
export function TicketCardSkeleton({
  showCheckbox = true,
  className,
}: {
  showCheckbox?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 w-full rounded-2xl border border-border bg-card px-4 py-3',
        className
      )}
      aria-hidden
    >
      {showCheckbox && (
        <div className="h-4 w-4 flex-shrink-0 rounded border border-border skeleton-shimmer" />
      )}
      <div className="flex-1 flex items-center justify-between min-w-0 text-left">
        <div className="min-w-0 space-y-1">
          <div className="h-3.5 w-48 rounded skeleton-shimmer" />
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-24 rounded skeleton-shimmer" />
            <div className="h-5 w-20 rounded-full skeleton-shimmer" />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="h-5 w-16 rounded-full skeleton-shimmer" />
          <div className="h-3 w-12 rounded skeleton-shimmer" />
        </div>
      </div>
    </div>
  );
}
