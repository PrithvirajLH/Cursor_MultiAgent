# Implementation Prompt — 1.40 A looped-in person's reply is refused and lost

**Date:** 2026-09-03
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.40 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** a colleague who is CC'd on a ticket email replies to the thread, and
the system **refuses the reply with 403 and stores nothing.** The agent never
learns it was sent.

**Cost:** none beyond the work. API. **Probably no schema change** — see §4.5.
Size **S–M**, depending on §4.

> ⚠️ This describes a live weakness in a running system and both GitHub remotes
> are public. Same handling as `docs/security-audit-2026-08.md`.

> **Found 2026-09-03** by the implementer of card 1.29, while correcting their own
> §4.4 answer. It is not a regression from 1.29 — it is **pre-existing** and was
> simply invisible until somebody drove a third-party reply through the live API.

---

## 1. Why this matters more than its size suggests

This is a gap against something the owner asked for explicitly when scoping the
email conversation epic:

> *"edge cases like people looping in, forwarded should all stay within the
> ticket"*

Cards 1.33 and 1.28 built the outbound half of exactly that: a public reply now
goes to the requester with **everyone else on `Cc`**, and the agent can see who
that is. So the system now actively invites people into a conversation it will
then refuse to hear from.

**Today it is latent**, because no mailbox feeds the inbound webhook yet. **Card
1.24 makes it live**, and it will present as "a manager replied to the thread and
nothing happened" — with no error anywhere an agent can see.

## 2. Facts established (verified 2026-09-03)

| Fact | Consequence |
|---|---|
| `InboundEmailService` provisions an unrecognised sender as an **`EMPLOYEE`**. | A looped-in colleague arrives as an EMPLOYEE, not as staff. |
| `AccessControlService.canWriteTicket` returns, for `EMPLOYEE`, exactly `ticket.requesterId === user.id`. | An EMPLOYEE who is not the requester cannot write. |
| `canPostMessage` = `canWriteTicket` **or** is-the-requester **or** `isPeerAgent`. All three are false for a third party. | **403, and no message stored.** This is the whole defect. |
| Card 1.29 (`4acca6d`) moved `addMessage` **ahead** of the status transition, so the refusal no longer also corrupts the status. | The bleeding is stopped. The reply is still lost. |
| `TicketFollower` and `TicketAccess` already exist, and 1.28 already treats followers as the ticket's audience. | **The audience is already modelled.** The fix is likely to reuse it rather than add anything. |

## 3. Goal

If we emailed someone about a ticket, their reply belongs on that ticket.

## 4. Decisions to make — this is the part that needs judgement

**Do not start coding until §4.1 is decided.** The rest follows from it.

1. **Who is allowed to reply?** The safe rule, and my recommendation: **anyone we
   actually emailed about this ticket** — i.e. the requester, the assignee, and
   the ticket's **followers**, which is precisely the `Cc` list 1.33 sends to and
   1.28 displays. Not "any EMPLOYEE", which would let an unrelated person post to
   any ticket whose reply address they could guess.
2. **The reply token is the real authorisation, and it must not become one.** The
   inbound address carries `+ticket-<id>`, which is a **bearer token in a header
   anyone in the thread can read and forward**. So it identifies the *ticket*, and
   must not by itself grant write access — otherwise a forwarded email hands a
   stranger the ability to post. Match the **sender** against the ticket's
   audience; the token only says which ticket.
3. **What if the sender is not in the audience at all?** Options, and this is the
   owner's call: drop silently (today's behaviour, minus the 403); record it on the
   ticket as an event so an agent can see somebody tried; or attach it as a message
   flagged as being from a non-participant. **My recommendation: record an event,
   do not store the body.** An agent learning "someone outside the thread replied"
   is useful; silently ingesting mail from anyone who can guess an address is not.
4. **Does replying make you a follower?** If a CC'd colleague replies, they are
   now participating. Adding them to followers means they get the rest of the
   thread — which is probably right, and is what card 1.28's audience list would
   then show. **Decide explicitly**, because it changes who receives subsequent
   mail.
5. **Check whether any schema change is needed before assuming one is.** The
   audience already exists in `TicketFollower`. If you find yourself adding a
   column, **stop and report** — say what you needed and why the existing tables
   could not carry it.

## 5. The work

Sequence it after the decisions above.

- [ ] Extend the inbound path's authorisation from "is the requester" to "is in
      the ticket's audience", per §4.1. Do this **in `AccessControlService`**, not
      inline in the inbound service — the visibility rule already lives in three
      places there and a fourth copy in a different file is how 1.36's Fault C and
      1.38 happened.
- [ ] Keep the message-before-status ordering that `4acca6d` established. **A
      status derived from a message must not outlive the message** — that comment
      is in `inbound-email.service.ts` and is load-bearing.
- [ ] Apply §4.3 for a sender outside the audience.
- [ ] Apply §4.4 for follower promotion.
- [ ] Make sure a third party's reply is still `PUBLIC` and still cannot see
      internal notes — card 1.36's read filter governs that and must not be
      touched.

## 6. Tests

- [ ] Integration: a **follower** replies inbound → the message lands, `PUBLIC`,
      attributed to them, and the awaiting-reply marker behaves as card 1.29
      defines.
- [ ] Integration: **a sender in no relationship to the ticket** replies →
      whatever §4.3 decided, asserted on the **stored** rows, not the response.
- [ ] Integration: the **requester** path is unchanged, and so is the automated
      guard from 1.29 — a third party's out-of-office must not move the status
      either.
- [ ] Integration: a third party's reply does **not** grant them sight of internal
      notes.
- [ ] **Assert the response code and the message count before the status.** Card
      1.29's own test asserted only the stored status and therefore passed on the
      bug it was meant to catch. Do not repeat that.
- [ ] Targeted, then the **full** suite. **Do not edit source while it runs.**

## 7. Verification

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npm run test:integration > ../../int-full.txt 2>&1
grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

**Baselines**, verified 2026-09-03 after card 1.29: api `tsc` 0, unit
**449 / 45**, integration **496 + 1 skipped, 54 of 55**, web `tsc` 0, vitest
**123 / 24**. Delete the log afterwards.

**Drive it through the live API as well as the suite.** Card 1.29's suite passed
on a real bug; the Playwright pass is what found it. This card is about
authorisation, where a test asserting the wrong thing is especially cheap to
write.

## 8. Acceptance criteria

1. Someone we emailed about a ticket can reply to it, and their reply appears on
   the ticket attributed to them.
2. Someone with no relationship to the ticket cannot put a message on it by
   knowing the reply address.
3. A forwarded email does not hand a stranger write access (§4.2).
4. A third party still cannot see internal notes.
5. The requester path, the automated guard and the message-before-status ordering
   are all unchanged.
6. Both `tsc` clean; unit, integration and vitest at or above §7.

## 9. What to report back

1. Commit SHA and `git diff --stat`.
2. Every `Tests:` line, both `tsc`, vitest.
3. **The four §4 decisions as you implemented them**, and why.
4. Whether the existing `TicketFollower` / `TicketAccess` tables carried it, or
   whether you needed something new (§4.5).
5. Anything that did not match. Handoffs from this planner have carried a wrong
   line number, a stale premise, a self-contradiction, an invented file reference,
   a dead CSS class quoted as live, a Tailwind trap, and an unconditional status
   transition that would have lost inbound mail. **Say so plainly.**

**Stop and report instead of improvising** if this appears to need the reply token
to be treated as authorisation, or a fourth copy of the access rule.
