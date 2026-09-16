# Deploy Handoff — forty-one commits, and still only ONE migration to apply

**Date:** 2026-09-16
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Ship:** `2c2f8d0` → **`60f5c64`**

⚠️ **This supersedes `prompts/2026-09-15-deploy-twenty-nine.md`** (target
`410da33`) **and `prompts/2026-09-15-deploy-twenty-two.md`** (target `dd2a14a`).
**Both are stale. Work from this file.**

> # ⚠️ THIS IS BY FAR THE BIGGEST DEPLOY THIS PROJECT HAS DONE
>
> **Forty-one commits. Five batches. Every previous deploy here went cleanly
> partly BECAUSE it was small enough to hold in your head.**
>
> **Read §6 before you start.** If this goes wrong, the thing that saves you is
> knowing in advance which half to suspect — not bisecting forty-one commits
> against production.
>
> ⚠️ **A previous attempt got halfway and the planner measured exactly where:**
>
> - ✅ **Migrations 65 and 66 ARE applied to production** — 66 applied, 0
>   blocking, `ApiKey`, `WebhookSubscription` and `EmailActionUse` all present,
>   **6 trigram indexes intact**.
> - ❌ **No code was ever deployed.** `DEPLOYED_COMMIT_SHA` still reads
>   `2c2f8d0`.
>
> **So production runs OLD code against a NEWER schema right now. That is safe
> and deliberate** — old code never reads the new tables and never writes
> `WEBHOOK` — **and it is exactly why migrations go first. Nothing is broken.**
>
> **→ Only migration 67 remains.** Local has 67 files; production has 66 rows.

---

## 0. State, measured

| | |
|---|---|
| Deployed commit | **`2c2f8d0`** |
| Production schema | **66 applied, 0 blocking** |
| Migration 67 | **not applied** — the only one outstanding |
| Trigram indexes | **6, intact** |
| Local `HEAD` | **`60f5c64`** — 41 commits ahead |

✅ **VERIFIED GREEN BY THE PLANNER 2026-09-16**, everything re-measured at
`60f5c64` on a tree with nothing of anyone else's under `apps/`:

```
api tsc 0 · web tsc 0
unit          834 passed, 89 suites, 0 failures
web           395 passed, 58 files
integration   963 passed + 1 skipped, 96 of 97 suites, 0 failures  (1227 s)
environment markers (P1001 / P1017 / 57P01)   0
migrations    67 · check-migrations.sh ok · commits from production 41
```

⚠️ **Zero environment markers is the load-bearing line, not the pass count.**
Two of the last four runs here died to Postgres dropping under WSL, and a suite
that dies in its first seconds reports as an ordinary failure. **This run had
none.**

---

## 1. What is shipping

**Four things people will notice:**

| Card | |
|---|---|
| **2.6** | API keys, outbound webhooks, generated docs at `/api/docs` |
| **1.93 + 1.100** | One-click email links wait for a real click, and can be spent once |
| **1.83** | ⚠️ **A file in an internal note is no longer visible to the requester** |
| **1.110** | ⚠️ **An EMPLOYEE can no longer hold a ticket, and a deactivated person cannot be given one** |

**Four that unblock a decision of yours:** **1.85**, **1.91**, **1.79** and
**1.106** — the AI stops running as whoever asked, stops quoting the requester
in the ticket history, the two unguarded reads are closed, and **it finally has
a real off switch.**

**Two that stop losing things:** **1.105** (an oversized attachment no longer
discards the sender's whole email) and **1.109** (a switched-off account loses
its live feed immediately instead of an hour later).

**The rest is correctness and hygiene:** 1.82, 1.84, 1.87, 1.88, 1.94, 1.95,
1.96, 1.97, 1.98, 1.99, 1.101, 1.102, 1.103, 1.104, 1.107, 1.108, 1.111, 1.112,
1.113, 1.114, 1.115, 3.5.

---

