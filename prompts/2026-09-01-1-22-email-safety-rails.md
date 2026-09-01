# Implementation Prompt — 1.22 Email safety rails

**Date:** 2026-09-01
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.22 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** nothing. This card ships no feature. It exists so that the first email
this system ever sends cannot start a loop, leak an internal note, reach an
outside address, or arrive as an unreadable wall of quoted text.

**Cost:** none. API only. **No schema, no migration, no Azure change, no new dependency.**

> **This card is a gate.** Card 1.23 turns sending on. **1.23 must not be started
> until this is GREEN and deployed.** Everything here is cheap now and expensive
> after the first bad email reaches a real person.

---

## 1. Goal

Six guards, none of which exist today. After this card, sending is still off —
but when it goes on, the failure modes are already closed.

## 2. Context read

- `CLAUDE.md` — baselines **272 unit (32 suites), 428 integration + 1 skipped, 58 web (16 files)**.
- `docs/agent-context/repo-landmines.md` (all), `docs/agent-context/working-agreement.md`, `.cursorrules`.
- **`C:\Users\PHulgur\Downloads\learningms\apps\lms\server\email\mailer.ts`** — the
  reference implementation for the pilot switch. Read its header comment; the
  reasoning is written down there and it is the reasoning we are adopting.

## 3. Facts established first (verified 2026-09-01)

| Fact | Consequence |
|---|---|
| `notifications/email.service.ts` is the **only** place that calls `transporter.sendMail`. It throws `'SMTP not configured'` when `SMTP_HOST` is unset, which is the case in production today (the setting is named `SMTP_HOST_DEV_DISABLED`). | One chokepoint. Every guard in this card belongs at or above it, so nothing can route around them. |
| `NotificationsService` has six `queueEmails` call sites and a `messageAdded(...)` method; mail goes out through an Outbox + `email-queue.service.ts` + `email-processor.service.ts`. | Guards that need to inspect *recipients* go in the queue/processor path; guards about *content* go where the body is built. |
| `MessageType` is `PUBLIC | INTERNAL` (`schema.prisma`). `TicketsService.addMessage` takes the type from the caller. | The internal-note guard has a clean discriminator. There is no ambiguity to resolve. |
| **No quote trimming exists anywhere.** Grep for `wrote:`, `-----Original`, `stripQuote` across `apps/api/src` returns only `notifications.service.ts:558`, which *writes* an attribution line — it does not strip one. | Task 1 is genuinely new code. |
| **No auto-reply or loop detection exists.** Grep for `Auto-Submitted`, `X-Auto-Response-Suppress`, `Precedence`, `autoreply` across `apps/api/src` returns nothing. | Task 2 is genuinely new code. |
| `tickets/inbound-email.service.ts` already dedupes on `messageId` via `InboundEmailReceipt` (unique), threads by three methods, finds-or-creates the sender, and auto-reopens RESOLVED/CLOSED tickets. | **Do not touch any of that.** This card adds guards *around* it. |
| The LMS pilot switch reads `REPORT_TEST_RECIPIENTS` **on every call** rather than at module load, deliberately, so an operator can flip it between runs without a restart. Its invariant is that the intended list is *replaced*, never merged — and that is pinned by a test. | Copy the pattern **and** the test. |

## 4. Decisions and assumptions

Three of these come from the owner on 2026-09-01 and are in the decisions log —
they are not yours to revisit:

1. **Internal only.** A recipient whose address is not `@csnhc.com`
   (case-insensitive, after trim) is **refused**, and the refusal is **recorded on
   the ticket** as an event — not logged and forgotten. The domain is config
   (`EMAIL_ALLOWED_DOMAINS`, comma-separated, default `csnhc.com`) so relaxing it
   later is a setting, not a deploy.
