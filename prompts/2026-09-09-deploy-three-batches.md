# Deploy Handoff — three batches, sixteen cards, one migration

**Date:** 2026-09-09
**Branch:** `ui-redesign-and-api-hardening`
**Verdict:** **GREEN.** All sixteen cards verified by the planning session, every
suite re-run here rather than taken from a report.

**Production is at `f48452b`, 57 migrations. Ship `HEAD`.** Twenty code commits,
one schema change (**58**).

> ⚠️ **This supersedes `prompts/2026-09-08-deploy-six-card-batch.md`.** That
> handoff covered only the first of these three batches and its numbers are now
> stale. **Use this file.** The older one is kept for its P1 firewall record.

---

## Confirmed against production, 2026-09-09, not assumed

```
DEPLOYED_COMMIT_SHA        f48452b
Applied migrations         57      (latest: 20260904180000_canned_response_actions)
Blocking migration rows    0
Trigram indexes            6       (must be 6)
Database reachable         yes     (firewall rule dev-laptop-20260908 in place)
```

---

## ⚠️ Two prerequisites, and both are still owed

**Either one missed ships a feature that silently does nothing — no error, no log
line.** The firewall prerequisite from the previous handoff is **done**.

### P1 — `EMAIL_ACTION_SECRET` is not set

`emailActionSecret()` reads `EMAIL_ACTION_SECRET`, falls back to
`AUTH_JWT_SECRET`, then returns `null`
(`apps/api/src/email-actions/email-action-link.util.ts:27-33`). **Production has
neither** — re-confirmed today. There is no default in the code.

`buildResolvedEmailLinks` is documented as **"all seven or none"**, so card 1.44
would deploy, raise nothing, log nothing, and **every resolved email would go out
with none of its seven links.** It would look exactly like the feature was never
built.

```
az webapp config appsettings set --name TicketTicket --resource-group csnhc-ai \
  --settings EMAIL_ACTION_SECRET="<a fresh 32+ byte random string>"
```

⚠️ **Generate it outside the repo. Do not paste it into a file here, and do not
echo it to a terminal you will later paste into a report** — see card 1.57 for why
that matters more than usual on this system. Rotating it later invalidates every
link already emailed, so set it once.

`WEB_APP_URL` **is** set, so the link base URL is fine.

### P2 — Easy Auth must exclude `/api/email-actions`

The routes are `@Public()`, which clears only the app's own guard. Production sits
behind Easy Auth with `unauthenticatedClientAction: RedirectToLoginPage`.

**Add `/api/email-actions` to `globalValidation.excludedPaths` in
`authsettingsV2`**, beside `/api/tickets/inbound-email` and `/api/tickets/intake`.
Without it every link returns 401.

### Worth doing in the same restart window — not a prerequisite

An app-settings change restarts the app. **Card 1.57's intake-secret rotation also
needs a settings change**, so doing both together costs one restart instead of two.
It is a separate decision with a Power Automate coordination cost — the owner has
the script (`rotate-intake-secret.sh`) and its warning. **Do not run it on your own
initiative.**

---

## What is shipping

### Batch 1 — the email and desk batch (migration 58)

| Card | Commit | What a person will notice |
|---|---|---|
| 1.44 | `98706ca` + `15d2179` | The resolved email gets seven one-click links: close, reopen, five rating stars. No sign-in, no mail app, no second click. |
| 1.11 | `8f2e002` | An agent can remove a message that should not have been sent. **Migration 58.** |
| 1.17 | `0c5a90e` | Three new desk reports: first-contact resolution, reassignment count, time in status. In the CSV export. |
| 1.12 | `9b6c540` | Tag or run a macro across a selection, with per-ticket outcomes rather than one silent failure. |
| 1.18 | `75506ef` | A half-written reply remembers whether it was public or an internal note. |
| 1.43 | `14e6a17` | An acknowledgement email's `In-Reply-To` is bracketed per RFC 5322, so a strict client threads the reply instead of opening a new ticket. |

### Batch 2 — the seven fixes

| Card | Commit | What a person will notice |
|---|---|---|
| 1.47 | `842e87a` | Removing a message now also stops any copy not yet sent, and scrubs the text the system had kept for ever. |
| 1.48 | `dba2658` | A pasted image goes with the message instead of staying one click away on the Attachments tab. |
| 1.45 | `bf154a5` | Reports stop counting deleted tickets. **Twenty of twenty-three never did.** |
| 1.50 | `b9f7adb` | The tag filter can hold two tags. It ate every comma you typed. |
| 1.52 | `ed58c42` | The Add-member list is searchable, by name or email — 111 people, four visible at a time. |
| 1.49 | `a513499` | The ticket-row checkbox actually selects, by mouse and by keyboard. |
| 1.51 | `dd6c4bb` | A bulk macro survives a slow connection instead of timing out mid-run. |
| — | `0c69e4c` | Three defects the browser pass found in the above. |

### Batch 3 — the session and logging batch

| Card | Commit | What a person will notice |
|---|---|---|
| 1.54 | `86537c3` | An expired session says so and signs you back in, instead of *"Unable to load tickets"* with a Retry that cannot help. **This is the error the owner kept hitting.** |
| 1.57 | `d0d580e` | ⚠️ **The API stops writing bearer tokens and shared secrets into the log.** See the warning below. |
| 1.55 | `5fb86e0` | A warning that fired 186 times a day on healthy data now fires once per account. |
| 1.56 | `77c3b99` | The macro editor's tag field can hold two tags. |
| — | `ea3a212` | Two defects the browser pass found in 1.54. |

## ⚠️ Card 1.57 — the deploy fixes this forward, it does not fix the past