## 2. Step one — migration 67 on **Supabase dev**, then production

- [ ] **Only `20260915160000_attachment_message_link`.** 65 and 66 are already in
      production; `prisma migrate deploy` will skip them.
- [ ] ⚠️ **Hand-read it. Three statements** — `ALTER TABLE "Attachment" ADD
      COLUMN "messageId" TEXT`, one `CREATE INDEX`, one `ADD CONSTRAINT` foreign
      key — **and ZERO `DROP`.** ✅ **Planner-verified.**
- [ ] **Supabase dev first**, as always.
- [ ] ⚠️ **The planner cannot run the production half.** **Hand the owner a script
      at a SHORT path to run with `!`.**
- [ ] **Then confirm all four:**

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

- [ ] ⚠️ **Build from a throwaway copy, NEVER the shared checkout:**

      ```bash
      git worktree add ../deploy-60f5c64 60f5c64
      # build and deploy from there, then:
      git worktree remove ../deploy-60f5c64
      ```

      **A planner instruction to `git checkout <sha>` detached HEAD under another
      session twice on 2026-09-15.** If a worktree is impossible, **say so and
      wait until the tree is idle — do not detach HEAD and hope.**
- [ ] **Confirm `git log --oneline 2c2f8d0..60f5c64` is exactly 41 commits.**
- [ ] **Build with `create-deploy-zip.ps1`; push with `az webapp deploy --async`.**
- [ ] ⚠️ **NEVER `deploy-to-azure.ps1`, never the `azure` git remote.**
- [ ] **Leave `e2e/` and `audit-output/` out of the package. Scan for embedded
      credentials.**
- [ ] **Set `DEPLOYED_COMMIT_SHA=60f5c64`** in the same change.

---

## 4. ⚠️ One setting becomes LIVE the moment this deploys — and it is safe

**`AI_PIPELINE_ENABLED` is set in production and has never been read by any
code.** Card 1.106 makes it real. ✅ **Planner-checked and it is safe:** the
value is 4 characters (`true`), and the new check is
`.trim().toLowerCase() !== 'false'` — **only the literal string `false` switches
the AI off**, and an unset variable defaults to **enabled**. **So nothing
changes on deploy, and it fails OPEN, which is the right direction.**

⚠️ **But know that it is armed now.** After this, setting it to `false` genuinely
stops the pipeline — which is the point, and is what card 1.63 needs.

---

## 5. Post-deploy checks

**⚠️ FIRST: does the application start?**

- [ ] **Open the app and load a ticket.** Card 2.6 contained a boot failure that
      two typechecks, 738 unit tests and a full build all passed through. **Cards
      1.102 and 1.103 added a start-up test and broke the cycle behind it, so this
      should now be safe. Check anyway.** If it does not start, roll back — do not
      debug in production.

**Then, in order of blast radius. ⚠️ THE RISK IN THIS DEPLOY IS
OVER-TIGHTENING — somebody being refused something they are entitled to:**

- [ ] ⚠️ **Open a ticket as its REQUESTER.** Cards 1.83, 1.96 and 1.79 all
      narrowed what a requester receives. **Check the Attachments tab as well as
      the conversation** — that is where the audit found the leak.
- [ ] **Open the same ticket as an agent** — the internal note and its file must
      still be there, and **an older ticket's existing attachments must still
      show.**
- [ ] ⚠️ **Assign a ticket to an ordinary team member.** **Card 1.110 is the
      newest tightening and the most likely to bite:** employees can no longer
      hold tickets, and a deactivated person is refused. **An OWNER must still be
      able to self-assign on a team they do not belong to** — that exemption is
      deliberate and easy to lose.
- [ ] **Auto-assignment still works** for a team with nobody away (1.94, 1.98,
      1.112).
- [ ] **Unassign an in-progress ticket** — it should land on TRIAGED with a
      status-change entry in the history (1.111).
