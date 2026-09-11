import { AtSign, CalendarClock, Eye, type LucideIcon } from 'lucide-react';

/**
 * The sidebar's system views — the rows above the built-in presets.
 *
 * ⚠️ CARD 1.61 EXISTS BECAUSE THIS WAS A SECOND LIST. Card 1.53 gave a team
 * admin a panel for switching built-in sidebar rows off; it was built from
 * `SAVED_VIEWS` alone, while these three were declared inline inside
 * `SidebarSavedViews`. So the panel truthfully said "6 of 6 shown" about the
 * list it controlled, and silently did not control these — the owner found it
 * within an hour of 1.53 reaching production, trying to hide *Follow-ups due
 * today*. Two lists that must agree is the same shape as cards 1.36, 1.38,
 * 1.47 and 1.50.
 *
 * They live here so the panel and the sidebar read ONE definition. Adding a
 * fourth system view means adding it here and nowhere else; the checkbox, the
 * count text and the hiding all follow.
 *
 * ⚠️ NOT IN THIS LIST: *Assigned to Me*, which comes from `App.tsx`'s nav
 * children. The owner decided on 2026-09-10 that it stays permanent — it is
 * load-bearing, and since 1.53 gives members no way to opt back in, a team
 * admin hiding it from everybody is not a power worth having.
 *
 * ⚠️ These ids share one namespace with `SAVED_VIEWS` in `Team.hiddenPresetIds`
 * (a plain `TEXT[]` from migration 59, which is why this card needs no schema
 * change). Verified they do not collide: the preset ids are `p1-today`,
 * `awaiting-24h`, `sla-at-risk`, `unassigned`, `recent-resolved`, `reopened`,
 * `inbox`, `my-tickets`, `team-queue` and `created-by-me`.
 *
 * ⚠️ Hiding a view removes the sidebar row and nothing else. `?scope=followups`
 * still loads for anyone holding the link or a bookmark — there is deliberately
 * no redirect, because hiding is a tidiness preference, not permission.
 */
export const SYSTEM_VIEWS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly query: string;
}> = [
  { id: 'watching', label: 'Watching', icon: Eye, query: '?scope=watching' },
  { id: 'mentions', label: 'Mentions', icon: AtSign, query: '?scope=mentions' },
  {
    // Card 1.10. Everything already due plus the rest of today, so the view is
    // useful first thing rather than only at the moment a reminder fires.
    id: 'followups',
    label: 'Follow-ups due today',
    icon: CalendarClock,
    query: '?scope=followups',
  },
];
