# Deploy Handoff — the last three Phase 1 commits

**Date:** 2026-09-11
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Ship:** `cc0ce09` → **`d4cf357`**
**Verified by the planner 2026-09-11.** Every number below was re-measured, not
taken from a report.

> # This deploy is the easy kind, and it is worth saying why
>
> **Three commits. All of them in `apps/web`. Zero files under `apps/api`. No
> migration — the schema stays at 61.**
>
> The previous deploy had a hard ordering constraint (migration first, or new
> code 500s on the old index). **This one has none.** There is nothing to
> sequence, nothing to check in the database, and a rollback is a redeploy of the
> previous package.
>
> ✅ **With this, Phase 1 is done.** Everything left on the board is a decision
> that belongs to the owner.

---

## 0. ⚠️ Build from `d4cf357`, not from "whatever HEAD is"

**The implementer starts Phase 2 on this same branch, possibly while you are
deploying.** Phase 2's first batch adds **migrations 62 and 63** and changes how
tickets get auto-assigned. **None of that is verified and none of it may ship in
this package.**

- [ ] **Check out `d4cf357` explicitly and build from it.** Do not build from the
      branch tip.
- [ ] ⚠️ **The last deploy shipped five commits past its stated target** because
      it took HEAD. No harm resulted — they turned out green — but **the sequence
      was deploy-then-verify, which is backwards.** Do not repeat it here, where
      the commits behind HEAD carry schema changes.
- [ ] **If `git log --oneline cc0ce09..d4cf357` shows anything other than the
      three commits below, stop and report.**

---

## 1. What is shipping

| Commit | Card | What the owner will notice |
|---|---|---|
| `6503d33` | 1.76 ① | Escape closes a menu or popover **without throwing you off the ticket** |
| `be1cb61` | 1.76 ② | Nothing visible — a dead nav array deleted, with four fabricated counts in it |
| `d4cf357` | 1.77 | The same fix on the ticket **list**, where Enter could confirm a dialog *and* open a ticket behind it |

**Green tally, measured by the planner on a clean tree at `d4cf357`:**

```
api tsc 0 · web tsc 0
unit          654 passed, 65 suites
web           298 passed, 46 files
integration   805 passed + 1 skipped, 77 of 78 suites
migrations    61  (unchanged)
```

⚠️ **The integration figure is from `cc0ce09` and is still valid**, because the
diff `cc0ce09..d4cf357` contains **zero files under `apps/api`** — verified with
`git diff --name-only`. The integration suite exercises the API; nothing it
touches has changed.

---

## 2. Build and deploy

- [ ] **Build with `create-deploy-zip.ps1`.**
- [ ] **Push with `az webapp deploy --async`** — it self-polls.
- [ ] ⚠️ **NEVER `deploy-to-azure.ps1`** (502s that tell you nothing) **and never
      the `azure` git remote** (Oryx, which cannot build this package).
- [ ] ⚠️ **Leave `e2e/` out of the package.** Those Playwright specs are untracked
      and local-only.
- [ ] **Scan the package for embedded credentials before pushing.** Standing rule.
- [ ] **Set `DEPLOYED_COMMIT_SHA=d4cf357`** as part of the deploy, without being
      asked. ⚠️ **An app-settings change restarts the App Service** — do it in the
      same change rather than causing a second restart.
- [ ] **No database step. Do not run `prisma migrate deploy`.** There is nothing
      to apply, and the production schema must stay at 61.

---

## 3. Post-deploy checks

**All three are keyboard behaviour, and all three take under a minute.**

- [ ] **Open a ticket. Right-click a message, press Escape.** The menu closes and
      **you are still on the ticket.**
- [ ] **Open the notification panel from the top bar, press Escape.** It closes
      and **you are still on the ticket.** (This one was broken before the
      right-click menu ever existed.)
- [ ] ⚠️ **Press Escape on a ticket with nothing open. You should leave the
      ticket.** **This is the check that matters most** — the risk in this change
      was a guard so greedy it silently killed a working shortcut, and every
      automated test would still have passed.
- [ ] **On the tickets list: delete a saved view and press Enter to confirm.** The
      view is deleted and **no ticket opens behind the dialog.** That is card 1.77.
- [ ] **Still on the list, with that dialog open, press `j`, `k` and `x`.** The
      list must not move underneath it.

**And confirm nothing else moved:**

- [ ] The ticket list loads, a ticket opens, a reply sends.
- [ ] **The Remove dialog on a message still works** and still shows card 1.11's
      wording and card 1.47's queued caveat.

---

## 4. ⚠️ Two things this deploy does not fix, and one to watch

1. **Card 1.69's rate-limit fix is still unproven in production.** The planner
   could not settle it: `az webapp log download` returns roughly a
   twenty-minute window, and the same query that finds **0 × 429** in that window
   also finds 0 on the two days that measured **288**. **If "Couldn't load list"
   or "Unable to load tickets" reappears, that is the answer** — and the response
   is to set `RATE_LIMIT_LIMIT`, which is still unset.
2. **`EMAIL_TEST_RECIPIENTS` is still set.** Outbound mail still reaches only the
   test addresses and still carries `[pilot mode]` in the subject. ⚠️ **Clearing
   it is a go-live decision, not tidying — real requesters start receiving email
   that moment. It is the owner's call and it is not part of this deploy.**
3. **Watch for a cold start** after the settings change, as usual.

---

## 5. If it goes wrong

- **Rollback is a redeploy of the `cc0ce09` package**, plus setting
  `DEPLOYED_COMMIT_SHA` back. `rollback.ps1` exists.
- ⚠️ **There is no database state to unwind.** No migration ran, so a rollback is
  purely the application package — the simplest case this project has.
- **The most likely failure is the greedy-guard one:** Escape stops working
  anywhere on a ticket. **If that happens, roll back and report** — do not try to
  narrow the selector in production.

**Stop and report instead of improvising** if `git log cc0ce09..d4cf357` shows
more than the three commits listed, if the package contains anything under
`apps/api/prisma`, or if Escape-with-nothing-open stops navigating.
