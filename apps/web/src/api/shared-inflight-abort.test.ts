import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A fetch that never settles until its signal aborts.
 *
 * Same shape as the helper in `client.test.ts`; duplicated rather than exported
 * because that file owns its own harness and this suite asks a different
 * question of it.
 */
function hangingFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    });
  });
}

/**
 * Card 1.65 — why the sweep changed ONE call site and not fifteen.
 *
 * The list of ~15 broad `catch` blocks was assembled by shape. The defect,
 * though, needs a request that can be CANCELLED, and an `AbortError` can only
 * reach a caller two ways:
 *
 *  1. that caller passed a signal which aborted — none of the eight files in
 *     the sweep list uses a signal or an `AbortController` at all; or
 *  2. the caller joined an in-flight GET started by somebody who did.
 *
 * Route 2 is the one that is easy to miss and is what this file pins.
 * `apiFetch` de-duplicates concurrent GETs by path, so a component that passes
 * no signal can inherit the abort of a component that does — which is exactly
 * `TeamPage.loadUsers` sharing `/users?page=1&pageSize=100` with the command
 * palette's `searchAll`, and the reason that one site was changed.
 *
 * ⚠️ It also pins the limit of that reasoning: sharing needs the SAME path, so
 * a site whose endpoint nobody fetches with a signal cannot see an abort, and a
 * guard there would be dead code that merely looks like handling.
 */
describe('a signal-less caller can inherit a shared abort (card 1.65)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('⚠️ rejects BOTH callers when the one holding the signal aborts', async () => {
    // THE MECHANISM THE WHOLE SWEEP JUDGEMENT RESTS ON. Without this, "only
    // TeamPage needs the guard" is an assertion; with it, it is a measurement.
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./client');
    const controller = new AbortController();

    const withSignal = client.fetchTeams({ signal: controller.signal });
    const withoutSignal = client.fetchTeams();
    // One request served both callers - that is the de-duplication.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    controller.abort();

    await expect(withSignal).rejects.toMatchObject({ name: 'AbortError' });
    // ...and the caller that never asked to be cancelled is cancelled too.
    await expect(withoutSignal).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('⚠️ does NOT share across different paths, which is why most sites are safe', () => {
    // The discriminating half. Sharing is keyed on the path, so the sweep sites
    // that hit `/admin/tags`, `/admin/agents` or `/teams/:id/members` cannot
    // inherit an abort from anyone: nothing fetches those paths with a signal.
    // If this ever stopped being true the judgement would need redoing, and
    // this line is where that shows.
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    return import('./client').then(async (client) => {
      const controller = new AbortController();
      // Attach the catch BEFORE aborting. Leaving these floating produced a
      // real unhandled rejection in the suite - which vitest reports as an
      // error beside 271 green tests, and which would have gone in unnoticed
      // had the summary line been the only thing read.
      const a = client.fetchTeams({ signal: controller.signal }).catch(() => null);
      const b = client.fetchHiddenPresets().catch(() => null);
      // Two different paths, two real requests: no promise to inherit.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      controller.abort();
      await a;
      // `b` is still hanging on its own path, unaffected by the abort above -
      // which is the point. Nothing awaits it to completion.
      expect(b).toBeInstanceOf(Promise);
    });
  });
});
