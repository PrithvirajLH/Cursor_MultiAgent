# Implementation Prompt — five cards, in order

**Date:** 2026-09-09
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** 1.58, 1.53, 0.9, 1.16, 0.10 — **in that order**

**One commit per card. Five commits.**

**Work straight through. Do not check in between cards, and do not ask permission
to proceed.** Then one browser pass, per §7.

> ✅ **The deploy landed.** Production is at `2d637f2` with **58 migrations
> applied**, 0 blocking rows, all 6 trigram indexes present, and
> `EMAIL_ACTION_SECRET` set — all confirmed by the planner on 2026-09-09.
> **So card 1.53's migration 59 is now safe**, which is the only reason this
> batch can include it.

> ⚠️ **Two cards in here are not ordinary code work. Read §4 and §6 before
> planning your day.** Card 0.9 may produce **no code at all**, and card 0.10's
> production half is **run by the owner, not by you** — your job there is to make
> it safe to run.

---

## 0. How to work through this

- **Read `CLAUDE.md` first.** Baselines: api `tsc` 0, unit **549 / 54**,
  integration **699 + 1 skipped, 69 of 70**, web `tsc` 0, vitest **225 / 36**.
  Migrations **58** in the tree **and in production**.
- **Only card 1.53 has a migration: 59.** If any other card seems to need one,
  **stop and report.**
- ⚠️ **Before any integration run, kill surviving jest processes.** A harness
  reporting a run as killed is **not** evidence it stopped — overlapping runs
  produced two phantom failures on 2026-09-09. **Exit 127 with no summary is a
  spawn failure, not a test failure.** Both are in `repo-landmines.md`. A clean
  run is ~11 minutes.
- **Never edit source while an integration suite is running.**
- **Hand-check migration 59 to zero `DROP` statements.** The standing twelve
  destructive statements are drift and are never part of your change.
- **Trust a live run over this document.** Handoffs from this planner have carried
  a wrong line number, a stale premise, a claim that a card could not be
  browser-verified when it could, a wrong count of a function's callers, and — last
  batch — **a fix instruction that would not have fixed the bug.** Say where this
  one is wrong.

---

## 1 — Card 1.58: a modal steals focus back on every render (S, no migration)

**Typing into any control inside the macro dialog is unreliable.** It blocked a
browser check last batch, so it is first here.

**Verified mechanism:** `useModalFocusTrap` lists **`onClose` in its effect
dependency array** (`:89`), and `RichTextEditor.tsx:825` passes
`onClose={() => setShowCanned(false)}` — **a fresh function identity every
render.** So the effect tears down and re-runs constantly, and its cleanup calls
`previouslyFocused?.focus()` (`:87`), yanking the caret out of the dialog.

- [ ] **Fix the dependency, not the focus restore.** Either wrap the handler in
      `useCallback` at the call site, or hold `onClose` in a ref inside the hook so
      the effect no longer depends on its identity.
- [ ] ⚠️ **Do NOT delete the focus-restore.** Returning focus on close is the
      accessible behaviour and card 3.8 will want it.
- [ ] ⚠️ **Check every other consumer of this hook before changing the hook
      itself.** An inline arrow as `onClose` is the natural thing to write, so
      others are probably affected too — and a fix at one call site leaves them
      broken. **List what you found in your report**, even if the answer is "only
      this one."
- [ ] **Why it went unnoticed:** it needs a re-render while the dialog is open, so
      it does not reproduce on a dialog you open and immediately click. The old
      macro tag control called `patchAction` on every keystroke, so it was **worse**
      before card 1.56 replaced it.

### Tests

- [ ] A re-render while the modal is open **does not** move focus. That is the
      regression assertion.
- [ ] Closing the modal **still** returns focus to whatever opened it.
- [ ] ⚠️ **This project's vitest has no jsdom.** Card 1.49 solved the same problem
      by extracting the wiring into a pure function so it could be asserted at all.
      **Do the same rather than skipping the test** — and if you genuinely cannot
      assert it without a DOM, say so plainly instead of writing a test that passes
      either way.

---

## 2 — Card 1.53: team admins manage saved views (M, **migration 59**)

**The owner asked for this one.** Design is decided; do not re-open it.

**Requirement:** keep per-user saved views exactly as they are, and **additionally**
let a **team admin create, modify and delete views visible to their whole team** —
and **hide the built-in sidebar presets their team does not use.** Worked example:
Payroll has no use for *SEV1 today* or *Awaiting reply > 24h*; they want **TCA
Urgent Retro, TCA paycard, A-PAF, B-PAF**.

### ✅ Far more of this exists than the request assumes — do not rebuild it

