# Deploy Handoff — card 1.24, the inbound mailbox worker

**Date:** 2026-09-10
**Branch:** `ui-redesign-and-api-hardening`
**Verdict:** **GREEN on everything buildable**, verified by the planning session
on 2026-09-10 by re-running all of it.

**Production is at `79e49e9`, 59 migrations. Ship `HEAD` (`fc4f499`).** Seven code
commits, one schema change (**60**).

> **This deploy switches on the last missing half of the product.** Until now
> nothing has ever fed the inbound webhook, so **seven cards have been shipping
> untested against real mail** — 1.29, 1.33, 1.34, 1.40, 1.43 and the threading
> work. §4 is where they finally get exercised.

---

## Confirmed against production, 2026-09-10, read not assumed

```
DEPLOYED_COMMIT_SHA        79e49e9      (predates card 1.24)
Applied migrations         59
Blocking migration rows    0
Trigram indexes            6            (must be 6)
INBOUND_MAILBOX_ADDRESS    glovebox@csnhc.com
INBOUND_MAILBOX_ENABLED    (not set)    -> worker dormant
SMTP_FROM / SMTP_REPLY_TO  glovebox@csnhc.com
EMAIL_TEST_RECIPIENTS      (still set to the owner)
EMAIL_ALLOWED_DOMAINS      csnhc.com
```

⚠️ **The mailbox is `glovebox@csnhc.com`, not `helpdesk@`.** The go-live doc said
`helpdesk@` throughout; the planner corrected all ten references on 2026-09-10.
**Running the scoping check against `helpdesk@` would have tested a mailbox that
does not exist and reported a pass.**

✅ **The loop closes:** `SMTP_REPLY_TO` is the same address the worker polls. The
address people are told to reply to **is** the one being read. That had to be true
and it is.

---

## The order, and the one step the owner's plan is missing

The owner's plan is: deploy → enable → run. **Insert the scoping check between
deploy and enable.** It is cheap, and it is the security decision on this card.

1. **Deploy** `HEAD`, migration 59 → 60.
2. ⚠️ **Prove the permission is SCOPED** — before the worker is allowed to touch
   anything.
3. **Set `INBOUND_MAILBOX_ENABLED=true`.**
4. **Run once** from `/admin/operations`.

### Step 2 — why it does not move

`Mail.ReadWrite` **unscoped lets the app registration read every mailbox in the
tenant.** Scoped, it reads one. That is the difference between a helpdesk worker
and a tenant-wide mail reader, and it is decided by whether an **Application
Access Policy** exists — not by anything in our code.

```
Test-ApplicationAccessPolicy -Identity glovebox@csnhc.com -AppId <AZURE_CLIENT_ID>
    # expect AccessCheckResult = Granted

Test-ApplicationAccessPolicy -Identity <any-other-mailbox>@csnhc.com -AppId <AZURE_CLIENT_ID>
    # expect AccessCheckResult = Denied
```

⚠️ **If the second says `Granted`, the permission is unscoped. Stop, do not set
`INBOUND_MAILBOX_ENABLED`, and tell the owner.** Enabling first and checking after
means the worker has already had tenant-wide read.

**Full detail, with the `New-ApplicationAccessPolicy` line if the policy is
missing, is in `docs/inbound-mailbox-go-live.md`.**

---

## What is shipping

| Commit | What |
|---|---|
| `916511c` | One mailbox, two kinds of plus-suffix — `+ticket-` is a reply token, anything else a department slug |
| `541a52f` | **Migration 60** — a durable delta cursor |
| `0b3ea70` | The Graph seam, so the card could be built before the permission arrived |
| `aec7f98` | The worker — poll, ingest, **then** move |
| `828fc9a` | The worker on the Operations console |
| `060fd6d` | One ingestion path, department routing, auto-follow |
| `9c011d2` | A failed job now names its cause rather than just saying "Failed" |

⚠️ **`9c011d2` matters more than its size.** It was found by clicking **Run now**
with the worker on: `summarize()` returned a bare *"Failed"* and threw the reason
away. **Without it, step 4 failing tells you nothing.** It is the difference
between a diagnosable go-live and an afternoon of guessing.

