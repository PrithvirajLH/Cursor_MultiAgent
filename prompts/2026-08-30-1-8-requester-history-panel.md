# Implementation Prompt — 1.8 Requester history panel

**Date:** 2026-08-30
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.8 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** an agent opening a ticket cannot see what else that person has asked for. It is the first thing anyone checks before replying — "have we had this before?" — and today it means leaving the ticket, searching, and coming back.

**Cost:** none. **Web only** — no API change, no schema, no migration, no Azure change. Smallest card in the queue.

---

## 1. Goal

On a ticket, an agent sees the requester's other recent tickets — number, subject, status, when — and can open one in a new tab without losing their place.

## 2. Context read

- `CLAUDE.md` — baselines **255 unit (30 suites), 415 integration + 1 skipped, 36 web (13 files)**.
- `docs/agent-context/repo-landmines.md` (all), `docs/agent-context/working-agreement.md` (commit discipline), `.cursorrules`.

## 3. Facts established first (verified 2026-08-30)

| Fact | Consequence |
|---|---|
| `GET /api/tickets` already accepts `requesterIds` (comma-separated), `statusGroup=all`, `pageSize`, `sort`, `order` — see `tickets/dto/list-tickets.dto.ts`. The list is filtered by `AccessControlService.buildTicketAccessFilter`, so a caller only ever sees what they are allowed to see, and soft-deleted tickets are already excluded. | **No API work.** One existing endpoint, called with a filter. Security comes free. |
| `apps/web/src/api/client.ts:769` `fetchTickets(params?, options?)` takes a params object and joins arrays with commas. | Call it directly; no new client function needed unless you want a named wrapper. |
| `TicketDetailPage.tsx` already uses `@tanstack/react-query` (`useQuery` at `:207`, `:222` for team members). | Follow that pattern exactly — same `queryKey` shape, same `enabled` guard. |
| `components/ticket-detail/TicketSidebar.tsx` has a collapsible-section mechanism: `ExpandedSections` (`:130`), `expandedSections` / `toggleSection` props (`:161-162`), and an existing collapsible "history" section for status events at `:659-683`. Property rows use `PropertyRow` / `DetailRow`; the requester block sits around `:620-640`. | Add a new collapsible section beside the existing ones, reusing the same header markup and chevron rotation. **Do not rename the existing `history` key** — it belongs to the status-event list. |
| The page derives `role` and the current user's email already (used for `canManage`, `canEditText`, `isRequester`). | Gate the panel on `role !== "EMPLOYEE"`. |
| Tickets have `displayId` (e.g. `IS_20260828_412`), `status`, `updatedAt`, `subject`, `priority`. `utils/format.ts` has `formatTicketId`; `utils/statusColors.ts` maps status → colour; `components/RelativeTime.tsx` renders "4h ago". | Reuse all four — do not invent new formatting. |

## 4. Decisions and assumptions

1. **Section title "Other tickets from this requester"**, collapsible, placed **directly under the Requester block** in the sidebar (that is where the eye already is when asking the question). New key `requesterHistory` on `ExpandedSections`; **collapsed by default** so it never pushes SLA rows below the fold on first open — the header shows the count so it is worth expanding.
2. **Query:** `fetchTickets({ requesterIds: [ticket.requester.id], statusGroup: "all", pageSize: 6, sort: "updatedAt", order: "desc", includeTotal: true })`. Fetch **6**, display up to **5** — the sixth tells you whether to show "more".
3. **Exclude the current ticket** client-side (it is in its own results). That is why 6 are fetched.
4. **Hidden entirely for `EMPLOYEE`** (a requester looking at their own ticket does not need a list of their own tickets in the sidebar — they have "My tickets"). Also hidden when the ticket has no requester.
5. **Each row:** display id (mono, small) · subject (truncated, one line) · status pill · relative time. The whole row is a link to `/tickets/<displayId>`; **`target="_blank"`** with `rel="noopener noreferrer"` so the agent does not lose the ticket they are working on. Add a `title` attribute with the full subject.
6. **Header shows the count** — "Other tickets from this requester · 4". When the total exceeds 5, the last row is a link "See all N tickets from this person" → `/tickets?requesterIds=<id>&statusGroup=all` (same tab).
7. **States:** loading → three skeleton rows (`components/skeletons/` already has row skeletons — reuse rather than invent); error → one quiet line "Couldn't load this person's other tickets" with a retry button (`refetch`); empty → "No other tickets from this person." Never a blank section.
8. **No polling.** `staleTime` 60 s; the existing realtime invalidation is not wired to this and does not need to be.

## 5. The work

Kill stray node processes first. This card touches `apps/web` only — the API and integration suites are untouched.

### Task 1 — The panel component

**Files:** Create `apps/web/src/components/ticket-detail/RequesterHistoryPanel.tsx`

