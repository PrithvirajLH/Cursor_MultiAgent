# Implementation Prompt — Phase 2, first batch: 2.2, 2.1 and 2.12

**Date:** 2026-09-11
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** **2.2** (out of office) → **2.1** (least-loaded assignment) → **2.12**
(human ticket ids in links)

**One commit per card. Three commits, in that order.** Work straight through. Do
not check in between them, and do not ask permission.

**Two migrations: 62 and 63.** Both additive. **Zero `DROP` statements.**

> ## This is the first Phase 2 batch, and the order is a dependency, not a preference
>
> **2.1 cannot be built before 2.2** — least-loaded means "the least loaded person
> who is actually here", and "actually here" is what 2.2 adds. Building 2.1 first
> means writing the picker twice.
>
> **2.12 is independent of both** and touches nothing they touch. It is in this
> batch because it is small, visible, and depends on nothing.
>
> ⚠️ **Two other cards were deliberately cut from this batch by the owner:** 2.7
> (announcements) is an M dressed as an S and gets its own handoff; 2.11
> (similar-ticket suggestions) is deferred because **production has exactly 5
> resolved tickets** to match against, so it would ship looking broken. **Do not
> pull either of them in.**

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check for a live `jest` process before touching `apps/api`** — a second
  session's run renames `apps/api/.env`, and an open handle on Windows blocks the
  rename and fails the suite. **While one is running, read from the git object
  store** (`git show HEAD:<path>`, `git grep HEAD -- <path>`). The planner walked
  into this again today.
- ✅ **Start from `d4cf357` or later.** Cards 1.76 and 1.77 have landed since this
  document was first written and Phase 1 is closed. **Pull before you branch** —
  `saved-views.ts` lost `PRIMARY_NAV_PRESETS` in `be1cb61`, and
  `TicketDetailPage.tsx` and `TicketsPage.tsx` both gained a call to
  `isTransientLayerOpen`. None of that collides with this batch, but working from
  a stale tree would resurrect deleted code.
- ⚠️ **A deploy of `cc0ce09 → d4cf357` may be running while you start.** It builds
  from a pinned commit, so it cannot pick your work up — **but do not force-push
  or rewrite history on this branch until it reports.**
- **Never `git add -A`; commit explicit paths.**
- **Baseline to beat:** unit **654 / 65**, web **298 / 46**, integration
  **805 + 1 skipped / 77 of 78**, both typechecks clean, migrations **61**.
  ✅ **All five re-measured by the planner at `d4cf357` on 2026-09-11.**
- ⚠️ **Hand-write both migrations.** `prisma migrate dev` emits six `DROP INDEX`
  for trigram GIN indexes it cannot model plus six `ALTER COLUMN … DROP DEFAULT`.
  **Applying one unedited destroys ticket and KB search.** Run
  `bash scripts/check-migrations.sh` before you report.
- **Trust a live run over this document.**

---

## 1 — Card 2.2: agent availability / out of office (S, migration 62)

**Auto-assignment currently sends tickets to people on leave.**

### Schema

- [ ] **Migration 62, additive:**

      ```sql
      ALTER TABLE "User" ADD COLUMN "isAvailable" BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE "User" ADD COLUMN "awayUntil" TIMESTAMP(3);
      ```

      ✅ **Verified absent from the schema today** — neither field exists, so
      there is nothing to reconcile.

### The one place assignment actually picks a person

`tickets.service.ts:4700-4742`. Read it before editing; the shape matters:

```ts
const [team] = await client.$queryRaw`SELECT "id", "assignmentStrategy"::text,
  "lastAssignedUserId" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`;
if (team.assignmentStrategy !== TeamAssignmentStrategy.ROUND_ROBIN) return null;
const members = await client.teamMember.findMany({
  where: { teamId }, orderBy: { createdAt: 'asc' },
});
```

- [ ] **Filter the member list by the user's availability.** Availability lives on
      `User`, and `members` are `TeamMember` rows, so this needs a relation filter
      — not a second query you then intersect in JavaScript.
- [ ] ⚠️ **`FOR UPDATE` IS LOAD-BEARING. Do not move the member query out of the
      transaction.** The team row is locked so two tickets arriving together
      cannot both take the same round-robin slot. Anything you add must stay
      inside that lock.
- [ ] ⚠️ **DO NOT ADD AN `isActive` FILTER THINKING YOU ARE FIXING A BUG.** The
      planner checked: `users.service.ts:220` deletes the user's `TeamMember` rows
      on deactivation, so a deactivated person is already out of rotation. **An
      `isActive` filter here would be dead code that looks like a fix** — the
      exact thing card 1.65 refused to do.

### ⚠️ The decision this card actually turns on

