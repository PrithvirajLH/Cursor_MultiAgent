# Implementation Prompt — five cards, in order

**Date:** 2026-09-10
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** 1.66, 1.70, 1.61, 1.65 (its sweep), 1.60 — **in that order**

**One commit per card. Five commits.** Work straight through. Do not check in
between cards, and do not ask permission.

> **This supersedes `prompts/2026-09-10-three-web-fixes-batch.md`**, which covered
> 1.66, 1.61 and the sweep. The owner has added **1.70** and **1.60**, and both
> decisions those were waiting on are answered below. **Use this file.**

---

## 0. Before anything

- **Read `CLAUDE.md`.** Baselines: api `tsc` 0, unit **649 / 64**, integration
  **782 + 1 skipped, 74 of 75**, web `tsc` 0, vitest **254 / 40**. Migrations
  **60**.
- ⚠️ **Kill surviving jest processes before any integration run, and verify they
  actually died.** A harness reporting a run as killed is not evidence — this
  repo has hit it twice, and 1.69's implementer hit it again while holding a
  connection to `ticketing_test`. **Exit 127 with no summary is a spawn failure.**
- ⚠️ **The Bash tool caps at 10 minutes and this suite now takes longer**, so it
  cannot be run in the foreground at all. Run it in the background and wait.
- **Only card 1.60 has a migration: 61.** ⚠️ **And it is the one migration in
  this project's history that legitimately contains a `DROP` — read §5 before you
  touch it.**
- **Trust a live run over this document.** On the last five batches this planner
  supplied a mislabelled site table, a fix that would have covered half the
  routes, three wrong claims about a library, quotes that were never in a header,
  and an unnecessary flag. **Say where this one is wrong.**

---

## 1 — Card 1.66: the reply trimmer truncates agent notes (XS)

**First, because it is a defect card 1.62 introduced and 1.62 is already
committed.**

`stripQuotedReply` now runs in `listMessages` (`tickets.service.ts:1203`) — the
single message-read path — so it trims **every** displayed message, including ones
an agent typed. Two of its six markers are things a person writes:

```
/^_{5,}\s*$/m      five or more underscores on a line
/^--[ \t]?$/m      a bare "--"
```

- [ ] **Delete markers 5 and 6.** No migration, no origin column, nothing lost.
      **The argument is complete:** `stripQuotedReply` cuts at the **earliest**
      match, so those two can only change the outcome when they beat markers 1–4
      or when none of 1–4 match. Markers 1–4 are unambiguous email artefacts a
      real reply always carries. **So 5 and 6 only ever bite a message with no
      email signal at all — an agent's note.**
- [ ] **On the real fixture** (`inbound-mailbox/__fixtures__/outlook-reply.html`)
      **markers 5 and 6 match zero times**; the trimming is markers 1 and 3.
- [ ] **Marker 6 also contradicts the util's own doc**, which says it declines to
      guess at signature blocks — while marker 6 is a signature delimiter.
- [ ] **Two tests will fail. Rewrite, do not delete.** `:64` "cuts an underscore
      rule" — ⚠️ **its `From: x` does NOT match marker 3**, which needs
      `Sent:`/`Date:` on the next line, so with marker 5 gone that body has no
      email signal and comes back unchanged. **That fixture is itself an example
      of the ambiguity.** And `:69` "cuts the RFC signature delimiter" — the
      signature now stays.
- [ ] **`:80` and `:93` must pass untouched.** If either moves, stop.
- [ ] **Add one test:** an agent's note containing a divider line comes back
      **byte-identical.**

---

## 2 — Card 1.70: two badges mean three different things (XS) — decided

**Both decisions are the owner's and both are now made.** Card 1.69 step 4
surfaced them; its implementer correctly refused to resolve either, because each
moves a number.

### ① "Unassigned" — use the narrower definition

The sidebar list means `assigneeId IS NULL`. The existing `unassigned` count
**also requires the ticket to be open.**

- [ ] ✅ **Decided: unassigned AND open.** An unassigned *resolved* ticket needs
      nobody; the badge exists to surface work no one has picked up. **The sidebar
      adopts the count's definition, not the other way round** — and
      `DashboardPage` has shown that figure for months.

### ② "Breach risk" — three numbers for one idea

The **label hard-codes 1h** (`shell/saved-views.ts:90`). The **list uses 4h** and
`completedAt IS NULL`. **`atRisk` uses `SLA_AT_RISK_THRESHOLD_MINUTES`** —
default `120`, **unset in production, so 2h** — and **ignores `completedAt`**.

- [ ] ✅ **Decided, three parts.** Use **`SLA_AT_RISK_THRESHOLD_MINUTES`** as the
      single definition. **Respect `completedAt IS NULL`** — a completed ticket
      cannot breach. And ⚠️ **derive the label from the setting instead of
      hard-coding it.**
- [ ] ⚠️ **That third part is the one that matters, and it is easy to skip.** A
      hard-coded number beside a configurable threshold **will** drift again — it
      already has, twice, which is how we got three values. **Fixing the number
      without fixing the label just resets the clock.**
