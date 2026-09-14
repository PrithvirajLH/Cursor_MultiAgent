# Implementation Prompt — 1.71, 1.72 and 1.73, the last three Phase 1 build cards

**Date:** 2026-09-11
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** **1.71** (one line), **1.72** (tidy-up, no migration), **1.73** (the
right-click message menu — the real work)

**One commit per card, except 1.73 which takes two. Four commits.** Work straight
through. Do not check in between them, and do not ask permission.

⚠️ **This supersedes `prompts/2026-09-11-1-71-and-1-72-badge-parity.md`.** That
file said card 1.72 needed a backfill migration; **it does not — the planner has
since measured production.** Read this file, not that one.

> ## These three finish Phase 1
>
> 96 cards, 86 done. After these, the only things left in Phase 1 are decisions
> that belong to the owner and one mailbox check (card 1.74). **So the bar is
> "leave it clean", not "leave it working".**

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Kill surviving jest processes before any integration run.** Exit 127 with
  no summary is a spawn failure, not a test failure.
- ⚠️ **A second session's integration run will reset the shared test database out
  from under yours.** Check for a live `jest` process first; if one is running,
  **read from the git object store** (`git show <sha>:<path>`) rather than the
  working tree, because each suite's reset renames `apps/api/.env` and an open
  handle on Windows blocks the rename.
- **NO MIGRATIONS IN THIS BATCH. The count stays at 61.**
- **Baseline to beat:** unit **650 / 64**, web **271 / 43**, integration
  **794 + 1 skipped / 75 of 76**, both typechecks clean.
- **Trust a live run over this document.**

---

## 1 — Card 1.71: the Unassigned shortcut does not state its own filter (XS, one line)

### ⚠️ The planner's first version of this card was wrong. Read the correction.

**I originally wrote that the badge and its list never match. That was wrong, and
the browser measurement (badge 5, list 5) was right.** I read `saved-views.ts:103`
emitting `?scope=unassigned` with no status filter, checked `buildListWhere:448`,
and stopped one file short of the one that decides it:

```ts
// useFilters.ts:42-45
const statusGroup =
  (searchParams.get("statusGroup") as StatusFilter) ||
  presetStatus ||
  undefined;
```

With no `statusGroup` in the URL the list falls back to `presetStatus` —
`App.tsx:539`'s `ticketPresetStatus`, which **initialises to `"open"`**. So the
real request does carry it, and on a normal load badge and list agree.

### What is actually wrong

`ticketPresetStatus` is **ambient React state, not part of the link**, and two nav
items change it:

| you last clicked | `ticketPresetStatus` | then click **Unassigned** in the sidebar |
|---|---|---|
| *(fresh load)* | `"open"` | unassigned **and open** — matches ✅ |
| **Created by me** (`App.tsx:734`) | `"all"` | any status — badge 5, list 6 ❌ |
| **Completed** (`App.tsx:719`) | `"resolved"` | resolved only — badge 5, list 1 ❌ |

✅ **And the app already disagrees with itself:** the left-nav's own Unassigned
item (`App.tsx:729-731`) navigates to `?scope=unassigned&statusGroup=open`
**explicitly.** The sidebar preset is the only route that leaves it implicit.

### The fix

- [ ] **One line in `apps/web/src/components/shell/saved-views.ts`:**

      ```ts
      buildQuery: () => qs({ scope: 'unassigned', statusGroup: 'open' }),
      ```

      ✅ **Verified exactly equivalent, not merely similar:** `statusGroup=open`
      at `buildListWhere:429` is `status: { notIn: [RESOLVED, CLOSED] }` — the
      same predicate `getCounts.unassigned` uses.
- [ ] **Leave `matches` alone.** `paramsMatch` (`saved-views.ts:56-58`) is a
      subset check, so the row still highlights on the wider URL.
- [ ] ⚠️ **Do NOT widen the count back instead.** The owner decided open-only in
      card 1.70; `DashboardPage` and `getSidebarChildBadge` have shown that number
      for months. **The list moves to meet the badge.**

### Tests