**What happens when every member of a team is away?** Today the list is never
empty and somebody always gets the ticket. After this card the filter can empty
it, the function returns `null`, and **the ticket lands unassigned.**

- [ ] **That is the right answer** — an unassigned ticket in the queue is visible
      and gets picked up; one assigned to somebody on leave is invisible until they
      return. **But it is a behaviour change and it must be deliberate, tested, and
      in your report.**
- [ ] ⚠️ **Make sure an unassigned ticket is still routed to the TEAM.** Losing
      the team as well would drop it out of every queue view. **Assert that.**

### Coming back

- [ ] **Toggle in the avatar menu**, and an `awayUntil` date.
- [ ] **The scheduler (card 1.3) flips `isAvailable` back at `awayUntil`.**
      ⚠️ **The planner could not find the job registry by grep. Find it, and say
      where it is in your report.** ⚠️ **`repo-landmines.md` records that the
      Operations console's job list is pinned in two specs** — if adding a job
      means updating those, that is expected, not a surprise.
- [ ] **When going away, offer "reassign my N open tickets to the queue."** Bulk
      unassign already exists (card 1.12) — **reuse it, do not write a second
      one.**
- [ ] ⚠️ **"Open" must mean what card 1.72 made it mean.** That card just
      collapsed three spellings of "not finished" into `notFinishedSql()` /
      `notFinishedFilter()`. **Use them. Do not write a fourth.**

### Tests

- [ ] ⚠️ **An unavailable agent never receives an auto-assignment.** The card's
      whole point.
- [ ] **An available agent still does** — the non-vacuity half. A filter that
      excludes everybody passes the first assertion and is useless.
- [ ] **Every member away → the ticket is unassigned but still routed to the team.**
- [ ] **Two tickets arriving concurrently do not both take the same slot** — the
      `FOR UPDATE` behaviour, which must survive your change.

---

## 2 — Card 2.1: load-balanced assignment (S, migration 63)

**Round-robin ignores that one agent has 40 open tickets and another has 4.**

### Schema

- [ ] **Migration 63:**

      ```sql
      ALTER TYPE "TeamAssignmentStrategy" ADD VALUE 'LEAST_LOADED';
      ```

      ✅ **Verified: the enum today is `QUEUE_ONLY, ROUND_ROBIN` only.**
- [ ] ⚠️ **KNOWN POSTGRES TRAP, and the planner checked the versions for you.**
      `ALTER TYPE … ADD VALUE` inside a transaction is allowed on **PostgreSQL 12+
      — production is 16.14 and the local test cluster is 16.15**, so this is
      fine. **But the new value cannot be USED in the same transaction that adds
      it.** So this migration adds the value and does nothing else: **no `UPDATE`
      setting a team to `LEAST_LOADED` in the same file.** If you need to set one,
      that is a later migration or a UI action.
- [ ] **Give it its own migration file rather than folding it into 62**, so a
      revert of either card is clean.

### The picker

- [ ] **Replace the `!== ROUND_ROBIN → return null` guard with a branch over the
      strategy**, keeping `QUEUE_ONLY` returning `null` exactly as now.
- [ ] **`LEAST_LOADED`: pick the available member with the fewest open tickets.**
- [ ] ⚠️ **"Open tickets" must again be `notFinishedFilter()` from card 1.72.**
      This is the third card in a row where a new count of "open" could be
      invented. **Do not invent it.**
- [ ] **Tie-break with the existing `lastAssignedUserId` pointer** — that is what
      it is for, and it keeps ties fair instead of always favouring the earliest
      member.
- [ ] ⚠️ **Keep updating `lastAssignedUserId` even in `LEAST_LOADED` mode.**
      Otherwise switching a team back to round-robin restarts from `members[0]`
      and one person gets a double share.
- [ ] ⚠️ **The count must run inside the same `FOR UPDATE` transaction.** A load
      count taken outside the lock is stale the moment two tickets arrive
      together, which is precisely the case this card exists for.
- [ ] **Strategy dropdown in `pages/TeamPage.tsx`.**

### Tests

- [ ] ⚠️ **The least-loaded agent is chosen** — with a fixture where round-robin
      would have chosen somebody else. **If round-robin and least-loaded would
      pick the same person, the test proves nothing.**
- [ ] **An unavailable agent is skipped even when they are the least loaded** —
      2.2 and 2.1 composed, which is the reason for the order.
- [ ] **A tie falls to the round-robin pointer**, and the pointer advances.
- [ ] **`QUEUE_ONLY` and `ROUND_ROBIN` behave exactly as before.** Pin this; two
      of three strategies are existing behaviour and must not move.

---

## 3 — Card 2.12: human ticket ids in links (S, no migration)

**`/tickets/7fe5d219-…` is unrecognisable in Teams and email. `IT-0042` already
exists as `displayId`.**

