import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff } from "lucide-react";
import { fetchHiddenPresets, setHiddenPresets } from "../api/client";
import { SAVED_VIEWS } from "./shell/saved-views";

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

  const shownCount = SAVED_VIEWS.length - hidden.length;

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
        everybody on the team.{" "}
        {/* Worth saying: each badge is its own count query, so this is a real
            saving on a busy sidebar, not only tidiness. */}
        Each visible preset fetches its own count, so showing fewer also makes
        the sidebar load faster.
      </p>
      <ul className="space-y-1.5">
        {SAVED_VIEWS.map((preset) => (
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
        {shownCount} of {SAVED_VIEWS.length} shown
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
