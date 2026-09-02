# Implementation Prompt — 1.34 Rewrite the reply email

**Date:** 2026-09-02
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.34 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** the email a requester receives leads with two lines of filler, buries
the question fourth, shows them `WAITING_ON_REQUESTER`, and makes "View Ticket"
a large button while "reply to this email" — the thing we actually want — is grey
text. Its inbox preview contains no information at all.

**Cost:** none. API only. **No schema, no migration, no Azure change, no dependency.**

**Also carries one inherited task** — see §5 Task 0. Card 1.33's refusal-recording
path shipped without a test, and this card is the next thing to touch that file.

> **Sequencing: this must start after card 1.33 is committed.** 1.33 rewrites the
> recipient model inside `messageAdded` and deletes the internal-note email path.
> Both cards touch the same function, and 1.33 is the one with correctness at
> stake. Do not run them in parallel.

---

## 1. The design, decided

Owner reviewed five directions and chose **design 2, the quoted block, for every
department** — no per-department variant. Reviewed at
`https://claude.ai/code/artifact/47581036-e24a-41b8-bb52-3b0979d11bbb`, and
stress-tested across eleven exchanges with a mid-thread loop-in at
`https://claude.ai/code/artifact/17360b4b-212a-40c6-a87f-2dd8605b19c8`.

The whole body is:

```
----- Reply above this line -----

┃ VI LE · SEP 2, 10:02
┃ Thanks Dana — so 08-31 is right but the punch is missing.
┃ Can you send a corrected timesheet?

Reply to this email
──────────────────
view online
```

**Marker. Quote block with a name and time. A two-line footer: the instruction
and the link. Nothing else.**

The instruction is exactly **"Reply to this email"** — the owner's wording. An
earlier draft read "Reply to this email and your answer goes onto the ticket";
the shorter line is the decision.

### What was deliberately removed, and why

Each of these was in an earlier draft and the owner cut it. Do not reintroduce
them:

| Removed | Because |
|---|---|
| Ticket ID in the footer | The **subject** already carries `[PA_20260901_001]` |
| Facility in the footer | The subject already carries it too |
| "Also copied: …" | The `Cc` header does this. Every client shows at least "and 2 others" |
| "Update on your request" heading | Says nothing the subject has not said |
| "We have an update on your request" | Same, and it pushes the real content below the fold |
| "Ticket details" block | Redundant with the subject, and it carried the status enum |
| "Best regards, CSNHC Support" | Duplicates the From line |

## 2. Facts established first (verified 2026-09-02)

| Fact | Consequence |
|---|---|
| `buildPublicReplyHtmlBody` (`notifications.service.ts:617`) builds the current HTML: a heading, a greeting, a filler line, a bordered quote, a "Ticket details" block containing `ticket.status` **raw**, a "View Ticket" button and a sign-off. | This is the function to rewrite. `WAITING_ON_REQUESTER` reaching a requester is the clearest single defect in it. |
| The **subject** is built by `formatTicketSubject` in `ticket-email-thread.service.ts` and already produces the owner's preferred form. | **Do not touch the subject.** It is correct. |
| `EmailService` prepends `REPLY_ABOVE_MARKER` to **both** the text and HTML parts (`email.service.ts:246`, `:261`) — the HTML as a bare `<p>` above whatever body it is given. | The marker is **already handled**, outside this function. Do not add a second one; do not remove the existing one — `stripQuotedReply` matches on it. |
| There is a plain-text sibling, `buildPublicReplyTextBody`. | It needs the same treatment. It is a deliverability signal and it is what watches show. |
| `escapeHtml` is used on every interpolated value, and newlines become `<br />`. | Keep both. This body is built from a requester-visible message and an agent-supplied name. |
| The font stack is `Segoe UI, Arial, sans-serif` — **unquoted**, so `Segoe UI` is invalid CSS and silently ignored by strict clients. | One-character fix while you are in there: `'Segoe UI', Arial, sans-serif`. |

## 3. Goal

A requester opens the email and the first thing they see is the question. The
inbox preview is the question. Nothing else is in the message.

## 4. Decisions and assumptions

1. **The quote block is the only structural device.** A left border, a small
   uppercase `NAME · TIME` label, the message. It exists so that a ticket with
   eleven exchanges is still readable — which is the one thing the plainest
   design could not do.
2. **The preheader is the highest-value part of this card.** The first ~90
   characters of the agent's message, plain, so the inbox preview carries the
   question instead of boilerplate. Standard technique: a hidden preheader
   element at the very top of the body (`display:none;font-size:0;line-height:0;
   max-height:0;overflow:hidden;mso-hide:all`). Strip newlines, collapse
   whitespace, truncate on a word boundary.
3. **No conversation history, ever.** The recipient's own client quotes the
   previous message. If we add a digest it sits on top of that and the email
   doubles. This is a rule, not an omission — write it in a comment.
4. **One design for every department.** The generic-vs-named From line
   (card 1.31) still applies and is unchanged; the *body* does not vary by team.
5. **The footer is two lines: the instruction, then `view online`.** Nothing
   else — no ticket id, no facility, no "Also copied". The link stays because it
   is the only route to earlier history for someone looped in mid-thread.
6. **Plain text mirrors the HTML exactly:** marker, `Name · time`, the message,
   `Reply to this email`, then the URL on its own line. Same order, no ASCII-art
   borders.

## 5. The work

Kill stray node processes; Postgres up; no other test run active. **Confirm 1.33
is committed first.**

### Task 0 — Pin the refusal event (inherited from 1.33)

**Files:** Modify `apps/api/test/integration/email-safety.spec.ts`