- **`SavedView` already has `teamId`** with a relation and index
  (`schema.prisma:798-812`). **Team scoping itself needs no migration.**
- **`SavedViewsService.list()` already returns `userId = me OR teamId = my team`**
  (`:16-26`), so **a team view is visible to the whole team the moment one exists.**
- **The tickets sidebar already renders per-user ticket saved views** with live
  counts (`SidebarSavedViews.tsx:142`, section at `:253`).
- The two kinds of saved view are already separated by a JSON discriminator,
  `filters.viewType === "reports"` (`:135-144`).

### ❌ What is actually missing

- [ ] **There is no role gate at all.** `create()` honours `dto.teamId` whenever it
      equals the caller's own team (`:30-33`) with **no role check**, so today *any*
      user — an EMPLOYEE included — can create a team-wide view. **The requirement
      makes this stricter, not looser.** `TEAM_ADMIN` manages their own team;
      `OWNER` manages any.
- [ ] **`update()` and `delete()` gate only on `existing.userId !== user.id`**
      (`:60`, `:88`), so a team view can be edited by **its creator alone** —
      another team admin cannot touch it, and it is orphaned the day that person
      leaves. Fix both.
- [ ] **`update()` cannot change `teamId`**, so there is no way to promote a
      personal view to a team view or demote one back.
- [ ] **No UI to create or manage a team view**, and the sidebar draws no
      distinction between *my* view and *the team's* — people need to know which
      they are about to edit.
- [ ] ⚠️ **A live bug to fix while you are in there.** Both `create()` and
      `update()` clear the default flag with
      `updateMany({ where: { userId: user.id } })` (`:37-40`, `:66-69`), which spans
      **both kinds** — so making a report view the default **already** clears the
      default ticket view. **Scope that clear to the same `viewType`.**

### The hiding, and the five decisions already made

- [ ] **Storage: add `hiddenPresetIds String[]` to `Team`.** `Team` has **no
      settings JSON** and the schema's house style is explicit columns with doc
      comments (`isSensitive`, `confidenceThreshold`). **This is migration 59** —
      one additive column, empty by default.
- [ ] **Team-admin-only means members cannot opt back in.** If Payroll's admin
      hides *SEV1 today*, an AGENT on Payroll cannot get it back. **That is what was
      asked for. Do NOT also add a personal override** — two mechanisms answering
      "is this row visible" is the drift that produced cards 1.36, 1.38, 1.47 and
      1.50.
- [ ] **A preset id is a code constant, not a row.** `SAVED_VIEWS` in
      `components/shell/saved-views.ts` owns them. A hidden id whose preset is later
      renamed or removed must be **ignored silently** — never a ghost row, never a
      crash. **Say so in that file's doc comment**, and while you are there: its
      comment claims the presets feed `/tickets-revamp`, **a page deleted
      2026-06-08.** Fix that.
- [ ] **Multi-team people: use the primary `teamId`.** `AuthUser` carries a
      resolved single `teamId` (`auth.guard.ts:185`) **and** `memberTeamIds`, the
      full set (`:192`), and `list()` uses only the single one today. **Match that.**
      Unioning hidden ids across several teams hides too much; intersecting hides
      nothing. `memberTeamIds` is there if the owner ever wants multi-team. **Say in
      your report that a multi-team member sees only their primary team's views and
      hides.**
- [ ] **`isDefault` is not allowed on a team view.** Keep the flag strictly
      personal — that sidesteps the three-way fight entirely. A team admin who wants
      everyone to *land* somewhere is asking for a team landing view, which nobody
      has requested. **Stop and report if you think otherwise rather than building
      it.**

### Counts — already answered, do not redesign

`useViewCounts` (`shell/use-view-count.ts`) issues **one real `GET /tickets` per
view** with `pageSize=1` and reads `meta.total`, and `viewFiltersToParams` already
works off a stored `filters` blob **regardless of whose view it is** — so **team
views get live counts with no extra work.** Three things to keep true:

- It is a **60-second cached fetch** (`staleTime: 60_000`) with `placeholderData`,
  **not** a push subscription. Do not promise live-to-the-second.
- **Every badge is its own COUNT query.** Ten presets plus four team views is
  fourteen filtered counts per sidebar load, against the same remote pooler that
  produced card 1.51's timeout. **Hiding presets makes this better, not worse** —
  Payroll would go from fourteen to four. Worth saying in the UI copy if it fits.
- The count runs through `/tickets`, so it applies **the viewer's own access
  filter**. One team view shows **different numbers to different members**. That is
  correct and must stay — but it means a team count is **not** a team-wide total,
  so do not label it as one.

