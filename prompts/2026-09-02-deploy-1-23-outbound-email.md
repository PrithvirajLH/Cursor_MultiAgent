# Deploy Handoff — card 1.23, outbound email

**Date:** 2026-09-02
**For:** the deploy-agent session
**Repo:** `Ticketing System Quality Review`, branch `ui-redesign-and-api-hardening`
**Ship:** branch **HEAD**. The last commit that changes anything shippable is
**`ecfd3c4`**; everything after it is documentation.
**Production is currently on:** `1ffe722` (deployed 2026-09-01 21:11 UTC)

**Planner verdict: GREEN** (`48764c9`). Verified independently: api tsc 0, unit
**344/39**, full integration **446 + 1 skipped, 50 of 51**, web tsc 0, vitest
**70/18 unchanged**, `check-migrations.sh` **ok** naming the new file, exit 0.

---

## 1. This one is different from the last deploy

The batch on 2026-09-01 was a plain deploy. **This one has two things that one
did not**, and both can go wrong:

1. **A migration.** The 52nd. Additive — one table, three statements — but it
   must be applied in the right order and to the right places.
2. **Nine App Service settings** that switch email from "cannot send" to "can
   send". They are **the last step, not part of the deploy**, and §5 exists
   because applying them early is the way to get this wrong.

**Nothing sends until §5.** Deploying this card alone changes no outward
behaviour: `/api/health/ready` will still report `smtp: "missing"` afterwards,
and that is the correct result, not a fault.

## 2. Why the order is load-bearing

Production runs `1ffe722`, which **does not contain 1.23** (verified with
`git merge-base --is-ancestor`). Two consequences:

- **`requireTLS` ships in this card.** Setting `SMTP_HOST` against the *current*
  build means nodemailer can fall back to plaintext on port 587 and put the
  SocketLabs password on the wire. The settings must not be applied before the
  code is live.
- **The code expects the `EmailSuppression` table.** That is migration 52.
  Applying it after the app restarts leaves a window where the suppression check
  queries a table that does not exist.

Card 1.22's guards **are** already live in `1ffe722`, so the safety gate is
satisfied. It is only the valve that has to wait.

## 3. Migration 52 — read this before applying it

`20260901180000_email_suppression/migration.sql`. Additive: one `CREATE TABLE`,
two `CREATE INDEX`, nothing else. The planner read it line by line; every `DROP`
and `trgm` mention in the file is inside a **comment** explaining what was
stripped out.

Context worth having, from `repo-landmines.md`:

- `prisma migrate diff` emitted **twelve** destructive statements alongside this
  table — six `DROP INDEX` on the trigram GIN indexes and six
  `ALTER COLUMN … DROP DEFAULT`. All were removed by hand. This is standing
  drift Prisma cannot model; it will reappear on every future generate.
- **Apply to local dev (Supabase) before Azure**, or local development breaks for
  whoever works next. That is standing guidance, not specific to this card.
- **`prisma migrate deploy`**, never `migrate dev` — the latter cannot run
  non-interactively at all.

Expected: `prisma migrate status` reports **52** afterwards. Production is on 51
now.

## 4. Deploy

Follow `docs/DEPLOYMENT.md`.

1. **Migration to Supabase (local dev) first.** `prisma migrate deploy`.
2. **Migration to Azure Postgres**, then the app restart — migration before app,
   per the runbook.
3. **Package and deploy**: build with `create-deploy-zip.ps1`, then push with

   ```bash
   az webapp deploy -g csnhc-ai -n TicketTicket --type zip --async true --src-path <zip>
   ```

   **Do NOT run `deploy-to-azure.ps1`.** `docs/DEPLOYMENT.md:38` forbids it: the
   package is ~169 MB and its Kudu zipdeploy dies with **502**, which tells you
   nothing — on 2026-05-21 a 502 left production untouched on a months-old build
   while looking like something had happened. (This correction is the planner's:
   four consecutive handoffs of mine named the wrong command, and the deploy
   agent corrected it every time. The stale planner memory behind it is now
   fixed.) **Never push to the `azure` git remote** either — Oryx rebuilds and
   breaks the flat `wwwroot` layout.
4. Kill stray node processes before building, or the Prisma query engine stays
   held and the build dies with `EPERM`. **Port 3000 is the LMS — leave it.**

### Post-deploy checks, before any settings change

1. Deployed asset hash matches the package you built.
2. `prisma migrate status` → **52**. The **six trigram GIN indexes still
   present** — this is the deploy where that check earns its keep.
