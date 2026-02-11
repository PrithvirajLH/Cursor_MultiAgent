import { cn } from '@/lib/utils';
import { AvatarSkeleton } from './AvatarSkeleton';

/**
 * Skeleton for ticket detail page: message bubbles (avatar + 2 lines) matching conversation layout.
 * Use while ticket and messages are loading to avoid layout shift.
 */
export function TicketDetailSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('mt-4 space-y-4', className)} aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex items-start gap-3">
          <AvatarSkeleton />
          <div className="flex flex-col max-w-[75%] space-y-2">
            <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 space-y-2">
              <div className="h-3 w-28 rounded skeleton-shimmer" />
              <div className="h-3 w-48 rounded skeleton-shimmer" />
            </div>
            <div className="h-3 w-16 rounded skeleton-shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}
