# Implementation Prompt — 1.26 The ticket list must not lie about how fresh it is

**Date:** 2026-09-01
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.26 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** new tickets already arrive in the list without a refresh — but the only
path is the realtime socket, and it fails **silently**. If Web PubSub drops, the
queue stops updating and an idle helpdesk is indistinguishable from a broken one.
The header count never moves either.

**Cost:** none. **Web only** — no API change, no schema, no migration, no Azure change.

---

## 1. Goal

An agent can trust the list. New tickets keep arriving even when the socket is
down, and when the app cannot keep the list live it **says so** instead of
looking quiet.

## 2. Context read

- `CLAUDE.md` — baselines **272 unit (32 suites), 428 integration + 1 skipped, 58 web (16 files)**.
- `docs/agent-context/repo-landmines.md` (all), `docs/agent-context/working-agreement.md`, `.cursorrules`.

## 3. Facts established first (verified 2026-09-01, read the code before changing it)

| Fact | Consequence |
|---|---|
| **New tickets already appear without a refresh.** `handleTicketChanged` in `TicketsPage.tsx` (~`:749`) runs for **every** realtime reason. When the ticket is not already in the list (`presentBeforePatch === false`) it calls `maybeHydrateRealtimeTicket`, which fetches the row and inserts it in sort order if `matchesTicketFilters` passes. | **Do not rebuild this.** The insert path works. This card is about what happens when the socket is not there. |
| **The connection signal already exists.** `useRealtimeEvents` takes an `onAvailabilityChange(boolean)` option: `true` on `socket.onopen` (`:212`), `false` on close, error, and negotiation failure (`:121`, `:129`, `:194`, `:204`, `:232`). | No new plumbing in the hook. You are adding a **second consumer**. |
| **It is already used exactly this way — for notifications.** `App.tsx:599` passes `onAvailabilityChange: setNotificationsRealtimeAvailable`, and that boolean gates the notification poll at `App.tsx:544`. `useNotifications.ts:325` is the interval; it is gated on `isTabVisible` (`useNotifications.ts:49`) and `enablePolling`. | **Copy this pattern, do not invent one.** The precedent is in the repo and it is the one to follow. |
| `useRealtimeEvents` already reconnects with exponential backoff — `Math.min(10000, 500 * 2 ** Math.min(reconnectAttempt, 4))` (`:143`). | Do not add retry logic. It exists. You only need to react to the state. |
| **Web PubSub does not replay missed messages.** Nothing in `useRealtimeEvents` buffers or re-requests events dropped during an outage. | A reconnect must trigger **one immediate refetch**, or every ticket created during the outage stays invisible until the next manual action. This is the single most important part of the card. |
| The header count is `const totalCount = listMeta?.total ?? tickets.length` (`TicketsPage.tsx:1101`), rendered as "N open tickets" (`:1104-1109`). `listMeta` is only ever set by `loadTickets`. | A realtime insert or delete changes `tickets` and leaves `listMeta.total` stale. |
| `maybeHydrateRealtimeTicket` returns early when `filters.page > 1` (`:542`). | Nothing arrives on page 2+ **by design**. Keep that; see §4.5. |
| `isTabVisible` is local state inside `useNotifications.ts:49`. | Extract it to a shared `hooks/useTabVisible.ts` (one export) and have both call sites use it, rather than writing the visibility listener a second time. |

## 4. Decisions and assumptions

1. **Poll only while the socket is down.** Healthy socket → no polling at all; it
   is wasted requests and the realtime path is better. This differs from the
   notification poll (which runs alongside) because the ticket list request is
   much heavier.
2. **Interval 30 s**, gated on `isTabVisible` **and** `filters.page === 1`. A
   background tab polls nothing.
3. **On reconnect, refetch once, immediately.** Transition `false → true` fires
   one `loadTickets()`. This is what closes the outage gap (§3, fact 5). Also
   refetch once when the tab becomes visible again after being hidden while
   disconnected.
