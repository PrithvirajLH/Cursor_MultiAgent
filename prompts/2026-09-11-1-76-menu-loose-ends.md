# Implementation Prompt — 1.76, the two loose ends from the right-click menu

**Date:** 2026-09-11
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.76 — **two items, two commits.** Both XS. No migration; the count stays at **61**.

**One commit per item. Work straight through. Do not check in between them, and
do not ask permission.**

> ## This is the last build card in Phase 1
>
> 92 of 99 done. After this, everything left on the board is a decision the owner
> has to make. **So the bar is "leave it clean", not "make it work".**
>
> Both items came out of your own card 1.73 report. **One of them you reported
> accurately and diagnosed wrongly; the other you flagged as a decision and it is
> not one.** Both are written up below with what the planner actually found.

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check for a live `jest` process before touching `apps/api`.** A second
  session's run resets the shared test database and renames `apps/api/.env`; an
  open handle on Windows blocks the rename and fails the suite. **Read from the
  git object store while one is running.**
- **Baseline to beat:** unit **654 / 65**, web **288 / 45**, integration
  **805 + 1 skipped / 77 of 78**, both typechecks clean, migrations **61**.
- ⚠️ **This card is web-only.** Nothing under `apps/api` should change. If you
  find yourself editing the API, stop — you are in the wrong place.
- **Trust a live run over this document.**

---

## 1 — Item ①: Escape closes the menu *and* leaves the ticket (XS)

### ⚠️ Your diagnosis was wrong, and the fix you implied cannot work

You reported: *"The shell's listener doesn't stop propagation — same as the
original ticket menu, so not a regression."* **The observation is right and the
cause is not.** `stopPropagation` in the shell would change nothing. Here is why:

```ts
// TicketDetailPage.tsx:1571
window.addEventListener("keydown", handleKeyDown, true);
//                                                ^^^^ CAPTURE phase
```

```ts
// shell/context-menu-shell.tsx:70
document.addEventListener("keydown", handleKeyDown);
//                                   bubble phase
```

**Capture runs before bubble, and `window` is the first node in the capture
path.** So the ticket page's handler has already called `navigateBack()` by the
time the shell's listener is reached. **A bubble-phase handler cannot stop
something that has already run**, and registering the shell in the capture phase
does not fix it either: capture order is `window` → `document`, and the page's
listener is registered on mount, long before the menu opens.

⚠️ **So this is not "one key doing two things". Pressing Escape to dismiss the
menu navigates you off the ticket.** The navigation is the dominant effect and
the menu closing is incidental.

### ✅ The right fix already exists in that file, and it just misses two cases

`TicketDetailPage.tsx:1526`, the first line of the handler:

```ts
if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
```

**The shortcut already knows it must stand down while a transient layer is open.**
It just asks the question too narrowly. What that selector does and does not
catch, all verified:

| Overlay | renders | caught? |
|---|---|---|
| `ConfirmDialog` — card 1.11's Remove dialog | `role="dialog"` + `aria-modal="true"` | ✅ |
| `MessageBody` lightbox — card 1.48's pasted images | `role="dialog"` + `aria-modal="true"` (`:171`) | ✅ |
| `NotificationCenter`, mobile (`:291`) | `role="dialog"` + `aria-modal="true"` | ✅ |
| **`context-menu-shell`** (`:116`) | `role="menu"` | ❌ **no** |
| **`NotificationCenter`, desktop panel** (`:233`) | `role="dialog"`, **no `aria-modal`** | ❌ **no** |

✅ **So card 1.11's Remove dialog and card 1.48's lightbox were never affected** —
worth knowing, because it means this is narrower than it first looks.

⚠️ **But you found a second victim without meaning to.** The desktop notification
panel is reachable from the top bar on every page, including a ticket. **Press
Escape to close it while reading a ticket and you are navigated off the ticket.**
That bug predates card 1.73 entirely and nothing on the board describes it.

### The fix

- [ ] **Widen the guard, in one place, to "is any transient layer open".** Put it
      behind a small named helper rather than growing the selector inline — the
      list has grown twice already and will grow again.
- [ ] **Cover `[role="menu"]`** so the context menu is included.
- [ ] ⚠️ **Do NOT fix the notification panel by adding `aria-modal="true"` to it.**
      It is not modal — it does not trap focus and the page behind it stays
      usable. Labelling it modal is a false promise to a screen reader, and it
      would be a worse bug than the one you are fixing. **Give it an explicit
      opt-in instead** — a `data-` attribute the helper looks for is the
      planner's suggestion, but say if you prefer another shape.
- [ ] ⚠️ **Do not disable the Escape shortcut.** Escape-to-go-back is a real
      feature of the ticket page and somebody uses it. **The shortcut must still
      work when nothing is open** — see the non-vacuity test below.

### Tests

- [ ] **Escape with the menu open closes the menu and does NOT navigate.**
- [ ] **Escape with the notification panel open closes it and does NOT navigate.**
- [ ] ⚠️ **THE NON-VACUITY TEST: Escape with nothing open still navigates back.**
      This is the one that matters. A guard that is too greedy silently kills a
      working shortcut, and every other assertion here would still pass.
