import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

export function TextFilterDropdown({
  label,
  value,
  placeholder = "Any text",
  inputPlaceholder = "Type to filter...",
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
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex h-10 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-700 hover:bg-slate-50 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/30"
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
            <div className="absolute left-0 top-full z-20 mt-1.5 w-full min-w-[240px] rounded-[16px] border border-slate-200 bg-white p-2.5 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={inputPlaceholder}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-white transition-colors"
                />
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setDraft("");
                    onChange("");
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(draft.trim());
                      setOpen(false);
                    }}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-blue-700 shadow-sm transition-colors focus:ring-2 focus:ring-blue-500/50"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-all"
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
