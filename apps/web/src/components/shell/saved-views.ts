/**
 * Preset filter definitions for the sidebar's "Saved views" and primary nav.
 *
 * Each entry produces a query-string for **`/tickets`** that, when applied,
 * triggers `useFilters` on the page to re-fetch with the corresponding filters.
 * (This comment used to name `/tickets-revamp`, a prototype page deleted on
 * 2026-06-08. `TicketsPage` is the only ticket list there is.)
 *
 * Adding a new preset: define it here, give it a unique `id`, and add it to
 * SAVED_VIEWS or PRIMARY_NAV. No other wiring needed.
 *
 * ⚠️ **`id` IS A CODE CONSTANT THAT OUTLIVES THIS FILE (card 1.53).** A team
 * admin can switch presets off for their whole team, and the ids they chose are
 * stored in `Team.hiddenPresetIds` in the database. So an id here is a value
 * some rows already refer to:
 *
 *  - **Renaming or removing a preset is safe** - `visiblePresets` ignores a
 *    stored id that matches nothing, silently. No ghost row, no crash, and
 *    nothing to clean up afterwards.
 *  - **Reusing a retired id for a different preset is NOT safe.** A team that
 *    hid the old one would silently hide the new one. Pick a fresh id.
 */

// Card 1.69 step 4: these moved to count-boundaries.ts so the query strings
// below and the counts request share ONE definition of "today". Two copies of
// a date boundary is how a badge and the list it opens drift apart.
import { isoDaysAgo, todayIso } from './count-boundaries';

export type ToneKey = 'red' | 'amber' | 'green' | 'gray';

export interface SidebarPreset {
  /** Stable identifier — used for `key` and active-state matching */
  id: string;
  /** Human label rendered in the sidebar */
  label: string;
  /** Tone of the leading dot (saved views) */
  tone?: ToneKey;
  /** Builds a `?key=value` query string applied on click */
  buildQuery: () => string;
  /** Returns true if the given URLSearchParams match this preset (for active highlight) */
  matches: (params: URLSearchParams) => boolean;
}


function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') sp.set(k, v);
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function paramsMatch(actual: URLSearchParams, expected: Record<string, string>): boolean {
  return Object.entries(expected).every(([k, v]) => actual.get(k) === v);
}

/**
 * Saved-view presets surfaced under "Saved views" in the sidebar.
 * Counts are placeholders — wiring real counts is a follow-up task.
 */
export const SAVED_VIEWS: SidebarPreset[] = [
  {
    id: 'p1-today',
    label: 'SEV1 today',
    tone: 'red',
    buildQuery: () => qs({ priorities: 'SEV1', createdFrom: todayIso() }),
    matches: p =>
      paramsMatch(p, { priorities: 'SEV1', createdFrom: todayIso() }),
  },
  {
    id: 'awaiting-24h',
    label: 'Awaiting reply > 24h',
    tone: 'amber',
    buildQuery: () =>
      qs({
        statuses: 'WAITING_ON_REQUESTER,WAITING_ON_VENDOR',
        updatedTo: isoDaysAgo(1),
      }),
    matches: p =>
      paramsMatch(p, {
        statuses: 'WAITING_ON_REQUESTER,WAITING_ON_VENDOR',
        updatedTo: isoDaysAgo(1),
      }),
  },
  {
    id: 'sla-at-risk',
    // ⚠️ CARD 1.70 ②: the threshold suffix is NOT here any more. It read
    // "· 1h" beside a configurable setting that defaults to two hours, and the
    // list used four - three numbers for one idea. The sidebar appends the real
    // value from `getCounts`; see `at-risk-label.ts`.
    label: 'Breach risk',
    tone: 'amber',
    buildQuery: () => qs({ slaStatus: 'at_risk' }),
    matches: p => paramsMatch(p, { slaStatus: 'at_risk' }),
  },
  {
    id: 'unassigned',
    label: 'Unassigned',
    tone: 'gray',
    // ⚠️ CARD 1.71: `statusGroup` IS STATED, NOT INHERITED. Without it the
    // list falls back to `presetStatus` (useFilters.ts:42-45), which is ambient
    // React state, not part of the link - so this one row meant three different
    // things depending on what you last clicked. From a fresh load it is "open"
    // and the badge agreed; after *Created by me* it is "all" (badge 5, list 6)
    // and after *Completed* it is "resolved" (badge 5, list 1).
    //
    // `statusGroup=open` is `status NOT IN (RESOLVED, CLOSED)` at
    // buildListWhere:429 - the same predicate `getCounts.unassigned` uses, so
    // the link now means exactly what the badge counts. The list moves to meet
    // the badge, never the other way: card 1.70 settled that definition and
    // DashboardPage has shown it for months.
    //
    // `matches` is deliberately NOT widened: paramsMatch is a subset check, so
    // the row still highlights on the wider URL.
    buildQuery: () => qs({ scope: 'unassigned', statusGroup: 'open' }),
    matches: p => paramsMatch(p, { scope: 'unassigned' }),
  },
  {
    id: 'recent-resolved',
    label: 'Resolved this week',
    tone: 'green',
    buildQuery: () =>
      qs({
        statusGroup: 'resolved',
        updatedFrom: isoDaysAgo(7),
      }),
    matches: p =>
      paramsMatch(p, { statusGroup: 'resolved', updatedFrom: isoDaysAgo(7) }),
  },
  {
    id: 'reopened',
    label: 'Reopened',
    tone: 'gray',
    buildQuery: () => qs({ statuses: 'REOPENED' }),
    matches: p => paramsMatch(p, { statuses: 'REOPENED' }),
  },
];

/**
 * Primary nav items that map to scope/status preset filters.
 * "Inbox" = all open; "My tickets" = assigned to me; etc.
 */
/**
 * The query string a built-in row navigates to, by id.
 *
 * ⚠️ CARD 1.71 ADDED THIS SO THERE IS ONE DEFINITION, NOT TWO. The left nav
 * in `App.tsx` spelled `?scope=unassigned&statusGroup=open` out by hand while
 * the sidebar preset emitted `?scope=unassigned` - two routes to one view, which
 * is the drift shape behind cards 1.36, 1.38, 1.47, 1.50, 1.66 and this one. A
 * test comparing the two literals would have caught them diverging; deriving one
 * from the other means they cannot.
 *
 * Returns an empty string for an unknown id, which is the existing
 * unknown-id-is-ignored rule (see `visible-presets.ts`) rather than a throw.
 * `App.tsx` depends on that: it interpolates the result straight into a path.
 *
 * @param id A `SAVED_VIEWS` id.
 */
export function presetQueryById(id: string): string {
  const preset = SAVED_VIEWS.find((v) => v.id === id);
  return preset ? preset.buildQuery() : '';
}
