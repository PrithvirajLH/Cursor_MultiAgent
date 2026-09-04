# Implementation Prompt — five small cards, in order

**Date:** 2026-09-04
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** 1.43, 1.18, 1.17, 1.12, 1.11 — **in that order**
**Baseline:** production `1b5e8f5` at schema **54**; branch HEAD is verified GREEN
with migrations **55–57 undeployed**.

**One commit per card. Five commits.**

---

## 0. How to work through this

**Work straight through all five. Do not check in between cards, and do not ask
permission to proceed** — the owner has asked for one uninterrupted pass.

**But finish each card completely before starting the next**, which means:

- [ ] Its own tests written and passing
- [ ] `apps/api` `tsc` + unit, and `apps/web` `tsc` + vitest, **green**
- [ ] Committed on its own
- [ ] **Only then** move on

Run the **full integration suite** after each card that touches the API. It costs
six minutes and it is the only thing that catches a card breaking an earlier one —
which has happened on this project.

**Then, at the end, one Playwright pass over all five**, per §6.

**"Stop and report" still applies** to the specific hazards each card names below.
That is not asking permission — it is telling the owner you found something. The
difference matters: proceed through the work, but if you hit one of the named
conditions, say so in the report rather than improvising around it.

> ## Two cards the owner removed from this batch
>
> ⚠️ **1.6 is NOT here — it is already done.** GREEN as `68c476e` + `d0ff232`,
> sitting in the pending deploy with migration 55. **Do not rebuild it.**
>
> ⚠️ **1.15 is NOT here — its premise no longer exists.** It was written to fix
> *"email fatigue"* by letting people switch off emails. **Card 1.42 removed staff
> email entirely**, and the four surviving emails all go to requesters, where
> switching off *"resolved"* would break the confirm / reopen / rate loop that
> email exists to start. Owner dropped it 2026-09-04. **Do not build it, and do not
> add a `NotificationPreference` model** — if you find yourself wanting one, that
> is a new conversation.

---

## 1 — Card 1.43: bracket the inbound message id (XS, no migration)

**The card is already written: `prompts/2026-09-04-1-43-bracket-the-inbound-message-id.md`.
Follow it.** In short: `preferredInReplyTo` is used raw at
`ticket-email-thread.service.ts:51` (`In-Reply-To`) **and `:58`** (`References`),
while `normalizeMessageId` at `:126` exists to bracket bare ids. Normalise **once**
and use it for both.

- [ ] An existing test pins the current unbracketed behaviour on purpose.
      **Update it, do not delete it**, and say which.

---

## 2 — Card 1.18: draft autosave (XS, no migration)

**The card says "verify, probably done". The planner has now verified it. It is
not done, and here is exactly what is missing so you do not rediscover it.**

`apps/web/src/utils/messageDraft.ts` stores exactly:

```ts
interface StoredDraft { body: string; updatedAt: number }
```

Its own comment says *"today we just read the body."* The three things the card
asks about:

| The card asks | Verified answer |
|---|---|
| Body survives a reload | **Yes.** |
| Inline pasted images survive | **Yes — once their upload has resolved.** An image is inserted as `<img data-temp-id>`, and `resolveUploadingImage(tempId, attachmentId)` stamps `data-attachment-id` when the upload lands. The body getter **deliberately strips any `img` without an attachment id** so a blank image is never sent, so an image pasted and reloaded **mid-upload is dropped from the draft** — the file itself survives on the ticket's Attachments tab. **That behaviour is correct; leave it.** |
| The public/internal toggle survives | **No. It is not stored at all.** This is the whole of the work. |

### The change

- [ ] Add the message type to `StoredDraft`, and restore it on load.
- [ ] The write site is **`TicketDetailPage.tsx:1614`** — `writeMessageDraft(ticketId, nextBody)`.
      `messageType` is state on that same component (`:182`), so it is already in
      scope. **Nothing needs lifting.**
- [ ] The read sites are **`:211` and `:217`**, both calling
      `readMessageDraft(ticketId)`, which returns a bare `string`. Either widen the
      return and update both, or add a second reader beside it. **Either is fine —
      say which you chose.**
- [ ] ⚠️ **The ticket's rules beat the stored draft.** On a ticket where card 1.38
      allows only internal notes, a restored `PUBLIC` type must **not** flip the
      composer to Public. The server would refuse the send anyway, but the screen
      would be lying — the exact defect card 1.37 existed to fix. Clamp the
      restored value to what the composer is currently allowed to be.
