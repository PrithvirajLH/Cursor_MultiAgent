# Implementation Prompt — 1.117, 1.118, 1.124: the three cards from the owner's questions today

**Date:** 2026-09-16
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** **1.117** (page through the pictures) · **1.118** (stop downloading a
file you are going to reject) · **1.124** (a picture pasted into an email body)

**Three cards. No migration. ⚠️ Do them in this order, and read §0 first — the
third one is BLOCKED and must not be started yet.**

> ## Where these came from
>
> **All three came out of the owner asking questions on 2026-09-16**, not from an
> audit:
>
> - *"can we have next and previous arrow to view all the image as a carousel
>   instead of clicking view on each one?"* → **1.117**
> - *"will this slow the platform by any chance?"* → measured, and the answer was
>   **no** for anything a person touches — but the measuring found **1.118**
> - *"can we do this for image pasted on email body and pull attachments to the
>   attachment tab"* → **half of it was already card 1.116**; the other half is
>   **1.124**

---

## 0. ⚠️ ORDER, AND THE ONE THAT IS BLOCKED

**Card 1.124 must NOT be started until `prompts/2026-09-16-four-findings-batch.md`
has shipped.** It depends on two cards in that batch, and building it first would
produce work that has to be redone:

| Blocker | Why 1.124 cannot go first |
|---|---|
| **1.121** — every emailed attachment has a null `messageId` | 1.124 rewrites a body to point at stored attachments. **Until an emailed attachment knows which message it arrived on, there is nothing correct to point at.** |
| **1.122** — the signature filter is not catching logos | 1.124 renders inline images in the body. **With the filter broken, every Outlook signature logo renders inline in every reply** — the exact noise the owner asked to avoid, now printed into the conversation instead of a tab. |

**So: 1.117 and 1.118 are ready now. 1.124 is written up here so the thinking is
not lost, and starts when that batch is green.**

⚠️ **1.123 is also in that batch and is undiagnosed — *a reply's typed text is
dropped when it sits above the signature*. That one affects EVERY inbound reply.
If you are choosing what to do next and nobody has taken it, take that instead of
anything here.**

---

## 0b. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check the tree is yours:** `git status --porcelain | grep -v '^??'` —
  anything modified under `apps/` that is not yours means **STOP.** Two sessions
  share this working tree and it has invalidated runs twice this week.
- **Baseline to beat:** unit **849 / 90**, web **395 / 58**, both typechecks
  clean, migrations **67**.

---

## 1 — Commit one: card 1.117, page through the pictures

⚠️ **The full write-up is `prompts/2026-09-16-card-1-117-attachment-carousel.md`.
Work from that file for this commit** — it is not repeated here.

**The one thing to carry in your head before you open it:** card 3.5 now writes an
audit row for **every** file open. **A carousel that preloads the next image
records files nobody looked at**, which turns *"who opened that file"* into a
record of what the software fetched. **Fetch on arrival only. No lookahead.**

---

## 2 — Commit two: card 1.118, stop downloading a file you are going to reject

### What is wrong

✅ **Measured while answering the owner's question about speed, and most of the
answer was reassuring — say so, because the card is small on purpose:**

- The mailbox worker is a **background poller on a 30-second timer**.
- ✅ **It has a real run guard** (`inbound-mailbox.service.ts:202`) — a poll
  already in progress is **skipped, not queued** — so a slow batch makes email
  late and **can never jam the desk**.
- ✅ **Signature images are filtered out BEFORE anything is downloaded**, and only
  the first `INBOUND_EMAIL_MAX_ATTACHMENTS` (10) files have content fetched. Both
  are in the right order already.
- Production is **P0v3, 1 vCPU / 4 GB, single instance**, shared with the API.

⚠️ **The gap: there is no SIZE pre-filter.** Graph's `size` is already in hand
from the metadata listing, but the loop at `inbound-mailbox.service.ts:378`
fetches content for everything under the **count** limit, and
`assertAttachmentWithinSizeLimit` only runs afterwards, on the decoded buffer.

**So a 40 MB file is downloaded in full and then thrown away.**

### The fix

- [ ] **Refuse on the declared size before fetching**, in the same loop that
      already applies the count limit.
- [ ] ⚠️ **Use the wire size ONLY TO REFUSE, NEVER TO ACCEPT.** Graph's `size`
      runs about a third larger than the real file (base64 + MIME overhead), so
      refusing on it is **biased towards keeping** — the safe direction. ✅ **Card
      1.116 already wrote exactly this reasoning into
      `is-signature-image.util.ts`. Reuse the reasoning, and say so.**