2. **From line** is `<Agent Display Name> (CSNHC Helpdesk) <helpdesk@csnhc.com>`,
   with a per-team fallback to the generic `CSNHC Helpdesk` identity. **In this
   card, build only the formatter and its config** — nothing sends yet. Follow the
   LMS rule that the display name lives in code and only the address is env.
3. **Six-month rule** belongs to card 1.24, not here. Ignore it.

And four that are mine, with reasons:

4. **The internal-note guard is a hard invariant, not a code path.** Do not merely
   avoid queueing internal notes — make it impossible. The function that turns a
   ticket message into an outbound email must **refuse** an `INTERNAL` message and
   throw, and a test must assert that refusal directly. If a future card wires the
   send path up carelessly, it should fail loudly in CI rather than quietly email
   an internal note to a requester. This is the single highest-consequence line in
   the epic.
5. **Quote trimming keeps the original.** Strip for *display*, never for storage —
   the full inbound body stays on the record. Cut at the first confident marker
   (`On <date> ... wrote:`, `-----Original Message-----`, `_____` block,
   `From: ... Sent: ...`, and the `Reply above this line` marker this card
   introduces), and if no marker is found, **keep the whole thing**. A trimmer that
   guesses is worse than one that occasionally leaves quoted text.
6. **Loop protection is two layers.** Headers first (`Auto-Submitted` anything but
   `no`, `X-Auto-Response-Suppress` present, `Precedence: bulk|junk|list`, a
   `List-Id`, or an empty `Return-Path`), then a **rate cap** as the backstop: more
   than **5 inbound messages from one sender on one ticket within 5 minutes** →
   accept-and-record but do not trigger any outbound. Never bounce, never reply to
   a `no-reply`/`noreply`/`donotreply` address.
7. **Bounce suppression is a table-free stub in this card.** Recording bounces
   properly needs somewhere to put them, and this card has no schema change. Build
   the *check* (`isSuppressed(email)`) with an in-memory store plus a clear
   `TODO(1.23)` naming what a durable version needs. Say so in the report. **Do not
   add a migration to this card** — an additive migration goes with the card that
   actually needs it.

## 5. The work

Kill stray node processes; Postgres up; no other test run active; export the
consent variable for the whole integration run.

### Task 1 — Quote trimming

**Files:** Create `apps/api/src/notifications/quoted-reply.util.ts`, `apps/api/src/notifications/quoted-reply.util.spec.ts`

- [ ] One export: `stripQuotedReply(body: string): string`. Pure, no dependencies.
- [ ] Markers per §4.5, most-specific first. Preserve the text **above** the marker,
      trim trailing whitespace, and return the original when nothing matches.
- [ ] Also strip a trailing signature block only when it is unambiguous
      (`-- ` on its own line, the RFC delimiter). **Do not** try to detect
      "Sent from my iPhone" or corporate disclaimers by guesswork; leave them.
- [ ] Unit tests: an Outlook `From:/Sent:/To:/Subject:` block; a Gmail
      `On Mon, 1 Sep 2026 at 11:42, Sarah Chen <...> wrote:`; `-----Original
      Message-----`; the `Reply above this line` marker; the `-- ` signature
      delimiter; **a body with no marker at all comes back byte-identical**; a body
      that is *only* a quote does not come back empty (fall back to the original).

### Task 2 — Inbound loop protection

**Files:** Modify `apps/api/src/tickets/inbound-email.service.ts`, `apps/api/src/tickets/dto/ingest-inbound-email.dto.ts`; Create `apps/api/src/tickets/auto-reply.util.ts` + spec

- [ ] DTO gains optional pass-through headers the receiver can supply:
      `autoSubmitted`, `autoResponseSuppress`, `precedence`, `listId`,
      `returnPath`. All `@IsOptional()`, all `@MaxLength`. **Additive only** — the
      existing webhook contract must keep working with none of them present.
- [ ] `auto-reply.util.ts`: one export, `isAutomatedEmail(headers): boolean`, per
      §4.6 layer one. Pure and unit-tested.
