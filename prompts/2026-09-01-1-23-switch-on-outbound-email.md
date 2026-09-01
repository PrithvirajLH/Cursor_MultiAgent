# Implementation Prompt — 1.23 Switch on outbound email (SocketLabs)

**Date:** 2026-09-01
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.23 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** production cannot send email at all. Card 1.22 built the guardrails;
this card opens the valve — carefully, behind a switch that keeps every message in
the operator's own inbox until someone deliberately turns it off.

**Cost:** none. **One additive migration** (the first in a while — read §0).
API + one Azure configuration step.

> **1.22 must be GREEN and deployed before this card starts.** It is, as of
> 2026-09-01 (`48c0b74`). Do not start otherwise: this card makes mail sendable
> and 1.22 is what makes that safe.

---

## 0. Read this before you generate the migration

This repo has cost a day to this exact trap. From `repo-landmines.md`:

**`prisma migrate dev` emits `DROP INDEX` for six trigram GIN indexes it cannot
model.** Applying one unedited destroys ticket and knowledge-base search
performance against a stated sub-500 ms requirement.

So: generate the migration, then **hand-read it and delete every `DROP`
statement** until the file contains only `CREATE TABLE` / `CREATE INDEX` for the
new table. Then run `scripts/check-migrations.sh` and confirm it passes without
needing an `-- allow-drop:` opt-out. If it wants one, you have not finished
editing.

Production has **51** migrations. Yours is the **52nd**. It is additive only:
one new table, no column changed, no data moved.

---

## 1. Goal

Production can send email through SocketLabs, with `EMAIL_TEST_RECIPIENTS`
pointed at the owner so no real requester can be reached yet. `/api/health/ready`
reports SMTP `configured`. Bounced addresses stop receiving mail and stay stopped
across restarts.

## 2. Context read

- `CLAUDE.md` — baselines **326 unit (38 suites), 437 integration + 1 skipped, 70 web (18 files)**.
- `docs/agent-context/repo-landmines.md` — **all of it**, especially the migration section.
- `prompts/2026-09-01-1-22-email-safety-rails.md` and `docs/email-conversation.md` — what already exists.
- **`C:\Users\PHulgur\Downloads\learningms\apps\lms\server\email\mailer.ts`** — the
  working reference. Read the header comment before touching transport config.

## 3. Facts established first (verified 2026-09-01)

| Fact | Consequence |
|---|---|
| The LMS sends through **`smtp.socketlabs.com`**, port 587, `SMTP_SECURE=false`, and is proven in production (weekly reports to 170 facilities). Its `.env` carries `SMTP_HOST`, `_PORT`, `_USER`, `_PASS`, `_SECURE`, `_FROM`, `_REPLY_TO`. | This repo's `EmailService` reads **the same seven key names**. Outbound is a config copy, not a build. |
| Production's setting is named **`SMTP_HOST_DEV_DISABLED`** — someone renamed the key to switch sending off. | Renaming it back is the switch. No code needed for that part. |
| `EmailService` (`notifications/email.service.ts`) sets **neither `secure` nor `requireTLS`**. The LMS sets `requireTLS: !config.secure` with the comment *"STARTTLS is not optional on 587"*. | **A real security fix, and the only mandatory code change to the transport.** Without it nodemailer will fall back to plaintext if STARTTLS negotiation fails, putting the SMTP password on the wire. |
| The LMS keeps the display name in code (`FROM_NAME`) and only the address in env, deliberately. | Follow it. Card 1.22 already built `notifications/from-identity.util.ts` for this — **use it, do not write a second formatter**. |
| Card 1.22's bounce suppression is an **in-memory stub** with a `TODO(1.23)`. `resolveOutboundRecipients` already takes a `suppressed` list. | The seam exists. This card makes it durable. |
| `/api/health/ready` reports `smtp: this.email.isConfigured() ? 'configured' : 'missing'`. | Your acceptance signal, and the deploy agent's. |
| The LMS pools connections (`pool: true, maxConnections: 2`) because a 170-facility Monday would otherwise open 170 TLS connections. | This app sends through a queue, one at a time. **Pooling is not needed** — do not copy it without a reason. |

## 4. Decisions and assumptions

Owner decisions already made (in the decisions log, not yours to revisit):
internal-only recipients; From line `Agent Name (CSNHC Helpdesk)` with a generic
fallback for HR and Payroll; the address stays the desk address.

Mine, with reasons:

