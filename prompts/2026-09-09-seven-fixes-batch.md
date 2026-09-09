# Implementation Prompt — seven fixes, in order

**Date:** 2026-09-09
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** 1.47, 1.48, 1.49, 1.50, 1.52, 1.45, 1.51 — **in that order**

**One commit per card. Seven commits.**

**Work straight through all seven. Do not check in between cards, and do not ask
permission to proceed** — the owner has asked for one uninterrupted pass.
**Then, at the end, one Playwright pass**, per §8.

> **Every one of these is a defect, not a feature.** Six were found by looking at
> the running product — three by the owner, two by the previous implementer, one by
> the planner tracing a send path. None were caught by 510 unit tests, 680
> integration tests or 175 web tests. **That is the theme of this batch:** each card
> names why the suite missed it, and **fixing that gap is part of the card**, not
> optional polish. A test that would still pass with the bug present is not a test.

---

## 0. How to work through this

- **Read `CLAUDE.md` first.** Baselines at time of writing: api `tsc` 0, unit
  **510 / 50 suites**, integration **680 + 1 skipped, 66 of 67**, web `tsc` 0,
  vitest **175 / 28 files**. Migrations **58** in the tree, **57** applied in
  production.
- **Only card 1.48 may need a migration**, and §2 argues it should not. **If you
  find yourself writing migration 59, stop and report instead** — the owner has a
  deploy in flight at 58 and a surprise 59 changes its shape.
- ⚠️ **There is an un-deployed batch sitting at `HEAD`.** Migration 58 and cards
  1.43/1.18/1.17/1.12/1.11/1.44 are GREEN but **not in production yet**
  (`prompts/2026-09-08-deploy-six-card-batch.md`). **Do not deploy anything, and do
  not touch that handoff.** Just commit on top.
- **Never edit source while an integration suite is running.** It resets the
  database and reloads modules; a mid-run edit once produced 81 phantom failures.
- **Hand-check any generated migration to zero `DROP` statements.** The standing
  twelve destructive statements (six `DROP INDEX` on the trigram GIN indexes, six
  `ALTER COLUMN … DROP DEFAULT`) are drift and are never part of your change.
- `npm run lint` runs eslint with `--fix`. It passing proves very little.
- **Trust a live run over any document, including this one.** Handoffs from this
  planner have carried a wrong line number, a stale premise, an invented file
  reference, an instruction that would have leaked the existence of deleted
  tickets, and — twice — a flat claim that a card could not be browser-verified
  when it could. **Say plainly where this document is wrong.**

---

## 1 — Card 1.47: redaction can be outrun by its own email (S–M, no migration)

**The most serious card in this batch. Do it first.**

**Redact a public reply within about a minute of posting it — exactly when someone
notices the mistake — and the dialog says nothing was emailed, and then the
original text is emailed anyway.**

Every link verified in code by the planner on 2026-09-08:

| Step | Where | What happens |
|---|---|---|
| 1 | `notifications.service.ts:998` | Posting a public reply writes a `NotificationOutbox` row whose `body` is the **rendered email containing `message.body`**, status `PENDING`. |
| 2 | `email-outbox-sweeper.service.ts:19` | Production has **no Redis app setting**, so BullMQ cannot deliver. The **sweeper** delivers, on a `setInterval` whose default is **60_000 ms**, and `EMAIL_OUTBOX_SWEEP_INTERVAL_MS` is unset in production. **So `PENDING` lasts up to a minute, not an instant.** |
| 3 | `tickets.service.ts:1215` | The redaction caveat counts **only `SENT`** rows, so mid-window `emailed = 0` and **no warning is shown at all**. |
| 4 | `tickets.service.ts` `redactMessage` | Overwrites `TicketMessage.body` and **never touches the outbox row.** |
| 5 | `email-processor.service.ts:79` | The sweeper later sends `text: record.body` — **the stored, unredacted text**, read from the database at that moment. |

⚠️ **The comment at `tickets.service.ts:1187` says "the send runs at queue time, so
PENDING is momentary." That is not true in production.** Fix the comment too.

### What to build