- [ ] **Assert the preset's own link carries the filter** —
      `SAVED_VIEWS.find(v => v.id === 'unassigned').buildQuery()` contains
      `statusGroup=open` — **and say in the comment why**: without it the list
      inherits ambient state and the same row means three different things.
- [ ] ⚠️ **Assert the sidebar preset and the left-nav item emit the SAME query.**
      Two routes to one view is the drift shape. **If that means lifting the nav
      item's query out of `App.tsx`'s `switch` and onto the preset, do that and
      say so** — one definition beats two a test merely compares.
- [ ] ⚠️ **Leave `tickets.counts-consolidation.spec.ts`'s parity table alone.**
      **The planner's earlier draft told you to derive its query strings from
      `SAVED_VIEWS`. Do NOT — it would make that test worse.** The effective
      request is `buildQuery()` **plus** the `presetStatus` fallback; a test built
      from `buildQuery()` alone would stop modelling the browser. After this card
      the two coincide for `unassigned` but still do not for `sla-at-risk`, which
      also emits no status filter. **Add that as a comment there instead.**
- [ ] **Non-vacuity:** revert the line and watch something fail. Say which.

### 1.71b — one line that belongs with card 1.60's migration, same commit

**`scripts/check-migrations.sh` fails on migration 61, and it is right to.** I ran
it:

```
49:DROP INDEX "SavedView_default_per_user";
::error ...20260911090000_saved_view_type/migration.sql::destructive statement in
  a new migration — hand-strip it or add a first-line '-- allow-drop: <reason>'
```

The `DROP` is **legitimate** (the index swap), but the file lacks the opt-out, and
the script reads **`head -n 1`** so the marker must be the very first line.

- [ ] **Add it above the existing comment:**

      ```sql
      -- allow-drop: replaces SavedView_default_per_user with the (userId, viewType) form (card 1.60)
      -- Card 1.60 — one default saved view per user PER KIND.
      ```
- [ ] ⚠️ **Editing an applied migration is normally forbidden.** Safe here *only*
      because it is a comment. **Run `npx prisma migrate status` afterwards and
      confirm no migration reports as modified.** If one does, revert and report.
- [ ] **Why it matters more than one line suggests:** that script exists to stop
      six trigram `DROP INDEX` statements reaching production. **A guard that
      cries wolf on a correct migration is one people learn to skip.**

---

## 2 — Card 1.72: two spellings of "finished" (XS, tidy-up, NO migration)

### ✅ Already measured. Do not write a migration.

`completedAt` was added by `20260123151500_add_completed_at` as one line —
`ALTER TABLE "Ticket" ADD COLUMN "completedAt"` — **with no backfill.** Since then
`changeStatus` (`tickets.service.ts:3050`) sets it on RESOLVED/CLOSED and clears
it on REOPENED. So the invariant *"completedAt is set exactly when finished"* is
true for everything touched since and false for anything finished before
2026-01-23.

Two definitions each pick a different half:

| | "finished" is expressed as |
|---|---|
| `getCounts.atRisk`, `getCounts.overdue` | `status NOT IN (RESOLVED, CLOSED)` |
| the list's `slaStatus` branches (`:548-560`) | `completedAt IS NULL` |

⚠️ **The planner measured production on 2026-09-11:**

```
427 tickets · 6 finished · 0 finished without the stamp · 0 that would show as breached
```

**Zero rows. The divergence has no population.** This dataset is young enough that
everything finished was finished after the column existed.

- [ ] ⚠️ **DO NOT write the backfill migration.** A migration for zero rows is
      churn that costs a careful `DROP`-review and buys nothing.
- [ ] **Do the tidy-up only: make the two spellings one.** Pick a single
      expression of "finished" and use it in both places, with a comment saying
      which and why. **The planner's view: `completedAt IS NULL` is the better
      one** — one column rather than an enum list that grows, and it is already
      indexed (`Ticket_completedAt_idx`, migration `20260206153000`). **But say
      which you chose.**
- [ ] ⚠️ **Whichever you pick, the behaviour must not change** — with zero legacy
      rows the two are equivalent today, so this is a refactor. **If any count or
      list moves by one, stop:** that means they were not equivalent and the
      measurement missed something.

### Tests

