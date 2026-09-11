import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { PRIMARY_NAV_PRESETS, SAVED_VIEWS, presetQueryById } from './saved-views';

const APP_SOURCE = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');

/**
 * Card 1.71 — the Unassigned shortcut did not state its own filter.
 *
 * The badge counts "unassigned AND open" (card 1.70's decision). The preset
 * linked to `?scope=unassigned` with no status filter, and the list then fell
 * back to `presetStatus` — ambient React state, not part of the link. From a
 * fresh load that is "open" and the two agreed, which is why a fresh-load check
 * proved nothing. After *Created by me* it is "all" and after *Completed* it is
 * "resolved", so the same row meant three different things.
 */
describe('the Unassigned preset states its own filter (card 1.71)', () => {
  it('⚠️ carries statusGroup=open in the link itself', () => {
    // THE REGRESSION ASSERTION. Without it the list inherits whatever the last
    // nav click left in `ticketPresetStatus`, and the badge beside it is right
    // only by luck.
    const query = presetQueryById('unassigned');
    expect(query).toContain('scope=unassigned');
    expect(query).toContain('statusGroup=open');
  });

  it('⚠️ the left-nav item and the sidebar preset emit the SAME query', () => {
    // Two routes to one view is the drift shape behind cards 1.36, 1.38, 1.47,
    // 1.50, 1.66 and this one. Rather than compare two literals, App.tsx now
    // DERIVES its URL from the preset - so this asserts the derivation is still
    // in place. A test that merely compared them would pass right up until
    // somebody edited one.
    expect(APP_SOURCE).toContain('presetQueryById("unassigned")');
    expect(APP_SOURCE).not.toContain(
      'navigate("/tickets?scope=unassigned&statusGroup=open")',
    );
  });

  it('still matches the row when the URL carries extra params', () => {
    // `paramsMatch` is a subset check, so widening the link must not stop the
    // row highlighting. Deliberately left alone by this card.
    const preset = SAVED_VIEWS.find((v) => v.id === 'unassigned');
    expect(preset).toBeDefined();
    expect(
      preset?.matches(
        new URLSearchParams('scope=unassigned&statusGroup=open&sort=updatedAt'),
      ),
    ).toBe(true);
  });

  describe('presetQueryById', () => {
    it('reads both built-in lists', () => {
      expect(presetQueryById('p1-today')).toContain('priorities=SEV1');
      expect(presetQueryById('my-tickets')).toContain('scope=assigned');
      expect(PRIMARY_NAV_PRESETS.some((v) => v.id === 'my-tickets')).toBe(true);
    });

    it('returns an empty string for an unknown id rather than throwing', () => {
      // The standing unknown-id rule from card 1.53: ids are code constants, so
      // a stale one refers to nothing and must be a no-op, not a crash.
      expect(presetQueryById('a-row-that-was-retired')).toBe('');
    });
  });

  it('⚠️ records that sla-at-risk still leaves its status implicit', () => {
    // NOT FIXED HERE, AND DELIBERATELY SO. `sla-at-risk` emits no status filter
    // either, so it has the same ambient-state dependency this card removed from
    // `unassigned`. It is left alone because its count (`atRisk`) already
    // excludes resolved/closed by status AND completedAt, so the badge and the
    // list agree for every reachable `presetStatus` - the bug shape is present,
    // the bug is not. This assertion exists so the next person sees that it was
    // considered rather than missed.
    expect(presetQueryById('sla-at-risk')).not.toContain('statusGroup');
  });
});
