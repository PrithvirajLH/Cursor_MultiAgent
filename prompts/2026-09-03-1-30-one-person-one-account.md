# Implementation Prompt — 1.30 One person, one account

**Date:** 2026-09-03
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.30 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** one human ends up as two accounts with different permissions, because
the three things that create users each take whatever address arrives and match it
as an exact string.

**Cost:** none. API + a one-time owner-run repair. **Stage 1 needs no schema
change**; Stage 2 does, and is deliberately optional — see §5.

**Size:** **S** for Stage 1. M if the owner also wants Stage 2.

> ⚠️ This describes a live weakness in a running system and both GitHub remotes
> are public. Same handling as `docs/security-audit-2026-08.md`.

---

## 1. Why this is worth doing now

It is already true in production, and it cost real time **today**: the planner
stated twice, confidently and wrongly, what permissions the owner's account had —
because that one human exists as different roles in different places. Production
has `phulgur@csnhc.com` as **AGENT** and `prithviraj_hulgur@csnhc.com` as
**EMPLOYEE**; the dev database has the same human as **EMPLOYEE** again.

The consequence is not cosmetic. **Which account a ticket lands on decides who can
see it.** A ticket raised by the EMPLOYEE twin is invisible to the AGENT twin, and
card 1.36's work — a staff member seeing their own ticket, and *not* seeing the
internal notes on it — is decided by `requesterId`, which is one of these two rows
and not the other.

## 2. Facts established (verified 2026-09-03)

| Fact | Consequence |
|---|---|
| **Three** paths create users, not the two the board says: `auth.guard.ts:285` (login), `inbound-email.service.ts:685`, `intake.service.ts:230`. | Any fix must cover all three, or the gap simply moves. |
| All three do `findUnique({ email })` then `create`, with **no normalisation beyond `trim().toLowerCase()`**. | `prithviraj_hulgur@` and `phulgur@` are two unrelated humans as far as the app is concerned. |
| `User.email` is `@unique`. There is **no alias table and no UPN column** — but `User.graphProfile` is a `Json?` that already exists. | Stage 2 has somewhere to put a mapping without a new table, if you prefer. |
| **No Graph user-lookup service exists.** `src/auth` only receives a profile the client pushes (`sync-profile.dto.ts`). | Resolving an address through Graph needs the same permission that blocks card 1.24. **Do not design around it.** |
| Logins in this tenant produce the **short** form — all three OWNER rows are `itbot@`, `zmeraz@`, `grblake@`. | The short form is the canonical identity here. |
| **~20 relations point at `User`** (tickets requested and assigned, messages, events, followers, team membership, attachments, notifications, audit rows, KB articles, routing rules, SLA configs …). | A merge is a 20-table reassignment, not an update to one column. |
| **Two composite uniques include `userId`: `TeamMember(teamId, userId)` at `:273` and `TicketFollower(ticketId, userId)` at `:591`.** | ⚠️ **A naive `UPDATE … SET userId = keeper` will violate both** whenever the two accounts share a team or follow the same ticket. Dedupe first, then reassign. This is the single most likely way to break the repair. |

## 3. The hazard that must not be built

**Do not match accounts by deriving a stem from the address.** It is the obvious
fix and it is dangerous: `jsmith@` is a plausible short form of **both**
`john_smith@` and `jane_smith@`. Merging on that basis puts one person's tickets —
including HR and payroll tickets, and the internal notes on them — in front of a
different person.

Getting this wrong is worse than the bug. **Never merge two accounts
automatically.** Detection may be automatic; the merge must be a human decision.

If you find yourself writing a heuristic that silently unifies two rows, **stop
and report.**

## 4. Stage 1 — detect, and repair the known pair (no schema change)

### Task 1 — Flag a probable duplicate at creation

**Files:** `apps/api/src/auth/auth.guard.ts`,
`apps/api/src/tickets/inbound-email.service.ts`,
`apps/api/src/tickets/intake.service.ts`, plus one shared helper

- [ ] Write **one** shared helper that, given an address about to be provisioned,
      finds existing users whose address is a plausible alternate form of it. Put
      it in `apps/api/src/common/` and use it from all three sites — three copies
      of an identity rule is exactly how 1.36's Fault C and 1.38 happened.
- [ ] On a hit, **still create the account** and **log a warning naming both
      addresses and both roles**. Do not block the request: refusing to create a
      user would drop an inbound email or reject an intake form, which is a worse
      failure than a duplicate.
- [ ] Also record it where a human will see it. `AdminAuditEvent` already exists
      and already has a `createdBy` relation — prefer it over inventing a place.
      **Say which you chose.**
- [ ] The comparison is for **suspicion only**. Write that in the comment, next to
      the §3 reasoning, so the next reader does not "improve" it into an automatic
      merge.

### Task 2 — The repair script for the known pair

