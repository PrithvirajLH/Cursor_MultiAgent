# Deploy Handoff — the six-card batch

**Date:** 2026-09-08
**Branch:** `ui-redesign-and-api-hardening`
**Verdict:** **GREEN** — all six cards verified independently by the planning
session on 2026-09-08. Every number below was re-run here, not taken from the
implementer's report.

**Production is at `f48452b`. The last code commit is `15d2179`.** Migration
**58** is the only schema change.

⚠️ **HEAD is ahead of `15d2179` by documentation-only commits** (this handoff, the
board, `CLAUDE.md`). **Ship HEAD, and stamp `DEPLOYED_COMMIT_SHA` with whatever
you actually shipped** — not with `15d2179`, and not with a value you carried over
from a previous deploy. Confirm the two are the same afterwards; a wrong stamp is
how the last board rot started. Verify before you build that no *code* commit has
landed since `15d2179`:

```
git log --oneline 15d2179..HEAD    # expect docs only
```

---

## ⚠️ Three prerequisites. Two of them are not in the implementer's report.

The implementer flagged one. The planner found two more while verifying. **Any one
of the three missing means the deploy either fails outright or silently ships a
feature that does nothing.**

### P1 — This machine cannot reach the production database right now

`prisma migrate deploy` will fail before it does anything:

```
Can't reach database server at csh-ticketing-db.postgres.database.azure.com:5432
```

> ⚠️ **Sensitivity: this section is deliberately vague and must stay that way.**
> Two of this repo's remotes are **public**. Which addresses are allow-listed on
> a production database is not something to write down here, so they are masked
> below. Read the live values at deploy time with the two commands given.

Verified 2026-09-08. The server has two laptop rules, `dev-laptop-20260501`
(`4.7.x.x`) and `dev-laptop-20260828` (`107.131.x.x`), alongside the two
Azure-services rules. **This machine's current public IP (`12.179.x.x`) matches
none of them.**

```
az postgres flexible-server firewall-rule list --resource-group csnhc-ai \
  --name csh-ticketing-db -o table     # what is allowed
curl -s https://api.ipify.org           # where you are calling from
```

**✅ Owner approved this on 2026-09-08** (*"allow IP list current"*). The planner
could not run it — Azure resource writes are blocked by the auto-mode classifier,
the same way production database writes are — so **the owner runs the command
below with `!`**. If the rule is already present when you read this, that step is
done; confirm rather than re-create it.

Two ways forward:

- Add a firewall rule for the current IP. **What it changes:** one inbound
  allow-rule on `csh-ticketing-db`. **Blast radius:** that IP can reach the
  production database on 5432; nothing else changes. **Reversible:** yes, delete
  the rule. **Cost:** none. The command, for the owner to run and not the agent:

  ```
  IP=$(curl -s https://api.ipify.org)
  az postgres flexible-server firewall-rule create --resource-group csnhc-ai \
    --name csh-ticketing-db --rule-name dev-laptop-20260908 \
    --start-ip-address "$IP" --end-ip-address "$IP"
  ```

- Or run the deploy from a network that already has a rule.

**Also worth doing either way:** those two laptop rules are standing inbound
paths to the production database from addresses that may no longer be yours — a
home or office IP that has since been reassigned now belongs to a stranger.
Pruning the ones you no longer use is a separate decision; flagging it, not
doing it.

### P2 — Production has no signing secret, so all seven links vanish

`emailActionSecret()` reads `EMAIL_ACTION_SECRET`, falls back to
`AUTH_JWT_SECRET`, then returns `null`
(`apps/api/src/email-actions/email-action-link.util.ts:27-33`).

**Production has neither.** Verified 2026-09-08 — the only secret-ish settings on
`TicketTicket` are `AZURE_CLIENT_SECRET`, `INBOUND_EMAIL_WEBHOOK_SECRET`,
`INTAKE_API_SECRET`, `MICROSOFT_PROVIDER_AUTHENTICATION_SECRET`. There is no
default anywhere in the code; `AUTH_JWT_SECRET` is set only inside tests.

The code degrades **gracefully and invisibly**: `buildResolvedEmailLinks` is
documented as *"all seven or none — if signing is not configured, the email keeps
its shape without them."* So card 1.44 would deploy, raise no error, log nothing
at send time, and **every resolved email would go out with none of the seven
links.** It would look exactly like the feature not having been built.

**Set a secret before or with the deploy.** A fresh random value is better than
reusing the JWT secret even though the token is domain-separated
(`email-action.v1:`), because rotating one should not invalidate the other:

```
az webapp config appsettings set --name TicketTicket --resource-group csnhc-ai \
  --settings EMAIL_ACTION_SECRET="<a fresh 32+ byte random string>"
```

⚠️ **Generate it outside the repo and do not paste it into a file here.**
Rotating it later invalidates every link already emailed — which is acceptable,
but means it should be set once and left alone.

`WEB_APP_URL` **is** set in production, so the link base URL is fine. Without it
the fallback is `http://localhost:3001`, which is worth knowing but is not a
problem today.

### P3 — Easy Auth must exclude the new path

**This is the one the implementer flagged, and it is correct.** The routes are
`@Public()`, which clears only the app's own guard. Production sits behind Easy
Auth with `unauthenticatedClientAction: RedirectToLoginPage`, so:

