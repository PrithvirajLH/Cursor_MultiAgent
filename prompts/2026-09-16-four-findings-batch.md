# Implementation Prompt — four findings from the first working attachment

**Date:** 2026-09-16
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** **1.120**, **1.121**, **1.122**, **1.123**
**Found by:** the deploy session, verifying card 1.116 + 1.119 in production on
`PA_20260910_381` — the first email attachment ever to reach this platform.

> ## Why these four arrived together
>
> Until 2026-09-16 the inbound attachment path had **never worked**. Card 1.116
> made the worker ask Graph for attachments; card 1.119 stopped the download
> 400ing. The moment seven real files landed on a real ticket, four separate
> things became visible that nothing could have exercised before.
>
> ⚠️ **None of these is a regression.** Three are gaps that were unreachable, and
> one (1.120) is a pre-existing layout fault that seven attachments merely made
> obvious.

---

## Card 1.120 — a tall tab panel is clipped with no way to scroll to it

**Web only. No migration, no API change. The most user-visible of the four.**

> **The owner's words, 2026-09-16:** *"image preview is pushed to the bottom
> without scroller."*

### Measured in production, not inferred

With the preview open on the Attachments tab:

```
panel-attachments   clientHeight 562   scrollHeight 1015   clipped 453px
                    overflowY: visible     innerScrollers: NONE
preview panel       top 856   bottom 916   viewport 889
document.scrollable false      body overflow-y: hidden
```

**453 pixels are unreachable.** The preview begins 856px into an 889px viewport —
33px of it visible, the rest gone. Every ancestor is `overflow: visible`, the
container above is `lg:overflow-hidden`, and the body does not scroll. There is
no scroller anywhere in the chain that can reach it.

### The cause — one shared helper

`apps/web/src/pages/ticket-detail-tabs.ts:52`:

```ts
return tab === activeTab
  ? "absolute inset-0 flex flex-col"   // ← no overflow-y, no min-h-0
  : "absolute inset-0 hidden";
```

The active panel is pinned to a fixed box by `absolute inset-0` and given no way
to scroll its own overflow.

- [ ] **Add `overflow-y-auto min-h-0` to the ACTIVE branch.** `min-h-0` is not
      optional: a flex child will not shrink below its content height without it,
      and the scroller never engages.
- [ ] ⚠️ **This helper serves all THREE tabs** — conversation, attachments and
      timeline. Neither of the other two has an inner scroller either (verified
      live: `innerScrollers: []` on the attachments panel), so all three share
      the fault whenever content is tall enough.
- [ ] ⚠️ **CHECK CONVERSATION BEFORE SHIPPING.** It has its own scroll behaviour —
      a message list and scroll-to-latest. **A panel-level scroller may give it
      two scrollbars or break the auto-scroll.** The deploy session could not test
      this because a hidden panel measures 0×0. **Make the panel visible and
      measure all three before calling it done.**
- [ ] **Verify at a short viewport** (~700px) as well as a tall one. The bug only
      appears when content exceeds the box.

### Note the interaction with card 1.117

**1.117 (the image carousel) will make this worse, not better**, if shipped
first: a carousel adds height to the same clipped panel. **Do 1.120 first, or do
them together.**

---

## Card 1.121 — every emailed attachment has a null `messageId`

**API. No migration — the column and its foreign key already exist (migration 67).**

### The evidence

All seven attachments from the live test:

```
HIPAA.png                   1.96MB  msg=NULL  blob=yes
ChatGPT Image ... (2).png   2.03MB  msg=NULL  blob=yes
ChatGPT Image ... (1).png   2.16MB  msg=NULL  blob=yes
image.png x2                1.05MB  msg=NULL  blob=yes
image.png x2             0.12/0.10MB msg=NULL blob=yes
```

### Why it matters

**Card 1.83 decides who may see a file by whether its `messageId` points at an
internal note.** With `messageId` null on every row, that rule never engages.

⚠️ **The direction is SAFE, which is why this is a gap and not an incident.** A
null `messageId` reads as "not an internal note", so a requester keeps access —
the permissive answer. Nothing is being leaked today.