- [ ] **On redaction, stop any still-unsent email for that message.**
- [ ] ⚠️ **`OutboxStatus` has no `CANCELLED`** — it is `PENDING | PROCESSING | SENT
      | FAILED`. **Do not add an enum value.** A new value needs a migration *and*
      cannot be used in the transaction that adds it (migrations 54 and 56 document
      this). **Reuse `FAILED`, non-retryable**, with a reason string — the same
      shape `markFailed(outboxId, 'SMTP not configured', false)` already uses — and
      **blank the row's `body` and the `html` in its `payload`** so the text is gone
      from there as well.
- [ ] ⚠️ **The outbox has no `messageId` column.** The id lives at
      `payload.event.messageId`, which is why `messageDeliveryLabels` reads rows and
      matches in JS. So you cannot express this as one `where`: select the
      candidate rows for the ticket, match the message id, then act by row id.
      **Go through the same helper the caveat uses** — if the send path and the
      cancel path find rows differently, they will disagree, and that is the
      one-rule-in-two-places drift that produced cards 1.36, 1.38 and 1.50.
- [ ] ⚠️ **This is a race and must be written as one.** The sweeper can claim a row
      (`PENDING → PROCESSING`) between your read and your write. **Update
      conditionally on the status still being `PENDING`** — an `updateMany` whose
      `where` includes `status: 'PENDING'` — and **branch on the returned count.**
      If the count is zero the mail is already gone, and the answer to the agent
      must say so.
- [ ] **Record what happened in the redaction event.** The existing payload carries
      `alreadyEmailed` and `emailedCount`; add the number of sends you stopped. An
      agent should be able to tell "we caught it" from "we did not".

### The caveat now has three cases, not two

The agent is making a different decision in each, so give each its own sentence:

- **Nothing queued, nothing sent** — no caveat. Unchanged.
- **Stopped before it left** — *"This had not been emailed yet, and we have stopped
  it."* **This is the new one and it is the whole point of the card.**
- **Already sent** — the existing wording: *"already emailed to N people… does not
  take the email back."*

- [ ] ⚠️ **Do not report "stopped it" when you did not.** If the conditional update
      matched nothing, the honest answer is the third case. False reassurance is
      the exact defect this card exists to remove; producing a nicer-sounding
      version of it would be worse than shipping nothing.

### The second half of the card

- [ ] A **`SENT`** row keeps the full rendered body in `NotificationOutbox.body`
      **for ever** — the retention job that would delete it is **off** (confirmed
      against production 2026-09-08). Card 1.11's own argument — that preserving
      redacted text moves PHI into a row with weaker read rules than the message it
      came from — **applies to that column exactly as it did to the `TicketEvent`
      the implementer refused to write.** Blank the body on a `SENT` row too, and
      keep `subject`, `toEmail` and the timestamps so the audit question *"did we
      email this, to whom, when"* still has an answer.

### Tests

- [ ] ⚠️ **The test that matters: redact while the row is `PENDING`, then run the
      sweeper, and assert no email was sent and the stored body no longer contains
      the text.** Asserting only the response, or only `TicketMessage.body`, passes
      today with the bug fully present.
- [ ] Redact after `SENT` → the caveat still says "already emailed to N", and the
      outbox body no longer holds the text.
- [ ] Redact while `PROCESSING` → reported as already sent, **not** as stopped.
- [ ] The existing 1.11 tests still pass untouched.

---

## 2 — Card 1.48: redaction, attachments, and a premise of mine that was wrong (S–M)

**Read this section before the card row on the board — the board's framing is
looser than what the schema actually allows.**

I filed 1.48 as *"redaction does not cover attachments."* Having read the schema:
**`Attachment` has no `messageId`. It links only to `ticketId`**
(`schema.prisma:736-757`). **So redaction cannot cascade to attachments, because
there is no message-to-attachment relation to cascade through.** Any handoff
telling you to "also redact the message's attachments" is describing a relation
that does not exist.

What *does* exist is one narrower, real leak:

