# Implementation Prompt — 1.30 One person, one account

**Date:** 2026-09-03 · **rewritten the same day, see §0**
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.30 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** one human ends up as two accounts with different permissions, because
every path that creates a user takes whatever address arrives and matches it as an
exact string.

**Cost:** none. API + **one additive migration** + a one-time owner-run repair.
**Size:** **M**.

> ⚠️ This describes a live weakness in a running system and both GitHub remotes
> are public. Same handling as `docs/security-audit-2026-08.md`.

---

## 0. READ THIS FIRST — what is already built, and what is not

> **DETECT and REPAIR are built and GREEN** (`50fe7dc`, 2026-09-03): a shape
> comparison used **for suspicion only**, flagged into `AdminAuditEvent`, plus
> `apps/api/merge-duplicate-user.mjs` for the owner to run. **Do not rebuild
> them.**
>
> **PREVENT — §4, the directory work — is NOT built.** `entraObjectId` does not
> exist and the `oid` claim is read nowhere. That is the remaining work, and it
> is what this card is now for.
>
> The phases are **named, not numbered**, on purpose: this card was rewritten
> mid-flight, "Stage 1" meant different things in the two versions, and the
> planner mislabelled a verdict as a result.

## 0b. This card was rewritten, and the first version was worse

The first version had the app work out for itself whether two addresses were the
same human, by comparing their shapes, and it spent most of its length warning
about how dangerous that is.

**The owner pointed at the Entra record instead:** one directory object, display
name *Prithviraj Hulgur*, **User principal name `PHulgur@csnhc.com`**, **Email
`Prithviraj_Hulgur@csnhc.com`**, **Object ID `9a431977-a0d9-4e2c-91b6-8e2f6bab851b`**.

Microsoft already knows these are one person, and already publishes a stable
identifier for them. **Let it be the authority.** That removes the guessing
entirely, so the hazard the first version was built around simply stops existing.

## 1. Why this is worth doing now

It is already true in production and it cost real time **today**: the planner
stated twice, confidently and wrongly, what permissions the owner's account had —
because that one human exists as different roles in different rows. Production has
`phulgur@csnhc.com` as **AGENT** and `prithviraj_hulgur@csnhc.com` as
**EMPLOYEE**; the dev database has the same human as **EMPLOYEE** again.

That is not cosmetic. **Which row a ticket lands on decides who can see it.** A
ticket raised by the EMPLOYEE twin is invisible to the AGENT twin, and all of card
1.36's work — a staff member seeing their own ticket, and *not* seeing the internal
notes on it — turns on `requesterId` being one of those rows and not the other.

## 2. Facts established (verified 2026-09-03)

| Fact | Consequence |
|---|---|
| **The token already carries every address form.** `auth.guard.ts` declares `sub`, `email`, `preferred_username` and `upn`, and one path resolves an address as `firstStringClaim(claims, ['preferred_username', 'upn', 'email'])`. | We are already handed the alternate forms and then throw them away. |
| **`oid` is not read anywhere**, and nothing stable is stored. `resolveUser` does `findUnique({ where: { email } })`. | This is the fix: key on the directory object, not on a string that varies. |
| ⚠️ **`oid` is the claim to use, not `sub`.** `sub` is a pairwise, per-application subject and is *not* stable across clients; `oid` is the tenant-wide object identifier — the value in the owner's screenshot. | Using `sub` would look like it worked and quietly fail to match the same human arriving through a different client. |
| **Three** paths create users: `auth.guard.ts:285` (login), `inbound-email.service.ts:685`, `intake.service.ts:230`. All three do `findUnique({ email })` then `create`, with no normalisation beyond `trim().toLowerCase()`. | Only the login path has a token. The other two have an address and nothing else — see §5. |
| **No Graph user-lookup service exists.** `src/auth` only receives a profile the client pushes (`sync-profile.dto.ts`). | Directory lookup for someone who has never logged in needs a new permission — §5.2. |
| `User.email` is `@unique`; there is no alias table and no directory-id column. `User.graphProfile` is an existing `Json?`. | One additive migration, or a key in the existing JSON. §4.1 decides. |
| **18 declared FK relations point at `User`, PLUS three columns that hold a user id as a plain `String` with no relation at all** — `Tag.createdById`, `TicketTag.createdById`, `IdempotencyRequest.actorId`. Corrected 2026-09-03 by the implementer; this card originally said "~20 relations" and told them to enumerate **relations**, which misses all three. | Count FK **columns**, not relations. No foreign key and no cascade protects those three, so nothing catches a missed one. |
| ⚠️ **Two composite uniques include `userId`: `TeamMember(teamId, userId)` at `:273`, `TicketFollower(ticketId, userId)` at `:591`.** | **A naive `UPDATE … SET userId = keeper` violates both** whenever the two accounts share a team or follow the same ticket. Dedupe first, then reassign. This is the most likely way to break the repair. |

