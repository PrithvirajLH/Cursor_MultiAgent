# Deploy Handoff — twenty-nine commits, and only ONE migration left to apply

**Date:** 2026-09-15
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Ship:** `2c2f8d0` → **`410da33`**

⚠️ **This supersedes `prompts/2026-09-15-deploy-twenty-two.md`.** That target
(`dd2a14a`) is now seven commits behind. **Work from this file.**

> # ⚠️ READ THIS FIRST — THE LAST ATTEMPT GOT HALFWAY
>
> **A deploy was started and stopped partway. The planner has measured exactly
> where it reached:**
>
> - ✅ **Migrations 65 and 66 ARE applied to production** — 66 applied, 0
>   blocking, `ApiKey`, `WebhookSubscription` and `EmailActionUse` all present,
>   **6 trigram indexes intact**.
> - ❌ **No code was deployed.** `DEPLOYED_COMMIT_SHA` still reads `2c2f8d0`.
>
> **So production runs OLD code against a NEWER schema right now.** That is safe
> and deliberate — old code never reads the new tables and never writes
> `WEBHOOK` — and it is exactly why migrations go first. **Nothing is broken.**
>
> **→ Only migration 67 remains to be applied.** Local has 67 files; production
> has 66 rows. **That one, and no others.**
>
> ⚠️ **DO NOT check out `410da33` in the shared working tree.** The previous
> handoff said to, and that was the planner's error: it detaches HEAD under
> whoever else is working, which happened **twice** on 2026-09-15. **Build from a
> throwaway copy.**

---

## 0. Production as measured 2026-09-15

| | |
|---|---|
| Deployed commit | **`2c2f8d0`** |
| Schema | **66 applied, 0 blocking** |
| Migration 67 | **not applied** — the only one outstanding |
| Trigram indexes | **6, intact** |

✅ **VERIFIED GREEN BY THE PLANNER 2026-09-15**, every figure re-measured at
`410da33` on a tree with nothing of anyone else's under `apps/`:

```
api tsc 0 · web tsc 0
unit          765 passed, 78 suites, 0 failures
web           385 passed, 56 files
integration   963 passed + 1 skipped, 96 of 97 suites, 0 failures  (1177 s)
environment markers (P1001 / P1017 / 57P01)   0
migrations    67 · commits from production    29
```

⚠️ **Zero environment markers is the load-bearing line**, not the pass count.
Two of the last three runs here died to Postgres dropping under WSL, and a
suite that dies in its first seconds reports as an ordinary failure. **This run
had none.**

---

## 1. What is shipping — twenty-nine commits, five batches

**Three that change what people can see or do:**

| Card | |
|---|---|
| **2.6** | API keys, outbound webhooks, generated docs at `/api/docs` |
| **1.93 + 1.100** | One-click email links wait for a click, and can be spent only once |
| **1.83** | ⚠️ **A file in an internal note is no longer visible to the requester** |

**Three that unblock a decision of yours:**

**1.85**, **1.91** and **1.79** — the AI stops running as whoever asked, stops
quoting the requester in the ticket history, and the two unguarded reads are
closed. ⚠️ **Together these are what made "switch the AI on" unsafe.**

**One that stops losing work:** **1.105** — an oversized or over-numerous
attachment no longer discards the sender's entire email.

**The rest is correctness and hygiene:** 1.94, 1.98, 1.87, 1.88, 1.82, 1.84,
1.95, 1.96, 1.97, 1.99, 1.101, 1.102, 1.103, 1.104, 3.5.

---

## 2. Step one — migration 67 on **Supabase dev**, then production

- [ ] **Only `20260915160000_attachment_message_link`.** 65 and 66 are already in
      production; `prisma migrate deploy` will skip them.
- [ ] ⚠️ **Hand-read it. Expect exactly three statements** — one
      `ALTER TABLE "Attachment" ADD COLUMN "messageId" TEXT`, one `CREATE INDEX`,
      one `ADD CONSTRAINT` foreign key — **and ZERO `DROP`.** Verified.
- [ ] **Supabase dev first**, as always.
- [ ] ⚠️ **The planner cannot run the production half.** **Hand the owner a script
      at a SHORT path to run with `!`.**
- [ ] **Then confirm:**

      ```sql
      select count(*) from pg_indexes where indexdef ilike '%gin_trgm_ops%';  -- 6
      select column_name from information_schema.columns
        where table_name = 'Attachment' and column_name = 'messageId';        -- 1 row
      select count(*) filter (where rolled_back_at is null) from _prisma_migrations; -- 67
      select count(*) from _prisma_migrations
        where finished_at is null and rolled_back_at is null;                 -- 0
      ```

      ⚠️ **The one permanently rolled-back row is the trigram migration.
      Expected. NEVER `migrate resolve --applied` on it.**

