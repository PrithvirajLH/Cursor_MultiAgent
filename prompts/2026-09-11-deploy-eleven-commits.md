# Deploy Handoff — eleven commits and migration 61

**Date:** 2026-09-11
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Ship:** `c1813ef` → **`f299011`**
**Verified by the planner 2026-09-11.** Every number below was re-measured on a
clean tree, not taken from a report.

> # ⚠️ THE ONE THING THAT CAN BREAK THIS DEPLOY
>
> **THE MIGRATION GOES FIRST. THE CODE GOES SECOND. NOT THE OTHER WAY ROUND.**
>
> Migration 61 replaces the unique index `SavedView_default_per_user` on
> `("userId")` with one on `("userId", "viewType")`.
>
> - **New code on the OLD index → 500s.** `clearOtherDefaults` now scopes by
>   kind, so a user with a default tickets view who sets a default report view
>   leaves two rows with `isDefault = true` and the old index rejects it:
>   `Unique constraint failed on the fields: (userId)`. **This is not
>   theoretical — card 1.53's implementer hit exactly this and backed the change
>   out.**
> - **Old code on the NEW index → fine.** The new index is strictly looser, and
>   the old `clearOtherDefaults` clears everything for the user regardless of
>   kind, so it can never violate it.
>
> **So the safe window runs one way only.** Apply the migration, confirm it, then
> ship the code.

---

## 0. Production as it actually is — measured today, 2026-09-11

**⚠️ `CLAUDE.md` was stale and I have corrected it.** It said production ran
`79e49e9` at 59 migrations. It does not.

| | measured | how |
|---|---|---|
| Deployed commit | **`c1813ef`** | `DEPLOYED_COMMIT_SHA` app setting |
| Is it an ancestor of HEAD? | **yes — clean fast-forward** | `git merge-base --is-ancestor` |
| Migrations applied | **60** (61 rows, one a rolled-back duplicate) | `_prisma_migrations` |
| Latest applied | `20260910120000_inbound_mailbox_cursor` | ” |
| Blocking rows | **0** | ” |
| Trigram GIN indexes | **6 — all present** | `pg_indexes … gin_trgm_ops` |
| `SavedView` rows | **3** | ” |
| Rows with `viewType` inside `filters` | **0** | ” |

✅ **That last row is the good news about migration 61: its two `UPDATE`
statements will touch ZERO production rows.** There are no report saved views in
production, so nothing is reclassified and nobody loses a view. All three
existing rows take `viewType = 'tickets'` from the column default.

⚠️ **The one rolled-back row is `20260220150000_add_ticket_search_trigram_indexes`,
and it is permanent and expected.** `finished_at` null, `rolled_back_at` set.
**NEVER run `prisma migrate resolve --applied` on it.** Prisma does not treat a
rolled-back row as blocking, and the six indexes it was meant to create are all
present by other means. Touching it is how you lose ticket and KB search.

---

## 1. What is shipping — eleven commits

| Commit | Card | What the owner will notice |
|---|---|---|
| `239646c` | *(threading — see §5)* | Outlook stops splitting one ticket into two conversations |
| `2c9b20c` | 1.68 | The footer, the rule and *view online* are gone from every email |
| `b3f1195` | 1.67 ① | `Reply-To` reads **CSNHC Helpdesk**, not a 36-character token |
| `e2e0d76` | 1.69 ② | **The rate limit is per user instead of one bucket for everyone** |
| `b45c4da` | 1.69 ③ | The health probe stops spending everyone's allowance |
| `9bf4af9` | 1.69 ④ | The sidebar asks for its counts once, not nine times |
| `5e14df4` | 1.66 | An agent's note with a divider or `--` in it stops being truncated |
| `2664cb1` | 1.70 | *Breach risk* reads **· 2h** and its list narrows to match |
| `4dd2407` | 1.61 | A team admin can hide *Watching*, *Mentions*, *Follow-ups* |
| `f007266` | 1.65 | Opening the palette while the Team page loads no longer shows a false error |
| `f299011` | 1.60 | **Needs migration 61.** Default report view stops clearing the default ticket view |

**Green tally, measured by me and independently by the implementer — identical:**