- [ ] **Inline images survive a redaction.** An image pasted into a message is
      embedded in the body HTML as `<img data-attachment-id="…">`. Redaction
      overwrites `body`, so **the reference disappears** — but the `Attachment` row
      and the blob behind it **remain, and stay reachable from the ticket's
      Attachments tab.** So the picture that should not have been sent is still one
      click away, and the conversation no longer shows any sign it was ever there.
      **That is the bug worth fixing here.**
- [ ] **Decide and state what "remove" means for the blob.** Dropping the
      `Attachment` row while leaving the object in Azure Blob storage is the worst
      of both — invisible in the app, still present in the account. Either delete
      the object too, or keep the row and mark it removed. **Say which you chose and
      why.**
- [ ] ⚠️ **Ticket-level attachments are out of scope for this card.** Removing an
      arbitrary file from a ticket is a **separate action with its own permission
      question**, not a side effect of redacting a message. **If you find yourself
      building a general "delete an attachment" feature, stop and report** — that is
      a new card and the owner has not asked for it.
- [ ] **No migration if you can avoid one.** If marking an attachment removed needs
      a column, **stop and report** rather than writing migration 59 (see §0).
      Deleting the row needs no schema change.

### Tests

- [ ] An inline image in a redacted message is no longer reachable, and the
      attachment list no longer offers it.
- [ ] A file attached to the **ticket** rather than pasted into the message is
      **untouched** — assert this, so the blast radius is pinned by a test and not
      by a comment.
- [ ] Redacting a message with no attachments still behaves exactly as it does now.

---

## 3 — Card 1.49: the row checkbox does nothing (XS, no migration)

`TicketTableView.tsx:212-229`. The `<td>` at `:213` owns the toggle
(`stopPropagation` + `preventDefault` + `selection.toggle`); the `<input>` at
`:221` has **`onChange={() => {}}`** — a no-op — and
`onClick={(e) => e.stopPropagation()}`. So a click on the box is stopped before it
reaches the only handler that acts, while a click on the **padding** works. That is
why it reads as flaky rather than dead.

- [ ] ⚠️ **It is also a keyboard bug.** Space on a focused checkbox dispatches a
      click, so it dies the same way — **the control is unreachable by keyboard, and
      the row has no other way to be selected.** Card 1.12 just made bulk selection
      something agents use daily.
- [ ] **The fix:** give the `onChange` the toggle, and leave the `<input>`'s
      `stopPropagation` in place so the row-click does not also fire. The `<td>` may
      keep toggling for the larger target.
- [ ] ⚠️ **Do not end up with both the input's `onChange` and the `<td>`'s
      `onClick` firing for one click.** Two toggles net to zero and look *identical*
      to this bug.
- [ ] ⚠️ **Why the suite is green on it:** the one test that touches this
      (`ticket-table-awaiting-reply.test.tsx:43`) passes `toggle: () => {}` as a
      stub and uses the checkbox's `aria-label` only as a **text anchor** to locate
      a row. **Nothing anywhere clicks the box and asserts the selection changed.**
      **Add that test, and a keyboard one**, or the next refactor breaks it
      invisibly again.

---

## 4 — Card 1.50: the tag filter cannot accept a comma (S, no migration)

The tickets-list filter box is labelled **"Tags (csv)"** and **eats every comma
you type.** `TicketsPage.tsx:1432-1445`: it is a controlled input whose `onChange`
does `split(",").map(trim+toLowerCase).filter(Boolean)` and whose `value` is
`filters.tags.join(", ")`. The empty segment created the instant you press `,` is
dropped, so React writes the comma back out of the box.

Simulated keystroke by keystroke, typing `network, printer`:

```
key ","  ->  box shows "network"        <- comma gone
key " "  ->  box shows "network"
key "p"  ->  box shows "networkp"       <- the two tags fuse
final tags: ["networkprinter"]          <- matches nothing, no error
```

- [ ] **Single-tag filtering works. Multi-tag is unreachable from the UI**, and this
      is the only tag-filter control on the page.
- [ ] ⚠️ **The capability is not missing, only the control.**
      `list-tickets.dto.ts:151` has accepted `tags?: string[]` all along, and the
      URL path already parses commas correctly — `useFilters.ts:12-18` and `:56`, so
      `?tags=network,printer` works today and is the current workaround.
