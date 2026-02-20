import { cn } from '../../lib/utils';

/* ——————————————————————————————————————————————————————————————
 * Skeleton primitives – consistent loading states across pages.
 *
 * Uses the existing `skeleton-shimmer` class from styles.css.
 * All pages should use these instead of ad-hoc loading text.
 * —————————————————————————————————————————————————————————————— */

/** Base skeleton block – shimmer rectangle with configurable size. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton-shimmer rounded', className)} />;
}

/** Row of KPI card skeletons (e.g. 4 stat boxes). */
export function KpiGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={`kpi-skel-${i}`}
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="mb-2 h-7 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/** Card list skeleton (stacked cards like rules, policies). */
export function CardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={`card-skel-${i}`}
          className="rounded-xl border border-slate-200 bg-white p-5"
        >
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3.5 w-56" />
            </div>
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Table skeleton with header row + body rows. */
export function TableSkeleton({
  columns = 5,
  rows = 6,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton
            key={`th-${i}`}
            className={cn('h-4', i === 0 ? 'w-40' : 'w-24')}
          />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, ri) => (
        <div
          key={`tr-${ri}`}
          className="flex items-center gap-4 border-b border-slate-100 px-4 py-3.5 last:border-0"
        >
          {Array.from({ length: columns }).map((_, ci) => (
            <Skeleton
              key={`td-${ri}-${ci}`}
              className={cn(
                'h-4',
                ci === 0 ? 'w-40' : ci === columns - 1 ? 'w-16' : 'w-24',
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Chart placeholder skeleton (single large card). */
export function ChartSkeleton({ height = 'h-72' }: { height?: string }) {
  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white p-6', height)}>
      <Skeleton className="mb-4 h-5 w-32" />
      <Skeleton className="h-3/4 w-full rounded-lg" />
    </div>
  );
}

/** Triage / Kanban column skeleton. */
export function ColumnSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="w-80 flex-shrink-0">
      <Skeleton className="mb-3 h-5 w-28" />
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={`col-card-${i}`}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <Skeleton className="mb-2 h-4 w-3/4" />
            <Skeleton className="mb-3 h-3 w-1/2" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Full-page skeleton combining KPIs + chart area. */
export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <KpiGridSkeleton />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}
