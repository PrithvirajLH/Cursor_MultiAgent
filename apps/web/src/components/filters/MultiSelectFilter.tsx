import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type MultiSelectOption = { value: string; label: string };

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  placeholder = "All",
  searchable = true,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredOptions = useMemo(() => {
    if (!searchable || !search.trim()) return options;
    const lower = search.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(lower) ||
        o.value.toLowerCase().includes(lower),
    );
  }, [options, search, searchable]);

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((s) => s !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  const summary = useMemo(() => {
    if (selected.length === 0) return placeholder;
    const labels = options
      .filter((o) => selected.includes(o.value))
      .map((o) => o.label);
    if (labels.length <= 2) return labels.join(", ");
    return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
  }, [options, placeholder, selected]);

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
        {open && (
          <>
            <div
              className="fixed inset-0 z-10"
              aria-hidden
              onClick={() => setOpen(false)}
            />
            <div className="absolute left-0 top-full z-20 mt-1.5 w-full min-w-[220px] rounded-[16px] border border-slate-200 bg-white p-2 shadow-[0_8px_30px_rgb(0,0,0,0.12)]">
              {searchable && (
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search..."
                    className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-white transition-colors"
                  />
                </div>
              )}
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {filteredOptions.map((opt) => {
                  const checked = selected.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggle(opt.value)}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors ${
                        checked
                          ? "bg-blue-50 text-blue-700 font-medium"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className="truncate">{opt.label}</span>
                      {checked ? <Check className="h-4 w-4" /> : null}
                    </button>
                  );
                })}
                {filteredOptions.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-slate-500 text-center">
                    No matches
                  </p>
                ) : null}
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    onChange([]);
                    setSearch("");
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
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
          </>
        )}
      </div>
    </div>
  );
}

export function CheckboxGroupFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((s) => s !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  return (
    <div className="space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-border bg-background text-foreground hover:bg-muted/30"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