## Migration 60 — `20260910120000_inbound_mailbox_cursor`

Hand-checked by the planner: **one new table (`InboundMailboxCursor`), nothing
altered, 0 `DROP` statements.** A unique index on `mailbox`, so re-pointing the
worker starts a fresh cursor rather than resuming someone else's.

**59 going in, 60 coming out.** `npx prisma migrate status` is the gate — if
anything other than `20260910120000_inbound_mailbox_cursor` is pending, **stop and
report.**

> ⚠️ **You will see one alarming row. It is fine. Do not "fix" it.**
> `20260220150000_add_ticket_search_trigram_indexes` has `finished_at = NULL` **and
> `rolled_back_at` set (2026-05-01)**, which Prisma treats as settled. The six
> trigram indexes exist regardless, verified today. **Never run
> `migrate resolve --applied` on it.**

## Numbers, re-run by the planner

| Check | Result |
|---|---|
| `apps/api` `tsc --noEmit` | **0** |
| `apps/api` unit | **598 / 59 suites** |
| `apps/api` integration | **735 + 1 skipped, 72 of 73** · `Ran all test suites` · exit 0 |
| `apps/web` `tsc --noEmit` | **0** |
| `apps/web` vitest | **239 / 38 files** |

⚠️ **Kill surviving jest processes before running integration yourself.** A
harness reporting a run as killed is **not** evidence it stopped. **Exit 127 with
no summary is a spawn failure, not a test failure.** Both are in
`repo-landmines.md`. A clean run is ~16 minutes.

---

## Step 4 — the run, and what should happen

**A message is already waiting in the mailbox.** One run should:

- [ ] **Turn it into a reply on `NA_20260910_357`** — not a new ticket. That is
      **check 4** and it exercises card 1.43's bracketed `In-Reply-To` for the
      first time in its life.
- [ ] **Move it to the Processed folder** — **check 3**, and it proves the
      store-then-move order. If the message is still in the inbox but the reply
      exists, say so: that is the *safe* failure and it will simply re-ingest.
- [ ] **Report on the console:** messages ingested, last run, last result. If it
      failed, `9c011d2` means the reason is on screen — **quote it.**

## Then the rest of the checklist

`docs/inbound-mailbox-go-live.md` has all twelve. The three worth naming here:

- [ ] ⚠️ **An out-of-office auto-reply must NOT move the status.** Send one with a
      literal `Auto-Submitted: auto-replied` header. **This is the most important
      check in the whole go-live**, because that failure *looks like progress* —
      the ticket quietly leaves the chase list and nobody looks at it again. Card
      1.29 shipped on 09-03 and has never met real mail.
- [ ] **Stop the API for two minutes, send mail, restart. Nothing is lost.** This
      is the entire reason the card polls instead of subscribing — prove it.
- [ ] **Ingest the same message twice → one ticket message.**

## ⛔ Two things NOT to do

- **Do not clear `EMAIL_TEST_RECIPIENTS` yet.** Everything still redirects to the
  owner's inbox, which is what you want while testing. **Clear it only after the
  checks pass**, and confirm `EMAIL_ALLOWED_DOMAINS` still covers the domain real
  requesters are on.
- **Do not rotate `INTAKE_API_SECRET`.** Deferred by the owner, tracked as card
  1.59. Not part of this deploy.

## Build and push

**Build with `create-deploy-zip.ps1`, push with `az webapp deploy --async`.**
**NOT** `deploy-to-azure.ps1`. **NOT** the `azure` git remote.

Keep **`e2e/`**, **`rotate-intake-secret.sh`** and any **`demo-*.png`** out of the
package. **Stamp `DEPLOYED_COMMIT_SHA` with what you actually shipped.**

## Stop and report if

- The second `Test-ApplicationAccessPolicy` returns `Granted` — unscoped.
- The tenant strips or rejects plus-addressing. **That changes the design**, not a
  constant; the fallback order is in card 1.24.
- `migrate status` shows anything pending other than migration 60.
- A trigram index is missing afterwards.
- The waiting message becomes a **new ticket** instead of a reply on
  `NA_20260910_357` — that means the reply-token path is not matching, and it is
  better to know before real requesters are replying.