### Tests

- [ ] An EMPLOYEE **cannot** create a team view. A TEAM_ADMIN can, for their own
      team only. An OWNER can, for any.
- [ ] A second team admin **can** edit and delete a team view they did not create.
- [ ] A hidden preset disappears for that team and **stays visible for every other
      team**. That is the regression assertion.
- [ ] A hidden id that matches no live preset is ignored, not rendered, not thrown.
- [ ] Setting a default **report** view no longer clears the default **ticket**
      view.
- [ ] `access-control.parity.spec.ts` stays green.

---

## 3 — Card 0.9: re-measure performance (S, probably no code)

**This card may produce no production code, and that is an acceptable outcome. Do
not invent work to make it feel like a card.**

The stated requirement is **sub-500 ms** for ticket and knowledge-base search. The
board's note says to measure against local WSL Postgres because there is no
staging.

- [ ] ⚠️ **That note is now out of date and you should improve on it.** The
      production database is **reachable from this machine** since the firewall rule
      landed on 2026-09-08, and `apps/api/prod-migration-count.mjs` is a working
      read-only example of connecting to it. **Measure against production data
      volumes, not a local fixture** — local Postgres is far faster than the remote
      pooler, which is exactly how card 1.51's timeout hid from the suite.
- [ ] **Measure, at minimum:** ticket list first page, ticket search with a text
      term, and KB search. Report **p50 and worst-of-N**, not an average — an
      average hides the tail, and the tail is what people complain about.
- [ ] ⚠️ **READ ONLY.** Do not write to production. Timing queries is fine;
      creating fixtures there is not.
- [ ] **The six trigram GIN indexes are the thing under test.** If search is fast,
      say which index the plan actually used (`EXPLAIN`), so the next person knows
      what would break it.
- [ ] **Then decide whether a gate is worth it**, and say so either way. A test that
      asserts a duration on a shared remote database will be flaky, and **a flaky
      gate is worse than none** — this repo already has the "a test that passes with
      the bug present is not a test" problem. If you cannot make it meaningful, say
      that and stop.

### What to report

Numbers, the `EXPLAIN` line for each, and your recommendation on the gate. **If
nothing needs fixing, the deliverable is the measurement and a one-paragraph
verdict.** Commit that as a document under `docs/`.

---

## 4 — Card 1.16: daily digest for leads (S) — ⚠️ read this before building

**This card contradicts a decision the owner made, and I am not going to paper over
it.**

**Card 1.42 removed staff email entirely** — *"agents, leads and owners get no
email at all; they work on the platform."* **A digest emailed to a lead is staff
email.**

**Planner's judgement, and the assumption you should build under:** 1.42 was aimed
at **per-ticket noise** — an email for every message and every status change, which
is what caused the fatigue. **A once-a-day digest is categorically different:** one
message, on a schedule, summarising rather than pinging. It honours 1.42's intent
while breaking its letter.

- [ ] ⚠️ **The owner has been told this is the assumption and can veto it.** If they
      have not confirmed by the time you reach this card, **build it and keep it
      behind a switch that is OFF by default** (see below) so shipping it sends
      nothing until somebody chooses to.
- [ ] ⚠️ **Stop and report rather than improvising** if making this work needs you
      to weaken the staff-exclusion logic in `notifications.service.ts:735-748`.
      That exclusion is card 1.42, and the digest should be a **new** send path that
      does not touch it.

### What it is

One email per lead per morning: **what breached, what is at risk, what is
unassigned** for their team.

- [ ] **OFF by default**, behind an env switch, in the shape the other background
      jobs already use. **Say the variable name in your report.**
- [ ] **It must appear on the Operations console** (card 1.21) like every other
      background job — whether it is on, when it last ran, what it did, with a Run
      now button. That page is the reference design for anything scheduled here.
- [ ] **Send nothing when there is nothing to say.** An empty digest every morning
      is exactly the fatigue 1.42 removed, and the fastest way to have the whole
      thing switched off.
- [ ] **A lead sees their team only.** Reuse the existing access rules rather than
      writing a second definition of "my team" — `operationalTeamIds` is the
      chokepoint, and card 1.55 is a live reminder of what happens when that
      function's behaviour is second-guessed.
- [ ] The four surviving email event types are `TICKET_CREATED`, `MESSAGE_ADDED`,
      `TICKET_STATUS_CHANGED`, `INBOUND_EMAIL_ACKNOWLEDGED`. **A digest is a fifth
      kind** — adding a `NotificationType` enum value needs a migration and
      **cannot be used in the transaction that adds it** (migrations 54 and 56
      document this). **If you find yourself needing one, stop and report** rather
      than writing migration 60 in a batch whose only migration is 59.

