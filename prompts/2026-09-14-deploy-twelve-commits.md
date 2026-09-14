# Deploy Handoff — twelve commits and migration 64

**Date:** 2026-09-14
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Ship:** `6f127cb` → **`2c2f8d0`**
**Verified GREEN by the planner 2026-09-14**, everything re-measured on a clean
first run.

> # ⚠️ THE MIGRATION GOES FIRST
>
> **New code without migration 64 has no `Announcement` table.** The banner's
> fetch fails (it catches and renders nothing, so the shell survives) and the
> admin screen errors outright.
>
> **Old code with migration 64 applied is completely safe** — a new table and two
> new enums that nothing existing reads.
>
> **So the order is one-directional, as it was for 62 and 63: apply, confirm,
> then ship.**

---

## 0. Production as it is right now — measured 2026-09-14

| | measured |
|---|---|
| Deployed commit | **`6f127cb`** |
| Schema | **63 applied migrations, 0 blocking** |
| Migration 64 | **applied nowhere** — not production, not Supabase dev |

⚠️ **This is the largest verified-but-unshipped stack this project has had:
twelve commits.** Two previous deploys each shipped exactly the commits their
handoff named because the handoff pinned a commit rather than taking HEAD. **Do
the same.**

---

## 1. What is shipping

**Card 2.7 — announcements (six commits, migration 64)**

| Commit | |
|---|---|
| `a6e2624` | model + API |
| `2a71de9` | admin screen |
| `4f85baf` | banner on every page |
| `7b2682b` | fix: the banner never loaded |
| `9ebda53` | regression guard for that fix |
| `e87a094` | fix: one header row, button where the house puts it |

**Four audit fixes (six commits, no migration)**

| Commit | Card | |
|---|---|---|
| `f55d111` | 1.78 + 1.89 | A deactivated account is refused, and cannot be re-added to a team |
| `8c635d7` | 1.80 | An out-of-office reply no longer reopens a resolved ticket |
| `f182493` | 1.79 | The satisfaction-rating read now checks who is asking |
| `a0a1384` | 1.79 | The AI analysis read too, and stops returning the requester's text |
| `15a327b` | 1.79 | The contract change that guard forced |
| `2c2f8d0` | 1.80 | The timeline says when an autoresponder was ignored |

**Green tally, measured by the planner at `2c2f8d0`:**

```
api tsc 0 · web tsc 0
unit          683 passed, 69 suites
web           372 passed, 54 files
integration   876 passed + 1 skipped, 85 of 86 suites, 0 failures
environment markers (P1001/P1017/57P01)   0
migrations    64 · check-migrations.sh ok
```

---

## 2. Step one — migration 64 on **Supabase dev**, before production

- [ ] Apply `20260914120000_announcements` to Supabase dev. **Standing order.**
- [ ] ⚠️ **Hand-read it first.** Expect **two `CREATE TYPE`, one `CREATE TABLE`,
      four `CREATE INDEX`, three `ADD CONSTRAINT` — and zero `DROP`.** The file
      documents this itself; if what you see differs, you are looking at a
      regenerated file. **Stop.**
- [ ] **Confirm dev still has its six trigram indexes afterwards.**

## 3. Step two — migration 64 on **production**

- [ ] ⚠️ **Confirm a backup exists.** No staging here.
- [ ] **`prisma migrate deploy` does NOT run on startup** — the start command is
      plain `node dist/src/main.js`. Nothing applies it for you.
- [ ] ⚠️ **The planner cannot run this** — production writes are blocked from
      agent sessions. **Hand the owner a script at a SHORT path to run with `!`.**
- [ ] **Immediately after, confirm all four:**

      ```sql
      select count(*) from pg_indexes where indexdef ilike '%gin_trgm_ops%';   -- 6
      select to_regclass('public."Announcement"');                             -- not null
      select count(*) from pg_type where typname like 'Announcement%';         -- 2
      select count(*) from _prisma_migrations
        where finished_at is null and rolled_back_at is null;                  -- 0
      ```

      ⚠️ **The one permanently rolled-back row is the trigram migration. Expected.
      NEVER `migrate resolve --applied` on it.**

