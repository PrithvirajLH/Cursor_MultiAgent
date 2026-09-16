# Deploy Handoff — six commits, no migration

**Date:** 2026-09-16
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Ship:** `8e394b7` → **`416ae5c`**

⚠️ **This supersedes `prompts/2026-09-16-deploy-forty-one.md`** (target
`60f5c64`, shipped 13:56 UTC). **Work from this file.**

> # ⚠️ PRODUCTION IS FURTHER AHEAD THAN THE LAST REPORT SAID
>
> **Measured, not assumed:** `DEPLOYED_COMMIT_SHA` reads **`8e394b7`**, and Azure
> shows **three** successful deployments today — 13:56, 15:51 and 16:13 UTC.
>
> **So `eaf1edb` (card 1.116, emailed attachments), `c9bebc7` and `8e394b7`
> (card 1.119) are ALREADY LIVE.** ⚠️ **The planner's own previous message said
> "11 commits undeployed" — that was wrong. It is SIX.**
>
> ✅ **And this one is small and low-risk: no migration, no schema change, four
> of the six are web-only, and one is documentation.**

---

## 0. State, measured 2026-09-16

| | |
|---|---|
| Deployed commit | **`8e394b7`** |
| Production schema | **67 applied** — nothing outstanding |
| Migrations in this range | ✅ **NONE.** `git diff --name-only 8e394b7..416ae5c -- apps/api/prisma/` is empty |
| Commits to ship | **6** |

✅ **VERIFIED GREEN BY THE PLANNER 2026-09-16**, re-measured at `416ae5c` on a
clean, idle tree with no other session's work in it:

```
api tsc 0 · web tsc 0
unit          855 passed, 91 suites, 0 failures
web           416 passed, 61 files
integration   966 passed + 1 skipped, 96 of 97 suites, 0 failures  (1101 s)
environment markers 0 · reset failures 0
migrations    67 · check-migrations.sh ok
```

⚠️ **Two stray dev servers were killed before that run.** One held `apps/api` and
had already wrecked an earlier attempt with `Command failed: node
scripts/reset-test-db.cjs`. **Check the repo is idle before you build.**

---

## 1. What is shipping

| Commit | |
|---|---|
| `7fee200` | **Card 1.117** — next/previous arrows through a ticket's images |
| `80f0074` | **Card 1.120** — a tall tab panel can be scrolled to |
| `02c3dba` | The ticket panel stops tooltipping everything inside it |
| `5a9fcb3` | **Card 1.121** — an emailed attachment records which message it arrived on |
| `416ae5c` | **Card 1.122** — documentation only, +42 lines, no behaviour change |
| `3bb695e` | Planning documents only |

**Two of these the owner will notice immediately** — the carousel and the
scrolling fix, both raised by them today from real tickets.

⚠️ **`5a9fcb3` is the only API change in the deploy, and it is NOT a security
fix — do not describe it as one.** Inbound messages are created `PUBLIC`
(`inbound-email.service.ts:308`), and card 1.83 only refuses INTERNAL, so linking
`messageId` **changes nothing about who can see what.** What it buys is
provenance and a populated foreign key. ✅ **Existing rows stay NULL and stay
visible; there is no backfill, deliberately.**

---

## 2. Build and deploy

- [ ] ⚠️ **Confirm the repo is idle first:** no jest, no dev server. **A dev
      server holds the Prisma query engine and the build dies with `EPERM`.**
- [ ] ⚠️ **Build from a throwaway copy, NEVER the shared checkout:**

      ```bash
      git worktree add ../deploy-416ae5c 416ae5c
      # build and deploy from there, then:
      git worktree remove ../deploy-416ae5c
      ```

      **Two sessions share this tree; a planner instruction to `git checkout <sha>`
      detached HEAD under another session twice on 2026-09-15.**
- [ ] **Confirm `git log --oneline 8e394b7..416ae5c` is exactly 6 commits.**
- [ ] ✅ **Skip the migration step entirely. There is no schema change.** Do not
      run `prisma migrate deploy` "just in case" — it would correctly do nothing,
      and running it is how the trigram question gets reopened by accident.
- [ ] **Build with `create-deploy-zip.ps1`; push with `az webapp deploy --async`.**
- [ ] ⚠️ **NEVER `deploy-to-azure.ps1`, never the `azure` git remote.**
- [ ] **Leave `e2e/` and `audit-output/` out of the package. Scan for embedded
      credentials.**
- [ ] **Set `DEPLOYED_COMMIT_SHA=416ae5c`** in the same change.

---

## 3. Post-deploy checks

**⚠️ FIRST: does the application start?** Open the app and load a ticket. **Card
2.6's boot failure passed two typechecks, 738 unit tests and a full build**, so
this check is never skipped even on a small deploy.

**Then — four of six commits are web, so the checks are mostly visual:**

- [ ] ⚠️ **Open ticket `PA_20260910_381`** — seven images, two over 2 MB. **Click
      View on the first and reach the last with arrows alone.** That ticket is
      where card 1.117 was reported.
- [ ] ⚠️ **Then open the audit log and count.** **One entry per image you actually
      looked at — no more.** If seven appear after you viewed three, the
      no-prefetch rule in card 1.117 has regressed. **This is the check that
      matters most in this deploy**, because card 3.5's log is only worth
      something if it records people rather than software.
- [ ] **Open the Timeline tab on a long ticket and scroll to the bottom of it**
      (card 1.120). **Then Conversation — one scrollbar, not two.**
- [ ] **Hover around the ticket panel** — no tooltip on everything (`02c3dba`).
- [ ] **Send an inbound reply with an attachment**, then check the file is on the
      ticket **and still visible to the requester** (card 1.121's direction of
      risk is over-tightening, not leaking).
- [ ] **Open a ticket as its REQUESTER** — attachments that arrived before today
      have a NULL `messageId` and **must still be visible.**

---

## 4. If it goes wrong

| Symptom | Suspect |
|---|---|
| **App does not start** | `5a9fcb3` — the only API change |
| **Audit log fills with opens nobody made** | `7fee200` — prefetch regression |
| **A requester cannot see a file they used to see** | `5a9fcb3` + card 1.83 — check the row's `messageId` |
| **An attachment arrives but is not on the ticket** | `5a9fcb3` |
| **A panel is clipped, or has two scrollbars** | `80f0074` |
| **Tooltips everywhere, or none** | `02c3dba` |

- **Code rollback:** redeploy the `8e394b7` package, set `DEPLOYED_COMMIT_SHA`
  back. `rollback.ps1` exists.
- ✅ **Nothing to unwind in the database.** No migration, and the only data change
  is `Attachment.messageId` being populated on new inbound attachments — **old
  code ignores that column entirely.**

**Stop and report instead of improvising** if the app does not start, if a
signed-in person is refused a file they own, or if the audit log shows more opens
than images actually viewed.

---

## 5. After this — the owner's list

**1. `HEALTH_READY_TOKEN`** — still unset, still optional, still the owner's
(card 1.114).

**2. Turn off pilot mode** (`EMAIL_TEST_RECIPIENTS`) — cards 1.93, 1.105 and
1.116 all shipped, so inbound email now actually works end to end including
attachments.

**3. Switch the AI on** (card 1.63) — cards 1.85, 1.91, 1.79, 1.106, 1.107 and
1.108 were the blockers and all are live.

✅ **`ATTACHMENT_SCAN_ENABLED=false` is already set** — confirmed 2026-09-16,
after card 1.83 went live, which was the required order.

⚠️ **None of these is part of this deploy.**
