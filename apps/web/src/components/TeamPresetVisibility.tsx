import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff } from "lucide-react";
import { fetchHiddenPresets, setHiddenPresets } from "../api/client";
import { SAVED_VIEWS } from "./shell/saved-views";
import { SYSTEM_VIEWS } from "./shell/system-views";

/**
 * Every built-in sidebar row a team admin may switch off, in display order.
 *
 * ⚠️ CARD 1.61. This panel was built from `SAVED_VIEWS` alone, so it offered
 * six checkboxes and said "6 of 6 shown" while three more rows sat above them
 * in the sidebar with no way to hide them. The owner hit that within an hour
 * of 1.53 shipping. The system views come first because that is the order the
 * sidebar renders them.
 *
 * *Assigned to Me* is deliberately absent - it comes from App.tsx's nav
 * children and the owner decided it stays permanent.
 */
const HIDEABLE_ROWS: ReadonlyArray<{ id: string; label: string }> = [
  ...SYSTEM_VIEWS.map(({ id, label }) => ({ id, label })),
  ...SAVED_VIEWS.map(({ id, label }) => ({ id, label })),
];

/**
 * Which built-in sidebar presets this team uses (card 1.53).
 *
 * The worked example from the owner: Payroll has no use for *SEV1 today* or
 * *Awaiting reply > 24h*, and wants their own views instead. A team admin
 * switches the unwanted ones off here and the whole team stops seeing them.
 *
 * ⚠️ Team-wide and one-directional: a member of the team **cannot** opt back
 * in. That is what was asked for, and it is deliberately the only mechanism -
 * a personal override on top would be two answers to "is this row visible",
 * which is the drift behind cards 1.36, 1.38, 1.47 and 1.50.
 *
 * Checked here means VISIBLE, because "tick the ones you want" reads better
 * than "tick the ones to hide"; the API stores the inverse.
 */
export function TeamPresetVisibility({
  teamId,
  canManage,
}: {
  teamId: string;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["hidden-presets", teamId],
    queryFn: ({ signal }) => fetchHiddenPresets({ signal }),
    staleTime: 60_000,
  });
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    setHidden(data?.data ?? []);
  }, [data]);

  const save = useMutation({
    mutationFn: (next: string[]) => setHiddenPresets(teamId, next),
    onSuccess: () => {
      // Both keys: the sidebar reads the unscoped one.
      qc.invalidateQueries({ queryKey: ["hidden-presets"] });
      qc.invalidateQueries({ queryKey: ["view-count"] });
    },
  });

  function toggle(presetId: string) {
    const next = hidden.includes(presetId)
      ? hidden.filter((id) => id !== presetId)
      : [...hidden, presetId];
    setHidden(next);
    save.mutate(next);
  }

  // ⚠️ DERIVED, NOT SUBTRACTED. This was `SAVED_VIEWS.length - hidden.length`,
  // which is wrong the moment `hidden` holds an id this panel does not list -
  // a retired preset, or (before card 1.61) any of the three system views. It
  // could read "3 of 6" with all six ticked, or go negative. Counting the rows
  // actually shown cannot drift from what is on screen, and the next row added
  // needs no change here.
  const shownRows = HIDEABLE_ROWS.filter((row) => !hidden.includes(row.id));

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-1 flex items-center gap-2">
        <EyeOff className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">
          Sidebar presets
        </h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Which built-in views this team sees. Unticking one hides it for
        everybody on the team. Anyone with a direct link still reaches the view.
        {/* ⚠️ CARD 1.61 DELETED A SENTENCE HERE that promised showing fewer
            presets made the sidebar load faster. That was true under card 1.53,
            when every badge was its own count query; card 1.69 step 4 moved
            them all onto one cached request, so hiding a row now saves nothing.
            Replaced with the thing an admin actually needs to know - hiding is
            not permission. */}
      </p>
      <ul className="space-y-1.5">
        {HIDEABLE_ROWS.map((preset) => (
          <li key={preset.id}>
            <label className="flex items-center gap-2 text-[13px] text-foreground">
              <input
                type="checkbox"
                checked={!hidden.includes(preset.id)}
                disabled={!canManage || save.isPending}
                onChange={() => toggle(preset.id)}
                aria-label={`Show ${preset.label}`}
                className="h-3.5 w-3.5 rounded border-border accent-primary disabled:opacity-50"
              />
              {preset.label}
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-muted-foreground">
        {shownRows.length} of {HIDEABLE_ROWS.length} shown
        {canManage ? "" : " — only a team admin can change this"}
      </p>
      {save.isError ? (
        <p className="mt-1 text-[11px] text-red-600">
          Could not save — try again
        </p>
      ) : null}
    </div>
  );
}