- [ ] ⚠️ **Two pieces of code parse the same comma-separated list and only one is
      wrong. Delete one of them rather than repairing both** — that duplication is
      the whole cause, and it is the same pattern as cards 1.36, 1.38 and 1.47.
- [ ] A chip/token control is the better answer than a smarter text box, and there
      is already a tag-autocomplete endpoint to feed it (`getTagAutocomplete`,
      `client.ts:1544`). **Your call — say which you chose.**
- [ ] **"csv" must not appear in a label a nurse reads.** Owner's standing
      preference is plain language.
- [ ] **Test that typing two tags yields two tags.** Nothing currently does.

---

## 5 — Card 1.52: search the Add-member user list (S, no migration)

Owner request, from a screenshot. `TeamPage.tsx:1217-1244` renders **every** user
unfiltered — the `availableUsers.map` inside `role="listbox"` — in a `max-h-60`
box. **Production has 111 users** (105 EMPLOYEE, 3 OWNER, 2 TEAM_ADMIN, 1 AGENT,
counted 2026-09-08). The box is 240 px, so **about four are visible and reaching
the end takes roughly 28 scrolls.**

- [ ] ⚠️ **Match on display name AND email.** Several accounts have no display name
      and render their raw address as the name — `tpitts@csnhc.com` is visible in
      the owner's own screenshot — so a name-only filter makes exactly the people
      someone is hunting for unfindable.
- [ ] ⚠️ **There is no combobox primitive in `components/ui/`.** The only search
      precedent in the app is a plain `useMemo` + `toLowerCase().includes()`
      (`AdminTagsPage.tsx:111-113`). **Follow it. Do not add a dependency.**
- [ ] ⚠️ **Do not break the keyboard.** That container already carries
      `onKeyDown={handleListboxNav}` (`:1196`). With a text input inside it, typed
      letters must reach the input while **arrows and Escape still drive the option
      list** — the `role="combobox"` + `aria-controls` + `aria-activedescendant`
      shape, not merely a box above a list.
- [ ] **Scope: the team page only.** The same unfiltered-dropdown pattern also sits
      at `ActionEditor.tsx:125` and `:226`, `CustomFieldRenderer.tsx:367`, and the
      assignee `<select>` on the tickets list. **Write the filter helper so it can be
      lifted, but do not refactor all five here.**
- [ ] **Test that typing narrows the list, that a match on email alone is found, and
      that Enter still picks the highlighted option.** Card 1.49 is the standing
      reminder that a control which looks right and does nothing passes every test
      we own.

---

## 6 — Card 1.45: reports have never excluded deleted tickets (S, no migration)

`reports.service.ts:199-201` carries this comment:

```
// Soft-deleted tickets never count in reports (the raw-SQL reports get
// this from accessConditionSql; the groupBy reports come through here).
```

**The first half is false.** `AccessControlService.accessConditionSql` *does* add
`deletedAt IS NULL` (`access-control.service.ts:130-134`) — but
**`reports.service.ts` never calls it.** Reports scope through `scopeReportQuery`
behind `LeadOrAdminGuard`, and only the Prisma `where` path (`:201`) filters
`deletedAt`. Of the file's **23 `$queryRaw` reports, exactly three** filter it —
the three added by card 1.17 (`:1614`, `:1669`, `:1733`). **The other 20 have
counted deleted tickets since they were written.**

- [ ] Add the `deletedAt` clause to each remaining raw report.
- [ ] ⚠️ **Do NOT fix this by pointing reports at `accessConditionSql`.** That
      fragment also applies role and team visibility, which `scopeReportQuery`
      already does **differently**, and layering the two would silently change who
      can see what. This card is about deleted rows only.
- [ ] **Fix the comment.** It is the reason nobody looked.
- [ ] **One test per report is not the ask** — one test that soft-deletes a ticket
      and asserts every report's count drops is worth more and will not rot.
- [ ] Impact today tracks how many tickets have ever been soft-deleted, so it is
      small and grows quietly. **Say what the numbers moved by**, so the owner knows
      whether any figure they have already relied on was wrong.

---

## 7 — Card 1.51: the bulk macro times out on a slow link (S, no migration)

