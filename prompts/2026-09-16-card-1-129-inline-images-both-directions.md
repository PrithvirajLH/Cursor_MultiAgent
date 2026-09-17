# Implementation Prompt — card 1.129: an inline image should survive in both directions

**Date:** 2026-09-16
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** **1.129** — three faults, one cause
**Raised by:** the owner, 2026-09-16, from `PA_20260910_381` after cards 1.116,
1.119, 1.121 and 1.128 finally made emailed attachments arrive at all.

> ## The owner's three questions
>
> 1. *"whats the best UI/UX to keep the pasted img inline or on attachment tab"*
> 2. *"how will an agent know that they attached a file? there is no indication
>    apart from number increase on attachment"*
> 3. *(screenshot)* — an agent's pasted image arriving in the requester's inbox
>    as raw `<img data-attachment-id=...>` markup.

> # ⚠️ THE APP ALREADY SOLVES THIS. TWICE. JUST NOT FOR EMAIL.
>
> **Do not design a new inline-image system.** One exists, it works, and it is
> tested:
>
> - `RichTextEditor.tsx:244` uploads a pasted image and stamps
>   `<img data-attachment-id="…">` into the body.
> - `MessageBody.tsx:44` finds `img[data-attachment-id]` on render, fetches the
>   attachment and hydrates the image in place.
> - `inline-attachment-ids.util.ts` parses the markers server-side.
> - `redaction-caveat.ts:86` already understands them.
>
> **Every fault below is email failing to join that pipeline at one end or the
> other.** This is the same shape as cards 1.36, 1.38, 1.47, 1.50, 1.61, 1.70 and
> 1.75: **two paths that must agree, and only one was taught the rule.**

---

## Fault A — an agent cannot see that a message carried files

**The owner's question 2. Highest value of the three: it affects every agent,
every day.**

### Measured

- `tickets.service.ts` `listMessages` does `include: { author: true }` and
  **nothing else**. **The API returns no attachment data per message**, so the
  bubble could not show it even if the UI wanted to.
- `TicketConversation.tsx` has **no attachment rendering at all**. The matches
  for "attachment" in that file are the *composer's* upload controls.
- So the only signal is the Attachments tab counter changing — which says
  *something* arrived, but not **which message**, **what**, or **whether it is
  the file the agent asked for**.

⚠️ **This became fixable only today.** Card 1.121 links `Attachment.messageId`,
and the owner's 12.8 KB paste at 19:49:20 is **the first attachment in this
system's history to carry one**. Before that the association did not exist.

✅ **A signal already exists and is not surfaced:** `attachmentCount` is recorded
on the inbound event (`inbound-email.service.ts:417` and `:513`). The timeline
knows. The conversation does not.

- [ ] **Return attachments per message from `listMessages`.** Filename, size,
      content type, id, and `isInline` if it is being kept.
- [ ] **Render them under the message bubble as chips** — name, size, click to
      preview. That is the smallest thing that answers *"did the file I asked for
      arrive, and on which reply?"*
- [ ] ⚠️ **Historical rows cannot be attributed.** Everything before 2026-09-16
      has `messageId = NULL` and **no backfill is possible** — the association was
      never recorded. **Chips will be empty for those, and that is correct.** Do
      not invent a heuristic that guesses which message an old file belonged to.
- [ ] ⚠️ **Respect card 1.83.** An attachment on an INTERNAL note must not appear
      in a chip a requester can see. The message already carries its type; use it.

## Fault B — an inbound pasted image loses its position

**The owner's question 1.**

### Measured

The owner pasted a screenshot; it arrived as an `Attachment` row, and the stored
message body has **no `<img>` and no `cid:`** — verified on the 19:49 message.

The cause is `select-body-text` / `html-to-text` converting the body at the Graph
boundary (**card 1.62**). That conversion drops `<img>`, and with it the `cid:`
reference that said *"the image belongs here, between these two sentences."*
**Position is lost, not just markup.**

⚠️ **A pasted screenshot mid-sentence is meaningless once separated from the
sentence** — *"the error looks like this: [image]"*. An attached PDF is fine in a
list; a paste is not.