## 3. Goal

The directory decides who a person is. The app stops deciding.

## 4. PREVENT — key on the directory object (the remaining work)

### Task 1 — Store the identifier

**Files:** `apps/api/prisma/schema.prisma` + a hand-written migration, or
`User.graphProfile`

- [ ] Add a nullable, **unique** `entraObjectId` to `User`. Nullable because every
      existing row has none and every inbound-only requester will keep none.
- [ ] **Hand-write the migration.** `prisma migrate dev` emits `DROP INDEX` for
      six trigram GIN indexes it cannot model — `grep -cE '^(DROP|ALTER TABLE .* DROP)' migration.sql` must be **0**.
      Apply to **local-dev Supabase first**, then production. It will be migration
      **53**.
- [ ] If you would rather put it in `graphProfile` to avoid a migration, **say so
      and stop** — a JSON key cannot carry a unique constraint, which is the whole
      point, so the owner should decide knowingly.

### Task 2 — Resolve the login by object, not by address

**Files:** `apps/api/src/auth/auth.guard.ts`

- [ ] Read `oid` from the token claims. **Not `sub`** — §2.
- [ ] Resolve in this order: **by `entraObjectId`**, then by email, then create.
- [ ] When a row is found by **email** and has no `entraObjectId` yet, **stamp
      it** — that is how the existing 59 accounts acquire their identity, quietly,
      as people log in.
- [ ] When a row is found by **`entraObjectId`** but the token's address differs
      from the stored `email`, **do not overwrite the email** and do not create a
      second row. Record the alternate address per Task 3 and carry on. The row is
      the human; the address is one of their labels.
- [ ] A token with **no** `oid` must still work exactly as it does today. Easy Auth
      and the dev header path must not regress.

### Task 3 — Record the addresses the directory gives us

**Files:** wherever Task 1 put the identity

- [ ] On every login, record the addresses present in the token —
      `preferred_username`, `upn`, `email` — against the human, deduplicated and
      lowercased.
- [ ] This is the mapping the other two paths need, and it is **given to us, not
      inferred**. No shape comparison anywhere.
- [ ] Then make `inbound-email.service.ts` and `intake.service.ts` resolve a
      requester by **any recorded address** before creating a new user.
- [ ] **Resolution must never block provisioning.** An unrecognised address still
      creates a user, as today — refusing would drop an inbound email or reject an
      intake form, which is a worse failure than a duplicate.

### ~~Task 4 — Repair the known pair~~ — **BUILT, do not rebuild**

> Delivered in `50fe7dc` as `apps/api/merge-duplicate-user.mjs`, verified against a
> throwaway pair seeded with collisions on both composite uniques, and audited
> against the schema: **20 of the 21 user-id columns covered**, with
> `IdempotencyRequest.actorId` skipped for good reason (short-lived, and `actorId`
> sits inside its own composite unique) and `User.primaryTeamId` skipped correctly
> because it is a setting **on** the user, not a reference **to** one.
>
> **Still to run against production**, by the owner: `phulgur@` as keeper,
> `prithviraj_hulgur@` as loser, **dry run first**. Agent sessions are
> classifier-blocked from production writes.
>
> The requirements below are kept only as the record of what it had to do.

**Files:** `apps/api/merge-duplicate-user.mjs` (new, alongside the existing
operator scripts)

Destructive production writes are classifier-blocked for an agent session, so this
ships as a script **the owner runs**, shaped like `agent-role-check.mjs`.

- [ ] Take **keeper** and **loser** addresses as explicit arguments. Refuse to run
      if either resolves to anything other than exactly one row.
- [ ] **Dry run by default**, printing per-table row counts plus both accounts'
      roles, team memberships and ticket counts, so the owner confirms which row
      should survive before anything moves.
- [ ] **Dedupe before reassigning** for the two composite uniques in §2, then
      reassign the rest. Enumerate **every** relation explicitly; do not rely on
      cascades. **List the tables you covered in the report.**
