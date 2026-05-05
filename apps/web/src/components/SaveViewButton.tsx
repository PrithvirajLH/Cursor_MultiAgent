import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Check } from "lucide-react";
import { createSavedView } from "../api/client";
import type { TicketFilters } from "../types";

interface SaveViewButtonProps {
  filters: TicketFilters;
  disabled?: boolean;
}

/**
 * Toolbar button + inline popover that persists the current TicketFilters as
 * a named saved view. After save, invalidates ["saved-views"] so the sidebar's
 * "Mine" section picks it up immediately.
 */
export function SaveViewButton({ filters, disabled = false }: SaveViewButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: () =>
      createSavedView({
        name: name.trim(),
        filters: filtersForPersistence(filters),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-views"] });
      setName("");
      setOpen(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const canSave = name.trim().length > 0 && !save.isPending;

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title={disabled ? "Apply a filter first" : "Save current filters as a view"}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card shadow-sm px-3 text-sm text-foreground transition-all hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Bookmark className="h-4 w-4" />
        Save view
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Save view"
          className="absolute right-0 top-full mt-2 z-30 w-[280px] rounded-xl border border-border bg-card shadow-lg p-3 flex flex-col gap-2"
        >
          <label
            htmlFor="save-view-name"
            className="text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground/55"
          >
            View name
          </label>
          <input
            ref={inputRef}
            id="save-view-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) save.mutate();
            }}
            placeholder="e.g. P1 + my team"
            className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          {save.isError && (
            <span className="text-[11px] text-red-600">
              Save failed — try again
            </span>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 text-[12px] font-medium text-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={!canSave}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-[12px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="h-3.5 w-3.5" />
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Strip empty / default fields and pagination so the persisted view is portable.
 */
function filtersForPersistence(f: TicketFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.statusGroup && f.statusGroup !== "all") out.statusGroup = f.statusGroup;
  if (f.statuses?.length) out.statuses = f.statuses;
  if (f.priorities?.length) out.priorities = f.priorities;
  if (f.teamIds?.length) out.teamIds = f.teamIds;
  if (f.assigneeIds?.length) out.assigneeIds = f.assigneeIds;
  if (f.requesterIds?.length) out.requesterIds = f.requesterIds;
  if (f.slaStatus?.length) out.slaStatus = f.slaStatus;
  if (f.createdFrom) out.createdFrom = f.createdFrom;
  if (f.createdTo) out.createdTo = f.createdTo;
  if (f.updatedFrom) out.updatedFrom = f.updatedFrom;
  if (f.updatedTo) out.updatedTo = f.updatedTo;
  if (f.dueFrom) out.dueFrom = f.dueFrom;
  if (f.dueTo) out.dueTo = f.dueTo;
  if (f.q?.trim()) out.q = f.q.trim();
  if (f.scope && f.scope !== "all") out.scope = f.scope;
  if (f.sort && f.sort !== "updatedAt") out.sort = f.sort;
  if (f.order && f.order !== "desc") out.order = f.order;
  return out;
}
