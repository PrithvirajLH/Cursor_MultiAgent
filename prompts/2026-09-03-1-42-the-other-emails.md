# Implementation Prompt — 1.42 Email is for people outside the system

**Date:** 2026-09-03 · **rewritten the same day after the owner's decision, see §0**
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** 1.42, and it **absorbs card 1.14** (satisfaction survey)
**Baseline:** production runs **`1e24dd6`** at schema **53**.

**Cost:** none. API only. **No schema, no migration.** Size **M**.

> **This is what stands between the owner and clearing `EMAIL_TEST_RECIPIENTS`.**
> Every email is redirected to the owner's inbox today. Nothing below reaches a
> real person until that is cleared, and it should not be cleared until this ships.

---

## 0. The owner's decision, 2026-09-03

> *"Let's only keep communication sent to the requester and CC'd people. Assignee,
> lead, owner all see the communication on the platform."*

**This replaces the first version of this card**, which was going to redesign
**ten** email types. Most of them should not exist. **Deleting an email beats
redesigning it.**

The planner argued for **one carve-out** and the owner kept it: **SLA alerts stay
email.** The reasoning is worth keeping, because it is the principle that decides
future cases:

> **An alert that only reaches someone already watching is not an alert.** The
> point of "this is about to breach" is to reach a lead who is *not* in the app —
> in a meeting, off the floor, 4pm on a Friday. In-app-only, the only person who
> sees it is the one who did not need telling.

The owner also asked that the **resolved** email keep going to the requester
**and carry the satisfaction rating**, which is card 1.14 folded in. That was
always the sensible shape: 1.14's widget already exists and nobody is ever sent to
it, so a separate survey email would have been a second email for the same moment.

## 1. The policy — what may send email after this card

| Email | Who | Keep? |
|---|---|---|
| **Public reply** | requester on `To`, assignee + followers on `Cc` | **Yes** — this is the whole point |
| **Inbound acknowledgement** | the sender | **Yes** — a requester's first impression |
| **Ticket created** | **requester only** | **Yes**, and **must not double up** with the acknowledgement (§3) |
| Ticket created → assignee, followers | — | **No** |
| **Status changed → RESOLVED** | **requester only** | **Yes**, carrying confirm / reopen / **rate** (§4) |
| Status changed → any other status | — | **No** |
| Assigned · Transferred | — | **No** |
| **SLA at risk · SLA breached** | team leads + on-call addresses | **Yes** — the carve-out |
| **Automation "notify" action** | whoever the rule names | **Yes** — an admin typed that address in deliberately |
| Internal note · mentions | — | Already no email |

**Ten types become five.** Every one that survives is either **to someone outside
the system** or **an escalation whose job is to reach someone not looking**.

## 2. What this depends on — say it out loud

**"They see it on the platform" assumes they are in the platform.** Payroll is the
only operating department; if a lead opens the app twice a day, an in-app-only
notification can leave a ticket unclaimed for hours.

**So this card makes card 1.16 (daily digest for leads) load-bearing**, not a
nice-to-have — *"leads read email, not dashboards."* The per-event internal emails
are being replaced by one digest, and the digest does not exist yet.

- [ ] **Do not build 1.16 here.** Just note in the report that this card increases
      its priority, so the owner can sequence it.

## 3. The duplicate that goes live with the mailbox

`TicketsService.create` fires `notifications.ticketCreated` (`:1504`), and
`create()` takes **no** suppression option (`:1272` — only
`skipRequiredCustomFields` and `tagSource`). The inbound path calls it and **then
separately queues its own acknowledgement** (`inbound-email.service.ts:320-348`).

So one inbound email will produce **two** emails back: "Ticket created" **and**
"We have received your request."

**Dormant today** — no mailbox feeds the webhook — and it goes live the day card
1.24 ships, alongside cards 1.40 and 1.29's unverified checks. Three latent things,
one trigger.

- [ ] Fix it here, since you are in this code. The acknowledgement is the better
      email of the two, so **suppress the created-email on the inbound path**
      rather than dropping the acknowledgement.
- [ ] Prefer an explicit option on `create()` over a flag read from somewhere
      else — `addMessage` already takes `{ suppressNotifications }`, so follow that
      shape.

## 4. The resolved email — confirm, reopen, and rate

**Everything needed already exists. Nothing new is required.**

| Fact (verified 2026-09-03) | Consequence |
|---|---|
| `CsatWidget.tsx` is rendered from `TicketSidebar.tsx:266`, and `POST /api/csat` + `GET /api/csat/:ticketId` work. | The rating works. **Nobody is ever sent to it** — that is the whole of card 1.14. |
| A rating is stored as a **`TicketEvent`** (`csat.service.ts:44`), not a dedicated table, and the service refuses a second one per ticket. | Fine for this card. Worth knowing that reporting on it is awkward — flag it for card 1.17, do **not** fix it here. |
| The CSAT endpoint uses `@CurrentUser` and is **not** `@Public`. | **A link, not a one-click star.** See below. |
| The resolved email already carries confirm / reopen lines. | You are adding a third action to an email that already has two. |

- [ ] Add a **"How did we do?"** line to the RESOLVED email linking to the ticket,
      where the rating widget already is. Single sensible sentence; this email
      already asks two things.
