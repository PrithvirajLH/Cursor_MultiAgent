# Implementation Prompt — 1.78, 1.89, 1.80 and 1.79: four things the product gets wrong today

**Date:** 2026-09-14
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** **1.78 + 1.89** (deactivation) → **1.80** (auto-reply reopen) → **1.79** (two unguarded reads)

**Four cards, four commits. NO MIGRATIONS — the count stays at 64.**
Work straight through. Do not check in between them, and do not ask permission.

> ## Why these four, and why now
>
> They came out of the September audit and **the planner re-verified every one by
> opening the file** — none is taken on trust. They are grouped because they are
> all small, none needs a migration, and each one means the product is doing
> something today that you would call broken if you watched it happen.
>
> **1.78 and 1.89 are one problem in two halves and must ship together.** Fixing
> either alone leaves "Deactivate" still not deactivating.

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check for a live `jest` process before touching `apps/api`**; read from the
  git object store while one is running.
- ⚠️ **Hold the WSL VM open for the whole integration run** — background a
  blocking `wsl -d Ubuntu-22.04 -- sleep 1500`. **And if a run comes back broadly
  red, grep for `P1001|P1017|57P01` before believing it.** Three people have now
  read an empty grep result as "clean" when it was a swallowed connection error.
- **NO MIGRATIONS IN THIS BATCH.** If you find yourself writing one, stop.
- **Baseline to beat:** unit **679 / 69**, web **367 / 53**, integration
  **856 + 1 skipped / 82 of 83**, both typechecks clean, migrations **64**.
- ⚠️ **Card 2.7 is verified and UNDEPLOYED**, and card 2.6 has migration 65
  reserved. **Start from the current `HEAD` and do not touch
  `apps/api/prisma/migrations/`.**

---

## 1 — Commit one: cards 1.78 + 1.89, deactivation actually deactivates

### The two halves

**1.78 — the guard never checks.** `grep isActive apps/api/src/auth/auth.guard.ts`
returns **nothing**. The guard resolves a user by `oid`/email and continues.
`users.service.ts:286-297` sets `isActive:false`, deletes the roster rows and
nulls `primaryTeamId` — **and never touches authentication.** The audit confirmed
at runtime that a deactivated agent still answered `GET /auth/me` 200, listed
tickets and created one.

**1.89 — and they can be put straight back.** `teams.service.ts` `addMember`
calls `ensureUser`, which is `findUnique` plus *"User not found"* — **no
`isActive` check.** So a deactivated account can be re-added to a roster and
starts receiving auto-assigned work again.

### The fix

- [ ] **In `canActivate`, after the user is resolved: reject when `!isActive`.**
- [ ] **Treat an inactive row as a rejection in `findOrProvisionUser` too** — it
      must not re-provision or resurrect the account.
- [ ] **In `ensureUser` (or at `addMember`), refuse to add an inactive user** with
      a message that says why.
- [ ] ⚠️ **DO NOT "fix" this by adding `isActive` to `availableUserFilter`.**
      Card 2.2's filter deliberately says nothing about `isActive`, and its doc
      comment explains that deactivation removes the roster rows so the check
      would be dead code. **That reasoning is correct — 1.89 is what breaks its
      premise, and the repair belongs at the add, not the picker.** Adding it
      there would make a correct comment wrong.
- [ ] **Consider closing realtime connections for a deactivated user**, and say
      what you decided. A live socket outliving the rejection is the obvious
      follow-on, and it may be out of scope — **say so rather than doing it
      quietly.**

### Tests

- [ ] ⚠️ **Deactivate a LEAD, replay their bearer token → 401.** The card's whole
      point.
- [ ] **An ACTIVE user with the same shape still gets 200** — the non-vacuity
      half. A guard that rejects everyone passes the first assertion.
- [ ] **Adding an inactive user to a team is refused.**
- [ ] **Reactivating restores access**, so the control is reversible.

---

## 2 — Commit two: card 1.80, an auto-reply must not reopen a ticket

- [ ] **`inbound-email.service.ts:274-311`.** The `RESOLVED || CLOSED → REOPENED`
      branch has **no `!automated` gate**. The `WAITING_ON_REQUESTER →
      IN_PROGRESS` branch immediately below it **does**.
