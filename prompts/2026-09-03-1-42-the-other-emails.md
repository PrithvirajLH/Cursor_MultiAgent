# Implementation Prompt — 1.42 The other emails

**Date:** 2026-09-03
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.42 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** cards 1.33 and 1.34 rewrote **one** email — the public reply. **Six
other kinds still go out in the old shape**, one per recipient, with a hero
button, a sign-off, and an inbox preview that says nothing.

**Cost:** none. API only. **No schema, no migration.** Size **M**.

> **This is the last thing standing between the owner and clearing
> `EMAIL_TEST_RECIPIENTS`.** Today every email is redirected to the owner's
> inbox. The moment that is cleared, all six of these reach real staff — and one
> of them reaches **requesters** — in a format the owner already rejected once.

> Found by the implementer of card 1.30 while reviewing what was left. Verified
> independently 2026-09-03.

---

## 1. What is still old

`buildDefaultNotificationHtmlBody` (`notifications.service.ts:1064`) retains both
of the things card 1.34 deliberately removed: a **"View Ticket" hero button**
(`:1095`) and a **"Best regards," sign-off** (`:1099`). It has no preheader, so
the inbox preview is boilerplate.

Every one of these paths uses it, and every one goes through `queueEmails`
(`:771`), which fans out **one email per recipient**:

| Path | Audience | Where |
|---|---|---|
| **Inbound acknowledgement** | **the requester** — outside staff | `buildInboundAcknowledgementHtmlBody:998`, same old shape (`:1050` button, `:1052` sign-off) |
| Ticket created | requester + team | `:93` |
| Status changed | requester + assignee + followers | `:356` |
| Assigned | the new assignee | `:232` |
| Transferred | old + new team | `:289` |
| Automation rule action | whoever the rule names | `rule-engine.service.ts:885`, `:888` |
| SLA breach / at-risk | leads, and on-call addresses | `sla-breach.service.ts:705`, `:731` |

Only `messageAdded` was rewritten, via `queuePublicReplyEmail` (`:651`).

## 2. The decision that shapes this card — read before coding

**Do NOT blanket-apply card 1.33's one-email-with-`Cc` model.** It is right for a
**conversation** and wrong for an **individually-addressed alert**:

- "Sarah has replied to your ticket" is a conversation. Everyone seeing who else
  is on it is correct, and is what 1.28 now displays.
- **"You have been assigned this ticket" is not.** `Cc`-ing the other candidates
  tells each of them who else was considered, which is information the system has
  no business volunteering.

**So this card is about the BODY, not the recipient model.** Leave the
per-recipient fan-out alone unless a specific path is genuinely a conversation —
and if you think one is, **say which and why** rather than changing it quietly.

## 3. Order of work — requester-facing first

The owner's concern is what **requesters** see; staff can live with an ugly email
for another week.

1. **The inbound acknowledgement.** The only one of these that leaves the staff
   group. Someone emails the helpdesk and this is the first thing the system ever
   says to them.
2. **Status changed.** Also reaches requesters, and it is the one most likely to
   carry an internal-looking status word — the exact defect card 1.34 existed to
   fix. **Check what it renders for the status** and make sure no raw enum
   reaches a requester.
3. **The four staff-facing ones**, together: created, assigned, transferred, and
   the automation/SLA generic path.

## 4. The work

Apply card 1.34's treatment, which the owner reviewed and chose:

- [ ] **A hidden preheader**, first element in the body, carrying the thing that
      actually matters for that email type — the subject line of the change, not
      boilerplate. `buildPreheader` (`:954`) already exists; reuse it, do not
      write a second one.
- [ ] **Content first.** The reason for the email is the first visible thing. No
      heading that restates the subject, no "We have an update on your request".
- [ ] **Delete the hero button.** A plain `view online` text link, as 1.34 landed.
- [ ] **Delete the sign-off.** The From line already says who it is — and since
      card 1.31 it names the agent.
- [ ] **No raw status enum, ever.** If a status must appear, it goes through the
      same human-readable mapping the UI uses (`tickets.service.ts:146` formats
      `WAITING_ON_REQUESTER` → "Waiting on requester").
- [ ] **Keep `escapeHtml` on every interpolation**, and the quoted font stack.
- [ ] **Do not touch the subject builders.** `formatTicketSubject` is correct and
      the owner has approved it.
- [ ] **Do not touch** cards 1.22's guards, 1.33's recipient model for replies, or
      the threading headers. If a test of theirs goes red, **stop**.

## 5. Tests

- [ ] For **each** of the six paths: the rendered HTML contains **no** "View
      Ticket" button markup, **no** "Best regards", and **no** raw `TicketStatus`
      value.
- [ ] Each has a preheader, and it is **not visible text** (assert on the style
      attribute, as card 1.34's tests do).
- [ ] The **inbound acknowledgement** is asserted separately and first — it is the
      requester-facing one.
- [ ] A malicious subject or display name is escaped in **every** body, preheader
      included; it is easy to forget there because it is invisible.
- [ ] The plain-text sibling of each carries the same parts in the same order.
- [ ] **Recipient counts are unchanged** on every path you did not deliberately
      convert — assert the number of outbox rows, so an accidental change to the
      fan-out cannot pass.
- [ ] Targeted, then the **full** suite. **Do not edit source while it runs.**

## 6. Verification

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npm run test:integration > ../../int-full.txt 2>&1
grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

**Baselines**, verified 2026-09-03 at `1e24dd6` (live): api `tsc` 0, unit
**468 / 47**, integration **512 + 1 skipped, 55 of 56**, web `tsc` 0, vitest
**123 / 24**. Delete the log afterwards.

**No real send.** Read the composed bodies off the outbox rows, as card 1.34 did,
and paste one into a browser to eyeball it.

## 7. Acceptance criteria

1. All six paths produce a body in card 1.34's shape: preheader, content first, a
   plain `view online` link, no button, no sign-off.
2. **No raw status enum can reach a requester.**
3. The inbound acknowledgement — the requester's first impression of the system —
   is done and tested first.
4. Recipient counts are unchanged wherever you did not deliberately convert, and
   any conversion is named and justified.
5. Escaping holds everywhere, preheaders included.
6. Both `tsc` clean; unit, integration and vitest at or above §6.

## 8. What to report back

1. Commit SHA and `git diff --stat`.
2. Every `Tests:` line, both `tsc`, vitest.
3. **The composed HTML and plain-text bodies, verbatim, for the inbound
   acknowledgement and one staff-facing email.** The planner will read them
   against card 1.34.
4. Whether any path was genuinely a conversation and should take the `To`/`Cc`
   model — and if you converted one, why.
5. **Whether anything else still sends email that this card missed.** Search for
   it rather than trusting this list: it was assembled from `queueEmails` callers,
   and a path that builds its own body would not appear.
6. Anything that did not match. Handoffs from this planner have carried a wrong
   line number, a stale premise, an invented file reference, a dead CSS class
   quoted as live, a Tailwind trap, an unconditional status transition that would
   have lost inbound mail, a mislabelled verdict, and a deploy check with no path
   to run it. **Say so plainly.**

**Stop and report instead of improvising** if this needs a schema change, a
subject change, or a change to the threading headers.