⚠️ **But 1.83 is therefore UNTESTED IN PRACTICE**, and migration 67's
`Attachment_messageId_fkey` is carrying no data at all. **Anyone relying on "a
file in an internal note is hidden from the requester" is relying on a path that
has never once run.**

- [ ] **Link an inbound attachment to the `TicketMessage` it arrived on.** The
      ingest already creates the message and the attachments in the same flow.
- [ ] **Then prove 1.83 works:** an attachment on an internal note must be
      refused to the requester and allowed to an agent. **That test cannot exist
      today** because no attachment has ever had a `messageId`.
- [ ] ⚠️ **Existing rows must stay visible.** Backfilling is optional; leaving
      them null keeps them requester-visible, which is the current behaviour and
      is correct for files that arrived on ordinary replies.

---

## Card 1.122 — the signature filter is not catching signature logos

**API. No migration.**

> **The owner's instruction, 2026-09-16:** *"dont pull signature logos."*
> Card 1.116 built `is-signature-image.util.ts` for exactly this.

### The evidence

Of seven files that landed, **four are `image.png`**:

| size | almost certainly |
|---|---|
| 104.7 KB | signature graphic |
| 120.9 KB | signature graphic |
| 1076.3 KB | duplicate pair — |
| 1076.3 KB | the same file stored twice |

Three are genuine content (`HIPAA.png`, two `ChatGPT Image …`). **The filter let
every signature image through.**

- [ ] **Work out what the util actually tests and why these missed it.** Do not
      guess: read `is-signature-image.util.ts` against the real files, which are
      still in `glovebox@csnhc.com` / `Processed`.
- [ ] ⚠️ **A filter that guesses eats real files.** The same reasoning as
      `stripQuotedReply`: losing a requester's genuine screenshot is far worse
      than showing an agent a logo. **Prefer a rule that is certain — `isInline`
      plus a size ceiling, or a `contentId` referenced by the body — over one
      that infers from dimensions alone.**
- [ ] **The duplicate 1076.3 KB pair is worth explaining too.** Two rows, same
      size, same name. Either the sender attached it twice or the worker stored
      it twice; **find out which before deduplicating anything.**

---

## Card 1.123 — a reply's typed text is dropped when it sits above the signature

**API. No migration. Affects EVERY inbound reply, not only ones with files.**

### The evidence — two replies in a row

```
2026-09-16T16:19:50   "Thank you,\nPrithviraj Hulgur\nAI Solutions Associate\n..."
2026-09-16T16:14:21   "Test\n\nThank you,\nPrithviraj Hulgur\n..."
```

The 16:14 reply kept its text (`"Test"`). The 16:19 reply begins at
`"Thank you,"` — **whatever was typed above the signature is gone.**

⚠️ **The deploy session did NOT diagnose this**, and it should not be assumed to
be the same root cause as the attachment bug. It is recorded here because it was
observed twice and affects every reply.

- [ ] **Establish first whether text was actually typed.** If the reply was
      files-only, there is nothing to fix and this card closes. **Ask the owner
      before writing code.**
- [ ] **If text was typed:** the suspects are the HTML-to-text conversion
      (card 1.62) and `stripQuotedReply` (cards 1.66, 1.75). An inline image
      sitting above the signature is a plausible trigger — `<img>` is dropped,
      and whatever heuristic finds the start of the quoted block may then cut too
      early.
- [ ] **The stored body is the evidence.** It is on the record in full —
      `TicketMessage.body` keeps everything; only the display is trimmed. Compare
      the stored body against the original in `Processed`.

---

## Priority

**1.120 first** — it is the one the owner reported, it is web-only, and card
1.117 makes it worse if that ships first.

**1.123 next if text was genuinely lost.** It affects every reply and silently
discards what a requester wrote, which is the worst failure mode in this list.

**1.121 before anyone relies on card 1.83.** No urgency while the null default is
the permissive one, but the security rule it underpins is currently unproven.

**1.122 last.** Cosmetic noise, and the wrong fix (an over-eager filter) is worse
than the current behaviour.

## Baselines to hold

api `tsc` 0, unit **854 / 91**, web `tsc` 0, vitest **395 / 58**, **67
migrations**. Production is `8e394b7`.
