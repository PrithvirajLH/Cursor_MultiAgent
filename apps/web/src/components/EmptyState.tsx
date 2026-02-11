import { Inbox } from 'lucide-react';

type Action = { label: string; onClick: () => void };

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  primaryAction,
  secondaryAction,
  compact = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  primaryAction?: Action;
  secondaryAction?: Action;
  /** When true, use smaller spacing and text (e.g. inside a column). */
  compact?: boolean;
}) {
  const IconComponent = Icon;
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? 'py-6 px-3' : 'py-10 px-6'
      } rounded-xl border border-slate-200 bg-white shadow-soft`}
      role="status"
      aria-label={title}
    >
      <span
        className={`inline-flex items-center justify-center rounded-full bg-slate-100 text-slate-500 ${
          compact ? 'h-10 w-10' : 'h-14 w-14'
        }`}
        aria-hidden
      >
        <IconComponent className={compact ? 'h-5 w-5' : 'h-7 w-7'} />
      </span>
      <p className={`mt-3 font-semibold text-slate-900 ${compact ? 'text-xs' : 'text-sm'}`}>
        {title}
      </p>
      {description && (
        <p className={`text-slate-500 ${compact ? 'mt-1 text-[11px]' : 'mt-1 text-sm'}`}>
          {description}
        </p>
      )}
      {(primaryAction || secondaryAction) && (
        <div className={`mt-4 flex flex-wrap items-center justify-center gap-2 ${compact ? 'gap-1.5' : ''}`}>
          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className={`rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2 ${
                compact ? 'text-xs px-3 py-1.5' : 'text-sm'
              }`}
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className={`rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:ring-offset-2 ${
                compact ? 'text-xs px-3 py-1.5' : 'text-sm'
              }`}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
