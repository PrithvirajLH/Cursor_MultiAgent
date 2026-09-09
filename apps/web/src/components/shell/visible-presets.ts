import type { SidebarPreset } from "./saved-views";

/**
 * The built-in presets a team should actually see (card 1.53).
 *
 * Payroll has no use for *SEV1 today* or *Awaiting reply > 24h*; their admin
 * switches those off and the whole team stops seeing them. The ids come from
 * `Team.hiddenPresetIds`.
 *
 * ⚠️ AN UNKNOWN ID IS IGNORED, SILENTLY. Preset ids are CODE CONSTANTS defined
 * in `saved-views.ts`, not database rows, so a stored id whose preset has since
 * been renamed or deleted refers to nothing. It must not become a ghost entry
 * in the sidebar and must not throw - it simply matches no preset and falls out
 * of the filter. Nothing needs cleaning up when a preset is retired.
 *
 * ⚠️ Team-admin-only by design: there is deliberately no personal override, so
 * a member of Payroll cannot opt back in. Two mechanisms answering "is this row
 * visible" is the drift behind cards 1.36, 1.38, 1.47 and 1.50.
 *
 * There is also a real performance effect, which is why hiding is worth having
 * beyond tidiness: every badge is its own `GET /tickets` count query, so a team
 * that hides six of ten presets makes four count queries per sidebar load
 * instead of ten, against the same remote pooler that produced card 1.51's
 * transaction timeout.
 *
 * @param presets The full built-in list, in display order.
 * @param hiddenIds Ids this team has switched off; unknown ones are ignored.
 * @returns The presets to render, in their original order.
 */
export function visiblePresets(
  presets: readonly SidebarPreset[],
  hiddenIds: readonly string[] | undefined,
): SidebarPreset[] {
  if (!hiddenIds || hiddenIds.length === 0) {
    return [...presets];
  }
  const hidden = new Set(hiddenIds);
  return presets.filter((preset) => !hidden.has(preset.id));
}
