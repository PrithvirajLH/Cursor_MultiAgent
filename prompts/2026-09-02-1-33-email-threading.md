# Implementation Prompt — 1.33 Every email on a ticket must be one conversation

**Date:** 2026-09-02
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.33 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** a second agent reply on a ticket arrives as a **separate email thread**.
Observed in production on 2026-09-02 and diagnosed from real headers.

**Cost:** none. API only. **No migration** — see §4.2, which is why.

> **Do this before card 1.24.** Broken threading is worse for the requester than
> for us: their own mail client splits their ticket's history into unrelated
> messages, which is the exact opposite of what this feature promises them. And
> fault 3 below means it is broken for **every real requester**, not just the
> pilot inbox — so it must be fixed before `EMAIL_TEST_RECIPIENTS` is cleared.

---

## 1. The evidence

Two real emails on ticket `PA_20260901_001`, headers supplied by the owner:

```
# email 1
In-Reply-To: <outbox.ab788bd9-…@localhost>      <- unroutable, and never delivered
Message-ID:  <outbox.fa718807-…@csnhc.com>

# email 2
In-Reply-To: <outbox.9989989e-…@csnhc.com>      <- a real message, but NOT email 1
Message-ID:  <outbox.ecc6313c-…@csnhc.com>
```

Subjects were byte-identical, and **SocketLabs is not rewriting anything** — our
Message-IDs arrive intact. This is entirely our own logic.

## 2. Four faults, in severity order

Enumerated with a second verifying session; this ordering is theirs and it is the
right one.

**1. The thread pointer is reserved at enqueue, not at send.**
`notifications.service.ts:541` calls `reserveTicketEmailThread(details, outbox.id)`
when the row is *created*, before any send is attempted. So the pointer advances
on **intent**, not delivery. Row `ab788bd9` reserved the chain on 09-01 and then
failed to send (SMTP was off); the chain kept pointing at it, and every later
email inherited a reference to a message that exists in nobody's mailbox.
`recordOutboundEmail` already runs after a *successful* send
(`email-processor.service.ts:85`) — but reserve writes the same field, so the
hopeful value overwrites the honest one.

**2. `localhost` gets persisted.** `sanitizeMessageIdDomain` returns `'localhost'`
when the reply address is missing — a reasonable guard in isolation. The problem
is that its output is written into a **permanent, quoted-forever Message-ID**
rather than being treated as a signal that this message cannot be threaded.

**3. One pointer, per-recipient Message-IDs.** Each recipient gets their own
outbox row and therefore their own Message-ID, but they share one
`lastOutboundMessageId` — last write wins. So the pointer usually names *somebody
else's* copy. **This is the one that bites hardest**: with two recipients, at
least one of them can never thread, and it has nothing to do with the pilot
switch.

**4. Internal notes overwrite the public chain, and `References` never
accumulates.** `messageAdded` builds one email context and queues for both
message types, so an **internal note reserves the pointer too** — the requester's
next email then references a note they were never sent. And
`buildOutboundEmailContext` composes `References` from a fixed set (root inbound,
last inbound, last outbound) rather than growing it. Clients will match on **any**
id in `References`, so an accumulating chain is exactly the fallback ancestry that
would have survived faults 1–3. We do not have it.

## 3. Goal

Every email ever sent about a ticket lands in **one conversation** in every
recipient's client, and no failed or never-sent message can break it.

**Two owner decisions taken on 2026-09-02 change the shape of this card**, and
make most of §2 disappear at the source rather than being compensated for. Read
§4.0 first — it is why the work is smaller than the fault list suggests.

## 4. Decisions and assumptions

### 4.0 The recipient model changes (owner, 2026-09-02)

**a. A public reply is ONE email.** `To:` the requester, `CC:` everyone else who
should see it — followers, assignee, looped-in colleagues. Not one email each.

This is how a person sends mail, and it **removes fault 3 at the root**: one
email means one `Message-ID`, so there is no per-recipient divergence for a
shared pointer to get wrong. The stable root (§4.1) becomes belt to that braces
rather than the only thing holding threading together.

Three consequences to handle, not ignore:

- **Suppression applies before composing, not at send.** Drop a suppressed or
  out-of-domain address from the CC; do **not** let one bad address fail the
  whole message. Card 1.23's `resolveOutboundRecipients` already returns
  `refused` separately — build the CC from `allowed` and record the refusals on
  the ticket as it already does.
- **Bounce attribution gets fuzzier.** "This message bounced" no longer names one
  person. Record what you can, and say in the report what is now unknowable.
- **CC is public.** Every recipient sees every other address. Internal-only
  recipients (decisions log, 2026-09-01) makes that acceptable, but write it down
  in `docs/email-conversation.md` so nobody is surprised later.

**b. An internal note sends NO email, to anybody.** Staff see it in the ticket
conversation, and `inAppNotifications.notifyNewMessage` already raises an in-app
notification with a realtime push and a poll fallback. Email adds nothing.

Deleting that path:

- **removes fault 4's first half** — an internal note cannot move a thread
  pointer it never touches;