- [ ] One transaction. A half-merged human is worse than two whole ones.
- [ ] Leave the loser row **deactivated, not deleted** (`isActive: false`), so
      audit rows that reference it do not break.
- [ ] Stamp the keeper with the `entraObjectId` and both addresses, so the pair
      cannot re-form.

## 5. What PREVENT does *not* solve, stated plainly

1. **Someone who has never logged in has no directory identity here.** Floor staff
   submit through Power Automate and may never sign in, so the intake path can
   still meet an address it has never seen. Task 3 shrinks the problem to first
   contact; it does not remove it.
2. **Closing that needs a directory read**, i.e. resolving an arbitrary address to
   a directory object without a token. That is a **different permission from card
   1.24's mailbox one** — a directory-read scope rather than `Mail.ReadWrite`.
   **Worth asking IT for both in the same request**, since the owner is already
   waiting on them. Do not build against it until it is granted.
3. **Two genuinely different people who share a short form** (`john_smith@` /
   `jane_smith@` both shortening to `jsmith@`) are now simply two people, because
   nothing compares shapes any more. That is the point. **If you find yourself
   adding a shape comparison as a fallback, stop and report** — merging on a
   resemblance would put one person's HR and payroll tickets, and the internal
   notes on them, in front of somebody else.

## 6. Tests

- [ ] Integration: a login carrying `oid` against an existing email-matched row
      **stamps** the row and does not create a second one.
- [ ] Integration: a second login with the **same `oid` and a different address**
      resolves to the **same** row, creates nothing, and does not overwrite the
      stored email.
- [ ] Integration: a token with **no** `oid` behaves exactly as before.
- [ ] Integration: inbound email and intake resolve a requester by a **recorded
      alternate address**, and an unrecognised address still creates a user and
      still lands the message. **Assert the message count, not just the
      response** — card 1.29's test asserted the wrong thing and passed on a real
      bug.
- [ ] Unit: `sub` is never used as the identity key. Assert it explicitly, since
      the two claims are easy to confuse and the failure is silent.
- [ ] The repair script is exercised by hand. **Include its dry-run output.**
- [ ] Targeted, then the **full** suite. **Do not edit source while it runs.**

## 7. Verification

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npm run test:integration > ../../int-full.txt 2>&1
grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
bash scripts/check-migrations.sh   # must report 0 DROPs; it only sees COMMITTED migrations
```

**Baselines**, verified 2026-09-03 after card 1.29 (`4acca6d`): api `tsc` 0, unit
**449 / 45**, integration **496 + 1 skipped, 54 of 55**, web `tsc` 0, vitest
**123 / 24**. Delete the log afterwards.

**Drive the login and both provisioning paths through the live API too.** Card
1.29's suite passed on a real bug and the browser pass is what found it; this card
touches identity, where a test asserting the wrong thing is cheap to write.

## 8. Acceptance criteria

1. A human who logs in with either address form resolves to **one** row.
2. Existing rows acquire their directory identity on next login, with no manual
   step.
3. Inbound email and intake resolve by a recorded address, and neither can fail or
   drop a message because of it.
4. **Nothing anywhere compares the shape of two addresses.**
5. `sub` is not used as an identity key.
6. The migration is hand-written, additive, **0 DROPs**, applied to dev first.
7. The repair dry-runs by default, dedupes the two composite uniques, covers every
   relation, and runs in one transaction.
8. Both `tsc` clean; unit, integration and vitest at or above §7.

## 9. What to report back

1. Commit SHA and `git diff --stat`.
2. Every `Tests:` line, both `tsc`, vitest, and the migration DROP count.
3. **The dry-run output** of the repair against the real pair, with the list of
   tables covered — the planner will check it against the schema.
4. Whether you put the identifier in a column or in `graphProfile`, and why.
5. Whether the token actually carries `oid` in this tenant's configuration —
   **confirm it from a real token, not from the type declaration.** If it does
   not, stop: the whole card depends on it.
6. Anything that did not match. Handoffs from this planner have carried a wrong
   line number, a stale premise, a self-contradiction, an invented file reference,
   a dead CSS class quoted as live, a Tailwind trap, an unconditional status
   transition that would have lost inbound mail, a confident wrong claim about
   which role the owner's account holds, and **a whole first draft of this card
   built on guesswork the directory made unnecessary.** Say so plainly.

**Stop and report instead of improvising** if `oid` turns out not to be present, if
this appears to need a Graph directory call, or if you find yourself adding a
shape comparison as a fallback.
