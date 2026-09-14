# Deploy Handoff — Phase 2 batch one: 2.2, 2.1 and 2.12

**Date:** 2026-09-11
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Ship:** `d4cf357` → **`6f127cb`**
**Verified GREEN by the planner 2026-09-11.** Every number re-measured, not taken
from a report.

> # ⚠️ THE MIGRATIONS GO FIRST. BOTH OF THEM.
>
> **New code without migration 62 throws on every auto-assignment** — the
> assignment query reads `User.isAvailable`, and the column does not exist in
> production yet.
>
> **New code without migration 63 throws the moment an admin picks the new
> strategy** — `LEAST_LOADED` is not a value the production enum accepts.
>
> **Old code with both migrations applied is completely safe**, which is what
> makes the ordering one-directional: migration 62's columns are simply ignored
> by a client that does not know them, and migration 63's enum value sits unused
> because nothing writes it. **So apply, confirm, then ship.**

---

## 0. Production as it is right now — measured 2026-09-11

| | measured |
|---|---|
| Deployed commit | **`d4cf357`** |
| Schema | **61 applied migrations, 0 blocking** |
| Trigram indexes | **6, all present** |
| Migrations 62 and 63 | **applied nowhere** — not production, not Supabase dev |

✅ **The previous deploy shipped exactly the three commits it named** because the
handoff pinned the commit rather than taking HEAD. **Do the same here.**

---

## 1. What is shipping — three commits

| Commit | Card | What it does |
|---|---|---|
| `b8b291d` | 2.2 | An agent can mark themselves away; auto-assignment skips them |
| `c4a2cba` | 2.1 | A team can assign to the least-loaded member instead of round-robin |
| `6f127cb` | 2.12 | Ticket links read `/tickets/IT-0042` instead of a UUID |

**Green tally, measured by the planner at `6f127cb`:**

```
api tsc 0 · web tsc 0
unit          675 passed, 68 suites
web           343 passed, 50 files
integration   836 passed + 1 skipped, 81 of 82 suites
migrations    63
check-migrations.sh   ok on both new files
```

⚠️ **How that integration figure was reached, so nobody is surprised by the
log:** three attempts. Two collapsed because WSL killed Postgres mid-run
(`P1001`, `57P01`). The third gave **814** with `security.authorization.spec.ts`
dead in its first 8 seconds while the cluster was restarting; re-running that one
suite alone gave its **22**. **814 + 22 = 836.** See `repo-landmines.md`.

---

## 2. Step one — migrations on **Supabase dev**, before production

- [ ] Apply `20260911160000_agent_availability` and
      `20260911170000_least_loaded_strategy` to Supabase dev. **Standing order,
      and it exists because skipping it has broken local dev before.**
- [ ] ⚠️ **Hand-read both files first.** Expect:
      - 62 — **two** `ALTER TABLE "User" ADD COLUMN`, nothing else, **zero `DROP`**
      - 63 — **one** `ALTER TYPE "TeamAssignmentStrategy" ADD VALUE 'LEAST_LOADED'`,
        nothing else
      **If either file contains a `DROP INDEX`, you are looking at a regenerated
      file. Stop.**
- [ ] **Confirm dev still has its six trigram indexes afterwards.**

## 3. Step two — migrations on **production**

- [ ] ⚠️ **Confirm a backup exists first.** There is no staging here.
- [ ] **`prisma migrate deploy` does NOT run on startup** — the App Service start
      command is plain `node dist/src/main.js`. Nothing applies these for you.
- [ ] ⚠️ **The planner cannot run this** — destructive production writes are
      blocked from agent sessions. **Hand the owner a script at a SHORT path to
      run with `!`.** A long path or a wrapped command has failed twice here.
- [ ] ⚠️ **Migration 63 must not be batched with anything that USES the new enum
      value.** `ALTER TYPE … ADD VALUE` is legal in a transaction on PG 12+
      (production is 16.14) but the value cannot be used until that transaction
      commits. The file is already written this way — **do not "helpfully" add an
      `UPDATE` alongside it.**
