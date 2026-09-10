# Implementation Prompt — 1.24 Inbound mailbox worker (+ 1.25's verification)

**Date:** 2026-09-10
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** 1.24 (L) — and the verification half of 1.25 (S)

> ## The point of this handoff: **build it all before the permission arrives.**
>
> The owner's manager is granting `Mail.ReadWrite` **today**. Everything in §1–§4
> can be built and proved **without it**, against fixtures. §6 is the list to run
> the moment it lands, so the live proof takes minutes rather than a day.
>
> **So: make nothing depend on a live Graph call to be testable.** The Graph client
> is an injected seam with a fake in tests. If you find yourself unable to run
> something locally, that is a design problem in your own code, not a blocker.

**One commit per coherent piece — this is an L, do not force it into one.** Work
straight through. Do not check in between pieces, and do not ask permission.

---

## 0. Before anything

- **Read `CLAUDE.md`.** Baselines: api `tsc` 0, unit **560 / 56**, integration
  **725 + 1 skipped, 71 of 72**, web `tsc` 0, vitest **239 / 38**. Migrations
  **59**, in the tree **and** in production.
- **Read the whole of card 1.24 on the board** — `prompts/2026-08-26-restart-master-plan.md`.
  It carries the design rationale (why polling not webhooks, why not Power
  Automate) and a **six-item deferred checklist** that other cards parked here.
  **This document does not repeat all of it.**
- ⚠️ **Before any integration run, kill surviving jest processes.** A harness
  reporting a run as killed is **not** evidence it stopped. **Exit 127 with no
  summary is a spawn failure, not a test failure.** Both are in
  `repo-landmines.md`. A clean run is ~14 minutes.
- **A migration is likely** here — a delta cursor has to persist somewhere. **Keep
  it additive, hand-check it to zero `DROP`s**, and it will be **60**.
- **Trust a live run over this document.** Handoffs from this planner have carried
  a wrong line number, a stale premise, a fix instruction that would not have
  worked, and — last batch — **an instruction that was impossible because of a
  database index I had not read.** Say where this one is wrong.

---

## 1 — The worker

A background worker polls one shared mailbox on a timer with a Graph **delta
query**, feeds each new message into the **existing** ingestion path in-process,
then moves it to a Processed folder so what was consumed is visible in the mailbox.

- [ ] **Reuse the existing ingestion path.** `POST /api/tickets/inbound-email`
      already parses and stores mail. **Do not write a second ingestion path** —
      one rule answered in two places is the drift that produced cards 1.36, 1.38,
      1.47, 1.50 and 1.55. Call the service the controller calls.
- [ ] **The delta token is a durable cursor and must survive a restart.** That is
      the whole reason this card is polling rather than a webhook. Persist it;
      **an in-memory cursor silently loses every message that arrives during a
      deploy.**
- [ ] **Follow the existing background-job shape.** `EmailOutboxSweeperService` is
      the closest model: `setInterval`, an env switch, a batch size. ⚠️ **Note what
      that file got wrong and do not copy it** — its interval comment misled a
      diagnosis for a day. Say what your default interval is.
