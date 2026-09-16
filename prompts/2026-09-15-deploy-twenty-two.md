# Deploy Handoff — twenty-two commits and two migrations

**Date:** 2026-09-15
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Ship:** `2c2f8d0` → **`dd2a14a`**
**Verified GREEN by the planner 2026-09-15**, everything re-measured on a clean
tree.

> # ⚠️ This is the biggest deploy this project has done, by a factor of two
>
> **Twenty-two commits, two migrations, four batches.** Every previous deploy
> here went cleanly partly *because* it was small enough to reason about.
>
> **Read §7 before you start.** If this one goes wrong, the thing that saves you
> is knowing in advance which half to suspect — not bisecting twenty-two commits
> against production.
>
> **The migrations go first**, as always.

---

> # ⚠️ UPDATED 2026-09-15 — THIS DEPLOY IS HALF DONE. READ THIS FIRST.
>
> **An attempt was made and stopped partway. The planner has measured where it
> got to:**
>
> - ✅ **Both migrations ARE applied to production** — 66 applied, 0 blocking,
>   `ApiKey` and `EmailActionUse` present, **6 trigram indexes intact**.
> - ❌ **The code was NOT deployed.** `DEPLOYED_COMMIT_SHA` still reads
>   `2c2f8d0`.
>
> **So production is running OLD code against the NEW schema. That is safe and
> deliberate** — old code never reads the three new tables and never writes
> `WEBHOOK` — which is the whole reason the migrations go first. **Nothing is
> broken; the deploy is simply unfinished.**
>
> **→ SKIP §2 AND §3.** Re-running `prisma migrate deploy` would correctly report
> nothing to apply, but there is no reason to run it. **Start at §4.**
>
> ⚠️ **AND §4 HAS CHANGED. Do not check out `dd2a14a` in the shared working
> tree.** That instruction was the planner's and it was wrong: it detaches HEAD
> under whoever else is working, which happened **twice** on 2026-09-15. **Build
> from a throwaway copy instead:**
>
> ```bash
> git worktree add ../deploy-dd2a14a dd2a14a
> # build and deploy from there, then:
> git worktree remove ../deploy-dd2a14a
> ```
>
> **If a worktree is not possible, say so and wait until the tree is idle — do not
> detach HEAD and hope.**

---


## 0. Production as it is right now — measured 2026-09-15

| | measured |
|---|---|
| Deployed commit | **`2c2f8d0`** — unchanged, the code half never ran |
| Schema | ✅ **66 applied, 0 blocking** — re-measured after the partial attempt |
| Migrations 65 and 66 | ✅ **APPLIED to production**; `ApiKey` and `EmailActionUse` exist |
| Trigram indexes | ✅ **6, intact** |

**Green tally at `dd2a14a`, clean tree, clean first run:**

```
api tsc 0 · web tsc 0
unit          754 passed, 75 suites
web           385 passed, 56 files
integration   947 passed + 1 skipped, 93 of 94 suites, 0 failures
environment markers (P1001/P1017/57P01)   0
migrations    66 · check-migrations.sh ok on both new files
```

---

## 1. What is shipping, grouped by what it changes

**Four things people will notice:**

| Card | |
|---|---|
| **2.6** | Other systems can be issued an API key, receive webhooks, and read generated docs at `/api/docs` |
| **1.93** | One-click email links wait for a real click ⚠️ **unblocks turning pilot mode off** |
| **1.95** | Team, routing, SLA, KB and tag changes now leave an audit trail |
| **1.100** | A one-click link can only be spent once |

**Three that close data exposure:**

**1.85** and **1.91** (the AI stops running as whoever asked, and stops quoting
the requester in the ticket history) — ⚠️ **together these unblock switching the
AI on**. **1.96** (ticket detail returns only what it renders).

**The rest are correctness:** 1.94, 1.98, 1.87, 1.88, 1.82, 1.84, 1.97, 1.99 —
assignment, reactivation, deleted tickets, SLA deadlines, shared requests and
filters.

**1.92 shipped nothing deliberately** — every advisory is gated behind a
framework upgrade.

---

## 2. Step one — both migrations on **Supabase dev**, before production

- [ ] Apply `20260915120000_public_api_keys_and_webhooks` and
      `20260915140000_email_action_single_use`.
- [ ] ⚠️ **Hand-read both first. Expect ZERO `DROP` in either** — verified, and
      `check-migrations.sh` agrees. If you see six `DROP INDEX`, you are looking
      at a regenerated file. **Stop.**
- [ ] ⚠️ **Migration 65 contains `ALTER TYPE "NotificationChannel" ADD VALUE
      'WEBHOOK'`.** It appears exactly once and is **never used in the same
      migration** — which is correct and deliberate, because a value added in a
      transaction cannot be used until it commits. **Do not "tidy" that by adding
      an UPDATE alongside it.**
- [ ] **Confirm dev still has its six trigram indexes.**

## 3. Step two — both migrations on **production**

- [ ] ⚠️ **Confirm a backup exists.** Three new tables and an enum change, and no
      staging environment.
- [ ] **`prisma migrate deploy` does NOT run on startup.** Nothing applies these
      for you.