`d0d580e` stops the leak. **It does nothing about what has already been written.**
Three days of production log hold **2,064 full bearer tokens** and **252 copies of
the intake shared secret**. Header logging dates from 2026-03-10; the intake secret
has been exposed since the endpoint went live 2026-08-28.

**Do not treat shipping this as closing the incident.** Two actions remain and both
are the owner's: rotate `INTAKE_API_SECRET`, and decide what happens to the
existing log files and who is told. **Say in your report that you shipped the code
fix and that these are outstanding**, so nobody reads GREEN as resolved.

## Migration 58 — `20260904200000_ticket_message_redaction`

Hand-checked: two nullable columns, one index, one `ON DELETE SET NULL` foreign
key, on one table. **Zero executable `DROP` statements** — a case-insensitive grep
matches three times and all three sit inside the header comment recording the
twelve destructive statements Prisma emitted and the implementer removed. **No enum
is touched**, so none of the enum-in-transaction hazard from migrations 54 and 56.

**57 going in, 58 coming out.** `npx prisma migrate status` is the gate: if
anything other than `20260904200000_ticket_message_redaction` is pending, **stop
and report.**

> ⚠️ **You will see one alarming row. It is fine. Do not "fix" it.**
> `20260220150000_add_ticket_search_trigram_indexes` has `finished_at = NULL` and
> error `0A000` in its logs — **and `rolled_back_at` set (2026-05-01)**, which
> Prisma treats as settled. That is why 55–57 deployed cleanly on 09-04. The six
> trigram indexes exist regardless, verified today.
>
> **Never run `migrate resolve --applied` on it** — that would assert a migration
> ran which did not, and the next `migrate dev` would diff against a false
> baseline. Only a row with **neither** timestamp blocks a deploy.

Per the standing rule: **apply to the Supabase dev database before production.**
Already done there — the local integration run proves 58 is applied.

## Numbers, re-run by the planner on 2026-09-09

| Check | Result | Was |
|---|---|---|
| `apps/api` `tsc --noEmit` | **0** | 0 |
| `apps/api` unit | **549 / 54 suites** | 480 / 48 |
| `apps/api` integration | **699 + 1 skipped, 69 of 70** · `Ran all test suites` | 617 + 1, 62 of 63 |
| `apps/web` `tsc --noEmit` | **0** | 0 |
| `apps/web` vitest | **225 / 36 files** | 158 / 26 |

⚠️ **Before you run integration yourself, kill surviving jest processes.** A
harness reporting a run as killed is **not** evidence it stopped — overlapping runs
produced two failures on 2026-09-09 that were pure phantoms. And **exit 127 with no
summary is a spawn failure, not a test failure.** Both are in `repo-landmines.md`.
A clean run takes **~11 minutes**.

## Build and push

**Build with `create-deploy-zip.ps1`, push with `az webapp deploy --async`.**
**NOT** `deploy-to-azure.ps1` — it cannot deploy the current package and returns
502s that tell you nothing. **NOT** the `azure` git remote (Oryx).

- **Keep `e2e/` out of the package.** Eight untracked Playwright specs.
- **Keep `rotate-intake-secret.sh` and any `demo-*.png` out** too.
- **Stamp `DEPLOYED_COMMIT_SHA` with the commit you actually shipped** — HEAD at
  build time, not a value carried over. Verify before you build that no *code*
  commit landed after `ea3a212`:
  ```
  git log --oneline ea3a212..HEAD    # expect docs only
  ```

## After the deploy — in this order

1. **`DEPLOYED_COMMIT_SHA` matches what you shipped.**
2. **`prisma migrate status`: 58 applied, nothing pending.**
3. **The six trigram indexes are still there.** `apps/api/prod-migration-count.mjs`
   reports all of 1, 2 and 3 in one read-only run.
4. ⚠️ **A resolved email contains SEVEN links.** This is the P1 check and the only
   way to know the secret took. Resolve a real ticket, read the outbox row, count
   them. **Seven or none — if none, P1 did not take and nothing else about 1.44 is
   worth testing.**
5. **Click one star, once.** The rating stores; the page says nothing about the
   ticket.
6. ⚠️ **The scanner check.** `curl` a link with a bare `GET` and confirm the ticket
   does **not** change. Asserted by a test that reads the database, but this is the
   failure that would auto-confirm every resolved ticket, so do it live once.
7. ⚠️ **Confirm the log no longer prints credentials.** Make one authenticated
   request, then grep the container log for `Bearer ey` and for `x-intake-secret`.
   **Both must be `[redacted]`.** This is card 1.57's forward half and it is the
   whole reason that commit exists.
8. **Card 1.43 is checkable now** — post to the inbound webhook with
   `INBOUND_EMAIL_WEBHOOK_SECRET`, which production has. Confirm `In-Reply-To`
   comes out bracketed. *(An earlier handoff of mine said this could not be checked
   without a mailbox. That was wrong.)*
9. **Reports load for a LEAD**, and the three new ones appear in the CSV.
10. **Read one `ROSTER_MISMATCH` log line if any appears.** It now prints
    `memberTeamIds`. **Card 1.55's root cause is still open** and this line is what
    closes it — production was warning 186 times a day for three accounts that hold
    correct roster rows, and nobody yet knows why the array is empty. **Copy the
    line into your report.**

## Stop and report if

- `prisma migrate status` shows anything pending other than 58.
- Any trigram index is missing afterwards.
- A resolved email goes out with **some** links rather than seven or none — the
  code says that cannot happen, and if it does the assumption behind P1 is wrong.
- A bare `GET` of an email link changes a ticket.
- `Bearer ey` still appears in the log after the deploy.
- The firewall rule has to be widened beyond a single IP to get the migration
  through.