- [ ] ⚠️ **A fixture row in the legacy shape** — status RESOLVED, `completedAt`
      explicitly `null`, a past `dueAt` — asserting the `overdue` count and the
      `slaStatus=breached` list **both** exclude it. **This is the whole card:**
      it is the one shape the existing fixture structurally cannot contain, and
      the reason the divergence was invisible.
- [ ] **The same for `at_risk`**, with a future `dueAt` inside the window.
- [ ] **Pin both to exact numbers, not to each other** — card 1.70's own comment
      makes the point: comparing count to list passes when both sides move
      together.

---

## 3 — Card 1.73: message actions in a right-click menu (S/M, the real work)

**The owner's words, with a screenshot:** *"I DONT LIKE THIS, I WANT REMOVE
MESSAGE/DELETE TO APPEAR ON RIGHT CLICK ON THE MESSAGE THAT POPS UP ALL THE
ACTION WE CAN DO ON THE CHAT MESSAGE."*

Today the only per-message action is a hover-revealed underlined **Remove** link
at `TicketConversation.tsx:461-470` (card 1.11's redaction). It hangs off the side
of the bubble, and that is what the owner is pointing at.

### ✅ Reuse, do not build — and do not copy either

**The app already right-clicks in three places:** `TicketTableView.tsx:200`,
`TicketTabBar.tsx:231`, `TicketDetailMidList.tsx:168` — all into
`TicketContextMenu.tsx` (275 lines). The pattern is:

```ts
const handleContextMenu = (e: React.MouseEvent, ticket: TicketRecord) => {
  e.preventDefault();
  setContextMenu({ x: e.clientX, y: e.clientY, ticket });
};
```

**That component already solves every hard part** — portal rendering, outside-click
dismissal, Escape, focus-the-first-item on open, roving Arrow focus, and UI-zoom
awareness via `getUiZoom`. **There is no Radix context-menu or dropdown-menu
package in this repo and none should be added for this.**

- [ ] ⚠️ **But do NOT copy `TicketContextMenu.tsx`.** It is typed to
      `TicketRecord` with ticket actions hard-coded. A second copy is two menus
      that must stay consistent — **the drift behind cards 1.36, 1.38, 1.47, 1.50,
      1.66 and 1.71.** **Extract the shell** (position, dismissal, focus
      management) and let both pass their own items.
- [ ] **Keep `TicketContextMenu`'s behaviour byte-identical through the
      extraction.** It is live on three surfaces; a refactor that quietly changes
      how the ticket menu dismisses is a worse outcome than not doing this card.
      **Say what you did to prove it did not change.**

### ⚠️ The four items the owner chose — two are ready, two are not

The owner picked **Copy text**, **who this message went to**, **delivery status**,
and **Remove**. I checked each against the code. **This is the part of the card
most likely to stall, so it is settled here rather than discovered by you.**

| Item | State | What it needs |
|---|---|---|
| **Remove** | ✅ ready | It exists. Move it into the menu. |
| **Copy text** | ✅ ready | `message.body` is on the client already. Trivial. |
| **Delivery status** | ⚠️ half | The counts are already on screen — **but `pending` is dropped.** See below. |
| **Who it went to** | ❌ not on the client | The data exists on the server and is **deliberately discarded**. See below. |

**Delivery status.** `deliveryLabel` (`TicketConversation.tsx:70-76`) renders
`emailed to N` / `N refused` under the bubble already, so a menu item that only
repeats that is not worth a click. **But its type is
`{ emailed, refused, internal }` and the API also returns `pending`** — so a
message whose email is still queued renders **no label at all**, which reads
identically to an internal note. ⚠️ **Also note `tickets.service.ts:1409`'s
fallback is `{ emailed: 0, refused: 0 }` — it omits `pending`, so the shapes
disagree.** **Fix both: carry `pending` through and show it.** That is what makes
this item earn its place.

**Who it went to.** The recipients **do** exist: `messageOutboxRows`
(`tickets.service.ts:1445-1467`) reads `NotificationOutbox.payload.email.cc` and
then **throws the identities away**, keeping only `reached = 1 + cc.length`.

- [ ] **So this item needs a small API change, not just UI.** Stop discarding the
      addresses on the message-list path and carry them through with the delivery
      shape. **Do that as its own commit, before the UI one.**
- [ ] ⚠️ **Scope it to what the menu needs.** Do not add a new endpoint; extend
      what `listMessages` already returns. **And do not widen access** — this rides
      on the existing message-list access check, which card 1.36 established is
      the thing that decides who reads what.
- [ ] ⚠️ **If the payload turns out not to carry a usable `to`** (only `cc` is
      read today), **stop and report rather than inventing one.** Shipping the
      menu with three items and adding the fourth later is a perfectly good
      outcome; guessing at recipients is not.

### Right-click alone is not an interface

- [ ] ⚠️ **It is unreachable by keyboard and by touch.** The menu needs a second
      opener — the existing hover affordance becoming a **⋯** button is the
      obvious one, and `Shift+F10` / the Menu key is the standard keyboard route.
- [ ] ⚠️ **The current Remove link is deliberately keyboard-focusable**
      (`focus:opacity-100`, and the comment at `:451-457` says focus matters "or
      the only way to reach it is a mouse"). **That must not regress.**
- [ ] **Respect the existing guard.** Remove only appears when
      `onRedactMessage && canRedactMessage?.(message) && !message.redactedAt`.
      **Items the viewer may not use should be absent, not disabled** — a greyed
      row invites a support question.

### Card 1.11's constraint still holds

`TicketConversation.tsx:451-457` explains that the control sits *under* the bubble
because **a control layered over the text would cover the very words somebody is
deciding about.**

- [ ] ✅ **A context menu is a better answer to that than the link was** — it
      opens at the pointer and closes again. **Say so when you update the comment,
      rather than deleting it.** The reasoning was right; the conclusion moved.

### Tests

- [ ] **Right-click a message opens the menu; Escape and outside-click close it.**
- [ ] ⚠️ **The keyboard route reaches every item the mouse route does.** That is
      the regression assertion — a menu that is mouse-only is a step backwards
      from the link it replaced.
- [ ] **Remove still redacts, and still only appears when the viewer may.**
      Card 1.11's existing assertions must keep passing unchanged.
- [ ] **A message with a queued email shows a pending state** — the thing that
      currently renders as nothing.
- [ ] ⚠️ **The extracted shell is proved not to have changed the ticket menu.**
      Name the test.

---

## 4 — What to report back

1. **Four commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, and **the migration count, which must
   still be 61.**
3. **`bash scripts/check-migrations.sh` clean**, and `npx prisma migrate status`
   showing no modified migration after §1.71b.
4. The answers:
   - **1.71 —** which test you watched fail on revert, and whether you unified the
     nav item's query with the preset's.
   - **1.72 —** which spelling of "finished" you chose, and **confirmation that no
     count or list number moved.**
   - **1.73 —** ⚠️ **whether the outbox payload carried a usable recipient list**,
     and therefore whether the menu shipped with three items or four.
   - **1.73 —** how you proved the extracted shell did not change the ticket menu.
5. **For each card, the specific assertion that would fail if it regressed.**
6. Anything that did not match. **This document is wrong somewhere.**

## 5 — Browser pass

- [ ] **1.71 —** click **Created by me**, then **Unassigned**. **Badge number =
      rows in the list.** Repeat from **Completed**. ⚠️ **Both paths, not just a
      fresh load** — a fresh load passed before this card and proves nothing.
- [ ] **1.72 —** the *Breach risk* and *Overdue* numbers are **the same as before
      your change**. This one is a refactor; a moved number is a failure.
- [ ] **1.73 —** right-click a message: menu opens at the pointer with the agreed
      items. **Then do the whole thing again with the keyboard only.** Then on a
      phone-width viewport, where there is no right-click at all.
- [ ] **1.73 —** remove a message from the menu and confirm it still redacts, and
      that the redaction caveat wording (card 1.11) is unchanged.

**Stop and report instead of improvising** if extracting the menu shell would
change how the ticket context menu behaves, if the outbox payload has no usable
recipient list, if unifying the "finished" spelling moves any number, or if the
keyboard route cannot reach an item the mouse route can.