**Files:** `apps/api/merge-duplicate-user.mjs` (new, alongside the existing
operator scripts)

Destructive production DB writes are classifier-blocked for an agent session, so
**this ships as a script the owner runs**, in the shape of the existing
`make-payroll-lead.mjs` / `agent-role-check.mjs`.

- [ ] Take a **keeper** and a **loser** address explicitly as arguments. No
      guessing, no defaults, and **refuse to run** if either does not resolve to
      exactly one row.
- [ ] **Dry run by default.** Print, per table, how many rows would move — and
      print the two accounts' roles, team memberships and ticket counts so the
      owner can confirm which should survive before anything is written.
- [ ] **Dedupe before reassigning**, for `TeamMember(teamId, userId)` and
      `TicketFollower(ticketId, userId)`: delete the loser's row wherever the
      keeper already has an equivalent, then reassign the rest. §2 explains why.
- [ ] Enumerate **every** relation from §2 explicitly. Do not rely on a cascade,
      and do not delete the loser row until every reference has moved. **List the
      tables you covered in the report** so the next reader can check against the
      schema.
- [ ] Do it in **one transaction**. A half-merged human is worse than two whole
      ones.
- [ ] Leave the loser row **deactivated rather than deleted** (`isActive: false`)
      unless the owner asks otherwise — an audit trail that references it should
      not break.

## 5. Stage 2 — real resolution (optional, needs the owner's yes)

Only worth doing if duplicates keep appearing after Stage 1's flagging shows how
often it happens. **Do not build this speculatively.**

- An explicit **alias mapping** — a `UserEmailAlias` table, or a key inside the
  existing `User.graphProfile` JSON — so a known alternate address resolves to the
  right human. Explicit and auditable, no guessing.
- If it is a table: **additive only**, hand-written, `grep -cE '^(DROP|ALTER TABLE .* DROP)'` must be **0**, and it must go to local-dev Supabase **before** production.
- **Stop and report before writing any migration.** The owner's standing position
  is that migrations go straight to production with no staging, so a schema change
  is their decision, not the implementer's.

## 6. Tests

- [ ] Unit: the alternate-form helper flags `prithviraj_hulgur@csnhc.com` against
      an existing `phulgur@csnhc.com`, and **does not** flag two genuinely
      different people who share a short form (`john_smith@` / `jane_smith@` both
      shortening to `jsmith@` — assert it treats that as ambiguous, not a match).
- [ ] Integration: provisioning a probable duplicate through **each** of the three
      paths still creates the user, returns success, and records the flag.
- [ ] Integration: an inbound email from a brand-new address still creates a
      ticket. **The flagging must not be able to drop mail** — assert the message
      count, not just the response.
- [ ] The repair script is exercised by hand, not by the suite. **Include its
      dry-run output in the report.**
- [ ] Targeted, then the **full** suite. **Do not edit source while it runs.**

## 7. Verification

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npm run test:integration > ../../int-full.txt 2>&1
grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

**Baselines**, verified 2026-09-03 after card 1.29 (`4acca6d`): api `tsc` 0, unit
**449 / 45**, integration **496 + 1 skipped, 54 of 55**, web `tsc` 0, vitest
**123 / 24**. Delete the log afterwards.

**Drive the three provisioning paths through the live API too.** Card 1.29's suite
passed on a real bug and the browser pass is what found it; this card touches
identity, where a test asserting the wrong thing is cheap to write.

## 8. Acceptance criteria

1. A probable duplicate is flagged, visibly, at the moment it is created — from
   all three paths.
2. **Nothing is ever merged automatically**, and two different people who share a
   short form are treated as ambiguous rather than matched.
3. No provisioning path can now fail or drop a message because of the check.
4. The repair script dry-runs by default, dedupes the two composite uniques,
   covers every relation, and runs in one transaction.
5. The identity rule exists in **one** place, used by all three call sites.
6. Both `tsc` clean; unit, integration and vitest at or above §7.

## 9. What to report back

1. Commit SHA and `git diff --stat`.
2. Every `Tests:` line, both `tsc`, vitest.
3. **The dry-run output** of the repair script against the real pair, with the
   list of tables it covered — the planner will check that against the schema.
4. Where you recorded the flag, and why.
5. Whether you needed Stage 2, and if you think so, **stop and say so rather than
   building it**.
6. Anything that did not match. Handoffs from this planner have carried a wrong
   line number, a stale premise, a self-contradiction, an invented file reference,
   a dead CSS class quoted as live, a Tailwind trap, an unconditional status
   transition that would have lost inbound mail, and — on this very card — a
   confident wrong claim about which role the owner's account holds. **Say so
   plainly if this one is wrong too.**

**Stop and report instead of improvising** if this appears to need automatic
merging, a stem heuristic that resolves ambiguity by picking one, a Graph lookup,
or a migration.
