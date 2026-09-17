# Implementation Prompt — card 1.137: a file that arrives live has no chip until you reload

**Date:** 2026-09-17
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** **1.137** — S, one field and two call sites
**Raised by:** the PLANNER 2026-09-17, found while building cards 1.133 and
1.135 against the live behaviour the owner reported.

> ## What happens
>
> A requester emails a file. The Attachments **tab counter** goes up in real
> time. The **chip under the message** — the thing card 1.129 fault A built so
> an agent can see *which* reply carried *what* — does not appear until the page
> is reloaded.
>
> So the agent is back to the signal card 1.129 was written to replace: a number
> changed somewhere, and no way to tell what arrived or on which message.

---

## ⚠️ THIS IS THE SAME METHOD, FOR THE THIRD TIME

`toRealtimeMessagePayload` is the **second message-read path**, and it has now
been found missing a display rule three times:

| Card | What the fetch path did that the socket did not |
|---|---|
| **1.75** | trim the quoted reply |
| **1.135** | hide an unresolved `[[cid:…]]` marker |
| **1.137** | carry the message's attachments |

Each was found in production, by the owner, on `PA_20260910_381`. **The pattern
is not "somebody forgot" — it is that the two paths have no shared shape forcing
them to agree.** Worth saying out loud in the fix, because a fourth rule is
coming.

## Measured

- **The fetch path returns them.** `tickets.service.ts` `listMessages` includes
  `attachments: { select: { id, fileName, contentType, sizeBytes } }` — added by
  card 1.129 fault A.
- **The socket payload has no such field.** `realtime.service.ts:46-56` types
  `message` as `{ id, body, type, createdAt, author }` and nothing else, and
  `toRealtimeMessagePayload` returns exactly that.
- **So the client cannot render a chip it was never sent.**
  `TicketDetailPage.tsx:628` `toTicketMessage` builds a `ConversationMessage`
  with no `attachments`, and `chipAttachments` in `TicketConversation.tsx` reads
  `message.attachments ?? []` — empty, every time, for a live message.

## The work

- [ ] **Add `attachments` to `TicketChangedPayload['message']`**
      (`realtime.service.ts`) with the **same four fields** `listMessages`
      selects. ⚠️ **`storageKey` must not be among them** — it names the blob
      and has no business in a message payload; the fetch path already
      deliberately selects rather than includes, for exactly this reason.
- [ ] **Fill it in `toRealtimeMessagePayload`** and give every caller the
      attachments to pass.
- [ ] **Carry it in `toTicketMessage`** and **in the upsert branch of
      `appendRealtimeMessage`** (`TicketDetailPage.tsx:643`). ⚠️ **THE UPSERT
      CURRENTLY COPIES ONLY `body`** — card 1.135 wrote it that way on purpose,
      so that `localStatus` and the local send flow's own fields survive. Add
      `attachments` to the copied set explicitly; do not replace the whole row.

### ⚠️ The ordering problem, which is the real work

**Storing the files happens AFTER the message is pushed.** `addMessage` emits
`message_added` and returns; `attachInboundEmailAttachments` runs afterwards. So
**the first push can never carry attachments** — they do not exist yet.

Card 1.135 added a second push, but **only when the body changed** (i.e. only
when an inline image resolved a marker). **A paperclip file on an emailed reply
changes no body text, gets no second push, and would still need a reload.**

- [ ] **Emit once the files are stored, whether or not the body changed.** The
      natural place is beside card 1.135's re-emit in
      `inbound-email.service.ts` `resolveInlineImageMarkers`, but that method
      returns early on an unchanged body — so either widen it or emit from the
      caller after `attachInboundEmailAttachments`. **Say which you chose.**
- [ ] ⚠️ **Do not simply re-emit `attachment_added` and refetch the page.** It
      is already emitted there and the handler at `TicketDetailPage.tsx:1185`
      deliberately does **not** reload messages. Turning it into a refetch would
      undo the whole point of pushing the message inline and put a round trip on
      every attachment.

## ⚠️ What must not break

- [ ] **Card 1.83 — an internal note's file must not reach a requester.** The
      socket is already safe and the reason is *not* obvious: `addMessage`
      passes `message: type === PUBLIC ? payload : null`, so an internal note
      pushes **no body and no author**, and therefore no attachments either.
      **That guard is what makes this card safe. Do not relax it** while adding
      a field to the payload it carries.
- [ ] **An image the body already draws still gets no chip.** `chipAttachments`
      filters on `data-attachment-id="<id>"` appearing in the body. A live
      message whose body is still the card 1.135 *placeholder* has no id in it
      yet — **so a pasted screenshot would chip for a moment and then stop**.
      Decide and state which you want: suppress chips while the body has
      `data-attachment-pending`, or accept the flicker. **The first is better
      and is two lines.**
- [ ] **A message stored before 2026-09-16 has `messageId = NULL`** and no
      backfill is possible (card 1.129 fault A). Chips stay empty for those and
      that is correct.

## What to verify

1. **A requester emails a document to an OPEN ticket** — the chip appears under
   the new message **without a reload**, naming the file and its size.
2. **A requester emails a pasted screenshot** — the picture resolves in place
   (card 1.135) and does **not** also get a chip.
3. **An agent posts an INTERNAL note with a file** — a requester watching the
   same ticket sees **no message and no chip**.
4. **A reload shows exactly what the live view showed** — the two paths agree,
   which is the whole point.
5. **An old message still shows no chip row**, not an empty strip.

## Baselines to hold

api `tsc` 0, unit **904 / 93**, web `tsc` 0, vitest **445 / 64**, **67
migrations**. Production is `cf83183`; cards 1.133, 1.135 and 1.136 are built
and undeployed at the time of writing.