- [ ] **The label is rendered client-side and the threshold lives server-side**, so
      the value has to reach the browser. `getCounts` is the natural carrier since
      the sidebar already calls it after 1.69 step 4. **Say how you did it.**
- [ ] `tickets.service.ts:846` already carries a comment noting the mismatch —
      **update it rather than leaving it describing the old state.**

### Tests

- [ ] An unassigned **resolved** ticket is **not** counted as unassigned. That is
      the regression assertion for ①.
- [ ] A **completed** ticket is not counted as at-risk. That is ②'s.
- [ ] **The label matches the configured threshold** — set the env var to
      something unusual and assert the label follows. **Without this test the
      third part rots immediately.**

---

## 3 — Card 1.61: the sidebar's system views cannot be hidden (S)

**The handoff is already written:
`prompts/2026-09-10-1-61-system-views-are-not-hideable.md`. Follow it.**

Found by the **owner** within an hour of card 1.53 reaching production, trying to
hide *Follow-ups due today*.

- [ ] **This is the planner's error**, so trust the card over my 1.53 handoff: I
      described the presets as **one** list. There are **two**. 1.53's hiding
      reaches the six in `SAVED_VIEWS`; **Watching, Mentions and Follow-ups due
      today are defined inline at `SidebarSavedViews.tsx:172-189`** and *Assigned
      to Me* comes from `App.tsx` nav children.
- [ ] ⚠️ **My 1.53 worked example used two of the hideable six**, so the card
      passed while the owner's first real attempt failed.
- [ ] **No migration.** `Team.hiddenPresetIds` exists from migration 59 and is a
      plain string array — these four need **ids in it**, not a new column.
- [ ] ⚠️ **Card 1.69 step 4 has just moved these badges onto `getCounts`.** Read
      that commit (`9bf4af9`) before editing the sidebar, or you will be working
      against a file that changed underneath the 1.61 handoff.
- [ ] **Regression assertion:** hiding one of the four hides it **for that team
      only**.

---

## 4 — Card 1.65: the remaining sweep (S)

Its first half is **committed now**, so this is unblocked. The same bare-catch
shape is in about fifteen more places:

```
AdminTagsPage:90        AgentProfilePage:106      AgentsDirectoryPage:92
AutomationRulesPage:1285  ManagerViewsPage:812
SlaSettingsPage:1401/1432/1447
TeamPage:455/472/490/510
TriageBoardPage:605     TagAnalyticsPanel:22
```

**The planner spot-checked four and they are exactly that shape.**

- [ ] ⚠️ **Judge each. Do not `sed` the list.** The bug bites where a request can
      be **cancelled** — navigation away mid-flight — not everywhere a catch is
      broad. **A one-shot load that cannot be superseded is fine as it is.**
- [ ] **Say which you changed, which you left, and why for each.** Fifteen with no
      reasoning is not a review.
- [ ] ⚠️ **A timeout must keep reaching the user.** `fetchWithTimeout` aborts on
      its own deadline but rethrows as `ApiError(…, 408)` — a real failure. The
      abort is the mechanism, not the meaning. **A test exists to stop a later
      "simplification" swallowing it. Do not swallow it.**
- [ ] **Reuse `isAbortError`** from `apps/web/src/api/is-abort-error.ts`. The whole
      reason 1.65 happened is that the knowledge sat private in `client.ts`.

---

## 5 — Card 1.60: one default saved view per user is a database rule (S–M, **migration 61**)

**Do this last. It carries the only schema change, and it breaks a rule every
other handoff in this repo gives you.**

Making a **report** view your default silently clears your default **ticket**
view, and vice versa. ✅ **1.53's implementer already refactored both call sites into one**, `clearOtherDefaults` (`saved-views.service.ts:239-247`), and left a thorough comment at `:210-238` explaining why they stopped. **Read that comment before writing anything** — it is the best description of the problem and it raises the objection you have to answer.

**Card 1.53's implementer tried to scope that per kind and could not**, because
`20260213140000_schema_hardening:41-43` creates:

```sql
CREATE UNIQUE INDEX "SavedView_default_per_user"
  ON "SavedView" ("userId")
  WHERE "isDefault" = true AND "userId" IS NOT NULL;
```

**One default per user is a database invariant.** Scoping the clear per kind makes
the second default violate it — they built it and got
`Unique constraint failed on the fields: (userId)`, a 500 on a flow that works
today. **They backed it out, which was right.**

### ✅ Decided: `viewType` becomes a real column

- [ ] **Add a `viewType` column to `SavedView`** with a default of `'tickets'`,
      and **backfill** `'reports'` where `filters->>'viewType' = 'reports'`.
- [ ] ⚠️ **Why not an expression index on the JSON — this is the reason, and it is
      decisive.** `viewType: "reports"` is set **only on report views**
      (`ReportsPage.tsx:291`); ticket views have **no such key**
      (`SidebarSavedViews.tsx:139` filters on `!== "reports"`). So
      `filters->>'viewType'` is **NULL for every ticket view**, and **a unique
      index treats NULLs as distinct — it would not constrain ticket views at
      all.** `COALESCE` would work and would hide the default inside an index
      expression where nobody will find it. **A column is the honest answer.**