### Tests

- [ ] A lead with a breached ticket gets a digest naming it; a lead with nothing
      gets **no email at all**.
- [ ] A lead sees only their own team's tickets. That is the regression assertion.
- [ ] The switch being off means nothing is queued.

---

## 5 — Card 0.10: seed cleanup and the HR merge (S) — ⚠️ you do not run this

**Both halves touch the production database. You write and prove the scripts; the
owner runs them.** Destructive production writes are blocked from agent sessions
here, and that is deliberate.

### The HR merge

**`apps/api/scripts/merge-hr-teams.sql` already exists** (147 lines) **and so does
`merge-hr-teams-dryrun.sql`** (59 lines). It is a one-time manual step that has
never been run. It `DELETE`s from `TeamMember`, `TicketAccess` and
`SlaPolicyAssignment`, then re-points `Ticket`, `User`, `TeamMember`,
`TicketAccess`, `RoutingRule`, `SlaPolicyAssignment` and `SavedView` from the source
team to the destination.

- [ ] **Read both scripts and confirm they still match the schema.** They predate
      several migrations — most recently **58**, and **your own 59 adds
      `Team.hiddenPresetIds`.** ⚠️ **A merge that drops the source team must decide
      what happens to its hidden-preset list.** You are the first person who can
      know that, because you are adding the column in the same batch. **Handle it or
      say plainly that you did not.**
- [ ] **Run the dry run against a restored copy or the dev database**, never
      production. Report what it says it would change: row counts per table.
- [ ] ⚠️ **Confirm it is wrapped in a transaction and can be rolled back.** It
      opens with `BEGIN;` — verify there is a single commit point and no partial
      state on failure.
- [ ] **Do not run it against production.** Hand the owner the exact command and
      the dry-run output.

### The seed cleanup

Production carries seeded fixtures — `prisma/seed.ts` uses a `[Seed]` prefix for
canned responses and creates a sample automation rule that matches `[Seed]` in a
subject.

- [ ] **Inventory first, delete second.** Write a **read-only** script that reports
      exactly what in production came from the seed: canned responses with the
      prefix, the sample rule, fixture users, sample tickets. **Numbers before
      deletions.**
- [ ] ⚠️ **Real traffic may now reference seeded rows.** A real ticket tagged with a
      seeded tag, or a real message that used a `[Seed]` canned response, must not
      be collateral. **The inventory has to say what is referenced**, and anything
      referenced needs a decision rather than a delete.
- [ ] **Two probe tickets are also awaiting deletion** — `PA_20260829_021` and
      `IT_20260829_022`, noted in `CLAUDE.md`. Include them in the inventory.
- [ ] **Deliverable: one read-only inventory script the owner can run, and one
      cleanup script they can run after reading it.** Short paths, so they can be
      invoked with `!`. **Test both against dev.**

---

## 6 — What to report back

1. **Five commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, and **the migration count, which must
   be 59** — 59 exactly, from card 1.53 alone.
3. The answers this batch exists to produce:
   - **1.58 — every other consumer of `useModalFocusTrap`**, and whether they were
     affected.
   - **1.53 —** the combobox/UI shape for managing team views, what happens to
     `hiddenPresetIds` on a team merge, and confirmation that a multi-team member
     sees only their primary team.
   - **0.9 — the numbers**, the `EXPLAIN` lines, and your verdict on a gate.
   - **1.16 —** the env variable name, and whether anything forced you near the
     staff-exclusion logic.
   - **0.10 —** the dry-run output, and the two script paths for the owner.
4. **For each card, the specific assertion that would now fail if the bug came
   back.** Not the count.
5. Anything that did not match. **This document is wrong somewhere.**

## 7 — The browser pass

- [ ] **1.58** — open the macro dialog and **type into its tag field.** That is the
      check that was impossible last batch.
- [ ] **1.53** — as a team admin, create a team view and hide a preset. Confirm a
      second account **on that team** sees both changes, and an account on **another
      team** sees neither. Confirm counts appear on the team view.
- [ ] **1.16** — with the switch on, trigger it from the Operations console and read
      the outbox row. With nothing to report, confirm **no row is written at all.**
- [ ] **0.9 and 0.10** need no browser pass. Say so rather than inventing one.

**Stop and report instead of improvising** if 1.53 needs a second visibility
mechanism or a change to what `operationalTeamIds` returns, if 1.16 needs the staff
exclusion weakened or a new `NotificationType`, if 0.10's scripts no longer match
the schema in a way you cannot safely fix, or if `access-control.parity.spec.ts`
goes red.
