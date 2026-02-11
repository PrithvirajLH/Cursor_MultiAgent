import { TABLE_COLUMN_IDS } from '../../hooks/useTableSettings';
import type { TableColumnId, TableSettings } from '../../hooks/useTableSettings';
import { TableRowSkeleton } from './TableRowSkeleton';

const COLUMN_LABELS: Record<TableColumnId, string> = {
  checkbox: '',
  id: 'ID',
  subject: 'Subject',
  status: 'Status',
  priority: 'Priority',
  team: 'Team',
  assignee: 'Assignee',
  requester: 'Requester',
  createdAt: 'Created',
  slaStatus: 'SLA',
};

/**
 * Table skeleton matching TicketTableView layout (same wrapper and column headers)
 * so loading state has no layout shift when real table appears.
 */
export function TicketTableSkeleton({
  columnWidths,
  columnVisibility,
  showCheckbox = true,
  rowCount = 8,
}: {
  columnWidths: TableSettings['columnWidths'];
  columnVisibility: TableSettings['columnVisibility'];
  showCheckbox?: boolean;
  rowCount?: number;
}) {
  const visibleColumns = TABLE_COLUMN_IDS.filter((id) => columnVisibility[id]);

  return (
    <div className="w-full max-w-full min-w-0 rounded-xl border border-border bg-card shadow-soft overflow-hidden">
      <div className="w-full max-w-full min-w-0 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="sticky top-0 z-[1]">
            <tr className="border-b border-border bg-muted/20">
            {showCheckbox && visibleColumns.includes('checkbox') && (
              <th
                className="sticky left-0 z-[2] border-b border-r border-border bg-muted/20 p-0 text-left"
                style={{ width: columnWidths.checkbox, minWidth: columnWidths.checkbox }}
              >
                <div className="flex h-10 items-center justify-center px-2">
                  <div className="h-4 w-4 rounded skeleton-shimmer" aria-hidden />
                </div>
              </th>
            )}
            {visibleColumns.map((colId) => {
              if (colId === 'checkbox') return null;
              const width = columnWidths[colId];
              return (
                <th
                  key={colId}
                  className="border-b border-border bg-muted/20 px-3 py-2.5 text-left font-semibold text-foreground"
                  style={{ width, minWidth: width }}
                >
                  {COLUMN_LABELS[colId]}
                </th>
              );
            })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }).map((_, index) => (
              <TableRowSkeleton
                key={index}
                showCheckbox={showCheckbox}
                columnVisibility={columnVisibility}
                columnWidths={columnWidths}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
