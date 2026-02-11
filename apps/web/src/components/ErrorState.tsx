import { AlertCircle } from 'lucide-react';

type Action = { label: string; onClick: () => void };

export function ErrorState({
  title = 'Something went wrong',
  description = "We couldn't load this content. Please try again.",
  onRetry,
  secondaryAction,
}: {
  title?: string;
  description?: string;
  onRetry: () => void;
  secondaryAction?: Action;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 py-10 px-6 text-center"
      role="alert"
      aria-label={title}
    >
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive" aria-hidden>
        <AlertCircle className="h-7 w-7" />
      </span>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2"
        >
          Retry
        </button>
        {secondaryAction && (
          <button
            type="button"
            onClick={secondaryAction.onClick}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:ring-offset-2"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>
    </div>
  );
}