- [ ] **The two already-covered cases keep working** — the Remove dialog and the
      image lightbox. They pass today; a change to the guard must not lose them.

---

## 2 — Item ②: delete the dead nav array (XS)

### ⚠️ You asked for a decision. There is nothing to decide — the planner checked.

You reported: *"After 1.71, Unassigned and the Team queue nav preset emit an
identical query. They genuinely are the same filter now the badge is open-only —
worth your decision, not a silent merge by me."*

**Flagging it rather than merging it was exactly right.** But the premise does not
hold: **`PRIMARY_NAV_PRESETS` renders nowhere.**

Everything that references it, in the whole web app:

- `saved-views.ts:168` — its own definition
- `saved-views.ts:164` — `presetQueryById`'s fallback lookup
- `preset-query.test.ts:4,56` — one test reference

**No component imports it.** And `presetQueryById` has exactly one call site —
`App.tsx:735`, for `"unassigned"`, which lives in `SAVED_VIEWS`. **So the fallback
branch has never once been taken.**

### And there is a reason to delete it rather than leave it

```ts
{ id: 'inbox',         label: 'Inbox',         count: '142', … }
{ id: 'my-tickets',    label: 'My tickets',    count: '14',  … }
{ id: 'team-queue',    label: 'Team queue',    count: '38',  … }
{ id: 'created-by-me', label: 'Created by me', count: '7',   … }
```

⚠️ **Those four numbers are invented.** They are not defaults and not
placeholders wired to anything — they are literals. **Wire this array up one day
and four fabricated counts appear in the primary nav**, in a product whose last
six cards have been about badges telling the truth.

✅ **Verified: nothing reads `preset.count`.** The four literals above are the
only ones in the file, and the only other `.count` in the sidebar
(`SidebarSavedViews.tsx:279`) is `userViewCounts[i]?.count`, a live query result
— a different thing with the same name.

### The fix

- [ ] **Delete `PRIMARY_NAV_PRESETS`.**
- [ ] **Delete the optional `count` field from `SidebarPreset`** (`:37`) — with
      the array gone, nothing sets it and nothing reads it. **`.cursorrules`
      disallows unused exports and this is the same smell one level down.**
- [ ] **Simplify `presetQueryById` to look in `SAVED_VIEWS` alone**, and correct
      its doc comment, which currently says *"A `SAVED_VIEWS` or
      `PRIMARY_NAV_PRESETS` id"*. ⚠️ **Keep the empty-string return for an unknown
      id** — that is the existing unknown-id-is-ignored rule from
      `visible-presets.ts`, and `App.tsx:735` depends on it not throwing.
- [ ] **Update `preset-query.test.ts:56`**, which asserts `PRIMARY_NAV_PRESETS`
      contains `my-tickets`. ⚠️ **Replace it, do not just delete it** — the
      assertion it should make now is that `presetQueryById` returns `""` for an
      id that does not exist, which is the behaviour `App.tsx` relies on.
- [ ] ⚠️ **If you believe the array was aspirational** — a primary nav somebody
      intended to build — **stop and say so instead of deleting it.** The planner's
      read is that it is abandoned: it carries hard-coded counts, which is not how
      anyone would write a nav they meant to ship. **But you are closer to it than
      I am, and an intent I cannot see is a real possibility.** The fallback
      position is to keep the array, strip the four fake counts, and add a comment
      saying what it is for.

---

## 3 — What to report back

1. **Two commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, and the migration count — **still 61**,
   and **nothing under `apps/api` should appear in either diff.**
3. The answers:
   - **① —** what shape you gave the guard, and **how the notification panel opts
     in without claiming to be modal.**
   - **① —** ⚠️ **confirmation that you watched the non-vacuity test fail** with an
     over-greedy guard, i.e. that Escape-with-nothing-open still navigates.
   - **② —** deleted or kept, and if kept, what intent you found that I did not.
4. **For each item, the specific assertion that would fail if it regressed.**
5. Anything that did not match. **This document is wrong somewhere.**

## 4 — Browser pass

- [ ] **Open a ticket. Right-click a message, press Escape.** Menu closes, **and
      you are still on the ticket.**
- [ ] **Open the notification panel from the top bar, press Escape.** Panel
      closes, **and you are still on the ticket.**
- [ ] ⚠️ **Press Escape with nothing open. You should leave the ticket.** If you
      do not, you have broken a working shortcut and the card is a net loss.
- [ ] **Remove a message, press Escape on the confirmation.** Dialog closes, you
      stay. **This works today — prove you did not lose it.**
- [ ] **Open a pasted image, press Escape.** Same.

**Stop and report instead of improvising** if the guard cannot distinguish an open
menu from a closed one without reaching into the shell's internals, if deleting
`PRIMARY_NAV_PRESETS` breaks something the typechecker does not catch, or if
Escape-with-nothing-open stops working and you cannot see why.