4. **The indicator only appears when something is wrong.** Connected → render
   nothing; no green dot, no "live" badge, no reassurance nobody asked for. When
   the socket is down: a small, quiet line near the list header —
   *"Reconnecting… list last updated 11:42"* — using `RelativeTime` if it reads
   better. It must not shift the layout when it appears (reserve the space or
   render it in an existing row).
5. **Page 2+ keeps its current behaviour** — no rows injected, no polling. That is
   deliberate: an agent paging through history does not want rows moving under
   them. But **do show the indicator** there when the socket is down, so the
   staleness is visible rather than implied. Say in the code comment that this is
   a decision, not an oversight.
6. **Header count:** adjust `listMeta.total` by `+1` on a realtime insert and
   `-1` on a removal, clamped at `>= 0`. It is an approximation between fetches —
   that is fine, and the reconnect refetch and the poll both correct it. Do not
   attempt an exact count; that needs an API change and this card has none.
7. **A poll must reconcile, not replace.** Realtime patches rows in place. If a
   poll assigns a fresh array wholesale, rows flicker and in-flight patches are
   lost. Merge by id, preferring the newer `updatedAt` — the same comparison
   `handleTicketChanged` already makes (`incomingUpdatedAtMs < currentUpdatedAtMs`
   → keep current).

## 5. The work

Kill stray node processes first. **`apps/api` is out of scope** — if you find
yourself editing it, stop and report.

### Task 1 — Shared tab-visibility hook

**Files:** Create `apps/web/src/hooks/useTabVisible.ts`; Modify `apps/web/src/hooks/useNotifications.ts`

- [ ] One export, `useTabVisible(): boolean`. Move the logic from
      `useNotifications.ts:49` verbatim — initial value from
      `document.visibilityState`, listener on `visibilitychange`, cleaned up.
- [ ] Point `useNotifications` at it and delete its local copy. **Its behaviour
      must not change**; the existing notification tests are the proof.

### Task 2 — Expose realtime availability to the ticket list

**Files:** Modify `apps/web/src/App.tsx`

- [ ] `onAvailabilityChange` currently has exactly one consumer. Make the boolean
      available to `TicketsPage` the same way `notificationsRealtimeAvailable`
      reaches the notification centre — follow whatever mechanism is already in
      place (prop, context, or the existing shell state) rather than adding a new
      one. **Do not call `useRealtimeEvents` a second time**; one socket.

### Task 3 — Poll backstop, reconnect refetch, indicator

**Files:** Modify `apps/web/src/pages/TicketsPage.tsx`; Create `apps/web/src/components/ListFreshnessNotice.tsx`

- [ ] Track the timestamp of the last successful `loadTickets` in state.
- [ ] Effect: when `realtimeAvailable === false && isTabVisible && filters.page === 1`,
      `setInterval(loadTickets, 30_000)`; clear it on every other condition and on
      unmount. Mirror the guard shape at `useNotifications.ts:315-322`.
- [ ] Effect: on `realtimeAvailable` transitioning `false → true`, call
      `loadTickets()` once (§4.3). Use a ref for the previous value; do not fire
      on first mount.
- [ ] Make `loadTickets` reconcile rather than replace when it is a background
      refresh (§4.7). If that is more than a small change to the existing
      `setTickets`, say so in the report rather than restructuring `loadTickets`.
- [ ] `ListFreshnessNotice.tsx`: one export, presentational, props
      `{ connected: boolean; lastUpdatedAt: string | null }`. Renders `null` when
      connected. No layout shift when it appears.
- [ ] Header count per §4.6, in the two places rows are added and removed.

### Task 4 — Web unit test

**Files:** Create `apps/web/src/components/list-freshness-notice.test.tsx`

- [ ] Follow the existing pattern — `renderToStaticMarkup`, no jsdom (see
      `linkified-text.test.tsx`).