- [ ] **Map each inline `cid:` to the stored attachment and emit
      `<img data-attachment-id="…">` in its place**, so the inbound path produces
      exactly what the composer already produces and `MessageBody` hydrates it
      with no new rendering code.
- [ ] ⚠️ **This requires the raw HTML to survive further into the pipeline than
      it does today**, which touches card 1.62's boundary decision. **That is the
      real work in this card.** Card 1.62 is not wrong — a plain-text body is
      right for everything else — but the `cid:` map has to be extracted *before*
      the conversion throws it away.
- [ ] ✅ **This also retires the size threshold honestly.** A `cid:` **inside the
      quoted history** is a signature logo; one **above it** is a paste. That is
      the signal card 1.122 needs. **`INBOUND_INLINE_IMAGE_MIN_BYTES` is set to
      10240 in production as a deliberate compromise** — the owner's paste was
      13 KB and the real logos were 104–120 KB, so **the 50 KB default was
      excluding screenshots while letting logos through, the exact opposite of
      its purpose.** Once position is known, the threshold can go.
- [ ] **Keep every file in the Attachments tab as well.** Inline is *where you
      read it*; the tab is the complete manifest. That is what Gmail, Outlook and
      every helpdesk do, and it is what the in-app path already does.

## Fault C — ⚠️ an outbound pasted image is sent to the requester as raw markup

**The owner's screenshot. The most embarrassing of the three, because it reaches
people outside the organisation.**

### Measured on the 19:59 outbound email

```
text body has raw <img      : TRUE   <- this IS what the requester reads
html part has <img          : FALSE  <- no image element at all
html part has data-attachment-id : TRUE
```

The requester received, as literal text:

```
IT BOT <img data-temp-id="6bdd3f50-…" alt="image.png" class=""
data-attachment-id="324e680b-…">see the img
```

**This is the exact mirror of card 1.62**, which fixed inbound email showing its
HTML source. The same fault now runs outbound.

⚠️ **Note `data-temp-id` is still present alongside `data-attachment-id`.**
`redaction-caveat.ts:86` documents `data-temp-id` as the *pre-upload* marker that
`data-attachment-id` replaces once the upload resolves. **Both surviving into a
sent email means the marker is never cleaned up after upload** — worth fixing
here, and worth checking whether it also persists in the stored body forever.

- [ ] **The text part must not contain markup.** Strip the tag and leave
      something a human reads — the `alt` text, or a plain line naming the file.
- [ ] **The HTML part must carry the actual image**, as a `cid:` inline part or a
      signed URL. ⚠️ **Prefer `cid:`** — a URL to an attachment endpoint will be
      blocked by most mail clients and needs authentication the recipient does not
      have.
- [ ] ⚠️ **Check card 1.44's seven one-click links still work** after touching the
      outbound HTML builder, and **card 1.68's footer removal** stays removed.
- [ ] **Clean up `data-temp-id`** once the upload resolves, so it never reaches a
      stored body or an email.

---

## What to verify

1. **An agent sees chips on a message that carried files**, naming each one.
2. **A message with no files shows no chips and no empty row.**
3. **An attachment on an INTERNAL note does not appear to the requester** — card
   1.83, which is still unexercised in production.
4. **A pasted inbound image renders in the body at its position**, and is also
   listed in the Attachments tab.
5. **A signature logo in quoted history does NOT render inline** and ideally is
   not stored at all — with the threshold no longer doing that job.
6. **An agent's pasted image reaches the requester's inbox AS AN IMAGE**, with no
   `<img`, no `data-temp-id` and no `data-attachment-id` visible as text.
7. **Card 1.44's one-click links still work** from a resolved email.

## Sequence

**A first.** It is self-contained, it is the owner's daily pain, and it does not
depend on B or C.

**C second.** It is the one that reaches people outside the organisation, and it
is currently sending markup to requesters.

**B last and largest.** It touches card 1.62's boundary decision, and it is what
finally lets card 1.122's size threshold be deleted rather than tuned.

## Baselines to hold

api `tsc` 0, unit **856 / 91**, web `tsc` 0, vitest **416 / 61**, **67
migrations**. Production is `2303c72`.
