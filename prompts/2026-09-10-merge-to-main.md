# Handoff — bring `main` up to date

**Date:** 2026-09-10
**Branch:** `ui-redesign-and-api-hardening` → `main`

**`main` is 216 commits behind and has diverged by nothing.** It is a clean
fast-forward. `git rev-list --count HEAD..main` is **0**, so there is no merge to
resolve and no conflict possible.

> **This is bookkeeping, not a release.** Production deploys from the working
> branch — every `DEPLOYED_COMMIT_SHA` this month has been a branch commit, most
> recently `045ebf4`. **Merging to `main` ships nothing and changes nothing in
> production.** Do it because `main` claiming to be the shipped state while
> sitting 216 commits back is a trap for the next person, not because anything is
> waiting on it.

---

## ⚠️ Three remotes, and one of them must not be pushed

```
origin   github.com/PrithvirajLH/Cursor_MultiAgent.git     PUBLIC
update   github.com/PrithvirajLH/TicketTicket.git          PUBLIC
azure    dev.azure.com/PHulgur/TicketTicket                the deploy target
```

- [ ] ⛔ **Do NOT push to `azure`.** `main` is already **107 commits ahead of
      `azure/main`**, and that remote is the Oryx build path — the one
      `docs/DEPLOYMENT.md` and the project's own notes say never to deploy
      through. Pushing 323 commits at it could trigger a build nobody asked for
      against the live App Service. **Deploys go through
      `create-deploy-zip.ps1` + `az webapp deploy`, and only from a deploy-agent
      session.**
- [ ] ⚠️ **`origin` and `update` are both PUBLIC GitHub repositories.** Before
      pushing anything outward, see the sensitivity check below. This is not
      theoretical: the repo contains a security audit describing live weaknesses,
      and this month's cards have discussed production secrets by name.

---

## Step 1 — decide whether to wait

**Two workstreams are uncommitted right now** (cards 1.62 and 1.65, from two
different sessions — see `prompts/2026-09-10-deploy-1-62-1-65.md` §0).

Uncommitted work is in no commit, so **the merge is unaffected either way.** But
merging now means `main` is stale again the moment those land.

- [ ] **Planner's recommendation: commit 1.62 and 1.65 first**, then fast-forward
      once. One catch-up rather than two.
- [ ] If the owner would rather not wait, fast-forward now — it is not wrong, just
      less tidy.

## Step 2 — the sensitivity check, before anything leaves the machine

⚠️ **Both GitHub remotes are public. Run these and read the output.**

- [ ] **Scan the diff going out for anything that looks like a credential:**
      ```
      git diff main..HEAD | grep -nEi "Bearer [A-Za-z0-9]{8}|postgres(ql)?://[^ ]*:[^ @]*@|password=|api[-_]?key['\"= ]"
      ```
      ✅ **The planner ran this on 2026-09-10 and it returns exactly THREE hits,
      all benign. They are listed below so you can match them off rather than
      judging anything yourself. A FOURTH hit is new and means stop and report.**

      1. `apps/api/.env.example` — `AZURE_AI_FOUNDRY_API_KEY=` **with no value.**
         A template key, which is the whole point of that file.
      2. `apps/api/src/common/log-redaction-paths.util.ts:11` — a doc comment
         showing what card 1.57's leak looked like:
         `"authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXV…"`. That
         string is the **standard JWT header prefix** — it decodes to
         `{"alg":"HS256","typ":"JWT"` and every HS256 token begins with it.
         **No payload, no signature, nothing secret.** It is illustrative, and
         it is truncated deliberately.
      3. A **markdown handling note** recording that the owner once pasted raw
         tokens into a session, and that those were credentials. A note *about*
         credentials, not credentials — and those tokens expired 2026-09-03.
- [ ] **Known and deliberate, so do not be alarmed by these:**
      `docs/security-audit-2026-08.md` describes live weaknesses in a running
      system; several cards name production app-setting **keys** (never values);
      and the firewall discussion in
      `prompts/2026-09-08-deploy-six-card-batch.md` was deliberately masked to
      `/16`. **All of that is already in earlier public pushes.** The question is
      only whether this diff adds something new.
- [ ] ⚠️ **One real item to check: two live secrets were printed into a session
      transcript on 2026-09-10** — `EMAIL_ACTION_SECRET` and
      `AZURE_AI_FOUNDRY_API_KEY` (cards 1.57 and 1.64). **Those live in
      `~/.claude/projects/…/*.jsonl`, not in the repo**, so a push cannot carry
      them. **Confirm that is still true** rather than assuming:
      ```
      git diff main..HEAD | grep -cE "6ia2gFK|b7e4977"
      ```
      ✅ **The planner ran this: it returns 0.** Neither value is in the repo, so
      no push can carry them. **Re-run it anyway** — it costs a second and the
      tree has moved under this session twice today.
- [ ] **`e2e/` stays untracked.** Eight Playwright specs, ~82 KB, owner reviewed
      2026-09-04 and chose to leave them out. ⚠️ **Note `.gitignore:49-51` says the
      opposite** — *"# Keep Playwright specs"* with two negation rules — so the
      recorded intent and the actual state disagree, deliberately. **Do not
      "fix" either.** Same for `rotate-intake-secret.sh` at the repo root.

## Step 3 — the fast-forward

```
git checkout main
git merge --ff-only ui-redesign-and-api-hardening
```

- [ ] ⚠️ **Use `--ff-only`.** If it refuses, something has changed since this was
      written — **stop and report** rather than reaching for a merge commit. The
      whole point is that there is nothing to reconcile.
- [ ] **Push to `origin` only.** Not `azure`. `update` at the owner's discretion.
- [ ] **Return to the working branch afterwards** — everything in flight assumes
      `ui-redesign-and-api-hardening` is checked out, including two uncommitted
      workstreams that would otherwise be sitting on `main`.

## Step 4 — fix the line that made this necessary

`CLAUDE.md` still says:

> *"`main` and `ui-redesign-and-api-hardening` are both at `d8811a7` — exactly
> what shipped."*

- [ ] **That has been wrong for two weeks** and is exactly the kind of stale fact
      that has cost this project days. Replace it with what is true after the
      merge, and **say which branch production actually deploys from**, because
      the sentence implies main is the shipped state and it is not.

## What to report back

1. **The output of both scans in Step 2**, even when clean. *"I ran it and it was
   empty"* is the useful sentence; silence is not.
2. **Confirmation the merge was a fast-forward** and the commit `main` now points
   at.
3. **Which remotes you pushed to.** Explicitly confirm you did **not** push
   `azure`.
4. **That you left the working branch checked out**, and that the two uncommitted
   workstreams are still intact and still uncommitted (or committed, if you did
   Step 1).
5. Anything that did not match. **This document is wrong somewhere.**

**Stop and report instead of improvising** if `--ff-only` refuses, if either scan
finds anything, if pushing appears to trigger a build, or if the uncommitted work
is disturbed at any point.