```
api tsc 0 · web tsc 0
unit         650 passed, 64 suites
web          271 passed, 43 files
integration  794 passed, 1 skipped, 75 of 76 suites, 0 failures   (~13 min)
migrations   61
```

---

## 2. Step one — migration 61 on **Supabase dev**, before production

**This is the repo's standing order and it exists because skipping it has broken
local dev before.** `docs/agent-context/repo-landmines.md`.

- [ ] Apply `20260911090000_saved_view_type` to the Supabase dev database.
- [ ] ⚠️ **Hand-read the file before applying it** — do not assume.
      **Expect exactly 5 executable statements and exactly 1 `DROP`**, the index
      swap. I verified this from the git object store:
      `git show f299011:apps/api/prisma/migrations/20260911090000_saved_view_type/migration.sql`.
      **If you see six `DROP INDEX` lines you are looking at a regenerated file —
      stop.**
- [ ] **Confirm dev still has its six trigram indexes afterwards.**

## 3. Step two — migration 61 on **production**

- [ ] ⚠️ **Take a backup or confirm one exists first.** There is no staging
      environment here; production is the first place this runs for real.
- [ ] Apply the migration. **`prisma migrate deploy` does NOT run on startup** —
      the App Service start command is plain `node dist/src/main.js`, so nothing
      applies it for you.
- [ ] ⚠️ **The planner cannot run this** — destructive production writes are
      blocked from agent sessions. **Hand the owner a script at a SHORT path to
      run with `!`.** A long path or a wrapped command has failed twice here.
- [ ] **Immediately after, confirm all four:**

      ```sql
      select count(*) from pg_indexes where indexdef ilike '%gin_trgm_ops%';   -- must be 6
      select indexdef from pg_indexes where indexname = 'SavedView_default_per_user';
      select count(*) from _prisma_migrations where finished_at is null and rolled_back_at is null;  -- must be 0
      select "viewType", count(*) from "SavedView" group by 1;                  -- expect tickets|3
      ```

      ⚠️ **The second one is the point of the whole migration:** the index must
      now read `("userId", "viewType")`. If it still says `("userId")` the swap
      did not happen and **you must not ship the code.**

## 4. Step three — build and deploy the code

**Use the recipe that works. Do not improvise:**

- [ ] **Build with `create-deploy-zip.ps1`.**
- [ ] **Push with `az webapp deploy --async`** — it self-polls.
- [ ] ⚠️ **NEVER `deploy-to-azure.ps1`** (502s that tell you nothing) **and never
      the `azure` git remote** (Oryx builds, which do not work for this package).
- [ ] ⚠️ **Leave `e2e/` out of the package.** Those eight Playwright specs are
      untracked and local-only.
- [ ] **Scan the package for embedded credentials before pushing.** Standing rule.
- [ ] **Set `DEPLOYED_COMMIT_SHA=f299011`** as part of the deploy, without being
      asked. ⚠️ **Setting an app setting restarts the App Service** — expect a
      cold start, and do it in the same change as the deploy rather than a second
      restart.

### ⚠️ The small window between steps 3 and 4

Between the migration and the code landing, **old code is running against the new
index.** That is safe (see the box at the top) with one cosmetic exception: the
old `ReportsPage` writes the kind *inside* `filters`, and the column will default
to `tickets`. **A report view saved during that window would show up in the
tickets sidebar afterwards.** The window is minutes and production has zero
report views today, so the realistic answer is "nobody will". If you want to be
certain, check afterwards:

```sql
select id, name from "SavedView" where filters ? 'viewType';   -- expect 0 rows
```

---

## 5. ⚠️ One commit in this deploy has never had a card, and you should know why

**`239646c` is labelled "card 1.66" and is not card 1.66.** Card 1.66 is the
reply trimmer (`5e14df4`). `239646c` is about **Outlook threading** — it sets
`Thread-Topic` to the canonical (untagged) subject and adds a `Thread-Index`
derived from the ticket's reply token.

- **It is not unverified:** it is an ancestor of `HEAD`, so it is inside the
  794 / 650 / 271 green run above, and its own commit message records api tsc 0
  and unit 621/62 at the time.