- [ ] A draft written by the old code has **no** type. Treat a missing type as the
      composer's normal default, never as a crash — and note `readMessageDraft`
      already swallows a `JSON.parse` failure, so follow that tolerance.
- [ ] Card 1.39 requires a **restored draft to open the composer expanded.** That
      must still hold.

## 3 — Card 1.17: the missing desk metrics (S, no migration)

Three KPIs absent from the 22 report endpoints. Design from the card, which is
sound:

- **First-contact resolution** — resolved tickets with ≤ 1 public agent
  `TicketMessage`
- **Reassignment count** — `TicketEvent.type = 'TICKET_ASSIGNED'` per ticket
- **Time in each status** — from consecutive status-change events

- [ ] Three endpoints, scoped by the existing **`scopeReportQuery`**. Do not invent
      a second scoping path — that function is what keeps a lead's report inside
      their own team.
- [ ] ⚠️ **Use `roleConditionSql`, not `roleFilter`.** Reports run on raw SQL, and
      card 1.36 had to add a requester clause to **both**; they are kept in step by
      `access-control.parity.spec.ts`. **If that spec goes red, stop** — you have
      broken visibility, not a report.
- [ ] Add them to `exportable-reports.const.ts` if the CSV export should cover
      them, and say whether you did.
- [ ] **Out of scope, but note it in the report:** CSAT is stored as a
      `TicketEvent` rather than a table, which makes aggregate rating reporting
      awkward. This is the card where that would be fixed. **Do not fix it here** —
      flag it.

---

## 4 — Card 1.12: bulk tags and bulk macro (S, no migration)

Depends on card 1.7, which is **done** (`92a6737`).

- [ ] `POST /api/tickets/bulk/tags { ticketIds, add[], remove[] }` using
      `TagsService.attachManyToTicket` (`tags.service.ts:133`) and
      `removeFromTicket`.
- [ ] `POST /api/tickets/bulk/macro { ticketIds, cannedResponseId }`.
- [ ] Follow the **existing** bulk DTO pattern — `bulk-assign`, `bulk-priority`,
      `bulk-status`, `bulk-transfer` in `tickets/dto/` — including
      `@ArrayMaxSize`.

### ⚠️ The decision this card turns on

**Card 1.7 established that a macro rolls back entirely if its status change is
illegal for that ticket** (`NEW → RESOLVED` is refused). Across twenty tickets,
some will be in a state the macro cannot legally reach.

**All-or-nothing, or per-ticket?** **Do per-ticket, and report which ones were
skipped and why.** All-or-nothing means one awkward ticket blocks nineteen good
ones, and the agent cannot tell which was the problem. Say in your report if you
disagree.

- [ ] ⚠️ **Check permission per ticket, not once for the caller.** A selection can
      span teams. `canWriteTicket` on **each** — the bulk endpoints are exactly
      where a role check gets done once and applied to twenty rows.
- [ ] The **macro allowlist** still applies, unchanged. A bulk macro must not send
      email or notify.
- [ ] ⚠️ **A bulk macro must not post messages.** Card 1.7 deliberately returns the
      text to the composer instead of sending; there is no composer for twenty
      tickets, so **bulk applies the actions only** and never the text. If that
      seems wrong to you, stop and report rather than inventing bulk messaging.

---

## 5 — Card 1.11: redact a message (S, **migration 58**)

`TicketMessage.redactedAt DateTime?` and `redactedById String?`;
`DELETE /api/tickets/:id/messages/:messageId`, allowed for the author within
`MESSAGE_REDACT_WINDOW_MIN` (default **15**) or LEAD+ at any time. Body becomes
`[message removed by <name>]`.

- [ ] Migration **58**. Additive, hand-written,
      `grep -cE '^(DROP|ALTER TABLE .* DROP)' migration.sql` must be **0**, the
      twelve drift statements stripped and documented as migrations 52–57 do.
      **Dev Supabase first.** ⚠️ Check the folder number: HEAD is at **57**.

### ⚠️ Two things this card must be honest about

**1. You cannot unsend an email.** A **public** message has already gone to the
requester and everyone CC'd — card 1.42's surviving email path. Redacting removes
it from the ticket and from nobody's inbox.

- [ ] **The UI must say so** where somebody redacts a message that was emailed.
      One sentence: the ticket is cleaned up, the email that already went out is
      not. **Do not** let the button imply a recall.
- [ ] An **internal** note was emailed to nobody (card 1.42), so it has no such
      caveat. Distinguish the two cases.