### ✅ Verified against production, so you can rely on it

| | measured 2026-09-11 |
|---|---|
| Tickets | **450** |
| Without a `displayId` | **0** |
| Distinct `displayId` values | **450** |
| Index | `Ticket_displayId_trgm_idx` present |
| Schema | `displayId String? @unique` |

- [ ] ⚠️ **It is `String?` — nullable in the schema even though every production
      row has one.** So the resolver must handle a null, and **a link builder must
      fall back to the UUID rather than emit `/tickets/undefined`.** Do not make
      the column non-null in this card; that is a migration and a separate
      decision.

### Resolve either form

- [ ] **Route `/tickets/:idOrDisplayId`.**
- [ ] **In `TicketsService.getById`, resolve by `displayId` when the parameter is
      not a UUID.** ⚠️ **Decide by shape, not by a database lookup that falls
      back** — a "try id, then try displayId" double query doubles the cost of the
      hottest read path.
- [ ] **Old UUID links must keep working.** People have them in email and in
      Teams. **Assert it.**

### ⚠️ Two traps that would make this card much bigger than it is

- [ ] **`ticketLink` is written twice** — `notifications.service.ts:1399` and
      `sla-breach.service.ts:877`, both `` `${base}/tickets/${ticketId}` ``.
      **Unify them; do not update both.** One rule in two places is the drift
      behind cards 1.36, 1.38, 1.47, 1.50, 1.61, 1.70, 1.71 and 1.75 — **eight
      cards, one of which was found by the owner in production yesterday.**
- [ ] ⚠️ **DO NOT TOUCH THE API PATHS.** `apps/web/src/api/client.ts` has roughly
      twenty `apiFetch('/tickets/${id}/…')` calls — messages, events, followers,
      viewing. **Those are internal endpoints, not links a human shares.** Changing
      them is a large diff with no user-visible benefit and real breakage risk.
      **This card changes the browser route, the copy-link, and the links in
      email. Nothing else.**

### ⚠️ Check before you touch the emails

- [ ] **Card 1.44's seven one-click links are signed** with `EMAIL_ACTION_SECRET`.
      **Find out whether the signature covers the ticket id before changing what
      appears in those URLs.** If it does, changing the id invalidates every link
      already sitting in somebody's inbox. **Stop and report if so** — that is a
      decision, not an implementation detail.

### Also in this card, and separable

- [ ] **An enum-to-label map so `IN_PROGRESS` never reaches the screen** (UX review
      Theme 2). A neighbour of `utils/statusColors.ts`. **If this makes the commit
      unwieldy, say so and leave it — it is the one part of 2.12 nothing else
      depends on.**

### Tests

- [ ] **`/tickets/IT-0042` opens the same ticket as its UUID.**
- [ ] **A UUID link still works** — the regression assertion.
- [ ] **Copy-link produces the `displayId` form**, and **falls back to the UUID
      when `displayId` is null.**
- [ ] **One assertion that the unified `ticketLink` is used by both services** —
      so the two cannot drift apart again.

---

## 4 — What to report back

1. **Three commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, **the migration count (63)**, and
   **`bash scripts/check-migrations.sh` clean.**
3. The answers:
   - **2.2 —** ⚠️ **what happens when every member of a team is away**, and the
     test that pins it. **And where the scheduler's job registry lives.**
   - **2.1 —** the fixture you used to prove least-loaded differs from round-robin,
     and confirmation that `QUEUE_ONLY` and `ROUND_ROBIN` did not move.
   - **2.12 —** ⚠️ **whether `EMAIL_ACTION_SECRET`'s signature covers the ticket
     id**, and what you therefore did about the email links.
   - **2.12 —** how you decided UUID-or-displayId without a double query.
4. **For each card, the specific assertion that would fail if it regressed.**
5. Anything that did not match. **This document is wrong somewhere.**

## 5 — Browser pass

- [ ] **2.2 —** mark yourself away, create a ticket that routes to your team,
      confirm it does not come to you. Mark yourself back, confirm it does.
- [ ] **2.2 —** set a team where everyone is away. **The ticket should be
      unassigned and still in the team's queue**, not lost.
- [ ] **2.1 —** switch a team to least-loaded with an obviously uneven split, and
      confirm the quiet agent gets the next one.
- [ ] **2.12 —** copy a ticket link. It should read `/tickets/IT-0042`. **Paste an
      old UUID link and confirm it still opens.**
- [ ] **2.12 —** trigger one email and check the link in it opens the ticket.

**Stop and report instead of improvising** if the email-action signature covers the
ticket id, if filtering by availability would leave a team unable to auto-assign at
all, if the least-loaded count cannot be taken inside the existing lock, or if
`displayId` turns out not to be unique in the local test data.