- **But it has no board row**, which means its real proof — *does Outlook
  actually thread now?* — has never been booked to anyone. **A test cannot prove
  this; only a mailbox can.** I have added card **1.74** to the board to hold it.
- **So put it in the post-deploy mailbox pass below**, and if it has not worked,
  that is a finding rather than a surprise.

---

## 6. Post-deploy checks

**Health and shape:**

- [ ] App responds; `GET /api/health` is 200 **and is no longer rate-limited**.
- [ ] **Read the log for `429`s.** The planner's last reading was **288 in one
      day, all `/api/tickets`.** ⚠️ **`RATE_LIMIT_LIMIT` is still unset**, so the
      limit is still the code default of 120 per 60 seconds — **but it is now 120
      *per user* instead of 120 for the entire application, which is the actual
      fix.** Expect the 429s to stop without raising anything. **If they do not,
      raise it then** — and say so rather than assuming.
- [ ] **Count the sidebar's requests on one load: expect ONE count call, not
      eleven.**

**On screen:**

- [ ] **Sidebar reads `Breach risk · 2h`, not `· 1h`.** ⚠️ **And that list will
      show FEWER tickets than yesterday** — the old list quietly used a four-hour
      window. **This is the fix working. Tell the owner before they report it as
      a bug.** `SLA_AT_RISK_THRESHOLD_MINUTES` is unset, so the default of 120
      minutes applies; setting it changes both the words and the number together.
- [ ] **Unassigned badge number = rows in the list it opens.**
- [ ] Team admin can hide *Watching*, *Mentions* and *Follow-ups due today*, and
      the panel's "N of M shown" counts the rows on screen.
- [ ] Save a default **report** view, then a default **ticket** view. **Both stay
      default.** That is card 1.60 and the reason for the migration.

**In the mailbox — this half cannot be done from a browser:**

- [ ] Trigger each outbound email. **No footer, no rule, no *view online*.** The
      resolved email **still shows its seven one-click links** (card 1.44).
- [ ] Your Sent folder shows **CSNHC Helpdesk**, not a token.
- [ ] **Reply to one and confirm it lands on the ticket.** More important than
      any of the cosmetics.
- [ ] **§5 — send two messages on one ticket and confirm Outlook shows ONE
      conversation, not two.**

---

## 7. ⚠️ What this deploy does NOT fix

**`EMAIL_TEST_RECIPIENTS` is still set in production.** So:

- Outbound mail still goes only to the test recipients, and subjects still carry
  `[pilot mode]`.
- **The owner's original complaint — "my sent items look like this" — is only
  half answered by shipping 1.68 and 1.67 ①.** The `[pilot mode]` text is card
  1.67 ③ and it goes away by clearing that setting.
- ⚠️ **Clearing it is a go-live decision, not tidying: real requesters start
  receiving email that moment.** **Do not clear it as part of this deploy.**
  It is the owner's call, on its own.

**Also still outstanding and deliberately not in this deploy:** card 1.69 step 1
(raise the limit — see above, probably unnecessary now), 1.59 (intake secret
rotation, deferred by the owner), 1.63 (AI routing), 1.64 (Foundry key), 0.7,
0.8, 0.4.

---

## 8. If it goes wrong

- **Code rollback is cheap:** redeploy the `c1813ef` package and set
  `DEPLOYED_COMMIT_SHA` back. `rollback.ps1` exists.
- ⚠️ **The migration is the part that needs thought.** Rolling the code back with
  migration 61 applied is **safe** — old code on the new index is fine, which is
  the whole reason for the ordering. **So roll the code back and leave the
  migration in place.** Do not try to reverse the index swap under pressure.
- **If the migration itself fails partway**, stop and report. **Do not
  `migrate resolve`.** Check the six trigram indexes first
  (`select count(*) from pg_indexes where indexdef ilike '%gin_trgm_ops%'`) and
  say what you found.

**Stop and report instead of improvising** if the `SavedView_default_per_user`
index does not read `("userId", "viewType")` after the migration, if the trigram
count is anything but 6 at any point, if `_prisma_migrations` gains a row with
both `finished_at` and `rolled_back_at` null, or if a reply stops landing on its
ticket.