- [ ] **OFF by default**, behind an env switch. **Name the variable in your report.**
- [ ] **Surface it on the Operations console** (`/admin/operations` — *not*
      `/operations`, per 0.10's implementer): enabled, last run, last result,
      messages ingested, and a **Run now** button. That page is the reference
      design for anything scheduled here.
- [ ] **Move to Processed only after the message is safely stored.** If storing
      throws, the message must stay where it is and be retried. ⚠️ **Moving first
      and storing second loses mail**, and this is the card where that matters
      most.
- [ ] **Ingesting the same message twice must create one ticket message.** There is
      existing idempotency on the inbound path — **use it rather than inventing a
      second scheme**, and note that
      `inbound-email.service.ts` has a documented reservation-release window that
      already caused a retry loop (see `repo-landmines.md`, *"A status transition
      can lose inbound mail"*).

### Tests — all against a fake Graph client

- [ ] Two polls where the second returns the delta token's tail: **nothing is
      ingested twice.**
- [ ] The worker restarting mid-run **resumes from the stored cursor** and loses
      nothing. **That is the regression assertion for this card.**
- [ ] A store failure leaves the message **unmoved** and re-ingests next poll.
- [ ] The switch off means the timer never fires.

---

## 2 — Addressing: one mailbox, two kinds of suffix

**The rule:** a suffix beginning **`ticket-`** is a reply token; **anything else**
is a department slug.

| Address | Means |
|---|---|
| `helpdesk+payroll@csnhc.com` | new ticket in Payroll |
| `helpdesk+ticket-a1b2c3@csnhc.com` | reply onto that ticket |

- [ ] ⚠️ **Look for our address in `To`, `CC` *and* `Delivered-To`.** On a
      reply-all or a forward the plus address is often **not** in `To`. **Parsing
      only `To` drops exactly the loop-in cases the owner cares about** — and card
      1.40 exists because a looped-in person's reply was being lost.
- [ ] **Forbid any department slug beginning `ticket-`** so the rule cannot become
      ambiguous. Enforce it where slugs are created, not only here.
- [ ] **Friendly aliases.** Production slugs are `ai`, `hr`, `it-service-desk`,
      `medicaid-pending`, `payroll`, `white-gloves` — and **`hr-operations` is
      INACTIVE, never target it.** Nobody will type
      `helpdesk+it-service-desk@csnhc.com`, so carry a small alias map (`it`,
      `pay`, `hr`, …). `resolveTeamIdBySlug` already does the lookup (`intake.service.ts:199`) 2014 but note it is **private to `IntakeService`**, so lift it rather than copying it.
- [ ] **Department addressing applies to the first message only.** Once the ticket
      exists, outbound sets `Reply-To` to the `+ticket-` address — already built in
      `ticket-email-thread.service.ts` — so the thread moves onto the ticket by
      itself. **Do not re-route a reply by its department suffix.**
- [ ] ⚠️ **Pass `skipRequiredCustomFields: true` on the inbound path**, the way
      `ai/tools/ticket-tools.service.ts:51` already does. **Production has zero
      required custom fields today** (verified 2026-09-04), so this is defence in
      depth — it stops the next required field anybody adds from silently dropping
      inbound mail.
- [ ] ⚠️ **If the tenant blocks plus-addressing, STOP AND REPORT.** The fallback
      order is a catch-all subdomain (`anything@tickets.csnhc.com`), then one
      mailbox per department — **that changes the design, not a constant.** §6
      checks this early for exactly this reason.

### Tests

- [ ] `+ticket-<token>` routes to that ticket; `+payroll` opens a new Payroll
      ticket; `+it` resolves through the alias map.
- [ ] The address found only in **CC**, and only in **Delivered-To**, both work.
      **Two separate assertions** — this is the case most likely to regress.
- [ ] A slug beginning `ticket-` is refused at creation.
- [ ] An unknown suffix does not throw and does not silently route to a wrong team.
      **Say in your report what it does instead.**

---

## 3 — Auto-follow, and the small extras

- [ ] **Add the inbound sender as a follower**, and any looped-in third party, so
      they are auto-watched. Mentions already do this; email does not. Roughly ten
      lines — **this is the owner's "auto-watching" ask** and it is easy to lose
      at the bottom of an L card.
- [ ] ⚠️ **A follower who is staff must not thereby start receiving email.** Card
      1.42 removed staff email, and `notifications.service.ts:741` already filters
      followers by `isStaffRole`. **Do not weaken that** — adding a follower is
      about visibility, not delivery. **Stop and report if you find yourself near
      that filter.**

---

## 4 — What you cannot build, and must not fake

- **The mailbox itself does not exist yet.** That is card 1.25 and it is the
  **owner's** M365 task, not yours.
- **The live Graph call.** Build the seam, fake it in tests, and leave the real
  call exercised only by §6.
- ⚠️ **Do not stub a "pretend it worked" mode that could ship enabled.** A worker
  that silently no-ops in production is worse than one that fails loudly. If the
  switch is on and Graph is unreachable, **log it and say so on the Operations
  console.**

---

## 5 — What to report back

1. **Commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, and **the migration number and its
   DROP count** if you added one.
3. The answers this card needs:
   - the **env switch name** and your default poll interval
   - **where the delta cursor is persisted**, and why there
   - what an **unknown plus-suffix** does
   - whether anything took you near the staff-email filter
4. **For each piece, the specific assertion that would fail if it broke.** Not the
   count.
5. ⚠️ **A single paste-ready §6 checklist**, filled in with the real command lines
   and env variable names — so the owner can run it the minute the permission
   lands without reading this document again. **This is the deliverable that makes
   the batch worth doing early.**
6. Anything that did not match. **This document is wrong somewhere.**

---

## 6 — The instant-test checklist (run when the permission lands)

**Order matters. The first two are cheap and can invalidate the design.**

- [ ] **1. Confirm the permission is SCOPED.** `Mail.ReadWrite` must be restricted
      to the single mailbox by an **Application Access Policy**. **Unscoped, the
      app registration can read every mailbox in the tenant** — that is the
      security decision on this card. **If it was granted unscoped, stop and tell
      the owner before pointing the worker at anything.**
- [ ] **2. Confirm the mailbox accepts plus-addressing.** Send to
      `helpdesk+test@…` from outside and check it arrives. **If the tenant strips
      or rejects it, stop** — see §2's fallback order.
- [ ] **3. Run the worker once** from the Operations console. Confirm: messages
      ingested, and each consumed message moved to Processed.
- [ ] **4. A reply from a real mailbox lands on the right ticket within a minute,
      under the sender's own name.**
- [ ] **5. Stop the API for two minutes, send mail, restart.** Nothing is lost.
      **This is the reason the card chose polling** — prove it.
- [ ] **6. Ingest the same message twice.** One ticket message.

### Then the six deferred items other cards parked here

- [ ] **7. Card 1.29's two checks.** A genuine reply clears *Waiting on requester*
      and shows a **REPLIED** marker that survives a reload. And ⚠️ **an
      out-of-office auto-reply does NOT move the status** — **this is the most
      important check in the whole list**, because that failure looks like
      progress, so the ticket quietly leaves the chase list and nobody looks again.
- [ ] **8. Card 1.40.** A looped-in colleague's reply lands on the ticket; a
      stranger's is recorded as an attempt with the body discarded.
- [ ] **9. Card 1.43** — a real requester's reply **threads** onto the ticket
      instead of opening a new one. 1.43 shipped on 09-09, so this is the moment it
      stops being dormant.
- [ ] **10. An unrouted inbound ticket.** Mail to bare `helpdesk@` with no matching
      routing rule gets **no team, so no email and no bell** — discoverable only
      from the Unassigned queue. Department addressing covers the normal case.
      ⚠️ **Owner decision at this point: a fallback department, or rely on card
      1.16's digest.** Planner's view: **a fallback** — small, and it means nothing
      can arrive with no owner.
- [ ] **11. `EMAIL_TEST_RECIPIENTS` still redirects everything to the owner's
      inbox.** **Clear it only after 4–9 pass**, and confirm
      `EMAIL_ALLOWED_DOMAINS` still covers the domain real requesters are on
      (production: `csnhc.com`).
- [ ] **12.** Item 5 of the board's checklist — the `Asset Tag` required field — is
      **already closed** (owner, 2026-09-04; production has zero required custom
      fields). Nothing to do; listed so nobody re-checks it.

**Stop and report instead of improvising** if the permission arrives unscoped, if
plus-addressing does not work, if the delta cursor seems to need a non-additive
migration, if you find yourself writing a second ingestion path, or if anything
requires weakening the staff-email filter.
