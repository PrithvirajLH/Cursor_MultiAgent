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

export type ToneKey = 'red' | 'amber' | 'green' | 'gray';

export interface SidebarPreset {
  /** Stable identifier — used for `key` and active-state matching */
  id: string;
  /** Human label rendered in the sidebar */
  label: string;
  /** Optional count badge (e.g. "4") */
  count?: string;
  /** Tone of the leading dot (saved views) */
  tone?: ToneKey;
  /** Builds a `?key=value` query string applied on click */
  buildQuery: () => string;
  /** Returns true if the given URLSearchParams match this preset (for active highlight) */
  matches: (params: URLSearchParams) => boolean;
}

const todayIso = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
};

const isoDaysAgo = (days: number): string => {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
};

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
    label: 'Breach risk · 1h',
    tone: 'amber',
    buildQuery: () => qs({ slaStatus: 'at_risk' }),
    matches: p => paramsMatch(p, { slaStatus: 'at_risk' }),
  },
  {
    id: 'unassigned',
    label: 'Unassigned',
    tone: 'gray',
    buildQuery: () => qs({ scope: 'unassigned' }),
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
export const PRIMARY_NAV_PRESETS: SidebarPreset[] = [
  {
    id: 'inbox',
    label: 'Inbox',
    count: '142',
    buildQuery: () => qs({ statusGroup: 'open' }),
    matches: p =>
      p.get('statusGroup') === 'open' && !p.get('scope') && !p.get('priorities'),
  },
  {
    id: 'my-tickets',
    label: 'My tickets',
    count: '14',
    buildQuery: () => qs({ scope: 'assigned' }),
    matches: p => p.get('scope') === 'assigned',
  },
  {
    id: 'team-queue',
    label: 'Team queue',
    count: '38',
    buildQuery: () => qs({ scope: 'unassigned', statusGroup: 'open' }),
    matches: p => p.get('scope') === 'unassigned',
  },
  {
    id: 'created-by-me',
    label: 'Created by me',
    count: '7',
    buildQuery: () => qs({ scope: 'created' }),
    matches: p => p.get('scope') === 'created',
  },
];