- [ ] ⚠️ **Open two tabs and change somebody's primary team.** Card 1.109 now
      revokes live access on deactivation, role change **and primary-team
      change** — **confirm ordinary users are not being kicked off their live feed
      by routine admin edits.**
- [ ] **A reply still emails the requester**, and a resolved-email link works.
      **Use it twice** — the second should decline politely (1.100).
- [ ] **The audit log shows rows**, including teams/routing/SLA/KB/tags (1.95),
      attachment opens (3.5). ⚠️ **The route is `/audit-log`, not `/admin/audit`.**
- [ ] **`/api/docs` loads for an OWNER, refused for an AGENT** (2.6).
- [ ] **`/api/health/ready` reports `aiPipeline: "configured"`** (1.106).

---

## 6. ⚠️ If it goes wrong — read this BEFORE deploying

**Forty-one commits is far too many to bisect against production. Decide the
suspect by symptom, not by search:**

| Symptom | Suspect |
|---|---|
| **App does not start at all** | 1.103's module restructure, or 2.6's imports |
| **A requester is refused their own ticket or file** | 1.83, 1.96, 1.79 — over-tightening |
| **A requester cannot see a file they used to see** | 1.83 — check it has a null `messageId` |
| **Somebody cannot be assigned a ticket** | **1.110** — is the account active? is it an EMPLOYEE? |
| **Live updates stop for ordinary users** | **1.109** — over-revoking on a routine edit |
| **A ticket lands on an unexpected status after unassign** | 1.111 |
| **Auto-assignment stops or picks oddly** | 1.94, 1.98, 1.112 |
| **Inbound email stops creating tickets** | 1.105, 1.84 |
| **The AI stops working** | **1.106** — check `AI_PIPELINE_ENABLED` is not `false` |
| **A screen renders empty with no error** | 1.97, 1.99 |
| **Audit log empty** | 1.104 |
| **An admin cannot be demoted from OWNER** | 1.113 — but this needs the bootstrap variable set, and it is not |

- **Code rollback:** redeploy the `2c2f8d0` package and set
  `DEPLOYED_COMMIT_SHA` back. `rollback.ps1` exists.
- ✅ **Leave all three migrations in place on a rollback.** Old code does not read
  the new tables or the new column. **That is why they go first.**
- ⚠️ **Check first whether anyone created an API key or webhook subscription** —
  old code will not know about them. Harmless, but say so rather than discover it.

**Stop and report instead of improvising** if the app does not start, if
migration 67 contains a `DROP`, if the trigram count is anything but 6, or if a
signed-in person is refused a ticket or a file they own.

---

## 7. ⚠️ AFTER this deploy — the owner's list, in order

**1. `ATTACHMENT_SCAN_ENABLED=false`** — the owner's 2026-09-15 decision on card
0.7. ⚠️ **IT DOES NOT EXIST IN AZURE AND MUST BE CREATED, NOT EDITED** — the code
defaults a missing value to `'true'`, so the gate is currently ON.
⚠️ **AND IT HAS A HARD PREREQUISITE THAT IS IN THIS DEPLOY:** card 1.83 is what
stops an internal note's screenshot becoming downloadable by the person it is
about. **Do not create that setting until this deploy is confirmed green in
production.** After it, the flag is safe — and `INFECTED` still blocks
unconditionally, so a scanner can be added later with nothing rebuilt.

**2. `HEALTH_READY_TOKEN`** — optional, small, owner's action (card 1.114).

**3. Turn off pilot mode** (`EMAIL_TEST_RECIPIENTS`) — card 1.93 was the blocker
and it ships here. ⚠️ **Card 1.105 matters too:** the day real requesters start
replying is the day attachments arrive in volume.

**4. Switch the AI on** (card 1.63) — cards 1.85, 1.91, 1.79 and 1.106 were the
blockers and all ship here.

⚠️ **None of these is part of this deploy. Do not do any of them as a side
effect.**
