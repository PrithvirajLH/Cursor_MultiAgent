# Implementation Prompt — 1.29 The queue must know who owes the next move

**Date:** 2026-09-03
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.29 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** a requester answers, and the queue still says we are waiting on them.
The ticket keeps sitting in **"Awaiting reply > 24h"** as though they had gone
quiet, so an agent chases someone who already replied.

**Cost:** none. API + web. **No schema change, no migration, no Azure change.**
Size **S**.

**Also carries two extra-small residuals** from the four-card batch — §7. Both are
a few lines and this card is the next thing to touch those files.

> **Ships independently of the email epic.** It improves the **existing** inbound
> webhook, which is already live and already has integration coverage
> (`test/integration/tickets.inbound-email.spec.ts`). It does **not** wait on the
> mailbox worker (1.24) or the Graph permission.

---

## 1. What already works — do not rebuild it

**The live update is not the problem.** Verified: an inbound reply goes through
`TicketsService.addMessage`, which emits `message_added` at
`tickets.service.ts:1662` **with the message payload attached**, and
`notifications.messageAdded` raises the in-app notification. The bell rings and an
open ticket updates with no refresh **today**.

So this card is not about realtime. It is about the ticket's **state** being
wrong afterwards.

## 2. Facts established today (2026-09-03) — verified in code

| Fact | Consequence |
|---|---|
| `inbound-email.service.ts:159-162` transitions **only** `RESOLVED` and `CLOSED` → `REOPENED`. `WAITING_ON_REQUESTER` is never touched. | **This is the whole of Gap A.** After the requester answers, the status still reads "Waiting on requester". |
| The "Awaiting reply > 24h" saved view is a plain filter: `statuses=WAITING_ON_REQUESTER,WAITING_ON_VENDOR` + `updatedTo`. | Nothing to change in the view. Fix the status and the view becomes honest for free. |
| The allowed transitions from `WAITING_ON_REQUESTER` (`tickets.service.ts:235-239`) are **`IN_PROGRESS`**, `WAITING_ON_VENDOR`, `RESOLVED`. | **The target is `IN_PROGRESS`, and it is already permitted** — do not touch the transition map. |
| `applyStatusTransitionInTx` computes `leavingPause` (`:2552`) from `isPauseStatus`, which counts both `WAITING_ON_*` statuses. | **⚠️ This is not a cosmetic fix: it resumes the SLA clock.** Correct — the ball is back with us — but it changes SLA state, so expect resolution timers to start moving on tickets that were parked. Say so in the report. |
| `isAutomatedEmail(payload)` is **already computed** at `inbound-email.service.ts:127`, with a comment that it exists so "an out-of-office cannot start a war with our acknowledgement". | **The guard you need already exists.** See §4.2. |
| The inbound path already calls `applyStatusTransitionInTx` for the REOPENED case, inside a `$transaction`, and then emits a `status_changed` realtime event. | **Copy that shape exactly.** §4.1. |
| Nothing anywhere exposes `lastPublicMessageAt`, `lastMessageAt` or `awaitingAgentReply` — the list payload carries no information about the last message. | **This is the whole of Gap B**: a "requester replied" badge cannot survive a page load today. |

## 3. Goal

When a requester answers, the queue says the ball is with **us** — in the status,
in the saved views, and at a glance in the list.

## 4. Decisions and assumptions

1. **Go through `applyStatusTransitionInTx`. Never write the status directly.**
   A raw `prisma.ticket.update({ status })` would skip the pause/resume
   accounting, the status-history row, and the realtime emit — and the bug would
   be invisible until someone looked at an SLA report. The inbound service already
   calls this function for REOPENED; extend that block rather than adding a new
   path.
2. **An automated reply must NOT clear the status.** An out-of-office answering
   your acknowledgement is not the requester answering your question — flipping
   the queue on it would make it lie in the *other* direction, and that is worse,
   because it looks like progress. `automated` is already in scope at `:127` and
   already gates `suppressNotifications`. Gate this on it too.
3. **`WAITING_ON_VENDOR` is untouched.** A requester replying tells you nothing
   about the vendor. Only `WAITING_ON_REQUESTER` clears.
