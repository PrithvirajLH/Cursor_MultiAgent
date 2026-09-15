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
 * Card 1.97 — joining a shared GET no longer means inheriting its cancellation.
 *
 * ⚠️ THIS FILE USED TO ASSERT THE OPPOSITE, AND THE CHANGE IS DELIBERATE.
 *
 * Under card 1.65 this suite pinned the behaviour that aborting one caller
 * rejected every caller sharing the path, because that was the mechanism a
 * judgement rested on: `TeamPage.loadUsers` shares `/users?page=1&pageSize=100`
 * with the command palette, so it needed an `isAbortError` guard while other
 * sites did not. The observation was right. Keeping the behaviour was not.
 *
 * It was a bug wearing a test. `apiFetch` de-duplicated concurrent GETs by
 * handing the second caller the FIRST caller's promise — built with the first
 * caller's `requestInit`, and therefore the first caller's signal. Two defects
 * came out of that and each was worked around separately:
 *
 *   - card 1.65: a caller with no signal inherited someone else's abort and
 *     showed "Unable to load" for a request that had already returned 200.
 *   - card 2.7: a caller WITH a signal was handed a promise that was already
 *     rejecting, so the announcements banner never loaded at all. StrictMode's
 *     mount → abort → remount made that the normal case, not the rare one.
 *
 * Two workarounds for one behaviour, and neither fixed it. Card 1.97 fixes it
 * here by ref-counting: the shared request is issued with its own controller,
 * each joiner gets its own promise, and the underlying request is only
 * abandoned when every joiner has abandoned it.
 *
 * ⚠️ The de-duplication itself must survive — it is real on the sidebar, which
 * is why option (b) was chosen over "stop sharing when a signal is present".
 */
describe('joining a shared GET does not inherit its abort (card 1.97)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('⚠️ aborting the caller WITH the signal leaves the other caller running', async () => {
    // THE INVERSION OF CARD 1.65'S ASSERTION, and the regression test for both
    // defects above. Before the fix, `withoutSignal` rejected here.
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./client');
    const controller = new AbortController();

    const withSignal = client.fetchTeams({ signal: controller.signal }).catch(
      (error: unknown) => ({ rejected: error }),
    );
    const withoutSignal = client.fetchTeams();
    // One request served both callers — the de-duplication is the point.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    controller.abort();

    // The caller that asked to be cancelled is cancelled...
    const first = (await withSignal) as { rejected?: { name?: string } };
    expect(first.rejected?.name).toBe('AbortError');

    // ...and the one that never asked is still waiting, not rejected.
    let settled = false;
    void withoutSignal.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it('⚠️ one request still serves both callers', async () => {
    // Without this the "fix" is a regression: the sidebar fires the same GET
    // from several components at once, which is why sharing exists at all.
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./client');
    const a = client.fetchTeams().catch(() => null);
    const b = client.fetchTeams().catch(() => null);
    const c = client.fetchTeams().catch(() => null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBeInstanceOf(Promise);
    expect(b).toBeInstanceOf(Promise);
    expect(c).toBeInstanceOf(Promise);
  });

  it('⚠️ the underlying request IS cancelled once every joiner abandons it', async () => {
    // The other half of ref-counting. If nobody is waiting any more, continuing
    // to hold the connection open would be a leak - the de-duplication must not
    // turn into "requests can never be cancelled".
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./client');
    const first = new AbortController();
    const second = new AbortController();

    const a = client.fetchTeams({ signal: first.signal }).catch(
      (error: unknown) => (error as Error).name,
    );
    const b = client.fetchTeams({ signal: second.signal }).catch(
      (error: unknown) => (error as Error).name,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The signal handed to fetch belongs to the shared entry, not to either
    // caller, so it must still be unaborted after the first one leaves.
    const passedSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    first.abort();
    expect(await a).toBe('AbortError');
    expect(passedSignal.aborted).toBe(false);

    second.abort();
    expect(await b).toBe('AbortError');
    expect(passedSignal.aborted).toBe(true);
  });

  it('a caller that aborts before joining still gets its own abort', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('./client');
    const live = client.fetchTeams().catch(() => null);
    const already = new AbortController();
    already.abort();
    await expect(
      client.fetchTeams({ signal: already.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(live).toBeInstanceOf(Promise);
  });

  it('does NOT share across different paths, which is why most sites are safe', () => {
    // Unchanged from card 1.65: sharing is keyed on the path, so a site whose
    // endpoint nobody fetches with a signal cannot see an abort at all.
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    return import('./client').then(async (client) => {
      const controller = new AbortController();
      const a = client.fetchTeams({ signal: controller.signal }).catch(() => null);
      const b = client.fetchHiddenPresets().catch(() => null);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      controller.abort();
      await a;
      expect(b).toBeInstanceOf(Promise);
    });
  });
});