1. **The pilot switch is ON for this deploy.** `EMAIL_TEST_RECIPIENTS` is set to
   the owner's address as part of switching SMTP on, in the same change. There
   must never be a window where production can send and the pilot list is empty.
   Say so explicitly in the deploy note you write for §6.
2. **SocketLabs credentials: either shape works, and the card must not care.**
   The owner may supply a separate SocketLabs *Server* (its own credentials) or
   the LMS's credentials with a **different from-address**. Both are just env
   values — build nothing that assumes one. Record which was used in the report.
3. **`SMTP_REPLY_TO` points at the helpdesk mailbox**, not the from-address, so a
   reply is already aimed at the right place before card 1.24 exists. Per-message
   `replyTo` (the `+ticket-<token>` address) already overrides it —
   `EmailService.sendEmail` takes `payload.replyTo` and
   `ticket-email-thread.service.ts` supplies it.
4. **The bounce table stores state; it does not learn it from a webhook yet.**
   Writing bounces properly needs SocketLabs to POST to us, which means a new
   public endpoint, an Easy Auth exclusion and a shared secret — the same shape as
   the intake endpoint, and its own card. **This card writes a suppression row
   only from a failure nodemailer reports synchronously** (a rejected recipient on
   send). That catches the obvious cases and makes the table real; asynchronous
   bounces come later. **Do not build the webhook here** — say in the report that
   it is still owed.
5. **Hard versus soft.** Store the distinction, and only suppress on **hard**. A
   soft failure (mailbox full, greylisted) increments a count and suppresses at 5.
   Suppressing a full mailbox permanently on one failure would lose real mail.
6. **An operator must be able to clear a suppression.** A person whose address
   bounced once and was fixed must not be permanently unreachable with no way
   back. Owner-only endpoint, and surface it on the Operations page (1.21) if that
   is a small addition — if it is not, a documented `curl` is acceptable for now
   and better than nothing. Say which you did.

## 5. The work

Kill stray node processes; Postgres up; no other test run active; export the
consent variable for the whole integration run.

### Task 1 — The transport fix (do this first; it is the security one)

**Files:** Modify `apps/api/src/notifications/email.service.ts`

- [ ] Add `requireTLS: !secure` to the transporter, and a comment saying why —
      copy the LMS's reasoning, do not paraphrase it into something vaguer.
- [ ] Wire the From line through 1.22's `from-identity.util.ts`, including the
      per-team generic fallback. `sendEmail` currently sends a bare address.
- [ ] Do **not** add pooling (§3, last row).

### Task 2 — Durable suppression

**Files:** Create `apps/api/prisma/migrations/<timestamp>_email_suppression/migration.sql`; modify `apps/api/prisma/schema.prisma`, `apps/api/src/notifications/email.service.ts`; create `apps/api/src/notifications/email-suppression.service.ts` + spec

- [ ] Model: `EmailSuppression` — `id`, `address` (unique, store lowercased),
      `kind` (`HARD` | `SOFT` as a string, matching how `CustomField.fieldType`
      does it rather than adding an enum), `failureCount`, `lastReason`,
      `firstSeenAt`, `lastSeenAt`, `createdAt`, `updatedAt`.
- [ ] **Read §0 before generating.** Additive only. 52nd migration.
- [ ] Service: `isSuppressed(address)`, `recordFailure(address, kind, reason)`
      (upsert, increment, promote SOFT→suppressing at 5 per §4.5),
      `clear(address)`.
- [ ] `EmailService` passes the suppression list into `resolveOutboundRecipients`
      — the parameter already exists — and calls `recordFailure` when `sendMail`
      rejects a recipient.

### Task 3 — Clearing a suppression

**Files:** Modify `apps/api/src/operations/*` (or a small controller of its own)

- [ ] `OwnerGuard`. List suppressed addresses, and clear one. Per §4.6.
- [ ] Integration cases: owner can list and clear; TEAM_ADMIN and LEAD get 403.

### Task 4 — Tests

- [ ] Unit: `requireTLS` is set when `secure` is false; the From line uses the
      agent's name for a normal team and the generic identity for HR/Payroll; a
      hard failure suppresses immediately; a soft failure suppresses at the fifth;
      `clear` un-suppresses.
- [ ] Integration: a suppressed address is refused with the reason visible; a
      cleared address sends again. **Never let a test perform a real send** — the
      suite must not depend on SocketLabs being reachable. If any test would open
      a socket, stop and report rather than adding a network dependency.
- [ ] Run the targeted specs, then the **full** suite. **Do not edit source while
      it runs.**