4. **Decide, and state, what a looped-in third party does.** The inbound path
   resolves a `requester`; a reply may come from someone CC'd instead. My reading
   is that **any human inbound reply should clear it** — the ball is with us
   either way, and the alternative leaves a ticket parked because the wrong
   person answered. **Whichever you choose, make it explicit in code and cover it
   with a test**, and say which you picked and why.
5. **Gap B is a list-payload addition, not a client trick.** A badge computed only
   in the browser dies on refresh. Put the fact on the row.
6. **No schema change.** Both facts are derivable from existing rows — see §6.
   If you find yourself wanting a column, **stop and report**.

## 5. Task 1 — Gap A: clear the status when the requester answers

**Files:** `apps/api/src/tickets/inbound-email.service.ts`

- [ ] Extend the existing transition block at `:159`. Alongside the
      RESOLVED/CLOSED → REOPENED case, add: **`WAITING_ON_REQUESTER` →
      `IN_PROGRESS`**, in the same `$transaction`, through
      `applyStatusTransitionInTx`, followed by the same `status_changed` realtime
      emit.
- [ ] **Guard it with `!automated`** (§4.2). The REOPENED case's own behaviour is
      out of scope — do not change it.
- [ ] Keep it to one transition per inbound message; the two cases are mutually
      exclusive by status, so an `else if` is honest here.

## 6. Task 2 — Gap B: show it in the list

**Files:** `apps/api/src/tickets/tickets.service.ts`, the list response type,
`apps/web` ticket list

- [ ] Add to the **list** payload, per row, the two facts a badge needs: **when
      the last public message arrived** and **whether it was the requester who
      wrote it** — or the single derived boolean `awaitingAgentReply`. Prefer the
      derived boolean: it keeps the rule on the server, where the next reader can
      find it.
- [ ] **One query for the whole page, not one per row.** The list is paginated;
      fetch the last public message for the page's ticket ids in a single query
      and attach in memory. **Do not** add a per-row subquery, and do not extend
      the existing raw-SQL count query to carry it.
- [ ] Render a quiet per-row marker in the ticket list — enough to scan for, not a
      klaxon. It must survive a page reload, which is the whole point.
- [ ] It must not shift the row's layout or push the existing SEV / reference /
      status chips around.

## 7. Task 3 — Two residuals from the four-card batch

Both verified 2026-09-03 while GREEN-ing that batch. Extra small, and this card
already touches one of the files.

### 7a — The mention path still filters internal notes by rank

`tickets.service.ts:1723` skips only `UserRole.EMPLOYEE` before asking
`canViewTicket` — and after card 1.36, `canViewTicket` returns **true** for a
requester. So a **staff** requester `@mentioned` in an internal note on their own
ticket gets a "You were mentioned on a ticket" notification for a message they
cannot open.

- [ ] Drop the requester from an internal note's mention audience, the same way
      card 1.36 did for the message audience — **by relationship, not by rank.**
- [ ] **This is not a leak and must not be reported as one:** the notification
      payload carries only the ticket subject, never the note body (verified). It
      is a dead-end notification.

### 7b — The follower-management rule is written twice

The same `OWNER || TEAM_ADMIN || LEAD` literal appears in `isRemovable`
(`notifications.service.ts`, card 1.28) and in `unfollowTicket`
(`tickets.service.ts:2882-2884`). They agree today.

- [ ] Replace both with **one shared predicate**. This is the exact pattern behind
      1.36's Fault C and 1.38 — a permission question answered independently in
      two places always drifts, and here the drift would put an × in front of
      someone the server will refuse.

## 8. Tests

- [ ] **Integration, the core case:** a ticket in `WAITING_ON_REQUESTER` receives
      an inbound reply → status is **`IN_PROGRESS`**, a status-history row exists,
      and the ticket **no longer matches** the "Awaiting reply" filter
      (`statuses=WAITING_ON_REQUESTER,WAITING_ON_VENDOR`). Assert the **stored**
      status, not a response field.
- [ ] **Integration, the guard:** the same ticket receives an **automated** reply
      → status **unchanged**. This is the assertion that stops the fix lying in
      the other direction; without it the guard can be deleted silently.
- [ ] **Integration, no over-reach:** a ticket in `WAITING_ON_VENDOR` receiving a
      requester reply is **unchanged**; the existing RESOLVED/CLOSED → REOPENED
      behaviour is **unchanged**.
- [ ] **Integration, §4.4:** whichever way you decide the looped-in-third-party
      case, pin it.