- [ ] In `ingestInboundEmail`: an automated message is **still recorded** (the
      ticket should show that an out-of-office arrived) but must not trigger any
      outbound notification. Add a `TicketEvent` saying so.
- [ ] Rate cap per §4.6 layer two, counted from `InboundEmailReceipt` rows —
      `fromEmail` + the resolved ticket + a 5-minute window. **No new table.**

### Task 3 — The internal-note invariant and the recipient guard

**Files:** Create `apps/api/src/notifications/outbound-recipients.util.ts` + spec, `apps/api/src/notifications/from-identity.util.ts` + spec

- [ ] `outbound-recipients.util.ts`, one export:
      `resolveOutboundRecipients(input): { allowed: string[]; refused: {address, reason}[] }`.
      Filters by `EMAIL_ALLOWED_DOMAINS` (§4.1), drops `no-reply`-style addresses
      (§4.6), and drops suppressed addresses (§4.7). **Returns the refusals** — the
      caller records them on the ticket; nothing is silently dropped.
- [ ] The internal-note refusal per §4.4. Put it where a ticket message becomes an
      outbound payload, throw a named error, and test the throw directly.
- [ ] `from-identity.util.ts`: one export building the §4.2 From line, with the
      per-team generic fallback. Display name in code, address from
      `SMTP_FROM`. Unit-test both shapes and a display name containing a comma or a
      quote (it must be RFC-quoted, not concatenated raw).

### Task 4 — The pilot switch

**Files:** Modify `apps/api/src/notifications/email.service.ts`; Create `apps/api/src/notifications/email.service.spec.ts` if absent

- [ ] `EMAIL_TEST_RECIPIENTS`, comma-separated, **read on every call** (§3, last row).
- [ ] When set, the recipient list is **REPLACED**, never merged or appended, and
      the body gains one line naming who it would have gone to.
- [ ] Add the `Reply above this line` marker to the outbound body builder so
      Task 1 has something to cut on.
- [ ] **Pin the invariant with a test**: while `EMAIL_TEST_RECIPIENTS` is set,
      there is no input for which an intended recipient reaches `sendMail`. Copy
      how the LMS test is written.

### Task 5 — Integration tests

**Files:** Create `apps/api/test/integration/email-safety.spec.ts`

- [ ] An inbound email carrying `Auto-Submitted: auto-replied` lands on the ticket
      and raises **no** notification; the ticket shows why.
- [ ] The 6th message from one sender within 5 minutes is recorded but triggers
      nothing.
- [ ] A quoted reply arrives; the stored body is complete and the displayed body is
      trimmed.
- [ ] An inbound email with **no** new headers behaves exactly as before this card
      (the additive-DTO proof).
- [ ] Run alone, then the **full** suite. **Do not edit source during the full run**
      — it resets the database and reloads modules; a mid-run edit once produced 81
      phantom failures here.

### Task 6 — Docs, baselines, commit

- [ ] `docs/integration-intake-api.md` or a new `docs/email-conversation.md`: the
      new env vars (`EMAIL_ALLOWED_DOMAINS`, `EMAIL_TEST_RECIPIENTS`) and what each
      guard does. **State plainly that sending is still off after this card.**
- [ ] `apps/api/.env.example` — the two new vars, commented, with safe defaults.
- [ ] `CLAUDE.md` + `repo-landmines.md` baselines, real numbers.
- [ ] Commit by explicit path after reading `git status --short`. **`e2e/` is
      untracked on purpose; leave it.**

## 6. Files expected to change

`notifications/quoted-reply.util.ts` + spec (new) ·
`notifications/outbound-recipients.util.ts` + spec (new) ·
`notifications/from-identity.util.ts` + spec (new) ·
`tickets/auto-reply.util.ts` + spec (new) ·
`notifications/email.service.ts` (+ spec) · `tickets/inbound-email.service.ts` ·
`tickets/dto/ingest-inbound-email.dto.ts` ·
`test/integration/email-safety.spec.ts` (new) · `apps/api/.env.example` ·
a doc · `CLAUDE.md` · `repo-landmines.md`.
**Nothing under `apps/web`. No `prisma/` change.**