- [ ] ⚠️⚠️ **THE COLUMN MUST REPLACE THE JSON KEY, NOT SIT BESIDE IT. This is the objection 1.53's implementer raised and they were right to raise it.** Their comment warns that putting the discriminator into SQL would make *“a second copy of a rule that already lives in TypeScript, which is the drift behind cards 1.36, 1.38, 1.47 and 1.50.”* **If you add the column and leave `filters.viewType` in place, you have created exactly that.** So: **migrate the discriminator out of the JSON**, drop the key from what gets written, and update every reader — **`ReportsPage.tsx:252` and `:291`, and `SidebarSavedViews.tsx:139`** — to read the column. **One discriminator, one place.**
- [ ] ⚠️ **If that turns out to be more than this batch can hold, STOP AND REPORT rather than shipping the column alongside the JSON key.** Half of this change is worse than none: the bug stays, and a second source of truth arrives to keep it company.
- [ ] **Then replace the index** with a partial unique on `(userId, viewType)
      WHERE isDefault = true AND userId IS NOT NULL`, and **scope the service's
      `updateMany` to the same `viewType`.**
- [ ] **Leave `SavedView_default_per_team` alone**, and say you did. Card 1.53
      deliberately decided **team views cannot be default**, so that index is
      currently unreachable — dropping it would remove a guard for a feature
      somebody may still want.

### ⚠️⚠️ THE MIGRATION CONTAINS A LEGITIMATE `DROP INDEX`. READ THIS TWICE.

**Every other handoff in this repo tells you to hand-check a migration to zero
`DROP` statements. This is the exception, and the two cases must not be
confused:**

- ✅ **KEEP** your own `DROP INDEX "SavedView_default_per_user"`. **It is the
  point of the migration.** Stripping it leaves the old invariant in place and the
  fix does nothing — while testing green on everything except the one case.
- ⛔ **STRIP** the **twelve standing destructive statements** Prisma will emit
  alongside it: **six `DROP INDEX` for the trigram GIN indexes** (`KbArticle_*_trgm_idx`,
  `Ticket_*_trgm_idx`) and **six `ALTER COLUMN … DROP DEFAULT`**. Those are drift,
  they are never part of any change, and applying them **destroys ticket and KB
  search performance against a stated sub-500ms requirement.**
- [ ] **Write the migration by hand** rather than shipping what `migrate diff`
      emits, and **list in your report every statement you kept and every one you
      removed.** This is the one migration where "0 DROPs" is the wrong check.
- [ ] **After applying it to dev, confirm the six trigram indexes still exist**
      (`apps/api/prod-migration-count.mjs` reports the count against production;
      for dev, query `pg_indexes`). **Say the number.**

### Tests

- [ ] A user can hold a default **report** view **and** a default **ticket** view
      at the same time. That is the regression assertion, and it is the thing that
      currently 500s.
- [ ] Setting a second default of the **same** kind still replaces the first.
- [ ] The backfill is correct: an existing report view comes out as `'reports'`,
      an existing ticket view as `'tickets'`.

---

## 6 — What to report back

1. **Five commit SHAs** and `git diff --stat` each.
2. Every `Tests:` line, both `tsc`, vitest, and **the migration count, which must
   be 61** — 61 exactly, from card 1.60 alone.
3. The answers:
   - **1.66 —** how you rewrote the two failing tests; confirmation `:80` and
     `:93` passed untouched.
   - **1.70 — how the threshold reaches the label**, and the label you now render.
   - **1.61 —** the ids for the four system rows, and how a stale id is handled.
   - **1.65 —** which of the ~15 you changed, which you left, **and why each**.
   - **1.60 — every statement you kept in migration 61 and every one you removed**,
     plus the trigram index count after applying it. **This is the report's most
     important section.**
4. **For each card, the specific assertion that would fail if it regressed.**
5. Anything that did not match. **This document is wrong somewhere.**

## 7 — Browser pass

- [ ] **1.66** — save an internal note containing a line of underscores; it
      displays in full.
- [ ] **1.70** — the Breach risk badge's label matches the configured threshold,
      and an unassigned resolved ticket is not in the Unassigned count.
- [ ] **1.61** — hide *Follow-ups due today* as a team admin; gone for that team,
      present for another.
- [ ] **1.65** — open a ticket from the list and navigate straight back, twice. No
      *"Unable to load tickets"*, rows stay on screen.
- [ ] **1.60** — set a default report view, then a default ticket view. **Both
      stick.** Today the second one 500s.

**Stop and report instead of improvising** if 1.66's change moves `:80` or `:93`,
if 1.70's threshold cannot reach the client without a new endpoint, if 1.61 needs
a migration, if 1.65's sweep would mean weakening the 408 path, or if migration 61
cannot be written without also dropping something you were not asked to drop.