- makes card **1.22's guard structural rather than defensive**. Today an internal
  note is *refused* when addressed to the requester; after this, no internal note
  is composed as an email at all, so the "requester who happens to be staff" hole
  closes by construction. **Keep 1.22's guard and its tests regardless** —
  defence in depth, and it is what would catch a future card wiring this back up.
- **Accepted trade-off:** an agent who is not logged in learns of an internal note
  only when they next open the app. Right for colleague-to-colleague notes on a
  ticket someone is already working, and **consistent with mentions**, which
  raise in-app notifications and queue no email today either.

### 4.1 The threading fix

1. **Stop tracking a moving target. Mint one stable root per ticket.** Do not try
   to track the anchor more carefully — remove the need to. Derive a synthetic
   root that never changes and put it in `References` on **every** outbound email
   for that ticket:

   ```
   <ticket.{replyToken}@{domain}>
   ```

   This fixes faults 1, 2, 3 and half of 4 at once: every recipient's copy
   references the same root, so they all thread together; a failed send cannot
   pollute anything because nothing is recorded; and an internal note cannot
   move an anchor that does not move.

2. **Use the existing `replyToken`, and add no column.** `TicketEmailThread`
   already persists a stable per-ticket `replyToken` (it is what
   `buildReplyToAddress` uses). Deriving the root from it means **no migration**
   and no new state that can drift. Do not add a column for this.

3. **The domain comes from the configured reply/from address.** Note the one
   consequence honestly in a comment: if the sending domain ever changes, threads
   break at that boundary. That is rare, acceptable, and §4.4's accumulating
   `References` softens it.

4. **Make `References` accumulate.** Parent's `References` + parent's
   `Message-ID`, capped (the existing 20 is fine). This is the resilience layer:
   even if one id is wrong, a client matching on any other still threads. Keep
   the synthetic root **first** so it is never the one dropped by the cap.

5. **`In-Reply-To` should name a message that recipient actually received.**
   Since we cannot know that from a shared pointer, prefer:
   the requester's last **inbound** message id (which we know they sent, and which
   they will have in their own sent items) → else the synthetic root → else
   omit it. **Never** a per-recipient outbound id from a shared field.

6. **Reserve stops writing the pointer.** Only `recordOutboundEmail`, after a
   confirmed send. Keep the per-message tracking — it is genuinely useful for
   inbound — but it must never again be written on intent. If removing the
   reserve call breaks a test, read the test before changing the code; it may be
   asserting the bug.

7. **No data cleanup, and no migration.** Existing `@localhost` values stay in the
   table and simply stop being used as anchors. Say so in the report rather than
   writing a fixup script for data that no longer matters.

## 5. The work

Kill stray node processes; Postgres up; no other test run active; export the
consent variable for the whole integration run.

### Task 1 — The recipient model (§4.0)

**Files:** Modify `apps/api/src/notifications/notifications.service.ts`, `apps/api/src/notifications/email.service.ts`, `apps/api/src/notifications/outbox.service.ts`, `apps/api/src/notifications/email-processor.service.ts`

- [ ] `messageAdded`, **internal** branch: raise the in-app notification and
      **queue no email**. Delete the internal subject/body construction with it —
      dead code that still compiles is how a future card accidentally re-enables
      this.
- [ ] `messageAdded`, **public** branch: compose **one** email. `To:` the
      requester; `CC:` the remaining recipients minus the author, built from
      `resolveOutboundRecipients` so suppressed and out-of-domain addresses drop
      out of the CC instead of failing the send.
- [ ] `sendEmail`, the outbox row and the processor need a **`cc`** field.
      Additive — the other five `queueEmails` call sites pass nothing and keep
      their current per-recipient behaviour.
- [ ] **If there is no requester** (an intake ticket whose requester never
      resolved), promote the first CC to `To:`. An email with only CC recipients
      is a spam signal.
- [ ] **The pilot switch must still replace everything, To and CC alike.** Card
      1.22's invariant test asserts no intended recipient reaches `sendMail` —
      confirm it still holds with a CC present, and **extend it if it only
      inspected `to`.**

### Task 2 — The stable root

**Files:** Modify `apps/api/src/notifications/email-threading.util.ts` + spec

- [ ] `buildTicketRootMessageId(replyToken: string, replyAddress?: string | null)`
      → `<ticket.{replyToken}@{domain}>`, reusing `sanitizeMessageIdDomain`.
- [ ] Extend `extractOutboxIdsFromThreadHeaders` (or add a sibling) so an inbound
      reply quoting the root still resolves to the ticket — the root is a **new
      shape** of id and the existing pattern only matches `outbox.<uuid>`. **Miss
      this and inbound threading regresses.**
- [ ] Unit tests: stable across calls; a missing reply address degrades the same
      way the existing helper does; the root is recognised by the extractor.

### Task 3 — Compose the headers correctly

**Files:** Modify `apps/api/src/notifications/ticket-email-thread.service.ts` + spec

- [ ] `buildOutboundEmailContext`: put the synthetic root **first** in
      `References`, then the accumulated ancestry (§4.4), then the existing ids,
      de-duplicated, capped at 20.
