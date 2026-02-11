import { LayoutGrid, Table2 } from 'lucide-react';
import type { ViewMode } from '../hooks/useTableSettings';

export function ViewToggle({
  value,
  onChange,
  className = '',
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Grid or table view"
      className={`inline-flex rounded-xl border border-border bg-muted/20 p-0.5 ${className}`}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' && value === 'table') {
          e.preventDefault();
          onChange('grid');
        }
        if (e.key === 'ArrowRight' && value === 'grid') {
          e.preventDefault();
          onChange('table');
        }
      }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === 'grid'}
        id="view-toggle-grid"
        tabIndex={value === 'grid' ? 0 : -1}
        onClick={() => onChange('grid')}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 ${
          value === 'grid'
            ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-600'
            : 'text-slate-600 hover:bg-white hover:text-slate-900'
        }`}
      >
        <LayoutGrid className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
        Grid
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'table'}
        id="view-toggle-table"
        tabIndex={value === 'table' ? 0 : -1}
        onClick={() => onChange('table')}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 ${
          value === 'table'
            ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-600'
            : 'text-slate-600 hover:bg-white hover:text-slate-900'
        }`}
      >
        <Table2 className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
        Table
      </button>
    </div>
  );
}