### Task 5 — Docs, baselines, commit

- [ ] `docs/email-conversation.md`: the new variables, the suppression rules, how
      to clear one, and — plainly — that the pilot switch is on and what turning
      it off will mean.
- [ ] `apps/api/.env.example`: the SMTP block, commented, with **no real values**.
- [ ] `CLAUDE.md` + `repo-landmines.md`: baselines, and note the migration count
      is now 52.
- [ ] Commit by explicit path. **`e2e/` is untracked on purpose.**

## 6. The Azure step — for the owner and deploy agent, not the implementer

Write this out in your report as a ready-to-run checklist. **You do not run it.**

The seven `SMTP_*` values, `EMAIL_TEST_RECIPIENTS` set to the owner's address, and
`SMTP_HOST_DEV_DISABLED` renamed to `SMTP_HOST` — **all in one change**, per
§4.1. Then the 52nd migration **before** the app restarts, per the deploy runbook.

Every one of those is an App Service configuration change: **read each to the
owner and get a yes**, as with any Azure change.

## 7. Security considerations

- **`requireTLS` is the whole reason Task 1 comes first.** Without it the SMTP
  password can cross the wire in plaintext.
- **Never log an SMTP password, a recipient address at info level, or a message
  body.** The existing logger conventions apply.
- **`.env.example` gets key names only.** The LMS's real credentials must not
  appear in this repo, in a commit message, or in the report. Both GitHub remotes
  are public.
- **The pilot switch is the safety net for this entire card.** A deploy that turns
  SMTP on without it is the failure mode to design against, which is why §4.1
  makes them one change.
- The 1.22 guards — internal-note refusal, domain allowlist, no-reply refusal —
  must still hold. Their tests are the proof; do not weaken them to make a send
  path easier.

## 8. Acceptance criteria

1. `/api/health/ready` reports `smtp: "configured"` in production.
2. With the pilot list set, an agent's public reply produces **one email in the
   owner's inbox**, `Reply-To` is `helpdesk+ticket-<token>@…`, and the body starts
   with the reply-above marker.
3. The From line reads `<Agent> (CSNHC Helpdesk) <helpdesk@csnhc.com>` on a normal
   team and the generic identity on HR and Payroll.
4. A hard-failed address is refused on the next send, **and still refused after a
   restart** — that is the difference from 1.22's stub.
5. A soft failure alone does not suppress; five do.
6. An owner can list and clear suppressions; a lead cannot.
7. All 1.22 guards still pass untouched.
8. Migration is the 52nd, contains **no `DROP`**, and
   `scripts/check-migrations.sh` passes with no opt-out.
9. Both `tsc` clean; unit and full integration at or above baseline; **web vitest
   unchanged** (this card touches no web code unless Task 3 adds the Operations
   row).

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
bash ../../scripts/check-migrations.sh
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx jest --config ./test/jest.integration.json test/integration/email-safety.spec.ts > ../../it-email.txt 2>&1; grep Tests: ../../it-email.txt
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

Delete those two log files when you are done — they are gitignored but they sit at
the repo root where a deploy package is built.

## 10. Manual test steps

**Nothing in this card requires a real send, and you should not attempt one** —
production credentials are the owner's to apply.

Locally: point `SMTP_HOST` at a throwaway local catcher if you have one, or assert
the transporter's options directly in a unit test. Prove `requireTLS` is set,
prove the pilot list replaces recipients, and prove suppression survives a restart
by writing a row, restarting the API, and confirming the address is still refused.

Stop the servers; zero repo node processes. **Port 3000 is the LMS — leave it.**

## 11. Handoff notes — what to report back

1. Commit SHA(s). 2. Every `Tests:` line plus both `tsc` and the
`check-migrations.sh` result. 3. `git diff --stat`. 4. The migration file, in
full, in the report — it is the 52nd against a live database and the planner will
read every line.
5. The §6 Azure checklist, ready for the owner to approve line by line.
6. Anything that did not match, specifically: whether `prisma migrate dev` tried
to drop the trigram indexes (it is expected to — say what you removed); which
SocketLabs shape the owner supplied; whether the suppression clear went on the
Operations page or stayed a documented `curl`; and what the bounce webhook still
needs, since §4.4 leaves it owed.

**Stop and report instead of improvising** if: the migration cannot be made
additive; a test would need a real network send; or the From-line work turns out
to need changes inside `NotificationsService` rather than just
`EmailService`. None should be necessary.