- [ ] ⚠️ **The planner cannot run this.** **Hand the owner a script at a SHORT
      path to run with `!`.**
- [ ] **Immediately after, confirm all five:**

      ```sql
      select count(*) from pg_indexes where indexdef ilike '%gin_trgm_ops%';   -- 6
      select to_regclass('public."ApiKey"'),
             to_regclass('public."WebhookSubscription"'),
             to_regclass('public."EmailActionUse"');                           -- none null
      select 'WEBHOOK' = any(enum_range(NULL::"NotificationChannel")::text[]); -- t
      select count(*) filter (where rolled_back_at is null) from _prisma_migrations; -- 66
      select count(*) from _prisma_migrations
        where finished_at is null and rolled_back_at is null;                  -- 0
      ```

      ⚠️ **The one permanently rolled-back row is the trigram migration.
      Expected. NEVER `migrate resolve --applied` on it.**

## 4. Step three — build and deploy

- [ ] ⚠️ **Build from `git worktree add ../deploy-dd2a14a dd2a14a`, NOT by
      checking out in the shared tree** — see the banner. Remove the worktree
      afterwards. **A four-card batch is in progress right now** and card 1.103 moves
      module imports — **exactly the change that stopped the app booting during
      card 2.6.** It must not ride along.
- [ ] **If `git log --oneline 2c2f8d0..dd2a14a` is not exactly 22 commits, stop
      and report.**
- [ ] ⚠️ **Check the tree is clean of other sessions' work before you build:**
      `git status --porcelain | grep -v '^??'` — **anything modified under
      `apps/` that is not yours means STOP.** A full test run was invalidated this
      way on 2026-09-15.
- [ ] **Build with `create-deploy-zip.ps1`; push with `az webapp deploy --async`.**
- [ ] ⚠️ **NEVER `deploy-to-azure.ps1`, never the `azure` git remote.**
- [ ] **Leave `e2e/` and `audit-output/` out of the package. Scan for embedded
      credentials.**
- [ ] **Set `DEPLOYED_COMMIT_SHA=dd2a14a`** in the same change.

---

## 5. Post-deploy checks

**⚠️ FIRST, AND BEFORE ANYTHING ELSE: does the application start?**

- [ ] **Open the app and load a ticket.** Card 2.6 included a boot failure that
      **two typechecks, 738 unit tests and a full build all passed through.** If
      the app does not start, roll back immediately — do not debug in production.

**Then, in order of blast radius:**

- [ ] **Auto-assignment still works** for a team with nobody away (cards 1.94,
      1.98 touched it).
- [ ] **Open a ticket as its requester** — cards 1.96 and 1.79 narrowed what that
      returns, and the risk is over-tightening.
- [ ] **A reply still emails the requester**, and the resolved email's links work.
      **Use one twice** — the second should say so politely rather than error
      (card 1.100).
- [ ] **The audit log page shows rows**, including from teams/routing/SLA/KB/tags
      (card 1.95).
- [ ] **`/api/docs` loads for an OWNER and is refused for an AGENT** (card 2.6).
- [ ] **A saved view with a date filter still filters** (card 1.99).

---

## 6. What this deploy unblocks — and what it does not

✅ **After this, two decisions become safe that were not before:**

1. **Turning pilot mode off** — card 1.93 is the blocker and it ships here.
2. **Switching the AI on** — cards 1.85, 1.91 and 1.79 were the three blockers
   and all three ship here.

⚠️ **Neither happens automatically. Both are the owner's call, and neither is
part of this deploy.**

**Still not fixed:** card 1.69's rate-limit fix remains unproven; **card 1.83
still gates the virus scanner**; and the circular import from card 2.6 is still
there (cards 1.102, 1.103, in progress).

---

## 7. ⚠️ If it goes wrong — read this BEFORE deploying

**Twenty-two commits is too many to bisect against production.** So decide the
suspect by symptom, not by search:

| Symptom | Suspect |
|---|---|
| **App does not start at all** | Card 2.6's module imports (`b3d6858`) |
| **A signed-in person is refused their own ticket** | 1.96 or 1.79 — over-tightening |
| **Auto-assignment stops or picks oddly** | 1.94, 1.98 |
| **Wrong SLA dates on new tickets** | 1.82 |
| **A screen renders empty with no error** | 1.97 or 1.99 — the web layer |
| **Emails stop, or links fail** | 1.93, 1.100 |

- **Code rollback:** redeploy the `2c2f8d0` package, set `DEPLOYED_COMMIT_SHA`
  back. `rollback.ps1` exists.
- ✅ **Leave BOTH migrations in place on a rollback.** Old code does not read the
  three new tables and never writes `WEBHOOK` — nothing to unwind. **That is the
  whole reason the migrations go first.**
- ⚠️ **One exception worth checking before a rollback:** if anyone has created an
  **API key or a webhook subscription** in the meantime, the old code will not
  know about them. Harmless — but say so rather than discovering it later.

**Stop and report instead of improvising** if the app does not start, if either
migration file contains a `DROP`, if the trigram count is anything but 6 at any
point, or if a signed-in user is refused a ticket they own.
