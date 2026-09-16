# Implementation Prompt — card 1.117: page through the pictures instead of clicking each one

**Date:** 2026-09-16
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** **1.117** — next / previous arrows across a ticket's images

**One card, one commit. Web only. No migration, no API change.**

> ## What the owner asked for, in their words
>
> *"attachment view can we have next and previous arrow to view all the image as
> a carousel instead of clicking view on each one?"*
>
> **Raised 2026-09-16 from a real ticket** — `PA_20260910_381`, seven images,
> several of them 1–2 MB. **Seven files means seven clicks on View, and no way to
> get from one to the next without going back to the list.**
>
> ⚠️ **This only became a real problem yesterday.** Until card 1.116 the mailbox
> worker never fetched emailed attachments at all, so tickets carried one or two
> hand-uploaded files at most. **Now a single email reply arrives with seven, and
> the one-at-a-time viewer does not scale to that.**

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check the tree is yours:** `git status --porcelain | grep -v '^??'` —
  anything modified under `apps/` that is not yours means **STOP**. Two sessions
  share this working tree and it has invalidated runs twice.
- **Baseline to beat:** unit **849 / 90**, web **395 / 58**, both typechecks
  clean, migrations **67**.
- ⚠️ **This is a WEB-ONLY card.** If you find yourself changing anything in
  `apps/api`, stop and report — see §2, which explains why that is the warning
  sign rather than a detail.

---

## 1. Where it lives

**`apps/web/src/components/ticket-detail/TicketAttachments.tsx`** (253 lines) —
**the preview already exists, and this card extends it rather than building
anything new.**

What is there today:

- a list of rows, each with **View** and **Download**
- `expandedAttachment` — the one currently being previewed
- `previewUrl`, created with `window.URL.createObjectURL(blob)` and **revoked on
  change and on unmount**
- `isFullscreenPreview`, a full-screen mode behind the ⤢ button
- a fallback message: *"Inline preview is only available for image attachments"*

**So the job is: give the preview a next and a previous, and make the full-screen
mode worth living in.**

---

## 2. ⚠️ THREE THINGS SHIPPED IN THE LAST TWO DAYS THAT THIS CARD CAN QUIETLY BREAK

**Read all three before writing code. Each one is a card that is already GREEN,
and each is easy to undo from the web layer without any test noticing.**

### ⚠️ 2a. Card 3.5 — every open is now recorded, so DO NOT PREFETCH

**As of yesterday, `GET /attachments/:id` writes an `ATTACHMENT_DOWNLOADED` audit
row naming the file and the person.** The whole point is answering *"who opened
that file"* after an incident, on a desk handling PHI.

⚠️ **A carousel that preloads the next image writes an audit row for a file
nobody ever looked at.** Do that and the audit log stops meaning anything — it
becomes a record of what the *software* fetched, not what a *person* saw. **That
is worse than having no log, because people would still trust it.**

- [ ] **Fetch on arrival only.** The image the user has navigated to, and nothing
      else. **No lookahead, no warming the next one, no "just one ahead".**
- [ ] **Caching an image the user has ALREADY viewed, so going back does not
      re-fetch, is fine and good** — they saw it, the row exists, and a second row
      adds nothing. ⚠️ **But if you cache, say so in the commit message**, because
      it changes what a repeat view looks like in the log.
- [ ] **If you think prefetching is worth it, STOP AND ASK.** It is the owner's
      call, not a UI decision, and the answer is probably no.

### ⚠️ 2b. Card 1.83 — the list you are given is already filtered. Do not build your own.

**Yesterday's card stopped a file pasted into an internal note being visible to
the requester.** The server decides that, per person, and hands back only what
the viewer may see.

- [ ] **Page through `ticket.attachments` exactly as the server returned it.**
- [ ] ⚠️ **NEVER construct an attachment id, guess a neighbour, or fetch "the next
      one" by anything other than stepping through that array.** The download
      route would still refuse it — but a carousel that asks for files the list
      does not contain is a bug generator pointed straight at the thing this
      project just spent a card fixing.
- [ ] **Do not add an API endpoint for "the images on this ticket".** The data is
      already on the page.

### ⚠️ 2c. Cards 1.76 / 1.77 — Escape already has an owner

**`apps/web/src/utils/transient-layer.ts` exists** and both the tickets list and
the ticket detail page use it:

```ts
export function isTransientLayerOpen(): boolean {
  return Boolean(document.querySelector(
    '[role="dialog"], [role="menu"], [data-transient-layer]'));
}
```

- [ ] **Mark the full-screen viewer so that helper sees it** — give it
      `role="dialog"` or `data-transient-layer`. **Then Escape closes the viewer
      and does not also fire the page's handler behind it.**