## 7. Security considerations

This card *is* the security work, so treat every item as load-bearing:

- **An `INTERNAL` message reaching an outbound payload must throw** (§4.4). Not a
  warning, not a skip — throw, and prove it with a test. The worst outcome of this
  epic is an internal note in a requester's inbox.
- **Refusals are recorded on the ticket, never silent.** An agent must be able to
  see that their message did not reach someone.
- **The domain allowlist is a guard, not a hint.** It belongs in
  `resolveOutboundRecipients`, above the transport, so no future caller can bypass
  it by calling `sendEmail` directly.
- **The pilot switch must be impossible to half-apply.** Replaced, never merged.
- **Do not log recipient addresses or message bodies** at info level. The existing
  logger conventions apply.
- Trimming is display-only; the full inbound body stays on the record for audit.

## 8. Acceptance criteria

1. An `INTERNAL` ticket message cannot be turned into an outbound email — the
   attempt throws, and a test asserts it.
2. A recipient outside the allowed domain is refused, and the refusal is visible on
   the ticket.
3. With `EMAIL_TEST_RECIPIENTS` set, no intended recipient can reach `sendMail`
   under any input — pinned by a test.
4. An auto-reply is recorded and triggers nothing.
5. A sender exceeding the rate cap is recorded and triggers nothing.
6. A quoted reply displays trimmed; the stored body is unchanged and complete.
7. A body with no quote marker is returned byte-identical.
8. **Inbound email with none of the new headers behaves exactly as it does today.**
9. `/api/health/ready` still reports SMTP as not configured — **this card sends
   nothing.**
10. Both `tsc` clean; unit and full integration at or above baseline; vitest
    unchanged (no web change).

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx jest --config ./test/jest.integration.json test/integration/email-safety.spec.ts > ../../it-email.txt 2>&1; grep Tests: ../../it-email.txt
npx jest --config ./test/jest.integration.json test/integration/inbound-email.spec.ts > ../../it-inbound.txt 2>&1; grep Tests: ../../it-inbound.txt
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit
```

The existing inbound-email spec matters most: this card must not change how the
webhook already behaves.

## 10. Manual test steps

No browser needed. Dev API on `PORT=3077` with
`AUTH_ALLOW_INSECURE_HEADERS=true` and `INBOUND_EMAIL_WEBHOOK_SECRET` set.

`curl` the inbound webhook with: a plain reply; the same reply carrying
`Auto-Submitted: auto-replied`; a reply whose body is a real Outlook quote block;
six replies in a minute from one sender. After each, read the ticket's timeline
and confirm what was recorded and what was suppressed.

Then set `EMAIL_TEST_RECIPIENTS` and confirm `/api/health/ready` still says SMTP
is not configured — nothing should be sendable either way at this point.

Stop the server; zero repo node processes. A service on port 3000 is the *LMS* —
leave it alone.

## 11. Handoff notes — what to report back

1. Commit SHA. 2. Every `Tests:` line (unit, email-safety, inbound-email, full
integration), both `tsc`. 3. `git diff --stat HEAD~1`. 4. The manual curl results,
including one trimmed body next to its stored original.
5. Anything that did not match, specifically: where you put the internal-note
refusal and why that is the true chokepoint; what the bounce stub needs to become
durable (§4.7); whether any existing inbound behaviour had to change to fit the
guards in; and any quote format you found that the trimmer handles badly.

**Stop and report instead of improvising** if this appears to need a schema
change, a migration, a web change, or an Azure change. None should be necessary —
and if a migration turns out to be genuinely needed for bounces, that is a
finding for the planner, not something to slip into this card.
