# Implementation Prompt — 1.39 Give the conversation room to work

**Date:** 2026-09-02
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.39 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** on a ticket with a long description, the conversation panel shows
**three messages out of ten**. The description gets more vertical space than the
actual conversation.

**Cost:** none. **Web only.** No API, no schema, no migration. Size **S**.

**Independent of everything in flight.** It touches the description block and the
composer's *height*; the four-card batch (1.36/1.38/1.37/1.28) touches the
composer's *controls* and the message bubbles. Coordinate on
`TicketConversation.tsx` — see §5.

---

## 1. What is actually wrong

Reported by the owner from production on 2026-09-02, on a real PAF termination
ticket. Measured off that screen (≈827px viewport):

| Region | Height | |
|---|---|---|
| Ticket header card | **≈355px** | description alone is ≈240px of it |
| Tabs | ≈45px | |
| **Conversation** | **≈275px** | **3 of 10 messages visible** |
| Composer | ≈150px | at rest, empty |

**The layout is not broken — do not restructure it.** `TicketConversation.tsx:198`
already gives the message list `flex-1 overflow-y-auto`, so it scrolls
independently and takes whatever height is left. The problem is entirely that two
siblings take too much before it gets its share.

### Cause A — the description has no limit

`TicketDetailPage.tsx:2162-2172` renders it as a plain paragraph:

```tsx
<p className="mt-2 text-[14px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
```

`whitespace-pre-wrap`, **no `line-clamp`, no collapse, no max height.** Every line
of description is a line taken from the conversation. The PAF ticket has eleven.

### Cause B — the composer is full size when empty

Three always-on pieces:

| Piece | Where | Height |
|---|---|---|
| Formatting toolbar, always rendered | `RichTextEditor.tsx:614` | ≈34px |
| Editable area | `RichTextEditor.tsx:753` — `min-h-[80px] max-h-[288px]` | **80px empty** |
| Footer row (type toggle, attach, send) | `TicketConversation.tsx:415` | ≈40px |

So ≈154px is reserved before anyone types a character.

## 2. The prize

Clamping the description to three lines returns ≈175px; collapsing the idle
composer returns ≈110px. Together that takes the conversation from ≈275px to
≈560px — **3 visible messages to 7 or 8**, with no behaviour change anywhere.

## 3. The part that is not a layout problem — read this before over-engineering

Those eleven description lines are **PAF form fields that should be structured
custom fields in the sidebar.** They are in the description only because the Power
Automate flow does not yet send `category` + `customFields` (owner to-do #5 on the
master plan). The 13 `paf-termination` fields already exist in production.

When that flow is fixed, those fields render in the sidebar's **Custom Fields**
card and the description becomes a line or two. **This screen improves on its
own.**

So: do the two changes below because they help **every** ticket. **Do not** design
the layout around the PAF shape — a collapsing-on-scroll header, a
description-only tab, or a resizable splitter is all work spent on a case that is
about to shrink. If you find yourself reaching for any of those, stop and report.

## 4. Task 1 — Clamp the description

**Files:** `apps/web/src/pages/TicketDetailPage.tsx`

- [ ] Clamp the description paragraph to **3 lines** (`line-clamp-3`) with a
      **"Show more" / "Show less"** toggle beneath it.
- [ ] **Only render the toggle when the text actually overflows.** A two-line
      description must not grow a pointless control. Measure
      (`scrollHeight > clientHeight`) rather than guessing from character count —
      the text wraps, so character count is wrong.
- [ ] Default **collapsed**. Expansion is per-view; it does not need persisting
      across tickets or reloads. Do not add storage for it.
- [ ] **Never clamp while the description is being edited.** There is an edit mode
      on this block (the pencil at `:2155`) — in edit mode show everything.
- [ ] Keyboard and screen-reader accessible: a real `<button>` with
      `aria-expanded`, and it must move focus nowhere on toggle.
- [ ] Three lines is a knob, not a law. If agents say it is too tight, the number
      moves — keep it a single constant, easy to find.
- [ ] `whitespace-pre-wrap` must stay. The description is line-oriented (the owner
      explicitly asked to see the raw description, and
      `stripFacilityFromDescription` was removed for eating lines). **Clamping is
      hiding, never dropping** — expanding must show the exact original text.

## 5. Task 2 — Let the composer rest small

**Files:** `apps/web/src/components/RichTextEditor.tsx`,
`apps/web/src/components/ticket-detail/TicketConversation.tsx`

> ⚠️ **The four-card batch is editing `TicketConversation.tsx` right now** —
> specifically the footer row at `:415-450` (the Public/Internal control) and the
> bubbles at `:298`/`:341`. **Land that batch first, or coordinate**, and keep this
> task to *heights*: do not touch the type toggle, the chip, or the bubbles.