- [ ] ⚠️ **Arrow keys need the same care.** ← and → must move between images
      **only while the viewer is open**, and must never steal the arrow keys from
      a text field, the ticket list, or a menu. **Bind them on the viewer, not on
      `document`, or bind on document and bail out when the viewer is closed —
      and say which you chose.**

---

## 3. What to build

- [ ] **Next and previous, in the preview panel and in full screen.**
- [ ] **A position indicator — but count IMAGES, not files.** ⚠️ **The ticket in
      the screenshot has seven attachments that are all images; a ticket with a
      PDF among them must not say "4 of 7" and then refuse to show number 4.**
      **"3 of 5 images" is honest; "3 of 7" is not.**
- [ ] ⚠️ **The carousel steps through images only.** A PDF or `.docx` keeps its
      View / Download row exactly as it has today, and the existing *"Inline
      preview is only available for image attachments"* message stays for anyone
      who opens one directly. **Do not silently drop non-images from the list
      itself** — they are still the ticket's files.
- [ ] **Decide whether the ends wrap or stop, and make the buttons say so** —
      a disabled arrow at the end is clearer than one that silently does nothing.
      Either choice is fine; **an arrow that looks live and is not, is not.**
- [ ] **Keyboard: ← → to move, Escape to close.** See §2c.
- [ ] ⚠️ **Revoke the object URL of the image you are leaving.** The existing code
      already revokes on change and unmount — **follow that pattern exactly.**
      **These are 1–2 MB images and seven of them; a carousel that leaks an object
      URL per step is a memory leak the user creates by holding down an arrow
      key.**
- [ ] **Loading and error states must be per image.** Today `previewError` is one
      value; stepping onto a broken file must not leave the error on screen when
      you step off it again.
- [ ] **Touch: left/right swipe in full screen** if it is cheap. **Optional — say
      so if you skip it.** The desk is on laptops.

---

## 4. Tests

- [ ] **A ticket with three images: next moves through all three, previous comes
      back.**
- [ ] ⚠️ **A ticket with images AND a PDF: the count says "of 3 images", the PDF
      is not a carousel stop, and its row still offers View and Download.**
- [ ] ⚠️ **THE AUDIT ASSERTION, AND IT IS THE ONE THIS CARD MOST NEEDS:**
      **opening the viewer on image 1 and stopping there fetches EXACTLY ONE
      attachment.** Assert the download function was called once, with that id.
      **A test that only checks the picture appeared would pass with a prefetch
      bug present.**
- [ ] **Stepping forward then back does not re-fetch** (if you cached) **or does**
      (if you did not) — **whichever you built, assert it, so the next person
      knows which it is.**
- [ ] **Escape closes the viewer and the page's own Escape handler does not also
      run.**
- [ ] **A ticket with one image shows no arrows, or disabled ones.**
- [ ] **A ticket with no images at all still renders the list.** Non-vacuity.
- [ ] ⚠️ **For each, confirm you watched the inversion actually fail.** Two
      vacuous tests were caught by their own authors in the last two batches —
      it is the normal outcome here, not an embarrassment.

---

## 5. Browser pass

**⚠️ Use the real ticket: `PA_20260910_381` has seven images including two over
2 MB.** That is where this was reported and it is the honest test.

- [ ] **Open the Attachments tab, click View on the first image, and reach the
      seventh with arrows alone** — no going back to the list.
- [ ] **Hold the arrow key down.** Nothing should leak, stack up, or lock the tab.
- [ ] **Full screen, arrow through, Escape out.** The ticket page must be where
      you left it and must not have reacted to that Escape.
- [ ] ⚠️ **Then open the audit log and count.** **There must be one entry per
      image you actually looked at — no more.** If seven appear after you viewed
      three, the prefetch rule in §2a is broken.
- [ ] **On a ticket with a PDF among the images, confirm the count and that the
      PDF still downloads.**

---

## 6. What to report back

1. **Commit SHA** and `git diff --stat`.
2. `tsc` for `apps/web`, vitest, and the API unit count (**should be unchanged at
   849 / 90 — this card touches no API code**).
3. The answers:
   - **Do you cache a viewed image, and what does a repeat view look like in the
     audit log?**
   - **Where did the arrow-key listener go, and how does it stay out of the way
     of text fields and the ticket list?**
   - **Wrap or stop at the ends?**
   - **Did you do swipe, or skip it?**
4. **The assertion that would fail if the prefetch rule regressed** — and confirm
   you watched it fail.
5. Anything that did not match. **This document is wrong somewhere; every one of
   the last five has been.**

**Stop and report instead of improvising** if the preview cannot be given
next/previous without restructuring `TicketAttachments.tsx` more than this card
implies, if the arrow keys cannot be scoped without touching the tickets list's
own key handling, or if you find yourself wanting an API change — **that last one
means the design went wrong, because the data is already on the page.**
