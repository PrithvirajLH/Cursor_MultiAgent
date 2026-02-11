import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

export function TextFilterDropdown({
  label,
  value,
  placeholder = 'Any text',
  inputPlaceholder = 'Type to filter...',
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  inputPlaceholder?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!open) {
      setDraft(value);
    }
  }, [open, value]);

  const summary = useMemo(() => {
    const trimmed = value.trim();
    if (!trimmed) return placeholder;
    if (trimmed.length <= 28) return trimmed;
    return `${trimmed.slice(0, 28)}...`;
  }, [placeholder, value]);

  return (
    <div className="space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex h-10 w-full items-center justify-between rounded-lg border border-border bg-background px-3 text-sm text-foreground hover:bg-muted/20"
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition ${open ? 'rotate-180' : ''}`} />
        </button>
        {open ? (
          <>
            <div className="fixed inset-0 z-10" aria-hidden onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full z-20 mt-1 w-full min-w-[240px] rounded-lg border border-border bg-popover p-2 shadow-elevated">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={inputPlaceholder}
                  className="h-9 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraft('');
                    onChange('');
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/30"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(draft.trim());
                      setOpen(false);
                    }}
                    className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/30"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
