# Implementation Prompt — card 1.131: View opens the full-screen viewer, and the small panel goes

**Date:** 2026-09-16
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** **1.128** — one viewer, not two

**One card, one commit. Web only. No API change, no migration.**

> ## What the owner asked for
>
> *"can we remove this on click view and instead replace that with this"* — with
> two screenshots: **the small inline preview panel** (the dark box headed
> PREVIEW with the filename, arrows and Download), and **the full-screen viewer**
> (the whole app dimmed, image centred, X top right, arrows at the edges,
> *"1 of 10 images"* along the bottom).
>
> **So: View opens the full-screen viewer directly. The inline panel is deleted.**
>
> ✅ **This is a simplification, and the code gets smaller.** Card 1.117 built the
> carousel into both surfaces a day ago; **one of the two is now going away, and
> with it the reason to keep two sets of arrows in sync.**

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check the tree is yours:** `git status --porcelain | grep -v '^??'`.
  ⚠️ **And check `apps/api` and `apps/web` are not EMPTY before you trust
  anything** — something emptied both on 2026-09-16 at 14:10 and it was only
  caught by a command failing oddly. `git status` shows it instantly.
- **Baseline to beat:** unit **855 / 91**, web **416 / 61**, integration
  **966 + 1 skipped / 96 of 97**, both typechecks clean, migrations **67**.

---

## 1. Where it is

**`apps/web/src/components/ticket-detail/TicketAttachments.tsx`.** Two pieces of
state drive two surfaces today:

| | |
|---|---|
| `expandedAttachmentId` (`:18`) | which file is open — **keep this** |
| `isFullscreenPreview` (`:24`) | whether the big viewer is up — **this becomes redundant** |

`handleTogglePreview` (`:93`) is what **View** calls, and the full-screen block
is at `:341`.

**The change is roughly: View opens the viewer; `isFullscreenPreview` stops being
a separate mode; the inline panel's markup is deleted.**

---

## 2. ⚠️ Three things must survive the deletion

**The inline panel is not only a picture. It carries three things the full-screen
viewer does not, and deleting it without moving them is how this becomes a
regression.**

### ⚠️ 2a. Download

**The inline panel's header has a Download button. The full-screen viewer in the
owner's screenshot does not.** ⚠️ **Download must be reachable from inside the
viewer** — otherwise the only way to save a file becomes "close the viewer, find
the row again", which is worse than today.

### ⚠️ 2b. The name of the file you are looking at

The inline panel's header reads **`image.png · 12.8 KB · image/png`**. The
viewer shows only *"8 of 10 images"*.

⚠️ **On this ticket that matters more than it sounds: FOUR of the attachments are
called `image.png`** (the owner's own screenshot of the list shows them). **A
position counter alone cannot tell you which file you are looking at.** **Carry
the filename into the viewer.**

### ⚠️ 2c. The answer for a file that is not an image

`:321-331` today renders *"Inline preview is only available for image
attachments. Use Download to open this file."*

⚠️ **If View always opens a full-screen viewer, a PDF opens a black screen with
nothing in it.** **Decide and say which you chose:**

- **hide View entirely for non-images** (the list row still has Download), or
- **View downloads a non-image**, or
- **the viewer keeps the existing message.**

**The planner's read is the first** — a View button that cannot view is the same
class of problem as card 1.81's team filter that does nothing. **But say what you
picked.**

---

## 3. ⚠️ And two rules from the last two days still apply

### ⚠️ 3a. No prefetch — card 3.5's audit log depends on it

**Every file open writes an `ATTACHMENT_DOWNLOADED` row naming the file and the
person.** Card 1.117 deliberately fetches **on arrival only, with no cache**, and
a test holds it there.

⚠️ **Do not let the rewrite quietly reintroduce a lookahead.** **The test from
1.117 must still pass, and if you move code it must still be asserting the real
thing.**

### ⚠️ 3b. Escape already has an owner — cards 1.76 / 1.77

`apps/web/src/utils/transient-layer.ts` exists, and the ticket page uses it.

- [ ] **The viewer must be marked `role="dialog"` or `data-transient-layer`** so
      `isTransientLayerOpen()` sees it and the page's own Escape handler does not
      also fire behind it.
- [ ] ⚠️ **Escape currently only closes the FULL-SCREEN layer** (`:147`) and
      leaves the inline panel open. **With one surface, Escape closes the viewer
      outright** — check that reads correctly and does not leave orphaned state
      (`previewUrl`, `previewError`).
- [ ] **The arrow-key guard at `:126-135` — skip when focus is in an input,
      textarea, select or contenteditable — must stay.**

---

## 4. What to build

- [ ] **View opens the full-screen viewer.**
- [ ] **Delete the inline preview panel and `isFullscreenPreview`.**
- [ ] **Keep: arrows, the position counter, Escape to close, the X.**
- [ ] **Add: the filename, and Download.**
- [ ] ⚠️ **Revoke the object URL of the image you are leaving**, exactly as the
      existing code does. **These are 1–2 MB images and there are ten of them; a
      leak per step is something a user creates by holding down an arrow key.**
- [ ] **Keep the `⤢` expand button only if it still means something.** With one
      surface it probably does not — **remove it rather than leaving a control
      that does nothing.**

---

## 5. Tests

- [ ] **Clicking View opens the viewer, and no inline panel is rendered.**
- [ ] ⚠️ **Opening the viewer on one image fetches EXACTLY ONE attachment.**
      Card 1.117's assertion — **it must survive this rewrite.** A test that only
      checks the image appeared would pass with a prefetch bug present.
- [ ] **Arrows move through images and the counter follows.**
- [ ] **The filename shown matches the image on screen** — ⚠️ **use a fixture
      with two files both called `image.png`**, because that is the real case.
- [ ] **Download from inside the viewer calls the download handler with the right
      id.**
- [ ] **Whatever you chose for non-images, a test names it.**
- [ ] **Escape closes the viewer and the page's own Escape handler does not run.**
- [ ] ⚠️ **For each, confirm you watched the inversion fail.**

---

## 6. Browser pass

**⚠️ Use `PA_20260910_381` — ten images, four of them named `image.png`, two over
2 MB.** That is the ticket the owner is looking at.

- [ ] **Click View on the third image. It opens full screen, showing that image
      and its name.**
- [ ] **Arrow to the last one and back. Hold the key down — nothing leaks or
      stacks up.**
- [ ] **Download from inside the viewer.**
- [ ] **Escape out. The ticket is where you left it and did not react.**
- [ ] ⚠️ **Then open the audit log and count: one entry per image you actually
      looked at, no more.**
- [ ] **On a ticket with a PDF, confirm whatever you decided in §2c.**

---

## 7. What to report back

1. **Commit SHA** and `git diff --stat`. ⚠️ **Expect a NET DELETION** — if the
   diff is larger than before, say why.
2. `tsc` for `apps/web`, vitest, and confirmation the API counts are unchanged.
3. The answers:
   - **What View does for a non-image.**
   - **Where Download and the filename ended up in the viewer.**
   - **Whether the `⤢` button survived, and why.**
4. **Confirmation that card 1.117's no-prefetch assertion still exists and still
   fails when inverted.**
5. Anything that did not match. **This document is wrong somewhere.**

**Stop and report instead of improvising** if removing the inline panel turns out
to break the Attachments tab's layout in a way that needs more than this card, or
if the viewer cannot be marked as a transient layer without touching the ticket
page's own key handling.
