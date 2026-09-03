# Implementation Prompt — 1.6 Link related tickets, then 1.5 Merge duplicates

**Date:** 2026-09-03
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** 1.6, then 1.5
**Baseline:** production runs **`1e24dd6`** at schema **53**; branch HEAD is at
schema **54** (card 1.10, undeployed).

> ## ⚠️ READ THIS FIRST — these two are not equally ready
>
> **1.6 is build-ready.** Full instructions below. **Start here.**
>
> **1.5 is NOT.** The design in the master plan is materially incomplete: it names
> **4** of the **16** places that point at a ticket, and misses **2 of the 3**
> unique constraints that will throw on merge. It also predates the email
> threading that shipped today, which raises a question nobody has answered.
> **§B is a decision pass, not a coding task.** Do not write merge code until the
> owner has answered §B.4.
>
> **The planner's recommendation: ship 1.6, then stop.** Do 1.5 after the email
> epic (cards 1.24/1.25) settles, because merge has to answer where a reply to a
> merged-away ticket lands, and that answer depends on how inbound threading
> actually behaves once real mail flows.

---

# Part A — Card 1.6, link related tickets (build this)

**Cost:** none. API + web + **one additive migration (55)**. Size **M**.

## A.1 Facts established (verified 2026-09-03)

| Fact | Consequence |
|---|---|
| **No `TicketLink` model exists**, and nothing in the schema expresses a relationship between two tickets. | Greenfield. One new table, one new enum. |
| The master plan's design is sound: `TicketLink { id, fromTicketId, toTicketId, type, createdById, createdAt }`, `@@unique([fromTicketId, toTicketId, type])`, cascade on ticket delete. | **Use it as written.** It is the one part of these two cards that needs no rework. |
| `Ticket` uses **soft delete** (`deletedAt`), and `TicketAccess` etc. cascade on hard delete only. | A link to a soft-deleted ticket still exists. **Decide what the UI shows** — see A.3. |
| Card 1.1's `PATCH` pattern and its event-writing are the model to follow. | Do not invent a new shape. |

## A.2 The work

- [ ] **Migration 55**, additive: the `TicketLink` table, a `TicketLinkType` enum
      (`RELATED`, `DUPLICATE_OF`, `PARENT_OF`), the composite unique, the indexes,
      and the FK cascade.
      - Hand-written. `grep -cE '^(DROP|ALTER TABLE .* DROP)' migration.sql` must
        be **0**, with the standing twelve drift statements removed and documented,
        exactly as migrations 52–54 do.
      - **Dev Supabase first**, then production.
      - ⚠️ **Check the folder number before naming it.** HEAD already has 54 from
        card 1.10.
- [ ] `POST /api/tickets/:id/links { toTicketId, type }` and
      `DELETE /api/tickets/:id/links/:linkId`. Include links in `getById`.
- [ ] Events `TICKET_LINKED` / `TICKET_UNLINKED` on **both** tickets, so each
      ticket's timeline records it.
- [ ] Web: a "Linked tickets" section on the ticket, and a parent's detail lists
      its children.

## A.3 Decisions — settle these in code, and say what you chose

1. **Who may link?** Anyone who may write the ticket is my recommendation —
      linking is not destructive and reversible in one click. Use the existing
      `canWriteTicket`; **do not** invent a check.
2. ⚠️ **You must be able to see BOTH tickets.** This is the security-relevant one.
      Linking ticket A to ticket B and then reading B's subject from A's "Linked
      tickets" list would leak the subject of a ticket you cannot open — and HR and
      payroll subjects carry names. **Check access on `toTicketId` as well**, and
      when a linked ticket becomes invisible to the reader later, show the
      reference without the subject rather than hiding the link.
3. **Direction and symmetry.** `RELATED` is symmetric; `DUPLICATE_OF` and
      `PARENT_OF` are not. Store **one** row and derive the inverse for display —
      storing both directions doubles the rows and lets them disagree. Say how you
      rendered the inverse.
4. **Self-links and cycles.** Refuse `toTicketId === id`. For `PARENT_OF`, refuse a
      cycle — a two-level check is enough today; **do not** build a graph walker.
5. **Soft-deleted targets.** A link to a soft-deleted ticket should still list, marked
      as deleted, rather than vanishing — an agent needs to know it was linked.

## A.4 Tests

- [ ] Unique constraint holds: the same pair and type twice is refused.
- [ ] **Access: linking to a ticket you cannot see is refused, and a link whose
      target you cannot see does not expose its subject.** Assert the negative.
- [ ] `RELATED` shows on both tickets; `PARENT_OF` lists children on the parent
      and the parent on the child.
- [ ] Self-link refused; a direct cycle refused.
- [ ] Both events land on both tickets.
- [ ] Web: the section renders, and an unreadable target degrades to a reference.
- [ ] Targeted, then the **full** suite. **Do not edit source while it runs.**

---

# Part B — Card 1.5, merge duplicates (decisions first)

**On hold by the owner since 2026-08-28, and the plan marks it "needs
brainstorming". This is why.**

## B.1 What the proposed design gets wrong

The master plan says: *"re-point `TicketMessage`, `Attachment`, `TicketFollower`,
`TicketTag` rows from each source to the target."*

**Sixteen things point at a ticket. That names four.** Verified from the schema:

