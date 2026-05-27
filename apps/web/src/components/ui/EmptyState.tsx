import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  /** Centered glyph (e.g. a lucide icon element). */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Optional call-to-action (button/link). */
  action?: React.ReactNode;
  /** Dashed placeholder border (default) vs. a plain panel. */
  bordered?: boolean;
  className?: string;
};

/** Centered placeholder for empty lists / unselected detail panes. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  bordered = true,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl bg-card p-8 text-center",
        bordered && "border-2 border-dashed border-border",
        className,
      )}
    >
      {icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-muted-foreground">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