Found live: a bulk macro across three tickets failed on one with a Prisma
interactive-transaction timeout — **5000 ms allowed, 5037 ms elapsed** — inside
`slaInstance.upsert`. Confirmed in code, all three links:

- `rule-engine.service.ts:499` opens the macro transaction with **no `timeout`
  option**, so it takes Prisma's **5000 ms** default.
- `:667` calls `slaEngine.syncFromTicket(…, tx)` **inside** that transaction, on the
  `set_priority` action.
- That reaches `sla-engine.service.ts:107` `slaInstance.upsert`.

With `BULK_CONCURRENCY = 5` against a remote pooler, five of those run at once.
**Latency, not logic** — the retry succeeded immediately, the rollback was clean,
and the per-ticket report named the ticket and the reason. **The integration suite
cannot see this**; local Postgres is far faster than the remote pooler.

- [ ] **Raise the transaction timeout. Do not move the SLA sync out of the
      transaction.** Moving it out would let the SLA row survive a priority change
      that rolled back — trading a visible timeout for silent inconsistency.
- [ ] **~15 s, not 60 s.** There is precedent for an override at
      `automation-scheduler.service.ts:348` (`{ timeout: 60_000, maxWait: 10_000 }`),
      but a long-held transaction under bulk starves a pooled connection. **State
      what you chose.**
- [ ] ⚠️ **`BULK_CONCURRENCY` is written twice** —
      `run-bulk-with-concurrency.util.ts:2` **and** `tickets.service.ts:2843`. If you
      touch concurrency at all, **touch both or collapse them to one**, or the next
      person tunes the wrong one.
- [ ] A test cannot reproduce the latency. **Assert the timeout option is actually
      passed** instead — cheap, and it catches the regression where someone removes
      it.

---

## 8 — The final Playwright pass

After all seven are committed, **one pass over the running app**, then report.

- [ ] **1.47** — post a public reply, redact it **immediately**, and confirm the
      dialog says it was stopped rather than saying nothing was emailed. Then wait
      out the sweeper interval and confirm **no email arrives**. ⚠️ **This is the
      most important check in the batch.**
- [ ] **1.47 again, the other way** — redact one that has genuinely been sent, and
      confirm the wording is the "cannot take it back" case.
- [ ] **1.48** — paste an image into a message, send it, redact the message, and
      confirm the image is not reachable from the Attachments tab. Then confirm a
      separately attached file **is** still there.
- [ ] **1.49** — click **directly on the checkbox** in a ticket row and confirm it
      selects. Then do it with **Space** on the focused checkbox.
- [ ] **1.50** — type `network, printer` and confirm you end up with **two** tags.
- [ ] **1.52** — type part of an **email address** whose account has no display name
      and confirm it is found; check arrows and Enter still work.
- [ ] **1.45** — soft-delete a ticket and confirm a report's count drops by one.
- [ ] **1.51** — run a bulk macro over several tickets and confirm it completes.
      Note that a timeout here is environmental, not a regression.

## 9 — What to report back

1. **Seven commit SHAs**, one per card, and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, and vitest. **Migration count must still be
   58** — if it is 59, say why in the first line of your report.
3. The decisions this handoff asked you to state:
   - 1.47 — how you found the rows without a `messageId` column, and what the
     three caveat sentences ended up saying
   - 1.48 — what "remove" means for the blob, and whether you needed a column
   - 1.50 — smarter text box or chip control, and which of the two parsers you
     deleted
   - 1.52 — the combobox shape you used
   - 1.51 — the timeout value, and whether you touched `BULK_CONCURRENCY`
   - 1.45 — **what the report numbers moved by**
4. **For each card, the test that would now fail if the bug came back.** Not the
   test count — the specific assertion. Six of these seven shipped past a full
   suite, so this is the part that matters.
5. Anything that did not match. **This document is wrong somewhere** — it always
   has been. Say where.

**Stop and report instead of improvising** if 1.47's cancel path seems to need a new
`OutboxStatus` value, if 1.48 seems to need a migration or a general
delete-an-attachment feature, if 1.45 seems to need `accessConditionSql`, or if
`access-control.parity.spec.ts` goes red at any point.
