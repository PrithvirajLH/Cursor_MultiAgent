# Implementation Prompt — 1.94, 1.98, 1.87, 1.88: finishing the assignment and state story

**Date:** 2026-09-14
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** **1.94** (rules bypass availability) → **1.98** (reactivation) →
**1.87** (deleted tickets accept writes) → **1.88** (resolved this week)

**Four cards, four commits. NO MIGRATIONS — the count stays at 64.**
Work straight through. Do not check in between them, and do not ask permission.

> ## Why these four together
>
> **Two of them finish what the last batch started.** Cards 1.78 and 1.89 made
> deactivation real; **1.94 is the assignment path they did not cover, and 1.98
> is the way back that nobody could exercise before.** Both surfaced *because*
> that batch shipped.
>
> The other two are small state-correctness fixes in the same area: a write that
> should not be possible, and a number that counts the wrong thing.
>
> **Production is `2c2f8d0`, schema 64** — all four build on a deployed base.

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check for a live `jest` process before touching `apps/api`**; read from the
  git object store while one is running.
- ⚠️ **Hold the WSL VM open for the whole integration run** — background a
  blocking `wsl -d Ubuntu-22.04 -- sleep 1800`. **A keepalive that expires
  mid-run is how the last batch lost 50 minutes.**
- ⚠️ **If a run comes back broadly red, grep for `P1001|P1017|57P01` before
  believing it.**
- **NO MIGRATIONS.** ⚠️ **Card 2.6 reserves migration 65** — do not take it.
- **Baseline to beat:** unit **683 / 69**, web **372 / 54**, integration
  **876 + 1 skipped / 85 of 86**, both typechecks clean, migrations **64**.

---

## 1 — Commit one: card 1.94, rules can still assign to people on leave

**Card 2.2 stopped the automatic pickers choosing somebody who is away. It did
not stop a rule that names a specific person.**

- [ ] ✅ **Verified: neither `automation/rule-engine.service.ts` nor
      `routing/routing.service.ts` imports `availableUserFilter` — zero
      references in either.** So an automation rule's `assign_user` action and a
      routing rule's pinned assignee both bypass availability entirely.
- [ ] ⚠️ **Card 2.2 is not defective. The planner's handoff for it was.** It
      called the round-robin picker *"the one place assignment actually picks a
      person"*, and it is not — `routing.service.ts:376-381` resolves a pinned
      assignee too. **You are fixing my omission, not their work.**

### ⚠️ This one needs a decision made explicitly, not by default

**A pinned assignee may be deliberate.** "Send all payroll escalations to Dana"
is a reasonable rule, and Dana being on leave does not obviously mean the rule
should silently pick somebody else.

- [ ] **The planner's recommendation: a pinned assignee who is unavailable falls
      back to the team queue, unassigned, and the rule records that it did.**
      Rationale: an unassigned ticket is visible and gets picked up; one assigned
      to somebody on leave is invisible until they return. **That is the same
      reasoning card 2.2 used for an all-away team, so the product stays
      consistent with itself.**
- [ ] ⚠️ **If you disagree, say so and implement your choice** — but **whichever
      it is, write the reason in the code.** The failure mode here is a future
      reader finding two assignment paths with different availability behaviour
      and no explanation.
- [ ] ⚠️ **Reuse `availableUserFilter`. Do not write a second predicate.** It is
      the single definition of "actually here" and its doc comment says so.

### Tests

- [ ] ⚠️ **An automation rule pinning an unavailable user does not assign to
      them** — and the ticket still reaches the team.
- [ ] **The same rule pinning an AVAILABLE user still assigns to them.** The
      non-vacuity half.
- [ ] **A routing rule's pinned assignee behaves identically** — this is the site
      the audit missed and the handoff missed before it.

---

## 2 — Commit two: card 1.98, reactivation puts somebody back to work

- [ ] ✅ **Verified: `users.service.ts` `reactivate` (`:311`) writes
      `{ isActive: true, deactivatedAt: null }` and nothing else.** Deactivation
      deleted the `TeamMember` rows; they are gone and unrecoverable. **So a
      reactivated agent signs in and sees an empty queue, on no team, and nothing
      records which teams they were on.**
- [ ] ⚠️ **Pre-existing, but cards 1.78/1.89 are why it matters now** — before
      them a "deactivated" person kept working, so nobody exercised the path back.

### The fix

- [ ] **Record the team ids (and roles) on the deactivation event, and offer them
      back at reactivation.** ⚠️ **The planner's recommendation, and the reason is
      blast radius:** the alternative — soft-deleting `TeamMember` rows — is a
      migration **and** it touches every roster query including card 2.2's
      assignment picker. **That is a lot of exposure for this problem.**
- [ ] **The event payload is JSON, so this needs no schema change.** Confirm that
      before building; if the deactivation path writes no event at all, say so —
      **that would make card 1.95 (admin changes leave no audit trail) a
      prerequisite, and this card should stop and report rather than invent
      one.**
- [ ] **Restoring must be a deliberate action, not automatic.** Somebody
      deactivated for cause should not be silently re-rostered. **Show the owner
      what the person had and let them confirm.**
- [ ] ⚠️ **A team that no longer exists, or that they were removed from for a
      reason, must not break the restore.** Skip what cannot be restored and say
      which.

### Tests

- [ ] ⚠️ **Deactivate a member of TWO teams, reactivate, restore → they can
      work** — not merely that they can sign in. **That is the whole card.**