## 3. Step two — build and deploy

- [ ] ⚠️ **Build from a throwaway copy, never the shared checkout:**

      ```bash
      git worktree add ../deploy-410da33 410da33
      # build and deploy from there, then:
      git worktree remove ../deploy-410da33
      ```

      **If a worktree is not possible, say so and wait until the tree is idle —
      do not detach HEAD and hope.**
- [ ] **Confirm `git log --oneline 2c2f8d0..410da33` is exactly 29 commits.**
- [ ] **Build with `create-deploy-zip.ps1`; push with `az webapp deploy --async`.**
- [ ] ⚠️ **NEVER `deploy-to-azure.ps1`, never the `azure` git remote.**
- [ ] **Leave `e2e/` and `audit-output/` out of the package. Scan for embedded
      credentials.**
- [ ] **Set `DEPLOYED_COMMIT_SHA=410da33`** in the same change.

---

## 4. Post-deploy checks

**⚠️ FIRST: does the application start?**

- [ ] **Open the app and load a ticket.** Card 2.6 contained a boot failure that
      two typechecks, 738 unit tests and a full build all passed through. **Card
      1.102 added a start-up test to the fast tier and card 1.103 broke the cycle
      behind it — so this should now be safe. Check anyway.** If it does not
      start, roll back; do not debug in production.

**Then, in order of blast radius:**

- [ ] ⚠️ **Open a ticket as its REQUESTER.** Cards 1.83, 1.96 and 1.79 all
      narrowed what a requester receives. **The risk in this deploy is
      over-tightening — somebody being refused something they are entitled to.**
      Check the Attachments tab as well as the conversation.
- [ ] **Open the same ticket as an agent** — the internal note and its file must
      still be there.
- [ ] **Auto-assignment still works** for a team with nobody away (1.94, 1.98).
- [ ] **A reply still emails the requester**, and a resolved-email link works.
      **Use it twice** — the second should decline politely (1.100).
- [ ] **The audit log shows rows**, including from teams/routing/SLA/KB/tags
      (1.95) and attachment opens (3.5). ⚠️ **The route is `/audit-log`, not
      `/admin/audit`.**
- [ ] **`/api/docs` loads for an OWNER, refused for an AGENT** (2.6).

---

## 5. ⚠️ What this deploy unblocks — and the order it must happen in

**After this lands, three things become possible that are not today. None is
automatic, and two have a required order.**

**1. Turn off pilot mode** (`EMAIL_TEST_RECIPIENTS`). Card 1.93 was the blocker.
⚠️ **Card 1.105 also matters here** — the day real requesters start replying is
the day attachments arrive in volume, and until this deploy an oversized one
discarded the whole email.

**2. Switch the AI on** (card 1.63). Cards 1.85, 1.91 and 1.79 were the three
blockers and all ship here.

**3. Turn off the attachment scan gate** (`ATTACHMENT_SCAN_ENABLED=false`) — the
owner's 2026-09-15 decision on card 0.7.

⚠️ **THAT THIRD ONE HAS A HARD PREREQUISITE AND IT IS IN THIS DEPLOY.** Card
1.83 is what stops an internal note's screenshot becoming downloadable by the
person it is about. **Do not set that flag before this deploy is confirmed
green in production.** After it, the flag is safe — and `INFECTED` still blocks
unconditionally, so a scanner can be added later with nothing to rebuild.

---

## 6. If it goes wrong

| Symptom | Suspect |
|---|---|
| **App does not start** | 1.103's module restructure, or 2.6's imports |
| **A requester is refused their own ticket or file** | 1.83, 1.96, 1.79 — over-tightening |
| **A requester cannot see a file they used to see** | 1.83 — check it has a null `messageId` |
| **Auto-assignment stops or picks oddly** | 1.94, 1.98 |
| **Inbound email stops creating tickets** | 1.105 |
| **A screen renders empty with no error** | 1.97, 1.99 |
| **Audit log empty** | 1.104 |

- **Code rollback:** redeploy the `2c2f8d0` package and set
  `DEPLOYED_COMMIT_SHA` back. `rollback.ps1` exists.
- ✅ **Leave all three migrations in place on a rollback.** Old code does not
  read the new tables or the new column. **That is why they go first.**
- ⚠️ **Check first whether anyone created an API key or webhook subscription** —
  old code will not know about them. Harmless, but say so rather than discover it.

**Stop and report instead of improvising** if the app does not start, if
migration 67 contains a `DROP`, if the trigram count is anything but 6, or if a
signed-in person is refused a ticket or a file they own.
