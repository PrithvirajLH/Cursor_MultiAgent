/**
 * Whether a rejected request was **cancelled** rather than failed.
 *
 * A cancellation is not an outage. The browser aborts an in-flight request
 * whenever the page it belongs to is torn down or superseded — navigating away,
 * a re-render that reissues the same query, a closed tab. The server may well
 * have answered it successfully; nobody is left to read the answer.
 *
 * Card 1.65: a data-loading `catch` that cannot tell the two apart renders a
 * full-page *"Unable to load…"* with a Retry button, for a request that was
 * never in trouble. Observed against production on 2026-09-10, where the two
 * aborted `scope=assigned` calls had already returned **200 in 20 ms** and
 * **304 in 42 ms**.
 *
 * ⚠️ **A timeout is deliberately NOT a cancellation.** `fetchWithTimeout` aborts
 * on its own 30s deadline and rethrows it as `ApiError("Request timed out",
 * 408)`, which is a real failure and must keep reaching the user. Do not widen
 * this helper to swallow it — the abort is the mechanism there, not the meaning.
 *
 * Matches on `name` rather than `instanceof DOMException`: every engine sets the
 * name, not all of them reject with a `DOMException`.
 */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