- [ ] **Integration, Gap B:** the list payload reports the ticket as awaiting an
      agent reply after a requester's message, and **not** after an agent's.
- [ ] **Unit/web:** the row marker renders from the payload field; no test may
      depend on it being computed client-side.
- [ ] **7a:** a staff requester `@mentioned` in an internal note on their own
      ticket receives **no** mention notification; a teammate mentioned in the
      same note still does.
- [ ] Targeted, then the **full** suite. **Do not edit source while it runs** — a
      mid-run edit once produced 81 phantom failures.

## 9. Verification

Postgres up; no other integration run active; **kill stray node processes first**,
and read the 2026-09-02 note in `repo-landmines.md` — the repo-scoped filter
**misses a dev server started with a relative path**, so check the listening ports
too.

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npm run test:integration > ../../int-full.txt 2>&1
grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

**Baselines to hold or beat** — verified 2026-09-03, after 1.39. Older documents
in this repo were stale until today:

| Check | Expected |
|---|---|
| `apps/api` `tsc` | 0 |
| `apps/api` unit | **443 / 44 suites** |
| Full integration | **475 + 1 skipped, 53 of 54** |
| `apps/web` `tsc` | 0 |
| `apps/web` vitest | **117 / 23 files** |

Delete the log afterwards. **A backgrounded run reported as `exit 127` was
killed, not missing a command** — its numbers are not real; re-run it.

## 10. Acceptance criteria

1. A requester's genuine reply moves the ticket out of `WAITING_ON_REQUESTER`, and
   it disappears from "Awaiting reply > 24h".
2. An **automated** reply does not.
3. `WAITING_ON_VENDOR` and the RESOLVED/CLOSED → REOPENED path are untouched.
4. The status change goes through `applyStatusTransitionInTx`, so pause
   accounting, status history and the realtime emit all happen.
5. The list shows, **after a page reload**, which tickets are waiting on us.
6. Gap B costs **one** query per page.
7. A staff requester is no longer notified about an internal note they cannot
   open, and the follower rule exists in one place.
8. Both `tsc` clean; unit, integration and vitest at or above §9.

## 11. Manual test steps

Dev API on `PORT=3077` (`AUTH_ALLOW_INSECURE_HEADERS=true`,
`NODE_ENV=development`); web with `VITE_API_BASE_URL=http://localhost:3077/api`
and `VITE_E2E_MODE=true`. Persona via `localStorage.setItem("demoUserEmail", …)`
**then reload** — setting it directly bypasses the cache clearing in
`setDemoUserEmail`, and a stale persona will have you chasing a bug that is not
there.

Confirm dev SMTP is off before posting: `apps/api/.env` must have no active
`SMTP_HOST` (it is present as `SMTP_HOST_DEV_DISABLED`).

Drive the inbound path by POSTing to `/api/tickets/inbound-email` — the existing
integration spec shows the payload shape. Then:

1. Put a ticket in **Waiting on requester** as an agent. Confirm it appears in
   "Awaiting reply > 24h" (adjust the date filter if needed).
2. Send an inbound reply. Confirm the status flips to **In progress**, the ticket
   **leaves** that view, and the list marker appears.
3. **Reload the page.** The marker must still be there.
4. Send an inbound reply carrying out-of-office headers. Confirm the status does
   **not** move.

**The API runs from `dist`** — if a change appears to have no effect, suspect the
build (`repo-landmines.md`).

## 12. What to report back

1. Commit SHA(s) and `git diff --stat`.
2. Every `Tests:` line, both `tsc`, vitest, against §9's table.
3. **Your §4.4 decision** — what a looped-in third party's reply does, and why.
4. **Whether SLA state moved** on any existing fixture when the pause resumed.
   §2 flags this; confirm what you actually observed rather than assuming.
5. Whether Gap B fitted the existing list query or needed restructuring, and the
   query count for a page.
6. Anything that did not match. Handoffs from this planner have carried a wrong
   line number, a stale premise, a self-contradiction, an invented file reference,
   a dead CSS class quoted as live, and a Tailwind trap I wrote myself. **Say so
   plainly if this one is wrong too.**

**Stop and report instead of improvising** if this appears to need a schema
change, a migration, a new column, or a change to the transition map. None should
be necessary.
