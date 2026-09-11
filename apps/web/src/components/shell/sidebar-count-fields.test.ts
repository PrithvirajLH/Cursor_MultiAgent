import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { SAVED_VIEWS } from './saved-views';
import { PRESET_COUNT_FIELD } from './sidebar-count-fields';

const SIDEBAR_SOURCE = readFileSync(
  join(__dirname, '..', 'SidebarSavedViews.tsx'),
  'utf8',
);

/** The three system rows the component defines inline. */
const SYSTEM_VIEW_IDS = ['watching', 'mentions', 'followups'];

/**
 * Card 1.69 step 4 — the sidebar fired nine uncached count requests per render.
 *
 * ⚠️ WHY THESE ARE SOURCE AND MAP ASSERTIONS RATHER THAN A RENDER. This web
 * suite runs in a NODE environment: there is no jsdom, no happy-dom and no
 * testing-library anywhere in the repo, so a component cannot be mounted and
 * its network calls cannot be counted the way the card's wording implies.
 * What can be checked is the thing that actually determines the request count
 * — how many `useViewCounts` call sites remain, and whether every fixed row
 * has a field to read instead of a query to fire. That is the same fact,
 * established a different way, and it is stated here rather than quietly
 * substituted.
 */
describe('the sidebar asks once, not nine times (card 1.69 step 4)', () => {
  it('⚠️ leaves exactly ONE useViewCounts call, for the dynamic saved views', () => {
    // THE REGRESSION ASSERTION FOR STEP 4. Three call sites became one. The
    // survivor is `userViewCounts`: team and personal saved views (card 1.53)
    // carry arbitrary user-defined filters, so they cannot be precomputed
    // without the filter-taking count endpoint the card explicitly rules out
    // as an exfiltration oracle. The win is removing the nine fixed ones.
    // Anchored to an assignment so the explanatory comment above the old
    // call site - which names `useViewCounts(` in prose - is not counted as a
    // call. A bare /useViewCounts\(/ matched it and the test failed for the
    // wrong reason, which is its own small lesson about source assertions.
    const calls = SIDEBAR_SOURCE.match(/^\s*const \w+ = useViewCounts\(/gm) ?? [];
    expect(calls).toHaveLength(1);
    expect(SIDEBAR_SOURCE).toContain('const userViewCounts = useViewCounts(');
  });

  it('⚠️ has a counts field for every built-in preset', () => {
    // A preset with no mapping silently renders no badge, which looks like
    // "this view has no tickets" rather than "this view lost its count".
    const unmapped = SAVED_VIEWS.filter(
      (view) => !PRESET_COUNT_FIELD[view.id],
    ).map((view) => view.id);
    expect(unmapped).toEqual([]);
  });

  it('has a counts field for every system view', () => {
    const unmapped = SYSTEM_VIEW_IDS.filter((id) => !PRESET_COUNT_FIELD[id]);
    expect(unmapped).toEqual([]);
  });

  it('maps no two rows onto the same field', () => {
    // Two rows sharing a field is the signature of a copy-paste mapping, and
    // it shows up as two badges that always agree - easy to miss on a screen.
    const fields = Object.values(PRESET_COUNT_FIELD);
    expect(new Set(fields).size).toBe(fields.length);
  });

  describe('the two duplicate fields card 1.70 retired', () => {
    it('⚠️ Unassigned reads unassigned — the OPEN-only definition', () => {
      // INVERTED BY CARD 1.70 ①, not deleted, so the decision stays legible.
      // Card 1.69 step 4 pointed this at `unassignedAnyStatus` because the
      // sidebar list and the count disagreed and choosing either moved a
      // number. The owner decided: unassigned means unassigned AND open, since
      // an unassigned *resolved* ticket needs nobody. The duplicate field is
      // gone, so this must never name it again.
      expect(PRESET_COUNT_FIELD.unassigned).toBe('unassigned');
    });

    it('⚠️ Breach risk reads atRisk — the one configurable definition', () => {
      // INVERTED BY CARD 1.70 ②. `breachRisk` existed only to hold the list's
      // hard-coded four-hour window; the list now uses
      // SLA_AT_RISK_THRESHOLD_MINUTES and respects completedAt, so the two
      // definitions became one and the duplicate was removed.
      expect(PRESET_COUNT_FIELD['sla-at-risk']).toBe('atRisk');
    });

    it('⚠️ names neither retired field anywhere in the map', () => {
      // The guard against one of them creeping back in under a new row. Both
      // were removed from the API response, so a mapping naming either would
      // render an empty badge rather than failing loudly.
      const fields = Object.values(PRESET_COUNT_FIELD);
      expect(fields).not.toContain('unassignedAnyStatus');
      expect(fields).not.toContain('breachRisk');
    });
  });

  it('reads the shared boundary helpers rather than a second copy of "today"', () => {
    // `todayIso`/`isoDaysAgo` moved to count-boundaries.ts so the query string
    // a badge navigates to and the counts request that fills it are derived
    // from ONE definition. A second copy is how the two drift apart.
    const savedViews = readFileSync(
      join(__dirname, 'saved-views.ts'),
      'utf8',
    );
    expect(savedViews).toContain("from './count-boundaries'");
    expect(savedViews).not.toContain('const todayIso =');
    expect(savedViews).not.toContain('const isoDaysAgo =');
  });
});