- [ ] **Do NOT build a public one-click rating endpoint.** It would mean an
      unauthenticated write whose authorisation is a token sitting in a forwardable
      email — exactly the hazard card 1.40 exists to avoid. Sign-in is SSO on a
      managed device, so the link costs the requester very little.
      **If response rates turn out poor, that is a later decision with a proper
      design, not a shortcut taken now.**
- [ ] Do not send a separate survey email. **Card 1.14 is closed by this card** —
      say so in the report.

## 5. The shape of the five survivors

The five that remain still carry the old body: `buildDefaultNotificationHtmlBody`
(`:1064`) has the **"View Ticket" hero button** (`:1095`) and the **"Best regards"
sign-off** (`:1099`), and `buildInboundAcknowledgementHtmlBody` (`:998`) has the
same (`:1050`, `:1052`). Neither has a preheader, so the inbox preview is
boilerplate.

Apply card 1.34's treatment, which the owner reviewed and chose:

- [ ] **Hidden preheader**, first in the body, carrying what actually matters for
      that email — not boilerplate. `buildPreheader` (`:954`) exists; reuse it.
- [ ] **Content first.** No heading restating the subject.
- [ ] **Delete the hero button**; a plain `view online` text link.
- [ ] **Delete the sign-off.** The From line already says who it is, and since card
      1.31 it names the agent.
- [ ] **No raw status enum, ever.** If a status must appear, use the human-readable
      mapping the UI uses (`tickets.service.ts:146`).
- [ ] Keep `escapeHtml` on every interpolation, preheader included, and the quoted
      font stack.
- [ ] **Do not touch** the subject builders, card 1.22's guards, card 1.33's
      recipient model for replies, or the threading headers. If a test of theirs
      goes red, **stop**.

## 6. Order of work

1. **Delete first.** Removing the internal emails is most of the value and makes
   everything after it smaller. Do it before any body work.
2. **The inbound acknowledgement** — the requester's first impression, and fix the
   §3 duplicate while you are there.
3. **The resolved email** — the confirm/reopen/rate one.
4. **Ticket-created → requester**, and the two SLA emails, and the automation one.

## 7. Tests

- [ ] **The deletions, asserted as absences.** For assignment, transfer, and every
      non-resolved status change: **zero outbox rows**. Assert the count, not the
      response — that is the assertion that catches a re-introduction.
- [ ] In-app notifications for those events are **unchanged**. Staff must still
      learn about them; only the email stops. **Assert the in-app rows still
      appear.** This is the half most likely to be deleted by accident.
- [ ] Status change **to RESOLVED** still emails the requester, and **only** the
      requester.
- [ ] An inbound email produces **exactly one** email back, not two (§3).
- [ ] For each surviving type: no "View Ticket" markup, no "Best regards", no raw
      `TicketStatus`, and a preheader asserted on its style attribute.
- [ ] A malicious subject or display name is escaped in every body **and every
      preheader**.
- [ ] SLA at-risk and breached still reach leads and on-call addresses. **The
      carve-out must be pinned by a test**, or the next tidy-up removes it.
- [ ] Targeted, then the **full** suite. **Do not edit source while it runs.**

## 8. Verification

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npm run test:integration > ../../int-full.txt 2>&1
grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

**Baselines**, verified 2026-09-03: api `tsc` 0, unit **468 / 47**, integration
**512 + 1 skipped, 55 of 56**, web `tsc` 0, vitest **123 / 24**. Delete the log.

**Expect the integration count to move**, because tests asserting the deleted
emails will need rewriting from "an email is queued" to "no email is queued".
**Say which tests you changed and why** — a test that asserted the old behaviour
is not automatically wrong, and the planner will read those diffs.

**No real send.** Read the composed bodies off the outbox rows and paste one into
a browser.

## 9. Acceptance criteria

1. Only the five types in §1 can send email. Everything else sends none.
2. **In-app notifications are unchanged for every event whose email was removed.**
3. An inbound email produces exactly one email back.
4. The resolved email reaches the requester and asks them to confirm, reopen, or
   rate — and card 1.14 is closed by it.
5. **No public one-click rating endpoint was added.**
6. All five survivors are in card 1.34's shape, with no raw status enum reachable
   by a requester.
7. SLA alerts still go out, pinned by a test.
8. Both `tsc` clean; unit, integration and vitest at or above §8.

## 10. What to report back

1. Commit SHA(s) and `git diff --stat`.
2. Every `Tests:` line, both `tsc`, vitest.
3. **Which tests you rewrote from "sends an email" to "sends none", and why each
   was right to change.**
4. **The composed HTML and plain-text bodies, verbatim, for the inbound
   acknowledgement and the resolved email.** The planner will read them against
   card 1.34.
5. Confirmation that in-app notifications still fire for the events that lost
   their email.
6. **Whether anything else still sends email that §1 missed.** Search for it
   rather than trusting the list — it was assembled from `queueEmails` callers, so
   a path building its own body would not appear.
7. Anything that did not match. Handoffs from this planner have carried a wrong
   line number, a stale premise, an invented file reference, a dead CSS class
   quoted as live, a Tailwind trap, an unconditional status transition that would
   have lost inbound mail, a mislabelled verdict, and a deploy check with no path
   to run it. **Say so plainly.**

**Stop and report instead of improvising** if this appears to need a schema
change, a public rating endpoint, or a change to the threading headers.
