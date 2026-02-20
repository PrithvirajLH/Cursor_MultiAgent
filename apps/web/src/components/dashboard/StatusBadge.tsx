import { cn } from '@/lib/utils';
import { formatStatus } from '@/utils/format';
import { statusBadgeClass } from '@/utils/statusColors';

/**
 * Status badge used in dashboard cards and tables.
 * Uses the centralized status color mapping (7.4 fix).
 */
export function StatusBadge({ status }: { status?: string | null }) {
  const label = status ? formatStatus(status) : 'Unknown';

  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full items-center justify-center overflow-hidden text-ellipsis rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-[0.1em] whitespace-nowrap',
        statusBadgeClass(status),
      )}
      title={label}
    >
      {label}
    </span>
  );
}