- [ ] Cases: connected renders nothing at all; disconnected renders the notice and
      the last-updated time; disconnected with `lastUpdatedAt: null` still renders
      something sensible rather than "undefined".
- [ ] If the count arithmetic can be pulled into a pure helper, test it too:
      insert increments, removal decrements, never below zero.

### Task 5 — Docs, baselines, commit

- [ ] `CLAUDE.md` + `repo-landmines.md`: web baseline only (API numbers unchanged).
- [ ] Commit by explicit path after reading `git status --short`. **`e2e/` is
      untracked on purpose — leave it.**

## 6. Files expected to change

`hooks/useTabVisible.ts` (new) · `components/ListFreshnessNotice.tsx` (new) ·
`components/list-freshness-notice.test.tsx` (new) · `hooks/useNotifications.ts` ·
`App.tsx` · `pages/TicketsPage.tsx` · `CLAUDE.md` · `repo-landmines.md`.
**Nothing under `apps/api`.**

## 7. Security considerations

Small, but real:

- The poll calls the **same** `fetchTickets` the list already uses, so the access
  filter applies unchanged. **Do not add a lighter-weight or unfiltered endpoint**
  for polling.
- The notice must show **connection state only** — never an error body, a URL, or
  a negotiation token. "Reconnecting" is the whole message.
- Polling every 30 s per open tab, per agent, is a real load increase on a queue
  page that is left open all day. That is why §4.1 polls **only** while the socket
  is down and §4.2 gates on tab visibility. Do not loosen either.

## 8. Acceptance criteria

1. With realtime healthy, a ticket created elsewhere appears in the list as it
   does today, and **no polling requests are made** (check the network tab).
2. With the socket broken, a ticket created elsewhere appears within ~30 s, and
   the notice says the list is reconnecting.
3. **Breaking and restoring the socket loses nothing** — a ticket created while it
   was down is present immediately after it comes back, without any user action.
4. The header count moves with the rows on insert and on delete.
5. A hidden tab makes no polling requests.
6. Connected state renders no notice and no layout shift.
7. Notification behaviour is unchanged (Task 1 is a pure extraction).
8. `tsc` clean; vitest green with the new file; API suites untouched and unrun.

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/web"
npx tsc --noEmit && npx vitest run
```

No API or integration run — nothing under `apps/api` should change. If it did,
stop: that is out of scope.

## 10. Manual test steps

Dev API on `PORT=3077` + web with `VITE_API_BASE_URL=http://localhost:3077/api`
and `VITE_E2E_MODE=true`. Switch persona with
`localStorage.setItem("demoUserEmail", "lead@company.com")`.

To break the socket without touching code: restart the API with
`AZURE_WEB_PUBSUB_CONNECTION_STRING` blank, or block the negotiate call in
devtools. Then create a ticket from a second browser (or `curl` the API as
another persona) and watch the list.

Cover: healthy (arrives, no polling) → broken (arrives within 30 s, notice shown)
→ restored (the ticket created during the outage is there at once, notice gone)
→ hidden tab (no requests) → page 2 (no injected rows, notice still shown when
down). Then confirm the notification bell still behaves.

Stop the servers; zero repo node processes.

## 11. Handoff notes — what to report back

1. Commit SHA. 2. `tsc` exit code and the vitest summary. 3. `git diff --stat HEAD~1`.
4. Manual steps, especially **acceptance criterion 3** — that is the one that
   matters and the easiest to get subtly wrong.
5. Anything that did not match, in particular: whether making `loadTickets`
   reconcile was a small change or wanted a restructure; how you got the
   availability boolean to `TicketsPage` and whether the existing mechanism took
   it cleanly; and whether extracting `useTabVisible` was truly behaviour-neutral
   for notifications.

**Stop and report instead of improvising** if the card seems to need an API
change, a new endpoint, a second socket, or a schema change. None should be
necessary.
