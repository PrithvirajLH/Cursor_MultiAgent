import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { SAVED_VIEWS } from './saved-views';
import { SYSTEM_VIEWS } from './system-views';
import { visiblePresets } from './visible-presets';

/**
 * Source with comments removed.
 *
 * ⚠️ WITHOUT THIS THE "IS IT GONE" ASSERTIONS ARE WORTHLESS, and that was
 * measured rather than foreseen: two of them failed on this file's own
 * explanatory comments, which quote the very strings they assert are absent.
 * A source check that matches prose proves nothing about the code.
 */
const codeOnly = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const PANEL_SOURCE = codeOnly(
  readFileSync(join(__dirname, '..', 'TeamPresetVisibility.tsx'), 'utf8'),
);
const SIDEBAR_SOURCE = codeOnly(
  readFileSync(join(__dirname, '..', 'SidebarSavedViews.tsx'), 'utf8'),
);

/**
 * Card 1.61 — the sidebar's system views could not be hidden.
 *
 * Card 1.53 gave a team admin a panel for switching built-in rows off. It was
 * built from `SAVED_VIEWS`, and the three system views were declared inline
 * inside the sidebar — so the panel said "6 of 6 shown", truthfully, about a
 * list that did not include them. The owner hit this within an hour of 1.53
 * reaching production, trying to hide *Follow-ups due today*.
 *
 * ⚠️ These are list and source assertions rather than a render. This web suite
 * runs in a NODE environment with no jsdom, happy-dom or testing-library
 * anywhere in the repo, so a component cannot be mounted. Said plainly here
 * rather than quietly substituted.
 */
describe('the sidebar system views are hideable (card 1.61)', () => {
  it('⚠️ hiding a system view removes exactly that row', () => {
    // THE REGRESSION ASSERTION. Before this card `visiblePresets` was never
    // given this list at all, so hiding `followups` did nothing.
    const shown = visiblePresets(SYSTEM_VIEWS, ['followups']);
    expect(shown.map((v) => v.id)).toEqual(['watching', 'mentions']);
  });

  it('leaves the other system views and every preset alone', () => {
    // Hiding is per id, so one team switching off Mentions must not disturb
    // anything else on the row list.
    expect(visiblePresets(SYSTEM_VIEWS, ['mentions'])).toHaveLength(2);
    expect(visiblePresets(SAVED_VIEWS, ['mentions'])).toHaveLength(
      SAVED_VIEWS.length,
    );
  });

  it('⚠️ ignores an unknown id, with no ghost row and no throw', () => {
    // The standing rule from 1.53, now covering system ids too. These are code
    // constants, not database rows, so a stored id can outlive the row it
    // named and must simply match nothing.
    expect(visiblePresets(SYSTEM_VIEWS, ['a-view-that-was-retired'])).toEqual([
      ...SYSTEM_VIEWS,
    ]);
    expect(() => visiblePresets(SYSTEM_VIEWS, [''])).not.toThrow();
  });

  it('⚠️ shares one id namespace with the presets, with no collision', () => {
    // Both lists are stored in the same `Team.hiddenPresetIds` array, which is
    // why this card needs no migration. A collision would mean hiding one row
    // silently hid another.
    const systemIds = SYSTEM_VIEWS.map((v) => v.id);
    const presetIds = SAVED_VIEWS.map((v) => v.id);
    const overlap = systemIds.filter((id) => presetIds.includes(id));
    expect(overlap).toEqual([]);
    // ...and no duplicates within the system list either.
    expect(new Set(systemIds).size).toBe(systemIds.length);
  });

  it('⚠️ offers nine checkboxes, built from both lists', () => {
    // The panel said "6 of 6" because it only knew about one list. Nine is
    // three system views plus six presets.
    expect(SYSTEM_VIEWS).toHaveLength(3);
    expect(SAVED_VIEWS).toHaveLength(6);
    expect(PANEL_SOURCE).toContain('...SYSTEM_VIEWS.map');
    expect(PANEL_SOURCE).toContain('...SAVED_VIEWS.map');
  });

  it('⚠️ does NOT offer "Assigned to Me"', () => {
    // The owner decided it stays permanent: it is load-bearing, and since 1.53
    // gives members no way to opt back in, a team admin hiding it from
    // everybody is not a power worth having. It comes from App.tsx nav
    // children and must never appear in either built-in list.
    const allIds = [...SYSTEM_VIEWS, ...SAVED_VIEWS].map((v) => v.id);
    expect(allIds).not.toContain('assigned');
    expect(PANEL_SOURCE).not.toContain('Assigned to Me');
  });

  it('⚠️ derives the count text instead of subtracting', () => {
    // It read `SAVED_VIEWS.length - hidden.length`, which is wrong the moment
    // `hidden` holds an id the panel does not list — a retired preset, or any
    // system view before this card. It could show "3 of 6" with all six ticked,
    // or go negative.
    expect(PANEL_SOURCE).not.toContain('SAVED_VIEWS.length - hidden.length');
    expect(PANEL_SOURCE).toContain('shownRows.length} of {HIDEABLE_ROWS.length');
  });

  it('⚠️ leaves no second copy of the system views in the sidebar', () => {
    // The whole cause of this card was the list existing twice. If it is
    // re-declared inline the panel stops controlling it again, silently.
    expect(SIDEBAR_SOURCE).toContain('visiblePresets(SYSTEM_VIEWS');
    expect(SIDEBAR_SOURCE).not.toContain('id: "watching"');
    expect(SIDEBAR_SOURCE).not.toContain('id: "followups"');
  });

  it('keeps a usable link on every row, so hiding is not permission', () => {
    // Hiding removes the sidebar entry, not the route: `?scope=followups`
    // still loads for anyone holding the link. There is deliberately no
    // redirect.
    for (const view of SYSTEM_VIEWS) {
      expect(view.query).toMatch(/^\?scope=[a-z]+$/);
      expect(view.label.trim()).not.toBe('');
    }
  });
});