- [ ] `In-Reply-To` per §4.5.
- [ ] Store the accumulated `References` on the thread row **only if it fits an
      existing column** — if it needs a new one, **stop and report**; §4.7 says no
      migration, and an accumulating list can be recomputed from what is already
      stored.

### Task 4 — Record on delivery, never on intent

**Files:** Modify `apps/api/src/notifications/notifications.service.ts`, `apps/api/src/notifications/ticket-email-thread.service.ts`

- [ ] Remove the `reserveTicketEmailThread` write of `lastOutboundMessageId`.
      Whether the method disappears entirely or keeps its thread-row-creation job
      is your call — say which and why.
- [ ] Confirm `recordOutboundEmail` is the only writer, and that it still runs
      after `markSent`.
- [ ] **A `localhost` domain must not be persisted.** If the reply address is
      missing at send time, skip recording rather than writing an unroutable id.
      Log it at warn.

### Task 5 — Tests

- [ ] Unit: two recipients on one message produce two Message-IDs but **the same
      `References` root**; a second message references the same root; an internal
      note does not change what the next public email references; a failed send
      records nothing; `References` accumulates and the root survives the cap.
- [ ] Integration: extend `test/integration/email-safety.spec.ts` or add one.
      Assert the composed headers on the outbox rows — **no test may perform a
      real send or open a socket.**
- [ ] Targeted, then the **full** suite. **Do not edit source while it runs.**

### Task 6 — Docs, baselines, commit

- [ ] `docs/email-conversation.md`: how threading works now, why the root is
      derived rather than stored, and the sending-domain caveat from §4.3.
- [ ] `CLAUDE.md` + `repo-landmines.md` baselines, real numbers.
- [ ] One commit. `e2e/` is untracked on purpose.

## 6. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx jest --config ./test/jest.integration.json test/integration/email-safety.spec.ts test/integration/tickets.inbound-email.spec.ts > ../../it-email.txt 2>&1; grep Tests: ../../it-email.txt
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

**The inbound-email spec matters as much as the new one** — Task 1's extractor
change is the place where fixing outbound could quietly break inbound. Baselines
to beat: **344 unit (39 suites), 446 integration + 1 skipped (50 of 51), 70 web
(18 files)** — plus whatever cards 1.31/1.32 moved them to. Delete the two log
files afterwards.

## 7. Security considerations

- **The reply token appears in a `Message-ID`, which is quoted forever in every
  reply.** It already appears in `Reply-To`, so this exposes nothing new — but it
  does mean the token is now in more places, so **it must stay a capability that
  only identifies a ticket**, never one that grants access. Confirm
  `resolveTicketIdByReplyAddress` still only resolves an id and that the inbound
  path still applies its own access rules.
- **Do not log a full Message-ID at info level** — it contains the token.
- The 1.22 guards stay green, untouched. Internal notes must still never reach a
  requester; this card changes headers, not recipients.

## 8. Acceptance criteria

1. Two agent replies on one ticket arrive as **one conversation** in the
   recipient's client.
2. A public reply with several recipients produces **exactly one email** — `To:`
   the requester, `CC:` the rest — and it threads for all of them.
3. **An internal note produces no email at all**, for anybody, while still
   raising the in-app notification. An internal note between two public replies
   does not break the public thread.
4. A suppressed or out-of-domain address is **dropped from the CC** and recorded
   on the ticket; the email still reaches everyone else.
5. A send that fails records nothing; the next email still threads.
6. No `@localhost` id is ever persisted or emitted.
7. `References` accumulates, and the synthetic root is always present.
8. **Inbound still works**: a reply to any of these emails still lands on the
   right ticket, by reply token, by subject id, and by header.
9. **Every 1.22 guard still passes**, including the pilot-switch invariant with a
   CC list present.
10. Both `tsc` clean; unit, integration and vitest at or above baseline.

## 9. Manual test steps

**Do not attempt a real send** — production credentials are the owner's.

Locally, with SMTP unconfigured, post two public messages and an internal note on
one dev ticket, then read the three outbox rows directly and compare the composed
headers: same `References` root on all three, `In-Reply-To` per §4.5, no
`@localhost` anywhere, and `References` longer on the later rows.

Then feed one of those Message-IDs to the inbound webhook as `inReplyTo` and
confirm it threads onto the same ticket.

**The API runs from `dist`** — if a change appears to have no effect, suspect the
build (`repo-landmines.md`).

## 10. What to report back

1. Commit SHA. 2. Every `Tests:` line, both `tsc`, vitest. 3. `git diff --stat`.
4. The three composed header sets from §9, verbatim — the planner will read them
   against the four faults.
5. Anything that did not match, in particular: whether the accumulating
   `References` fitted an existing column or wanted a new one (§4.2 says stop if
   so); what you did with `reserveTicketEmailThread`; and whether any existing
   test turned out to be asserting the bug rather than the behaviour.

**Stop and report instead of improvising** if this needs a migration, a new
column, a data fixup, or a change to how mail is sent. None should be necessary.