- [ ] Collapse the idle editable area from `min-h-[80px]` to roughly **one line**
      (≈40px), expanding to the current height on focus or as soon as there is
      content. Keep `max-h-[288px]` and the internal scroll.
- [ ] Hide the formatting toolbar until the composer has focus or content. It is
      seven buttons an agent does not need while reading.
- [ ] **A restored draft must open the composer expanded.** Drafts persist
      (`clearMessageDraft` exists on this page); a draft hidden inside a collapsed
      one-line box is a regression worse than the wasted space.
- [ ] Expanding must **not** jar the message list. Because the list is
      `flex-1 overflow-y-auto`, growing the composer shortens it — make sure the
      view stays pinned to the newest message rather than jumping. Check this
      while scrolled to the bottom **and** while scrolled up mid-history.
- [ ] Do not animate it into a distraction. A short transition or none at all.
- [ ] The footer row stays visible at all times — the send button and the
      Public/Internal state must never be hidden. **That state is a safety
      control** (cards 1.37/1.38), and hiding it would undo work landing this week.

## 6. Tests

- [ ] Web: a long description renders clamped with a **"Show more"** control;
      clicking it reveals the **full original text**, including line breaks.
- [ ] Web: a **short** description renders with **no** toggle.
- [ ] Web: in edit mode the description is **not** clamped.
- [ ] Web: the composer renders its compact height with no content and no focus,
      and its full height when it has content.
- [ ] Web: with a restored draft the composer renders **expanded**.
- [ ] Follow `renderToStaticMarkup`, as the existing web tests do. Focus-dependent
      states may need a small interaction test or an explicit prop — if the
      existing harness cannot express focus, **say so** rather than asserting on
      something that only looks right.
- [ ] Targeted, then the **full** suite. **Do not edit source while it runs.**

## 7. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/web"
npx tsc --noEmit && npx vitest run
cd ../api && npx tsc --noEmit && npx jest --silent
```

The API is untouched, so the integration suite is not required for this card
**unless** it is committed together with the four-card batch — then run it once
for the pair.

**Baselines** (current as of 1.35; older documents in this repo are stale):
API `tsc` 0, unit **416 / 43 suites**, integration **457 + 1 skipped**, web `tsc`
0, vitest **70 / 18 files**.

## 8. Acceptance criteria

1. On a ticket with an eleven-line description, the conversation shows **at least
   twice** as many messages as before, with no change to any behaviour.
2. The full description is always reachable in one click, character-for-character.
3. A short description grows no extra control.
4. The composer at rest is roughly one line tall; focusing or typing restores the
   full editor with the toolbar.
5. A restored draft is visible without the agent doing anything.
6. The Public/Internal state and the send button are visible at all times.
7. Nothing in the header, sidebar or ticket list moves or resizes.
8. `tsc` clean both sides; vitest and API unit at or above baseline.

## 9. Manual test steps

Dev API on `PORT=3077` (`AUTH_ALLOW_INSECURE_HEADERS=true`,
`NODE_ENV=development`); web with `VITE_API_BASE_URL=http://localhost:3077/api`
and `VITE_E2E_MODE=true`. Persona via
`localStorage.setItem("demoUserEmail", "agent@company.com")` **then reload** —
setting it directly bypasses the cache clearing in `setDemoUserEmail`.

Dev has no long-description ticket, so make one: edit a ticket's description to
about a dozen short lines (the pencil beside the subject), which also exercises
the edit-mode rule in Task 1.

Then, at a 1366×768-ish window:
1. **Count visible messages before and after your change on the same ticket.**
   That count is the acceptance criterion — report both numbers.
2. Expand the description and confirm the text matches the original exactly.
3. Click into the composer, type, delete it all, click away. Confirm it collapses
   again and the list does not jump.
4. Type a draft, navigate away, come back. Confirm the draft is **visible**.
5. Scroll up into history, then click the composer. Confirm your scroll position
   is not thrown to the bottom.

**The API runs from `dist`** — if a change appears to have no effect, suspect the
build (`repo-landmines.md`).

## 10. What to report back

1. Commit SHA and `git diff --stat`.
2. `tsc` both sides, vitest, API unit.
3. **Before/after screenshots of the same ticket at the same window size**, and
   the **visible message count** in each. This card is measured in pixels; a test
   run cannot show it.
4. Whether the focus-dependent composer states were testable in the existing web
   harness, or whether you had to restructure to make them assertable.
5. Anything that did not match. Handoffs from this planner have carried a wrong
   line number, a stale premise, a self-contradiction and an invented file
   reference — say so plainly if this one is wrong too.

**Stop and report instead of improvising** if this appears to need a layout
restructure, a resizable splitter, a scroll-collapsing header, or a change to how
the description is stored. None should be necessary — §1 establishes the layout is
already correct and §3 explains why the worst case is temporary.