Card 1.33 moved the domain check to compose time, so an out-of-domain address now
drops out of the `Cc` and the email still goes to everyone else — correct. It then
records an `EMAIL_RECIPIENT_REFUSED` ticket event, which is **the only way an
agent ever learns somebody did not receive their message.**

**That path has no test.** `EMAIL_RECIPIENT_REFUSED` appears in exactly one place
in the repo: `notifications.service.ts:593`. And the write is wrapped in a
`.catch()` that only logs — so if it fails, nothing surfaces on the ticket and
nothing looks wrong. Untested plus silently-swallowed is how an agent waits three
days for a reply from someone who was never contacted.

- [ ] Queue a public reply where one recipient is outside
      `EMAIL_ALLOWED_DOMAINS`. Assert **(a)** the email is still queued for the
      allowed recipients, and **(b)** a `EMAIL_RECIPIENT_REFUSED` event exists on
      the ticket with the refused address in its payload.
- [ ] Do this **first**. It is inherited work, it is five lines, and it is the
      weakest link in an otherwise solid card.

### Task 1 — The HTML body

**Files:** Modify `apps/api/src/notifications/notifications.service.ts`

- [ ] Rewrite `buildPublicReplyHtmlBody` to §1. Keep the table-based outer
      structure and inline styles — Outlook has no flexbox and no `<style>`
      block.
- [ ] Add the hidden preheader per §4.2, as the **first** element in the body.
- [ ] Quote the font family.
- [ ] Keep `escapeHtml` on every interpolation and the `\n` → `<br />`
      conversion.
- [ ] **Delete** the status, the ticket-details block, the button and the
      sign-off. Do not leave them behind a flag.

### Task 2 — The plain-text body

**Files:** Modify `apps/api/src/notifications/notifications.service.ts`

- [ ] `buildPublicReplyTextBody` to §4.6.

### Task 3 — Tests

**Files:** Create/modify `apps/api/src/notifications/reply-email-body.spec.ts` (or extend an existing spec)

- [ ] The rendered HTML **contains no** `WAITING_ON_REQUESTER`, no other
      `TicketStatus` value, no "View Ticket", and no "Best regards".
- [ ] The preheader holds the start of the agent's message, is truncated on a
      word boundary, and is not visible text (asserted on the style attribute).
- [ ] A message containing `<script>` or `&` is escaped; newlines become `<br />`.
- [ ] A name containing a quote or comma does not break the label.
- [ ] The plain-text part has the same parts in the same order, with the URL on
      its own line.
- [ ] **A long message does not have history appended** — assert the body
      contains the message once.
- [ ] Targeted run, then the **full** suite. **Do not edit source while it runs.**

### Task 4 — Docs, baselines, commit

- [ ] `docs/email-conversation.md`: the body's parts, and the
      removed-on-purpose table from §1 so nobody helpfully adds the ticket
      details block back.
- [ ] `CLAUDE.md` + `repo-landmines.md` baselines, real numbers.
- [ ] One commit. `e2e/` is untracked on purpose.

## 6. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx jest --config ./test/jest.integration.json test/integration/email-safety.spec.ts > ../../it-email.txt 2>&1; grep Tests: ../../it-email.txt
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

Baselines to beat: whatever 1.33 leaves them at — read `CLAUDE.md`, do not assume.
Delete those two log files afterwards.

## 7. Security considerations

- **Every interpolated value stays escaped.** The message body comes from an
  agent and is rendered into HTML that reaches a requester's inbox. `escapeHtml`
  is not optional and there is a test for it.
- **No status, no internal field, no metadata** in the body. The removed
  "Ticket details" block is the one that leaked an internal enum; do not
  reintroduce anything of that shape.
- The preheader is derived from the same message body and **must be escaped
  too** — it is easy to forget because it is invisible.
- Card 1.22's guards and 1.33's recipient model are untouched by this card. If a
  test of theirs goes red, stop: this is a body rewrite and should not reach
  them.

## 8. Acceptance criteria

1. The body is exactly the parts in §1 and nothing else: marker, quote block,
   the line **"Reply to this email"**, and a `view online` link.
2. The inbox preview shows the beginning of the agent's message.
3. No `TicketStatus` value, no "View Ticket" **button**, no sign-off, no ticket
   id, no facility and no "Also copied" appears in either part. A plain
   `view online` **text link** is expected and correct.
4. HTML escaping holds, including in the preheader.
5. The plain-text part carries the same parts in the same order, with the URL
   on its own line.
6. The subject is **unchanged**.
7. Every 1.22 and 1.33 test still passes untouched.
8. Both `tsc` clean; unit, integration and vitest at or above baseline.

## 9. Manual test steps

**No real send.** Post a reply on a dev ticket and read the composed body off the
outbox row. Then paste the HTML into a browser to eyeball it, and — if you have a
throwaway account anywhere — into a real client, because Outlook is the only
judge of Outlook.

Check the preheader by looking at the raw HTML for the hidden element, not the
rendered page.

**The API runs from `dist`** — if a change appears to have no effect, suspect the
build (`repo-landmines.md`).

## 10. What to report back

1. Commit SHA. 2. Every `Tests:` line, both `tsc`, vitest. 3. `git diff --stat`.
4. **The composed HTML and plain-text bodies, verbatim**, for one real reply. The
   planner will read them against §1.
5. Anything that did not match, in particular: whether the hidden preheader
   survived the clients you could test, and whether anything in the removed list
   turned out to be load-bearing for a reason nobody spotted.

**Stop and report instead of improvising** if this appears to need a subject
change, a schema change, or a change to `EmailService`. None should be necessary —
this is one function and its plain-text sibling.