**Add `/api/email-actions` to `globalValidation.excludedPaths` in
`authsettingsV2`**, beside `/api/tickets/inbound-email` and
`/api/tickets/intake`. Without it every link returns 401.

---

## What is shipping

| Card | Commit | What a person will notice |
|---|---|---|
| 1.43 | `14e6a17` | An acknowledgement email's `In-Reply-To` is now bracketed per RFC 5322, so a strict client threads the reply onto the existing ticket instead of opening a new one. **Dormant until inbound email is live** (card 1.24). |
| 1.18 | `75506ef` | A half-written reply now remembers whether it was public or an internal note — not just its text. |
| 1.17 | `0c5a90e` | Three new desk reports: first-contact resolution, reassignment count, time in status. In the CSV export too. |
| 1.12 | `9b6c540` | Tag or run a macro across a selection of tickets, with per-ticket outcomes: *"3 updated, 1 could not be."* |
| 1.11 | `8f2e002` | An agent can remove a message that should not have been sent. **Migration 58.** |
| 1.44 | `98706ca` + `15d2179` | The resolved email gets seven one-click links — close, reopen, and five rating stars. One click, no sign-in, no mail app. |

`ce46bc2` and `01563aa` are documentation.

## Migration 58 — `20260904200000_ticket_message_redaction`

**Verified by the planner, not taken on trust:** two nullable columns, one index,
one `ON DELETE SET NULL` foreign key, on one table. **Zero executable `DROP`
statements** — a case-insensitive grep matches three times and all three are
inside the header comment documenting the twelve destructive statements Prisma
emitted and the implementer removed (six `DROP INDEX` for the trigram GIN
indexes, six `ALTER COLUMN … DROP DEFAULT`).

**No enum is touched**, so this carries none of the
enum-value-in-the-same-transaction hazard that migrations 54 and 56 documented.

**Production should be at 57 going in, 58 coming out.** I could not confirm the
applied count from here — see P1 — so **`npx prisma migrate status` is the gate**:
if anything other than `20260904200000_ticket_message_redaction` is pending,
**stop and report** rather than applying.

Per the standing rule: **apply to the Supabase dev database before production.**
The implementer already did (their report says so, and the local integration run
here proves 58 is applied there).

## Numbers, re-run by the planner on 2026-09-08

| Check | Result | Previous baseline |
|---|---|---|
| `apps/api` `tsc --noEmit` | **0 errors** | 0 |
| `apps/api` unit | **510 / 50 suites** | 480 / 48 |
| `apps/api` integration | **680 passed + 1 skipped, 66 of 67 suites** | 617 + 1, 62 of 63 |
| `apps/web` `tsc --noEmit` | **0 errors** | 0 |
| `apps/web` vitest | **175 / 28 files** | 158 / 26 |

Every figure matches the implementer's report exactly. `CLAUDE.md` has been
updated to these.

## After the deploy — what to check, and what cannot be checked

**Check, in this order:**

1. **`DEPLOYED_COMMIT_SHA` reads the commit you actually shipped** (HEAD at build time, not `15d2179`, which is only the last code commit).
2. **`prisma migrate status` reports 58 applied and nothing pending.**
3. **The six trigram indexes are still there** — the standing check after every
   migration.
4. **A resolved email actually contains seven links.** This is the P2 check and
   the only way to know the secret took effect. Resolve a real ticket, read the
   outbox row, and count the links. **Seven or none — if it is none, the secret
   is not set and nothing else about 1.44 is worth testing.**
5. **Click one star, once.** Confirm the rating stores and the page says nothing
   about the ticket.
6. ⚠️ **The scanner check, in production:** `curl` a link with a bare `GET` and
   confirm the ticket does not change. It is asserted by an integration test that
   reads the database rather than the response, but this is the failure that
   would auto-confirm every resolved ticket, so it is worth one live `curl`.
7. **Reports load for a LEAD**, and the three new ones appear in the CSV.

**Cannot be checked after this deploy, and should not be claimed:**

- **Card 1.43 stays dormant.** No mailbox feeds the inbound webhook, so nothing
  exercises the bracketed `In-Reply-To`. It is on card 1.24's checklist.
- The redaction caveat's *"already emailed to N people"* count needs a message
  that was genuinely emailed to more than one person — possible, but only after
  there is real requester traffic.

## Two things the owner should know before staff are told about 1.11

Both are recorded as cards. Neither blocks this deploy.

- **Card 1.47.** Redaction clears the message from the conversation. It does
  **not** clear the copy in `NotificationOutbox.body`, which holds the rendered
  email including the message text — and the retention job that would delete
  those rows is off. So for a message that was already emailed, the words are
  still in our own database. The caveat shown to the agent is honest about the
  email having been sent; nobody has been told the send record also keeps it.
- **Card 1.48.** Redaction removes a message **body**, not an **attachment**. If
  the wrong patient's document arrived as a file, it stays. That is the more
  likely way a document lands on the wrong ticket, and *"remove a message that
  should not have been sent"* is what staff will reach for.

## Stop and report if

- `prisma migrate status` shows anything pending other than migration 58.
- Any trigram index is missing after the migration.
- A resolved email goes out with **some** links rather than seven or none — the
  code says that cannot happen, and if it does, the assumption behind P2 is wrong.
- A bare `GET` of an email link changes a ticket.
- The firewall rule in P1 has to be widened beyond a single IP to get the
  migration through.
