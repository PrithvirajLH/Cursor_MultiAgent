import { Inbox } from "lucide-react";

type Action = { label: string; onClick: () => void };

export function EmptyState({
  icon: Icon = Inbox,
  illustration,
  title,
  description,
  primaryAction,
  secondaryAction,
  compact = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  illustration?: React.ReactNode;
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
        compact ? "py-6 px-3" : "py-10 px-6"
      } rounded-xl border border-border bg-card shadow-soft`}
      role="status"
      aria-label={title}
    >
      {illustration ? (
        <div
          className={`mb-4 flex items-center justify-center ${compact ? "h-24 w-24" : "h-32 w-32"}`}
          aria-hidden
        >
          {illustration}
        </div>
      ) : (
        <span
          className={`inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground ${
            compact ? "h-10 w-10" : "h-14 w-14"
          }`}
          aria-hidden
        >
          <IconComponent className={compact ? "h-5 w-5" : "h-7 w-7"} />
        </span>
      )}
      <p
        className={`mt-3 font-semibold text-foreground ${compact ? "text-xs" : "text-sm"}`}
      >
        {title}
      </p>
      {description && (
        <p
          className={`text-muted-foreground ${compact ? "mt-1 text-[11px]" : "mt-1 text-sm"}`}
        >
          {description}
        </p>
      )}
      {(primaryAction || secondaryAction) && (
        <div
          className={`mt-4 flex flex-wrap items-center justify-center gap-2 ${compact ? "gap-1.5" : ""}`}
        >
          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className={`rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring/40 focus:ring-offset-2 ${
                compact ? "text-xs px-3 py-1.5" : "text-sm"
              }`}
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className={`rounded-lg border border-border bg-card px-4 py-2 font-medium text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring/30 focus:ring-offset-2 ${
                compact ? "text-xs px-3 py-1.5" : "text-sm"
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