## 4. Step three — build and deploy

- [ ] ⚠️ **Check out `2c2f8d0` explicitly and build from it**, not the branch tip.
      **Card 2.6 is next and reserves migration 65** — it must not ride along.
- [ ] **If `git log --oneline 6f127cb..2c2f8d0` shows anything but the twelve
      commits above, stop and report.**
- [ ] **Build with `create-deploy-zip.ps1`; push with `az webapp deploy --async`.**
- [ ] ⚠️ **NEVER `deploy-to-azure.ps1`, never the `azure` git remote.**
- [ ] **Leave `e2e/` and the root `p4-*.png` screenshots out of the package.
      Scan for embedded credentials.**
- [ ] **Set `DEPLOYED_COMMIT_SHA=2c2f8d0`** in the same change.

---

## 5. Post-deploy checks

**⚠️ Two of these change behaviour people will notice. Do them first.**

- [ ] **Deactivate a test account, then try to use the app as them. Refused, with
      a message saying the account is deactivated.** Reactivate → back in.
      ⚠️ **Then read §6 before you reactivate anyone real.**
- [ ] **Try to add that deactivated person to a team → refused**, with a message
      naming them.
- [ ] **Create an OUTAGE announcement.** It appears on the dashboard, the ticket
      list, a ticket and `/submit`. **Set `endsAt` a minute ahead and watch it
      disappear** without a reload trick.
- [ ] ⚠️ **Sign in as somebody on another team and confirm a TEAM announcement is
      NOT there.** The security check, by eye as well as by test.
- [ ] **With nothing active, confirm no empty bar and no layout shift.**
- [ ] **Open a ticket as its requester** — the two guarded reads must still work
      for people entitled to them. The risk in 1.79 is over-tightening.

**Then the quieter ones:**

- [ ] The ticket list loads, a ticket opens, a reply sends.
- [ ] The admin announcements screen has **one** header row.

---

## 6. ⚠️ One thing to know before you deactivate anybody real

**Reactivation restores access but NOT team membership.** Deactivation deletes
the roster rows; `reactivate` writes `{ isActive: true, deactivatedAt: null }` and
nothing else. **So a reactivated agent signs in successfully and sees an empty
queue, on no team — and nothing records which teams they were on.**

**This is pre-existing and this deploy did not cause it** — but until now a
"deactivated" person kept working, so nobody exercised reactivation. **From this
deploy onward, deactivation is real and this is the path back.**

- [ ] **Before deactivating anyone in production, write down their teams.**
- [ ] Tracked as **card 1.98**, not fixed here.

---

## 7. What this deploy does not change

1. **Pilot mode is still on.** ⚠️ **And card 1.93 says an email-security scanner
   could perform one-click actions the moment it is switched off.** Verified not
   to have happened yet — but **fix 1.93 before clearing
   `EMAIL_TEST_RECIPIENTS`.**
2. **Card 1.69's rate-limit fix remains unproven.** If *"Couldn't load list"*
   returns, set `RATE_LIMIT_LIMIT`.
3. **Announcement dismissal is the planner's default, not an owner decision** —
   INFO/WARNING dismiss for good, OUTAGE returns each session. ⚠️ **And dismissal
   is remembered per BROWSER, not per person: on a shared desk machine one
   person's dismissal hides the notice from the next.** The owner has not ruled on
   that and it is worth raising after they have seen it working.

---

## 8. If it goes wrong

- **Code rollback:** redeploy the `6f127cb` package, set `DEPLOYED_COMMIT_SHA`
  back. `rollback.ps1` exists.
- ✅ **Leave migration 64 in place on a rollback.** Old code never reads the
  table — that is the whole reason for the ordering.
- ⚠️ **The most likely failure is over-tightening, not the migration:** somebody
  entitled to a ticket being refused a rating or an analysis, or a legitimate
  account being locked out. **If a real user is locked out, roll the code back
  first and diagnose afterwards** — do not debug an auth guard in production.

**Stop and report instead of improvising** if the migration file contains a
`DROP`, if the trigram count is anything but 6 at any point, if a genuine human
reply stops reopening a resolved ticket, or if any signed-in person is refused a
ticket they own.
