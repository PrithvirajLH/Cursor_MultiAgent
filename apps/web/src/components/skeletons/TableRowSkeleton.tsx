import { cn } from '@/lib/utils';
import { DEFAULT_WIDTHS } from '../../hooks/useTableSettings';
import type { TableColumnId } from '../../hooks/useTableSettings';
import { TABLE_COLUMN_IDS } from '../../hooks/useTableSettings';

/**
 * Single table row skeleton matching TicketTableView row layout.
 * Uses same column widths as real table to avoid layout shift.
 */
export function TableRowSkeleton({
  showCheckbox = true,
  columnVisibility,
  columnWidths,
  className,
}: {
  showCheckbox?: boolean;
  columnVisibility?: Record<TableColumnId, boolean>;
  columnWidths?: Record<TableColumnId, number>;
  className?: string;
}) {
  const visibleColumns = TABLE_COLUMN_IDS.filter(
    (id) => id === 'checkbox' || (columnVisibility ?? { [id]: true })[id]
  );
  const widths = columnWidths ?? DEFAULT_WIDTHS;

  return (
    <tr className={cn('border-b border-border/60', className)} aria-hidden>
      {showCheckbox && visibleColumns.includes('checkbox') && (
        <td
          className="sticky left-0 z-[2] border-b border-r border-border/60 bg-card p-0"
          style={{ width: widths.checkbox, minWidth: widths.checkbox }}
        >
          <div className="flex h-12 items-center justify-center px-2">
            <div className="h-4 w-4 rounded skeleton-shimmer" />
          </div>
        </td>
      )}
      {visibleColumns.includes('id') && (
        <td
          className="border-b border-border/60 px-3 py-2"
          style={{ width: widths.id, minWidth: widths.id }}
        >
          <div className="h-3 w-14 rounded skeleton-shimmer" />
        </td>
      )}
      {visibleColumns.includes('subject') && (
        <td
          className="border-b border-border/60 px-3 py-2"
          style={{ width: widths.subject, minWidth: widths.subject }}
        >
          <div className="h-3 w-40 rounded skeleton-shimmer" />
        </td>
      )}
      {visibleColumns.includes('status') && (
        <td
          className="border-b border-border/60 px-3 py-2"
          style={{ width: widths.status, minWidth: widths.status }}
        >
          <div className="h-5 w-16 rounded-full skeleton-shimmer" />
        </td>
      )}
      {visibleColumns.includes('priority') && (
        <td
          className="border-b border-border/60 px-3 py-2"
          style={{ width: widths.priority, minWidth: widths.priority }}
        >
          <div className="h-3 w-8 rounded skeleton-shimmer" />
        </td>
      )}
      {visibleColumns.includes('team') && (
        <td
          className="border-b border-border/60 px-3 py-2"
          style={{ width: widths.team, minWidth: widths.team }}
        >
          <div className="h-3 w-20 rounded skeleton-shimmer" />
        </td>
      )}
      {visibleColumns.includes('assignee') && (
        <td
          className="border-b border-border/60 px-3 py-2"
          style={{ width: widths.assignee, minWidth: widths.assignee }}
        >
          <div className="h-3 w-24 rounded skeleton-shimmer" />
        </td>
      )}
      {visibleColumns.includes('requester') && (
        <td
          className="border-b border-border/60 px-3 py-2"
          style={{ width: widths.requester, minWidth: widths.requester }}
        >
          <div className="h-3 w-24 rounded skeleton-shimmer" />
        </td>
      )}
      {visibleColumns.includes('createdAt') && (
        <td
          className="border-b border-border/60 px-3 py-2"
          style={{ width: widths.createdAt, minWidth: widths.createdAt }}
        >
          <div className="h-3 w-16 rounded skeleton-shimmer" />
        </td>
      )}
      {visibleColumns.includes('slaStatus') && (
        <td
          className="border-b border-border/60 px-3 py-2"
          style={{ width: widths.slaStatus, minWidth: widths.slaStatus }}
        >
          <div className="h-5 w-14 rounded-full skeleton-shimmer" />
        </td>
      )}
    </tr>
  );
}
