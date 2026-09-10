# Implementation Prompt — 1.65 A cancelled request is not a failed one

**Date:** 2026-09-10
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.65 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** a request the **browser cancelled** is rendered as a full-page
*"Unable to load tickets"* with a Retry button, on a request the server had
already answered successfully.

**Cost:** none. **No migration. Web only.**

> ⚠️ **PART OF THIS IS ALREADY FIXED.** The planner fixed the shared cause and
> the two pages the owner actually hits — see §4. **The remaining work is the
> sweep in §5.** Read §4 before writing anything, or you will do it twice.

> Reported by the **owner** on 2026-09-10 — *"i have been seeing this quite a
> lot"* — on `/tickets?scope=assigned`, i.e. **Assigned to Me**, the view they
> land on. Not a one-off.

---

## 1. The evidence — the server was fine

Two `GET /api/tickets?…&scope=assigned&…` calls failed in the browser as
`net::ERR_ABORTED`. Both had **already succeeded on the server**:

| Request | Server result |
|---|---|
| req 219 | **200 — 20 ms** |
| req 228 | **304 — 42 ms** |

Read from the production container log. `ERR_ABORTED` is the browser tearing down
an in-flight request, not the API rejecting one. Ruling out the obvious
alternatives, all checked:

- **Not the session.** The bearer token on the failing request had ~45 minutes
  left. This is *not* the card 1.54 case, which is why the generic wording
  appeared instead of the session-expired panel.
- **Not the API, the deploy or the database.** Every sidebar count returned 200
  in the same seconds, and **the identical URL returned 200** later in the same
  session.
- **Not a slow query.** `scope=assigned` is `filters.push({ assigneeId: user.id })`
  — one indexed equality returning zero rows.

## 2. The fault

`TicketsPage.tsx`, the list `catch`, special-cased exactly one thing:

```ts
if (err instanceof ApiError && err.status === 401) { … return; }
setTicketError("Unable to load tickets.");
```

Anything that is not a 401 becomes a full-page error. Two different non-failures
land there:

- a raw `AbortError` when the fetch is cancelled;
- `ApiError("Request timed out", 408)` from the 30s deadline in
  `fetchWithTimeout` (`client.ts:722`).

**This is card 1.54's mistake repeated with a different status.** 1.54 taught the
catch that a 401 is not a data-loading failure. Nobody asked the same question
about a cancellation.

The sharpest detail: **`isAbortError` already existed** at `client.ts:874`. It was
private and used only on the cached-users path (`:2322`, `:2342`, `:2362`). The
knowledge was in the file; the list could not reach it.

## 3. Why it fires so often on that view

Cancellation is normal and constant here. The list is torn down or superseded on
every scope change, every tab switch, every navigation into a ticket and back —
and the tickets list passes **no signal of its own**, so these aborts come from
the browser, not from app-level supersede logic. `ticketsRequestSeqRef` guards
against a *stale response* landing, but a cancelled request never produces a
response to guard, so it falls straight through to the error branch.

## 4. What the planner already did — do not redo

Verified: api untouched, web `tsc` **0**, vitest **247 / 39 files**.

- **`apps/web/src/api/is-abort-error.ts` — new, one export**, per `.cursorrules`.
  Matches on `err.name === "AbortError"` over `instanceof Error` rather than
  `instanceof DOMException`: every engine sets the name, not all reject with a
  `DOMException`. Strictly broader than the old private check.
- **`client.ts`** imports it; the private duplicate is gone. The three
  cached-users call sites are unchanged in behaviour.
- **`TicketsPage.tsx`** — `if (isAbortError(err)) return;` **after** the 401
  branch. Deliberately leaves the rows alone rather than clearing them: either a
  newer load is already coming, or nobody is on the page to read anything.
- **`TriageBoardPage.tsx`** — same guard, same reasoning. It is the other list
  the owner uses and it is superseded on every scope and team change.
- **`is-abort-error.test.ts`** — 5 tests, including a real `AbortController`
  rejection, a non-`DOMException` `AbortError`, and **an assertion that a 408
  timeout is NOT treated as a cancellation.**

⚠️ **The timeout must keep reaching the user.** `fetchWithTimeout` aborts on its
own deadline, but rethrows as `ApiError(…, 408)` — a real failure. The abort is
the *mechanism* there, not the *meaning*. Do not "simplify" the helper to catch
both; the test above exists to stop exactly that.

## 5. The remaining work — the sweep

The same bare-`catch`-renders-an-error shape is in **~15 other places**. Found by
`grep -rn "Unable to load\|Failed to load" apps/web/src`:

`AdminTagsPage.tsx:90`, `AgentProfilePage.tsx:106`,
`AgentsDirectoryPage.tsx:92`, `AutomationRulesPage.tsx:1285`,
`ManagerViewsPage.tsx:812`, `SlaSettingsPage.tsx:1401/:1432/:1447`,
`TeamPage.tsx:455/:472/:490/:510`, `TriageBoardPage.tsx:605`,
`TagAnalyticsPanel.tsx:22`.

- [ ] **Audit each one and apply the guard where the call is cancellable.** Not
      every site needs it — a one-shot load in a modal that cannot be superseded
      is fine as it is. **Judge each; do not sed the whole list.**
- [ ] **Say in the report which ones you changed and which you deliberately did
      not, and why.** A list of fifteen with no reasoning is not a review.
- [ ] **Consider whether the 408 timeout deserves its own message** anywhere it
      is likely — *"This took too long"* is honest and actionable where *"Unable
      to load"* is not. Planner's view: worth it on the ticket list only.
      Owner's call.

## 6. What to verify

1. A cancelled list request leaves the rows on screen and shows **no** error.
2. A genuine failure (500) still shows the error and the Retry button.
3. A **408 timeout still shows an error** — this is the regression to fear.
4. A 401 still routes to the session-expired panel, not the generic error
   (card 1.54 must not regress).
5. Navigating rapidly between Assigned to Me, Unassigned and a ticket detail
   produces no error panel at any point.

## 7. Priority

**Medium-high.** Nothing is broken or at risk, and no data is wrong — but the
owner sees a false outage on their landing view often enough to report it
unprompted, and a UI that cries wolf about the API is how a real outage gets
ignored. The shared cause is already fixed; §5 is a contained afternoon.

Related: **1.54**, the same lesson one status code earlier. The pattern behind
both — *"a `catch` that flattens every distinct cause into one message"* — is
worth naming in the report, because §5 shows it fifteen more times.