- [ ] ⚠️ **Do not touch `inbound-email.service.ts:792`.** That exact-match check —
      `buffer.length !== declaredSize` — is what catches a truncated download, and
      it must keep receiving the **decoded** length. **Card 1.116 already fixed a
      caller that fed it the wrong number; do not undo that.**
- [ ] **The rejection reason must read like a sentence to an agent**, matching the
      ones card 1.105 established — it is shown on the ticket.
- [ ] ⚠️ **A skipped file is still REPORTED, not silent.** The whole of card 1.105
      is that an agent must be able to see a file is missing and ask for it again.

### Tests

- [ ] **A 40 MB declared attachment is never fetched** — assert the content fetch
      was **not called** for it. ⚠️ **The assertion the card exists for: a test
      that only checks it was rejected would pass with the bug present.**
- [ ] **It is still reported on the ticket with a readable reason.**
- [ ] **A file just under the limit IS fetched and stored.** Non-vacuity.
- [ ] **A file whose declared size is wrong but whose real size is fine still
      works** — or is refused, if you decide that is right. **Say which.**

---

## 3 — Card 1.124, a picture pasted into an email body — ⚠️ BLOCKED, DO NOT START

### What the owner asked, and what is already true

✅ **Half of it is already done. Say this back to them.** *"Pull attachments to
the attachment tab"* **is card 1.116**, shipped — the owner's own screenshot shows
seven emailed images in the tab.

### What is actually wrong

✅ **Verified: an inbound HTML body is flattened to PLAIN TEXT.**
`select-body-text.util.ts` runs it through `htmlToText`, so **the `<img>` tag and
the `cid:` reference inside it are gone before anything is stored.**

✅ **And `grep -rn "cid:" apps/api/src apps/web/src` returns NOTHING** — nothing
anywhere resolves a Content-ID.

⚠️ **THE FLATTENING IS CARD 1.62 AND IT WAS RIGHT.** That card exists because
inbound emails were **showing their raw HTML source on screen**. **So this card
cannot simply stop flattening.** It has to keep a **safe subset** of HTML.

### The shape of the fix

- [ ] **Ask Graph for `contentId`.** ⚠️ **It is not currently selected** —
      `graph-mail.http-client.ts:257` asks only for
      `id,name,contentType,size,isInline`.
- [ ] **Carry it through ingestion and store it on the attachment.**
- [ ] **Keep a safe subset of the body HTML instead of flattening**, and rewrite
      each `cid:` reference to the web app's existing **`data-attachment-id`**
      marker.
- [ ] ✅ **THE GOOD NEWS, AND IT MAKES THIS SMALLER THAN IT SOUNDS: the rendering
      half already exists and is already sanitised.** `MessageBody.tsx:43-65`
      hydrates `img[data-attachment-id]` for images pasted in the UI. **This is
      pointing it at the right ids, not building a viewer.**
- [ ] ⚠️ **DECIDE WHAT A DANGLING REFERENCE RENDERS AS.** Card 1.116 deliberately
      drops inline images under 50 KB as signature furniture, so **a small pasted
      image will be referenced by a body with no attachment behind it.** **Leaving
      a second broken-image icon would be trading one complaint for another.**
- [ ] ⚠️ **This widens what inbound email can put on a screen, which is a security
      surface.** Card 1.62 flattened it for a reason. **State the tag and
      attribute allow-list explicitly in the commit message**, and do not accept
      `style`, `on*`, `script`, `iframe`, or any `src` scheme other than the
      rewritten marker.

### Tests

- [ ] **An email with one pasted image renders it in the message body.**
- [ ] ⚠️ **An email whose body contains a `<script>` renders no script.** The
      assertion this card most needs, because it is the one card 1.62 was about.
- [ ] **An email with a `cid:` reference to an image that was dropped as a
      signature renders whatever you decided — and the test names it.**
- [ ] **A plain-text email is completely unaffected.** Non-vacuity.

---

## 4 — What to report back

1. **Commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, migration count (**67, unchanged**).
3. The answers listed in each card's own section.
4. **For each card, the assertion that would fail if it regressed — and confirm
   you watched each inversion actually fail.** ⚠️ **Two vacuous tests were caught
   by their own authors in the last two batches. That is the normal outcome here,
   not an embarrassment — but they were caught by INVERTING, not by reading.**
5. Anything that did not match. **This document is wrong somewhere; every one of
   the last six has been.**

**Stop and report instead of improvising** if 1.118's size filter cannot be
applied without changing what the normalizer receives, if card 1.117 makes you
want an API change (**the data is already on the page — that want means the
design went wrong**), or if 1.124 turns out to need the body stored in two forms
rather than one.
