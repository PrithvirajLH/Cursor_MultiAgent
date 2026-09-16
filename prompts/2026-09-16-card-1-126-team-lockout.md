# Implementation Prompt — card 1.126: a team admin can lock themselves out, and an owner cannot undo it

**Date:** 2026-09-16
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** **1.126** — guards on team membership, both directions

**One card, probably two commits. No migration.**

> ## ⚠️ THIS IS A LIVE LOCKOUT, REPORTED BY THE OWNER FROM PRODUCTION
>
> **What they did:** held TEAM_ADMIN, removed their own account from Payroll.
> **What happened:** *"now as a owner i am not able to add member"*.
>
> **And they named the missing rule themselves:** *"team admin cannot remove
> another team admin or himself"*.
>
> ⚠️ **Both halves are confirmed in the code. Neither is a UI problem.**

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check the tree is yours:** `git status --porcelain | grep -v '^??'`.
- **Baseline to beat:** unit **855 / 91**, web **416 / 61**, integration
  **966 + 1 skipped / 96 of 97**, both typechecks clean, migrations **67**.
- ⚠️ **Before writing anything, get the EXACT error text the owner saw.** §3
  explains why it decides which of two things you are fixing. **If you cannot get
  it, build §1 first — that one is unambiguous.**

---

## 1 — Commit one: `removeMember` has no guard at all

### What is wrong

✅ **Verified at `teams.service.ts:256-281`. The whole method is:** permission
gate → find the row → delete it → sync the role. **There is no other check.**

**So a TEAM_ADMIN can remove:**

- **themselves** — which is what the owner did, and there is nothing to stop it
- **another TEAM_ADMIN**
- **the last member of the team**, leaving it with nobody

⚠️ **AND THE CODEBASE ALREADY KNOWS THIS CLASS OF BUG, ONE FILE OVER.**
`users.service.ts:206-212` guards exactly this shape for the OWNER role:
*"You cannot change your own owner role"*, plus a count of remaining active
owners. **The rule exists, was thought through, and was never carried across to
team membership.** ⚠️ **That is the fifteenth instance of this project's
recurring failure — one question answered in one place and not the other.**

### The fix

- [ ] **A TEAM_ADMIN cannot remove themselves from a team they administer.**
      **An OWNER still can remove them** — somebody has to be able to.
- [ ] **A TEAM_ADMIN cannot remove another TEAM_ADMIN.** An OWNER can.
- [ ] ⚠️ **Refuse with a sentence that says what to do instead**, not
      `Forbidden`. *"You cannot remove yourself from a team you administer. Ask an
      owner to do it."* **Card 1.110's follow-up (`2fed472`) exists because a
      correct refusal reached the screen as "Unable to assign ticket" — do not
      repeat that.**
- [ ] ⚠️ **Decide about the LAST member of a team and say what you chose.** An
      empty team still receives auto-assigned tickets and has nobody to take them.
      **Either guard it or write down why not.**
- [ ] ⚠️ **Do NOT reuse `ensureTeamAdminOrOwner` for this.** That answers *"may
      you manage this team"*; this answers *"may you remove THIS PERSON"*. **They
      are different questions and collapsing them is how the next drift starts.**

### Tests

- [ ] **A TEAM_ADMIN removing themselves is refused, and the message names the
      way out.**
- [ ] **A TEAM_ADMIN removing another TEAM_ADMIN is refused.**
- [ ] ⚠️ **An OWNER can remove either of them.** **Non-vacuity, and the one most
      likely to break** — a guard that locks owners out too is worse than the bug.
- [ ] **A TEAM_ADMIN can still remove an ordinary AGENT.** Non-vacuity.

---

## 2 — Commit two: an OWNER cannot be a team member, and nothing says so

### What is wrong

✅ **Verified at `teams.service.ts:344-356`:** `ensureEligibleTeamMemberRole`
accepts **EMPLOYEE, AGENT, LEAD and TEAM_ADMIN** — and **rejects OWNER**, with
*"Only employee, agent, lead, or team admin users can be added as team members"*.

✅ **And that is deliberate elsewhere, not an accident:**

- `users.service.ts:237` — **promoting someone to OWNER nulls their
  `primaryTeamId`.** The system treats an owner as team-less on purpose.
- `tickets.service.ts:2725` (card 1.110) — *"OWNERs have global write access and
  aren't required to hold an explicit TeamMember record"*, an exemption with a
  comment explaining itself.

⚠️ **SO THE RULE IS COHERENT AND THE TRAP IS THAT IT IS ONE-WAY AND SILENT.**
A TEAM_ADMIN who is later promoted to OWNER **loses their team membership and can
never get it back** — not by their own hand, and not by another owner's.

### ⚠️ What to decide BEFORE writing code

**Two readings, and they need different work:**

| Reading | Fix |
|---|---|
| **An owner genuinely should not hold membership** | Then the *message* is the bug. It must say **why** and say that an owner does not need membership to see or act on the team's tickets. **And the Add-member picker should not offer a person it will then refuse.** |
| **An owner should be able to sit on a team** (roster, round-robin, saved views) | Then `ensureEligibleTeamMemberRole` must accept OWNER — **and `syncOperationalUserRole` must be checked, because it returns early for OWNER and TEAM_ADMIN, so an owner's membership would never sync their role.** That early return is correct and must stay. |

⚠️ **The planner's read is the FIRST**, because two other places already assume an
owner is team-less — **but this is the owner's product decision, not the
implementer's.** **Ask. Do not pick.**

- [ ] **Whichever is chosen, the dead end must go.** Today the owner is told
      *"only employee, agent, lead, or team admin"* and is given no way forward at
      all.

---

## 3 — ⚠️ First, find out which failure this actually was

**The owner said *"not able to add member"* and that is two different bugs:**

- **Adding THEMSELVES** (an OWNER) → §2. Message: *"Only employee, agent, lead,
  or team admin users can be added as team members"*.
- **Adding SOMEBODY ELSE** → ⚠️ **§2 does not explain it**, because
  `ensureTeamAdminOrOwner` returns immediately for an OWNER and nothing else on
  that path rejects one. **A different message means a different bug and this
  document does not cover it — report that rather than forcing a fit.**

- [ ] **Get the exact text, then say in your report which one it was.**

---

## 4 — What to report back

1. **Commit SHAs** and `git diff --stat`.
2. Every `Tests:` line, both `tsc`, vitest, migration count (**67, unchanged**).
3. The answers:
   - **Which failure §3 turned out to be**, with the exact message.
   - **What you decided about the last member of a team.**
   - **Which reading of §2 the owner chose.**
   - **Confirmation that `syncOperationalUserRole`'s early return for OWNER and
     TEAM_ADMIN is untouched** — a TEAM_ADMIN removing themselves must not be
     demoted, and today it correctly is not.
4. **For each guard, the assertion that would fail if it regressed — and confirm
   you watched the inversion fail.**
5. Anything that did not match. **This document is wrong somewhere.**

## 5 — Browser pass

- [ ] **As a TEAM_ADMIN, try to remove yourself. Refused, with a message that
      says what to do.**
- [ ] **As a TEAM_ADMIN, try to remove another team admin. Refused.**
- [ ] **As a TEAM_ADMIN, remove an ordinary agent. Works.**
- [ ] **As an OWNER, remove a team admin. Works.**
- [ ] ⚠️ **As an OWNER, open Add member on Payroll and check what the picker
      offers and what happens on save.** **That is the screen the owner was on.**

**Stop and report instead of improvising** if §3 turns out to be the
add-somebody-else case, or if guarding the last member of a team would break an
existing test in a way that looks deliberate.