3. `/api/health/ready` → **`smtp: "missing"`**. Expected. The code is live, the
   valve is shut.
4. Container log clean on startup — no error about a missing `EmailSuppression`
   table.

**Stop here and report.** §5 is a separate, owner-approved step.

## 5. Switching sending on — owner approval, line by line

**Do not run any of this without reading each line to the owner and getting a
yes.** These are App Service configuration changes.

**Three values the owner must supply.** The deploy agent does not have them and
should not go looking:

| | Needed | Note |
|---|---|---|
| a | **SocketLabs user + password** | From the LMS's settings, or a new SocketLabs Server if one was created. **Never** paste these into a commit, a report, or this file. |
| b | **The from / reply-to address** | `helpdesk@csnhc.com` unless SocketLabs restricts which addresses the account may send as — worth confirming with whoever owns that account first. |
| c | **The owner's own email address** | For `EMAIL_TEST_RECIPIENTS`. |

**All nine keys in one change.** There must never be a moment where SMTP is on
and the pilot list is empty:

| Setting | Value |
|---|---|
| `SMTP_HOST` | **create it** — value `smtp.socketlabs.com`. **There is nothing to rename.** An earlier version of this file said to rename `SMTP_HOST_DEV_DISABLED`; that key lives in the local `apps/api/.env`, **not** on the App Service, which the deploy agent confirmed by listing all 38 settings. The only mail-related key there is `INBOUND_EMAIL_WEBHOOK_SECRET`. |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` — this is STARTTLS. `true` belongs to port 465 and will hang the handshake |
| `SMTP_USER` | (a) |
| `SMTP_PASS` | (a) |
| `SMTP_FROM` | (b) |
| `SMTP_REPLY_TO` | (b) |
| `EMAIL_ALLOWED_DOMAINS` | `csnhc.com` |
| `EMAIL_TEST_RECIPIENTS` | (c) — **in this same change** |

### Then verify, in this order

1. `/api/health/ready` → `smtp: "configured"`.
2. **On a real ticket, post a public reply as an agent.** Expect **exactly one
   email, in the owner's inbox, and nowhere else.** Check:
   - the body begins with the `----- Reply above this line -----` marker;
   - `Reply-To` is `helpdesk+ticket-<token>@…`, not the bare desk address;
   - the From line reads `CSNHC Helpdesk <…>`. **The agent's name will *not*
     appear — that is card 1.31, not a fault.** See §6.
   - the body names who it would have gone to (the pilot switch says so).
3. **Post an internal note on the same ticket.** The requester must receive
   **nothing**. If an internal note reaches an inbox, **stop everything and
   report** — that is the highest-consequence failure in this epic.
4. Container log: no SMTP error, no repeated retry.

**Leave `EMAIL_TEST_RECIPIENTS` set.** Clearing it is what makes real requesters
reachable, and that is a deliberate later decision, not part of this deploy.

## 6. Known and deliberate — do not "fix" these

- **The From line shows the generic `CSNHC Helpdesk`, not the agent's name.**
  The owner chose the agent's name, but it cannot be built from `EmailService`
  alone: the outbox payload carries only `{messageId, type}`, so neither actor
  nor team reaches the send path. Card **1.31**. HR and Payroll were always meant
  to get the generic identity, so they already have their intended behaviour.
- **Asynchronous bounces are not captured.** Suppression works from failures
  nodemailer reports at send time. A SocketLabs bounce webhook needs a public
  endpoint, an Easy Auth exclusion and a shared secret — its own card, still
  owed.
- **No reply can come back into a ticket yet.** That is card 1.24, and it needs
  the helpdesk mailbox, plus-addressing confirmed, and a Graph permission the
  owner has been asked to request. Outbound working is the whole of this
  milestone.
- **`e2e/` is untracked on purpose.** Leave it out of the package.

## 7. What to report back

1. Deployment id, timestamp, the SHA shipped.
2. `prisma migrate status` for **both** Supabase and Azure, and the trigram index
   check.
3. The four §4 checks — including `smtp: "missing"`, which is the expected
   result there.
4. Whether §5 was approved and run. If it was: the five §5 verification results,
   and **explicitly** whether the internal note stayed unsent.
5. **Do not include any credential, any recipient address beyond the owner's own,
   or any message body** in the report. Both GitHub remotes are public.
6. Anything that did not match this handoff. Earlier handoffs of mine have
   carried wrong commands and a stale premise; say so plainly if this one does.