- [ ] One export, kebab-case file name is **not** required here (the folder uses PascalCase component files — match the folder, `.cursorrules` kebab-case applies to the API).
- [ ] Props: `{ requesterId: string; currentTicketId: string; expanded: boolean; onToggle: () => void }`.
- [ ] Inside: `useQuery` with `queryKey: ["requester-history", requesterId]`, `enabled: expanded && Boolean(requesterId)` — **do not fetch until the section is opened**; that keeps the ticket page's first paint unchanged.
- [ ] Render the header row (button, aria-expanded, chevron) exactly like the existing status-history section at `TicketSidebar.tsx:659`, plus the count once loaded.
- [ ] Body per §4.5–4.7.

### Task 2 — Wire it into the sidebar

**Files:** Modify `apps/web/src/components/ticket-detail/TicketSidebar.tsx`, `apps/web/src/pages/TicketDetailPage.tsx`

- [ ] Add `requesterHistory: boolean` to `ExpandedSections` and to the page's initial state object (`TicketDetailPage.tsx` around `:236` where `history: false` is set) — default `false`.
- [ ] Render `<RequesterHistoryPanel …/>` under the requester block when `role !== "EMPLOYEE" && ticket.requester?.id`.
- [ ] Pass `expanded={expandedSections.requesterHistory}` and `onToggle={() => toggleSection("requesterHistory")}`.

### Task 3 — Web unit test

**Files:** Create `apps/web/src/components/ticket-detail/requester-history-panel.test.tsx`

- [ ] The existing web tests render to static markup with `renderToStaticMarkup` (see `ticket-history-state.test.tsx`) — follow that, no DOM environment needed.
- [ ] Cases: collapsed renders the header and **no** list; the empty state renders its message; a list of two tickets renders both display ids and excludes the current ticket id; the error state renders the retry affordance. Mock the query hook or pass rows through a presentational sub-component — whichever keeps the test in Node without jsdom. If that forces a component split, split it (`RequesterHistoryList` presentational + panel container) and say so.
- [ ] `cd apps/web && npx tsc --noEmit && npx vitest run` → 13 files + 1, 36 + new tests.

### Task 4 — Docs, baselines, commit

- [ ] `CLAUDE.md` + `repo-landmines.md`: web baseline only (API numbers unchanged).
- [ ] Commit by explicit path (read `git status --short` first):

```bash
git add apps/web/src/components/ticket-detail/RequesterHistoryPanel.tsx apps/web/src/components/ticket-detail/requester-history-panel.test.tsx apps/web/src/components/ticket-detail/TicketSidebar.tsx apps/web/src/pages/TicketDetailPage.tsx CLAUDE.md docs/agent-context/repo-landmines.md
git commit -m "feat(web): requester history panel on the ticket sidebar"
```

## 6. Files expected to change

`RequesterHistoryPanel.tsx` (new) · `requester-history-panel.test.tsx` (new) · possibly `RequesterHistoryList.tsx` (new, if Task 3 forces the split) · `TicketSidebar.tsx` · `TicketDetailPage.tsx` · `CLAUDE.md` · `repo-landmines.md`. **Nothing under `apps/api`.** If the API needs a change, stop and report — it should not.

## 7. Security considerations

The list endpoint applies the caller's own access filter, so an agent sees only tickets they could already open, and soft-deleted tickets are already excluded. Do **not** add a `includeDeleted` flag or any team override. The panel is hidden from `EMPLOYEE` — but that is a UI nicety, not the security boundary; the boundary is the API filter, which needs no change.

## 8. Acceptance criteria

1. On a ticket whose requester has other tickets, an agent expands the section and sees up to five, newest first, current ticket absent.
2. Collapsed on first open, and **no network request is made** until it is expanded (check the browser network tab).
3. Clicking a row opens that ticket in a new tab; the original stays put.
4. Empty, loading and error states all render something sensible.
5. A requester (`EMPLOYEE`) viewing their own ticket does not see the section.
6. `tsc` clean; vitest green with the new file; API suites untouched and unrun.

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/web"
npx tsc --noEmit && npx vitest run
```

(No API or integration run needed — but if you touched anything under `apps/api`, stop: that is out of scope.)

## 10. Manual test steps

Dev API (`PORT=3077`) + web (`VITE_E2E_MODE=true`). Sign in as a lead. Open a ticket whose requester has more than one ticket — create two or three for the same person first if the dev data is thin. Expand the section: rows appear, the current ticket is not among them, a row opens in a new tab. Collapse and reload: no request until expanded. Then sign in as that requester and confirm the section is absent. Stop the servers; zero repo node processes.

## 11. Handoff notes — what to report back

1. Commit SHA. 2. `tsc` exit code and the vitest summary. 3. `git diff --stat HEAD~1`. 4. Manual steps. 5. Anything that did not match — especially whether Task 3 forced the presentational split, and whether the sidebar's section mechanism took the new key cleanly.
