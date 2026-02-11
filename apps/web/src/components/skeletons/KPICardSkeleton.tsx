import { cn } from '@/lib/utils';

/**
 * Skeleton that matches KPICard layout: icon (h-9 w-9 rounded-lg), value (text-xl), label (text-xs uppercase).
 * Use for dashboard stats loading to avoid layout shift.
 */
export function KPICardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative flex items-center gap-2 rounded-lg border border-border/80 p-3 shadow-card bg-card',
        className
      )}
      aria-hidden
    >
      <div className="h-9 w-9 flex-shrink-0 rounded-lg skeleton-shimmer" />
      <div className="flex-1 min-w-0">
        <div className="h-6 w-16 rounded skeleton-shimmer" />
        <div className="mt-0 h-3 w-24 rounded skeleton-shimmer" />
      </div>
    </div>
  );
}