**2. Redacted is not deleted.** The design stores the original in a `TicketEvent`,
so the PHI **moves rather than leaves**. For a healthcare organisation that is a
real distinction, and the repo already takes a stricter line elsewhere:
`AiInferenceLog` carries *"Redacted before write for sensitive departments — never
store raw PHI."*

- [ ] ⚠️ **Decide who can read the preserved original, and make it narrow** —
      OWNER is the defensible answer. A LEAD being able to read what a colleague
      redacted defeats the point of redacting it.
- [ ] Reconcile with `AiInferenceLog`'s stance in your report: either keeping the
      original is right and that comment is stricter than the product needs, or
      keeping it is wrong and the audit should record **that a redaction happened**
      without the body. **Say which and why** — do not just implement the card.
- [ ] Card 1.36's read filter still governs who sees messages at all. A redacted
      message must not become **more** visible than the original was.

---

## 6 — The final Playwright pass

After all five are committed and the full suite is green, **one browser pass over
everything**, against the live dev API.

**Twice on the previous pair of cards the browser found what the suites could
not** — an unclickable toolbar button, and a form that merged instead of replaced
when somebody changed their mind mid-edit. Both needed a human interaction no unit
test performs. **So this pass is not a formality.**

Read `repo-landmines.md` § *"Running the stack by hand for a browser pass"* first:
the API needs `AUTH_ALLOW_INSECURE_HEADERS=true` or every request 401s, and setting
`localStorage.demoUserEmail` without reloading serves the previous persona's cached
data.

Check, at minimum:

- [ ] **1.18** — type a draft, paste an image, switch to internal, reload. All
      three survive, the composer opens expanded, and on a ticket where only
      internal notes are allowed a stored `PUBLIC` draft does **not** flip the
      toggle.
- [ ] **1.12** — select several tickets spanning two teams, add a tag, remove a
      tag, apply a macro. Confirm the per-ticket outcome is reported and that a
      ticket you cannot write is refused rather than silently skipped.
- [ ] **1.11** — redact your own message inside the window, then try outside it;
      redact somebody else's as a LEAD. Confirm the body reads
      `[message removed by …]`, the caveat about the already-sent email appears for
      a public message and not for an internal note, and the original is not
      readable by whoever §5 says may not read it.
- [ ] **1.17** — load each of the three new reports as a LEAD and confirm the
      numbers are scoped to their team, not the whole desk.
- [ ] **1.43** cannot be browser-checked — no mailbox feeds the webhook. Say so
      rather than claiming it.

**Click every control you added.** That is the specific thing that caught the last
two defects.

---

## Verification

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npm run test:integration > ../../int-full.txt 2>&1
grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
bash scripts/check-migrations.sh    # 0 DROPs; it only sees COMMITTED migrations
```

**Baselines — read `CLAUDE.md`.** It is updated at every GREEN, which is more often
than any card is rewritten. As of writing: api `tsc` 0, unit **480 / 48**,
integration **617 + 1 skipped, 62 of 63**, web `tsc` 0, vitest **158 / 26**,
migrations **57**. Delete the log afterwards.

**A backgrounded run reported as `exit 127` was killed, not missing a command** —
its numbers are not real; re-run it.

## What to report back

1. **Five commit SHAs**, one per card, and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, and the **migration DROP count** for
   **58**, which is the only migration in this batch.
3. **The decisions each card asked you to make and state:**
   - 1.12 — per-ticket versus all-or-nothing, and why
   - 1.11 — who may read the preserved original, and how you reconciled that with
     `AiInferenceLog`'s "never store raw PHI"
   - 1.17 — whether the three reports went into the CSV export
4. **The §7 browser results, control by control**, and screenshots of 1.11's
   already-sent-email caveat and 1.12's per-ticket outcome.
5. **1.18's real answer** — which of the three things actually survived a reload
   before your change.
6. Anything that did not match. Handoffs from this planner have carried a wrong
   line number, a stale premise, an invented file reference, a dead CSS class
   quoted as live, a Tailwind trap, an unconditional status transition that would
   have lost inbound mail, a mislabelled verdict, a check with no path to run it,
   and an instruction that would have leaked the existence of deleted tickets.
   **Say so plainly if this one is wrong too.**

**Stop and report instead of improvising** if 1.11 appears to need the original
body kept somewhere a LEAD can read it, if 1.12 appears to need bulk messaging, or
if `access-control.parity.spec.ts` goes red at any point.