- [ ] ✅ **The reasoning you need is already written, in that second branch:**
      *"an out-of-office answering our acknowledgement is not the requester
      answering our question, and flipping the queue on it would make the board
      lie in the more dangerous direction."* **It applies with more force to
      reopening closed work.** Card 1.29 added the gate only to the branch it
      introduced.
- [ ] **Add `!automated` to the reopen condition.**
- [ ] **Record something on the inbound event** — `statusChangeSkipped:
      'automated'` or similar — so the decision is visible rather than silent.
      **An agent seeing "we ignored this autoresponder" is the difference between
      a feature and a mystery.**

### Tests

- [ ] ⚠️ **Resolve a ticket, post an inbound auto-reply → status stays RESOLVED
      and `resolvedAt` is unchanged.** The regression assertion.
- [ ] **A GENUINE human reply to a resolved ticket still reopens it** — the
      non-vacuity half, and the thing most at risk from a careless fix.
- [ ] **The message is still stored either way.** Suppressing a transition must
      not suppress the content.

---

## 3 — Commits three: card 1.79, two reads that skip the visibility check

**Every other ticket-derived read in this app goes through the visibility
chokepoint. These two never did:**

- `ai.controller.ts` — `getAnalysis(@Param('ticketId') ticketId: string)`, **no
  `@CurrentUser`, no guard**, straight to the service.
- `csat.controller.ts` — `@Get(':ticketId')`, **the same shape**, while the
  `@Post` beside it *does* take `@CurrentUser`.

- [ ] **Add `@CurrentUser()` to both and resolve the ticket through
      `buildTicketAccessFilter(user)` first, returning 404 when it is not
      visible** — mirroring `listEvents`, which is the pattern to copy.
- [ ] ⚠️ **404, not 403.** The sibling endpoints return 404 for an invisible
      ticket; a 403 tells an outsider the ticket exists.
- [ ] **Drop `rawText` from the AI analysis payload while you are in there.** It
      is the requester's verbatim message and the endpoint has no reason to
      return it.
- [ ] ⚠️ **The CSAT half is live today** — any signed-in person can read any
      ticket's rating and free-text comment. **The AI half leaks nothing only
      because the pipeline has never run** (card 1.63, zero rows against 461
      tickets). **Fix both; do not defer the AI one as theoretical.**

### Tests

- [ ] ⚠️ **Seed a CSAT row; GET as a non-participant → 404; as the requester →
      200.** The assertion that matters.
- [ ] **Seed an `AI_CLASSIFICATION` event; GET as a non-participant → 404; as
      OWNER → 200 with content.**
- [ ] **The returned AI payload contains no `rawText`.** Assert on the serialised
      body, so re-adding the field later fails this test.

---

## 4 — What to report back

1. **Four commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, **and the migration count, which must
   still be 64** — plus confirmation that **no file under
   `apps/api/prisma/migrations/` appears in any diff.**
3. The answers:
   - **1.78 —** what you decided about realtime connections for a deactivated
     user.
   - **1.78 —** confirmation you watched the *non-vacuity* test fail, i.e. that an
     active user still gets 200.
   - **1.80 —** confirmation a genuine human reply still reopens.
   - **1.79 —** 404 or 403, and why.
4. **For each card, the specific assertion that would fail if it regressed.**
5. Anything that did not match. ⚠️ **This document is wrong somewhere** — every
   handoff this month has been, and each time it was found by running rather than
   reading. **Card 2.7's implementer found the last one by opening the page when
   every test said the feature worked.**

## 5 — Browser pass

- [ ] **1.78 —** deactivate a test agent, then try to use the app as them.
      **Refused.** Reactivate: works again.
- [ ] **1.89 —** try to add that deactivated person to a team. **Refused, with a
      message that explains why.**
- [ ] **1.80 —** resolve a ticket, send an auto-reply to it. **Still resolved**,
      and the message is on the ticket.
- [ ] **1.79 —** as a requester, open your own ticket and confirm nothing broke;
      the point is that the guard must not lock out the people entitled to see it.

**Stop and report instead of improvising** if rejecting inactive users in the
guard breaks the seeded personas or the E2E auth mode, if `buildTicketAccessFilter`
cannot be reached from the AI or CSAT service without a circular import, or if a
genuine human reply stops reopening tickets.
