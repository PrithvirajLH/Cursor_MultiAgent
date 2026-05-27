import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Leading header icon (already wrapped/sized by the caller). */
  icon?: React.ReactNode;
  /** Right-aligned header content (badges, action buttons) shown left of the close button. */
  headerActions?: React.ReactNode;
  /** Sticky footer area, e.g. primary/secondary buttons. */
  footer?: React.ReactNode;
  /** Tailwind max-width class for the panel. Default "max-w-xl". */
  widthClassName?: string;
  children: React.ReactNode;
};

/**
 * Right-anchored slide-over panel — the "detail/editor" half of a list+drawer page.
 * Portaled to <body> so the surrounding (often transformed) layout can't clip it,
 * and sized via `inset-y-0` rather than `vh` so it fills the viewport under the
 * global `zoom` without coordinate math. Esc or backdrop click closes.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  icon,
  headerActions,
  footer,
  widthClassName = "max-w-xl",
  children,
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[120]">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/40 animate-overlay-in"
        aria-hidden="true"
      />
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-card shadow-2xl animate-drawer-in",
          widthClassName,
        )}
      >
        {(title || icon || headerActions) && (
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              {icon}
              <div className="min-w-0">
                {title && (
                  <h2 className="truncate text-sm font-semibold text-foreground">
                    {title}
                  </h2>
                )}
                {description && (
                  <p className="truncate text-xs text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {headerActions}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer && (
          <div className="border-t border-border bg-card px-5 py-3">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
