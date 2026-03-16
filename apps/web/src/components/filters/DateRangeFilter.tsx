import { useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";

export function DateRangeFilter({
  label,
  from,
  to,
  placeholder = "Any date",
  onFromChange,
  onToChange,
}: {
  label: string;
  from: string;
  to: string;
  placeholder?: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const summary = useMemo(() => {
    if (!from && !to) return placeholder;
    if (from && to) return `${from} to ${to}`;
    if (from) return `From ${from}`;
    return `Until ${to}`;
  }, [from, placeholder, to]);

  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex h-10 w-full items-center justify-between rounded-xl border border-border bg-popover px-3 text-[13px] text-foreground hover:bg-muted shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        >
          <span className="truncate">{summary}</span>
          <ChevronDown
            className={`h-4 w-4 text-slate-400 transition ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open ? (
          <>
            <div
              className="fixed inset-0 z-10"
              aria-hidden
              onClick={() => setOpen(false)}
            />
            <div className="absolute left-0 top-full z-20 mt-1.5 w-full min-w-[240px] rounded-[16px] border border-border bg-popover p-2.5 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
              <div className="space-y-3">
                <div>
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    From
                  </span>
                  <input
                    type="date"
                    value={from || ""}
                    onChange={(e) => onFromChange(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-popover transition-colors"
                    aria-label={`${label} from`}
                  />
                </div>
                <div>
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    To
                  </span>
                  <input
                    type="date"
                    value={to || ""}
                    onChange={(e) => onToChange(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-popover transition-colors"
                    aria-label={`${label} to`}
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => {
                    onFromChange("");
                    onToChange("");
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-border bg-popover px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-muted hover:border-border shadow-sm transition-all"
                >
                  Done
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
