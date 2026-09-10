# Implementation Prompt — 1.62 An inbound email shows its HTML source

**Date:** 2026-09-10
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.62 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** an inbound email is stored and displayed as its raw HTML document.
The agent reads `<html><head><meta http-equiv=…` where the sender's sentence
should be.

**Cost:** none. **No migration.** API only — the web is already correct and must
not be changed. See §5.

> Found on 2026-09-10, in the first minutes of card 1.24 being live, on the
> first real reply the worker ever ingested (`NA_20260910_357`). **1.24 itself
> works.** Fetch, thread, ingest, move-to-Processed and the cursor are all
> correct. This is the step after them.

---

## 1. What the agent actually sees

The sender typed one sentence. The conversation shows **5,325 characters** of
markup as literal text:

```
<html><head> <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<style type="text/css" style="display:none"> <!-- p {margin-top:0; margin-bottom:0} -->
</style></head><body dir="ltr"><div class="elementToProof" style="font-family:Aptos,…
```

Buried inside it, in full:

| Fragment | Why it is there |
|---|---|
| `Ticket acknowledgement received.` | **the entire human content** |
| Corporate signature block | Outlook appends it |
| `----- Reply above this line -----` and everything below | our own outbound email, quoted back |
| `[pilot mode] EMAIL_TEST_RECIPIENTS is set…` | our pilot notice, quoted back |
| `!!! WARNING !!!` + confidentiality footer | the tenant's mail rule |

The requester's actual words are roughly **0.6%** of what is on screen.

## 2. Fault A — the body is HTML and nothing converts it

`apps/api/src/inbound-mailbox/graph-mail.http-client.ts:145`:

```ts
const bodyText =
  typeof item.bodyPreview === 'string' && item.bodyPreview.trim()
    ? String(body?.content ?? item.bodyPreview)
    : String(body?.content ?? '');
```

The field is named `bodyText`. It holds `body.content`, which for any mail sent
from Outlook is a **complete HTML document**. `bodyPreview` — which Graph already
returns as plain text — is only ever reached when `body.content` is missing.

Note the branch is close to dead as written: both arms prefer `body.content`, so
the `bodyPreview.trim()` test decides almost nothing. Whatever the fix, that
expression should stop pretending to make a choice it does not make.

**Fix.** Convert to text at the boundary, before the value leaves the Graph
client. Prefer `body.content` when `contentType` is `text`, and flatten when it
is `html`. `contentType` is already read into scope on the line above and then
never used — that is the signal to branch on. Keep the flattener small and
dependency-free if that is a close call: block elements become newlines, `<br>`
becomes a newline, tags are dropped, entities are decoded. Do not reach for a
sanitiser — nothing is being rendered as HTML, so there is no injection to
sanitise, only noise to remove.

## 3. Fault B — `stripQuotedReply` is written, tested, and never called

`apps/api/src/notifications/quoted-reply.util.ts` exists. It has its own spec
file, twelve passing cases, and a careful doc comment explaining it is
**display-only** so nothing an audit needs is discarded. That design is right and
should be kept.

**No production code calls it.** The only importers are its own spec and
`email.service.spec.ts`. `email.service.ts` imports `REPLY_ABOVE_MARKER` alone —
it *writes* the marker and nothing *reads* it. The contract described in that
util's own comment ("`email.service.ts` writes it, `stripQuotedReply` reads it")
is half-built.

And it would not have helped here even if it were wired up. Its markers are
line-anchored:

```ts
new RegExp(`^${toLiteralPattern(REPLY_ABOVE_MARKER)}\\s*$`, 'm')
```

In this body the marker sits inside `<p>----- Reply above this line -----</p>`,
so `^`/`$` cannot match. **Fault A must be fixed first, or fixing B changes
nothing** — trimming only works once the body is really text.

**Fix.** Call `stripQuotedReply` on the display path once A lands. Storage keeps
the full converted body, exactly as the util's comment requires.

## 4. Fault C — a new email ticket gets HTML as its `description`

Wider blast radius than the message case, and the reason this is not merely
cosmetic. `apps/api/src/tickets/inbound-email.service.ts`:

- `:265` — a reply on an existing thread → `{ body: payload.body, … }`
- `:371` — mail with no thread → **`description: payload.body`**, a brand-new ticket

So every ticket opened by email gets a full HTML document as its description.
`Ticket_description_trgm_idx` (migration `20260220150000`) is a trigram index on
that column, so this lands directly in ticket search: once a handful of such
tickets exist, a search for `font-family`, `Calibri` or `margin` matches all of
them, and the confidentiality footer's words are in every single one.

✅ **ANSWERED by the planner 2026-09-10, so you do not need to trace it: NO.**
AI classification does **not** read `Ticket.description` for an email-channel
ticket, so fault C's blast radius is **search only**. Two facts settle it:

- `ai.service.ts:479` sits inside **`classifyAndCreateTicket`** (`:177`), which is
  the **AI Submit** entry point — it *creates* a ticket from AI-parsed input and
  selects `description` for its own return value. It is not a classifier being fed
  an existing ticket.
- **`AiService` is imported nowhere outside the `ai/` module.** Inbound email
  creates through `ticketsService.create()` (`inbound-email.service.ts:368`), which
  never reaches it.

**So do not widen this card to the AI path.** If that ever changes — if something
outside `ai/` starts importing `AiService` — the markup problem arrives there too,
which is worth a comment where the conversion lands rather than a card now.

## 5. Do not "fix" the web

`TicketConversation.tsx` renders a body as text — `whitespace-pre-wrap` at `:409`
and a `<pre>` at `:440`. **That is correct and must stay.** Rendering an inbound
body as HTML would take arbitrary third-party markup from outside the
organisation and inject it into an authenticated page. The bug is that the API
stores markup, not that the web declines to execute it.

## 6. What to verify

Unit level throughout; none of this needs a browser.

1. An Outlook HTML mail ingests as readable text — no tags, no `<style>`, entities
   decoded.
2. A `text/plain` mail is **unchanged**, byte for byte.
3. The quoted block below `----- Reply above this line -----` is gone from the
   display, and still present on the stored record.
4. A reply that is *entirely* quoted text still shows something — the util's
   existing "kept.length === 0" guard must survive.
5. A new email-created ticket's `description` is text, not markup (Fault C).
6. `stripQuotedReply` has at least one production caller, asserted by a test that
   fails if it is unwired again.
7. Ticket search for `font-family` returns nothing.

Add a fixture from the real message: it is in `glovebox@csnhc.com` / Processed,
subject `Re: [send test 2] reply-to base [NA_20260910_357]`. It exercises all
five noise sources at once and is the honest regression case.

Baselines to hold: api `tsc` 0, unit **598 / 59 suites**, integration
**735 + 1 skipped** (72 of 73 suites), web `tsc` 0, vitest **239 / 38 files**.

## 7. Priority

**High for a cosmetic-sounding card**, because it is the first thing anyone sees
of the feature that just went live, and because Fault C quietly degrades ticket
search for every email ticket from here on. Nothing is unsafe and no data is
lost — the full body is on the record and the web is not executing any of it.

Sequence is fixed: **A, then B.** C travels with A. Doing B alone changes nothing
and would look like a fix.

Related: **1.35** (the pilot-mode preamble making previews unreadable) is the same
theme from the outbound side — our own boilerplate crowding out the message. This
card is where that boilerplate comes *back* to us, quoted.