- [ ] **Reactivating without restoring still leaves them on no team**, so the two
      steps are genuinely separate.
- [ ] **A deleted team in the stored list is skipped rather than throwing.**

---

## 3 — Commit three: card 1.87, a deleted ticket still accepts assignment

- [ ] ✅ **Verified: `tickets.service.ts` `assign()` opens with
      `findUnique({ where: { id: ticketId } })` — no `deletedAt` filter** — so
      assigning or unassigning a soft-deleted ticket succeeds and writes a
      `TicketEvent` against a ticket nobody can see.
- [ ] ⚠️ **SCOPE THIS BY MEASURING, NOT BY ASSUMING.** The audit implied the SLA
      breach worker and the agent profile share the gap. **The planner checked
      both and they are FINE** — `sla-breach.service.ts:263` filters
      `deletedAt: null`, and `agents-admin.service.ts` filters at `:84`, `:211`
      and `:224`. **So sweep the write paths, find the ones that actually skip
      the filter, and report the list.**
- [ ] **Card 1.45 fixed this class on the read side** (20 of 23 reports were
      counting deleted tickets). **This is the same job for writes.**
- [ ] ⚠️ **404, consistent with everything else** — a soft-deleted ticket is
      invisible, so the answer is "no such ticket", not "forbidden".

### Tests

- [ ] **Soft-delete a ticket, then try to assign it → 404**, and **no
      `TicketEvent` is written.** The event is the part that pollutes history.
- [ ] **A live ticket still assigns.** Non-vacuity.
- [ ] **One test per write path you found**, so the list is visible in the suite
      rather than only in your report.

---

## 4 — Commit four: card 1.88, "resolved this week" counts the wrong thing

- [ ] ✅ **Verified: the `resolvedThisWeek` column keys on `t."updatedAt"`.** So
      editing a ticket resolved two months ago drags it into this week's figure,
      and a bulk touch inflates it for everyone at once.

### ⚠️ Use `resolvedAt`. NOT `completedAt`. The planner's first instruction was wrong.

**The card originally said to use `completedAt`, "the stamp that records when work
actually finished". That is wrong and would have swapped one bad field for
another:**

```ts
// tickets.service.ts:3248-3250
const completedAt =
  newStatus === TicketStatus.RESOLVED || newStatus === TicketStatus.CLOSED
    ? now : ...
```

**`completedAt` is rewritten when a ticket CLOSES**, so closing an old resolved
ticket would drag it into this week exactly as `updatedAt` does.

```ts
// tickets.service.ts:3236-3241
const resolvedAt =
  newStatus === TicketStatus.RESOLVED
    ? now
    : newStatus === TicketStatus.REOPENED ? null : ticket.resolvedAt;
```

**`resolvedAt` is set on RESOLVED, cleared on REOPENED, and PRESERVED through
CLOSED.** That is the field.

- [ ] **Key `resolvedThisWeek` on `resolvedAt`.**
- [ ] ⚠️ **Check whether `resolvedAt` is null on older rows** before relying on
      it, exactly as card 1.72 turned out to need. **If a backfill is required,
      STOP AND REPORT — this batch takes no migrations.**
- [ ] ⚠️ **Card 1.72's `notFinishedSql` uses `completedAt` and that use is still
      correct** — it asks only whether the stamp is null. **Do not "fix" it.**
      What must not happen is anything treating `completedAt` as *when it was
      resolved*.

### Tests

- [ ] ⚠️ **A ticket resolved last month, then edited today, is NOT in this
      week's figure.** The regression assertion.
- [ ] **A ticket resolved this month, then CLOSED today, is still counted in the
      week it was resolved** — the case that catches the `completedAt` mistake.
- [ ] **A ticket resolved this week IS counted.** Non-vacuity.

---

## 5 — What to report back

1. **Four commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, **migration count still 64**, and
   **confirmation that no file under `apps/api/prisma/migrations/` appears in any
   diff.**
3. The answers:
   - **1.94 —** what a rule does when its pinned assignee is away, and **why**.
   - **1.98 —** whether the deactivation path already writes an event you could
     hang the team list on.
   - **1.87 —** ⚠️ **the list of write paths that actually skip the soft-delete
     filter**, measured.
   - **1.88 —** whether `resolvedAt` is populated on old rows.
4. **For each card, the specific assertion that would fail if it regressed** —
   and **confirm you watched each inversion actually fail.** ⚠️ **Last batch an
   inversion silently did not apply because the block existed twice, and jest
   still printed "20 passed".**
5. Anything that did not match. **This document is wrong somewhere.**

## 6 — Browser pass

- [ ] **1.94 —** mark yourself away, trigger a rule that assigns to you.
      **It does not land on you**, and the ticket is in the team queue.
- [ ] **1.98 —** deactivate a test agent on two teams, reactivate, restore.
      **They can see and work their queue** — not just sign in.
- [ ] **1.87 —** delete a ticket, then try to assign it. Refused, and nothing new
      appears in its history.
- [ ] **1.88 —** open an old resolved ticket, edit it, and confirm **"resolved
      this week" does not move.**

**Stop and report instead of improvising** if the deactivation path writes no
event to hang the team list on, if `resolvedAt` turns out to need a backfill, if
making a pinned assignee fall back would break an existing routing rule in the
seed data, or if the soft-delete sweep turns out to be more than a handful of
call sites.