- [ ] **Immediately after, confirm all four:**

      ```sql
      select count(*) from pg_indexes where indexdef ilike '%gin_trgm_ops%';  -- must be 6
      select column_name from information_schema.columns
        where table_name = 'User' and column_name in ('isAvailable','awayUntil');  -- 2 rows
      select unnest(enum_range(NULL::"TeamAssignmentStrategy"));  -- must include LEAST_LOADED
      select count(*) from _prisma_migrations
        where finished_at is null and rolled_back_at is null;  -- must be 0
      ```

      ⚠️ **The one permanently rolled-back row is
      `20260220150000_add_ticket_search_trigram_indexes`. That is expected.
      NEVER run `migrate resolve --applied` on it.**

## 4. Step three — build and deploy

- [ ] ⚠️ **Check out `6f127cb` explicitly and build from it.** Do not build from
      the branch tip: work on later cards may already be landing.
- [ ] **If `git log --oneline d4cf357..6f127cb` shows anything but the three
      commits above, stop and report.**
- [ ] **Build with `create-deploy-zip.ps1`; push with `az webapp deploy --async`.**
- [ ] ⚠️ **NEVER `deploy-to-azure.ps1`, never the `azure` git remote.**
- [ ] **Leave `e2e/` out of the package. Scan for embedded credentials.**
- [ ] **Set `DEPLOYED_COMMIT_SHA=6f127cb`** in the same change.

---

## 5. Post-deploy checks

**⚠️ Most of this deploy is inert until somebody uses it**, which is good:
`isAvailable` defaults to true, so nobody is away and assignment behaves exactly
as it did yesterday. **The one thing that changes for everyone immediately is
ticket links.**

- [ ] **Copy a ticket link. It should read `/tickets/IT-0042`.**
- [ ] ⚠️ **Paste an OLD UUID link and confirm it still opens.** People have those
      in email and in Teams. This is the regression that would matter most.
- [ ] **Mark yourself away in the avatar menu, create a ticket that routes to your
      team, confirm it does not come to you.** Mark yourself back, confirm it does.
- [ ] **Switch a team to Least loaded** and confirm the quiet agent gets the next
      ticket. **Then switch it back to round-robin and confirm that still works** —
      two of three strategies are existing behaviour.
- [ ] **Check the Operations console lists the new availability job** (card 2.2
      added a row; it was placed last deliberately).
- [ ] **Confirm auto-assignment still works at all** for a team where nobody is
      away. That is the blast radius of migration 62 if anything went wrong.

---

## 6. What this deploy does not change

1. **Pilot mode is still on.** `EMAIL_TEST_RECIPIENTS` is set, so mail still
   reaches only the test addresses. ⚠️ **Clearing it is a go-live decision — real
   requesters start receiving email that moment. Not part of this deploy.**
2. **Card 1.69's rate-limit fix remains unproven.** If *"Couldn't load list"*
   reappears, set `RATE_LIMIT_LIMIT`.
3. ✅ **Card 1.44's seven one-click email links are unaffected** — verified: the
   signature covers the ticket id, but the URLs carry no ticket segment.

---

## 7. If it goes wrong

- **Code rollback:** redeploy the `d4cf357` package and set
  `DEPLOYED_COMMIT_SHA` back. `rollback.ps1` exists.
- ✅ **Leave both migrations in place on a rollback.** Old code ignores the two
  new columns and never writes the new enum value, so there is nothing to unwind
  — that is the whole reason for the ordering.
- [ ] ⚠️ **BUT: if anyone switched a team to Least loaded before you rolled back,
      switch it back first.** The old code reads `strategy !== ROUND_ROBIN` and
      returns null, so that team would **silently stop auto-assigning altogether**
      — tickets would land unassigned with no error anywhere. **Check
      `select id, name, "assignmentStrategy" from "Team" where
      "assignmentStrategy" = 'LEAST_LOADED';` before rolling back.**

**Stop and report instead of improvising** if either migration file contains a
`DROP`, if the trigram count is anything but 6 at any point, if an old UUID ticket
link stops opening, or if auto-assignment stops working for a team where nobody is
marked away.