**Thirteen relations:** `TicketMessage`, `TicketEvent`, `Attachment`,
`TicketFollower`, `TicketTag`, `CustomFieldValue`, `TicketAccess`, `SlaInstance`,
`TicketEmailThread`, `InboundEmailReceipt`, `NotificationOutbox`, `Notification`,
`AutomationExecution`.

⚠️ **Three plain `String` columns with no relation at all** — no foreign key, no
cascade, nothing to catch a miss: **`AiInferenceLog.ticketId`,
`RoutingDecisionLog.ticketId`, `CorrectionLog.ticketId`**. This is the same trap
card 1.30 hit with users, where counting *relations* rather than *columns* missed
three.

## B.2 Three unique constraints will throw

Merging means re-pointing rows onto a ticket that may already have an equivalent:

| Constraint | Collides when |
|---|---|
| `TicketFollower(ticketId, userId)` | both tickets have the same follower |
| `CustomFieldValue(ticketId, customFieldId)` | both have the same custom field set |
| `TicketAccess(ticketId, teamId)` | both were transferred through the same team |

**The proposed design mentions only the first.** A naive
`UPDATE … SET ticketId = target` throws on the other two.
**Dedupe, then re-point** — card 1.30's `merge-duplicate-user.mjs` already solves
this shape; read it before designing.

## B.3 Two things the design has no answer for

1. ⚠️ **`TicketEmailThread` — and this is the one that can lose mail.** Email
   threading shipped **today** (card 1.33), after this design was written. Each
   ticket has a thread with a stable root that a requester's mail client replies
   into. **Merge two tickets and there are two roots.** If a requester replies to
   the *source* ticket's email afterwards, where does it land? Options: keep the
   target's root and re-point the source's receipts; keep both roots pointing at
   the target; or refuse to merge tickets that have live email threads.
   **Unanswered, and getting it wrong loses a reply** — the exact class of failure
   this project hit twice on 2026-09-03.
2. **`SlaInstance`** — two instances, and the card's own "done when" requires that
   *reports count one ticket*. Which timer survives? Does the merged ticket inherit
   the earlier `dueAt`? **Decide before coding**, because SLA reporting is what
   agent performance is measured on.

## B.4 The owner's decisions — needed before any merge code

1. **Move or copy messages?** The plan recommends **move** ("one thread of
   truth"). I agree: a copy means two records of the same conversation drifting.
2. **Who may merge?** The plan says LEAD+ or the target's assignee. Reasonable.
3. **May tickets from *different* requesters be merged?** The plan recommends
   **no**. I agree, strongly: merging two people's tickets puts one requester's
   messages in front of the other, and on HR or payroll content that is a
   disclosure. **Same requester only, with no override.**
4. ⚠️ **What happens to email threads on a merged ticket?** §B.3.1. **This is the
   one that needs the owner, and it is the reason to wait.**
5. **Is the merge reversible?** The plan marks the source `CLOSED` with
   `closeReason = MERGED` rather than deleting it, which is right — but once
   messages have moved, unmerging means knowing which came from where. My
   recommendation: **not reversible**, and say so in the confirm dialog.

## B.5 What it will need, once decided

- `Ticket.mergedIntoId String?` + index, **and** a new `TicketCloseReason` value
  **`MERGED`** — verified absent (the enum has only `REQUESTER_CONFIRMED`,
  `REQUESTER_CANCELLED`, `AGENT_CLOSED`, `AUTO_CLOSED`). That is **another
  migration**, with the same enum-in-transaction rule card 1.10 documented: add
  the value, use it later.
- All **sixteen** pointers handled, deduped where §B.2 requires.
- `TICKET_MERGED` events on both sides, and a banner on the source linking to the
  target.
- **A dry run.** Card 1.30's user merge ships as an owner-run script with a
  dry-run default for exactly this reason; a ticket merge is an in-app action, so
  the confirm dialog must show **what will move** before it moves.

---

## Verification (both parts)

**Kill stray node processes first** — the repo-scoped filter in
`repo-landmines.md` **misses a dev server started with a relative path**, so check
the ports too.

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npm run test:integration > ../../int-full.txt 2>&1
grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
bash scripts/check-migrations.sh    # 0 DROPs; it only sees COMMITTED migrations
```

**Baselines**, verified 2026-09-03 at HEAD: api `tsc` 0, unit **468 / 47**,
integration **542 + 1 skipped, 58 of 59**, web `tsc` 0, vitest **133 / 24**,
migrations **54**. Delete the log afterwards.

## What to report back

1. Commit SHA for 1.6 and `git diff --stat`. **Nothing for 1.5 unless the owner
   answered §B.4** — if they have not, report that and stop.
2. Every `Tests:` line, both `tsc`, vitest, and the **migration DROP count**.
3. Your A.3 decisions, especially **how you handled a link whose target the reader
   cannot see** — that is the leak worth getting right.
4. A screenshot of the "Linked tickets" section, including a parent listing
   children.
5. Anything that did not match. Handoffs from this planner have carried a wrong
   line number, a stale premise, an invented file reference, a dead CSS class
   quoted as live, a Tailwind trap, an unconditional status transition that would
   have lost inbound mail, a mislabelled verdict, a deploy check with no path to
   run it, and a card whose whole first draft was built on guesswork. **Say so
   plainly.**

**Stop and report instead of improvising** if 1.6 wants a second migration, if a
link needs to be stored in both directions, or if you find a seventeenth thing
pointing at a ticket.
