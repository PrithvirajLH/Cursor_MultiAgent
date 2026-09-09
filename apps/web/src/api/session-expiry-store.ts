type SessionExpiryListener = (expired: boolean) => void;

/**
 * Whether the session is currently rejected by the API (card 1.54).
 *
 * ⚠️ WHY THIS EXISTS. On 2026-09-09 the owner's screen showed
 * *"Unable to load tickets"* with a **Retry** button, beside sidebar badges
 * still displaying confident numbers. Every request on the page had 401'd in a
 * single 70 ms burst. Retry cannot fix an expired session, so clicking it
 * failed again — which is what "this happens frequently" feels like from the
 * outside — and the counts were stale values held by
 * `useViewCounts`'s `placeholderData`, not live figures.
 *
 * The page had no way to know the difference, because a bare `catch` threw the
 * status away and every failure became the same generic loading error. This
 * store is the missing signal: one place that says "the API is refusing this
 * session", which the list and the counts can both read.
 *
 * Deliberately a plain module-level store rather than React context: `client.ts`
 * is not a component and must be able to set this from inside a fetch, and the
 * value is genuinely global — there is one session.
 */
export const sessionExpiryStore = {
  expired: false,
  listeners: new Set<SessionExpiryListener>(),

  /** Read the current state, for a first render before any event arrives. */
  isExpired(): boolean {
    return this.expired;
  },

  /**
   * Mark the session expired or recovered, notifying subscribers on a change.
   *
   * Idempotent: setting the same value twice notifies nobody, so the ten count
   * queries that fail together produce one state change rather than ten.
   */
  set(next: boolean): void {
    if (this.expired === next) {
      return;
    }
    this.expired = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  },

  /** Subscribe to changes. Returns the unsubscribe function. */
  subscribe(listener: SessionExpiryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  },
};
