# Implementation Prompt — 1.126, 1.127, 1.81 and 1.63: the owner's four

**Date:** 2026-09-16
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Cards:** **1.126** (a team admin can lock themselves out) · **1.127** (saving a
view silently drops three filters) · **1.81** (owner reports ignore the team
filter) · **1.63** (the AI has never run in production)

**Four cards, four commits. No migration.**

⚠️ **This supersedes `prompts/2026-09-16-card-1-126-team-lockout.md`.**

> ## ⚠️ TWO DECISIONS WERE OPEN AND THE OWNER ANSWERED BOTH ON 2026-09-16
>
> **Cards 1.81 and 1.63 have sat on the board as *"needs an owner decision"*.
> They are decided. Both answers are recorded below, and neither needs asking
> again:**
>
> - **1.81 → HONOUR THE FILTER.** Pick a team on the Reports page and get that
>   team's numbers.
> - **1.63 → YES, LET THE AI ROUTE UNROUTED EMAIL.** An inbound email arriving
>   with no department is classified rather than landing in Unassigned.
>
> **Order: 1.126 and 1.127 first — they are live faults the owner hit today.
> 1.81 is small. 1.63 is the largest thing here and should be its own sitting.**

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check the tree is yours:** `git status --porcelain | grep -v '^??'`.
  ⚠️ **And check `apps/api` and `apps/web` are not EMPTY** — something emptied
  both on 2026-09-16 at 14:10 and it was caught only by a command failing oddly.
- **Baseline to beat:** unit **855 / 91**, web **416 / 61**, integration
  **966 + 1 skipped / 96 of 97**, both typechecks clean, migrations **67**.

---

## 1 — Commit one: card 1.126, a team admin can lock themselves out

### 1a. `removeMember` has no guard at all

✅ **Verified at `teams.service.ts:256-281`. The whole method is:** permission
gate → find the row → delete it → sync the role. **Nothing else.**

**So a TEAM_ADMIN can remove themselves, remove another TEAM_ADMIN, or empty a
team completely** — and an empty team still receives auto-assigned tickets with
nobody there to take them.

⚠️ **THE CODEBASE ALREADY SOLVED THIS EXACT SHAPE ONE FILE OVER.**
`users.service.ts:206-212` guards the OWNER role: *"You cannot change your own
owner role"*, plus a count of remaining active owners. **The rule was thought
through and never carried across to team membership.**

- [ ] **A TEAM_ADMIN cannot remove themselves from a team they administer.**
      **An OWNER still can** — somebody has to be able to.
- [ ] **A TEAM_ADMIN cannot remove another TEAM_ADMIN.** An OWNER can.
- [ ] ⚠️ **Refuse with a sentence that says what to do instead**, not
      `Forbidden`. *"You cannot remove yourself from a team you administer. Ask an
      owner to do it."* **Commit `2fed472` exists because a correct refusal reached
      the screen as "Unable to assign ticket" — do not repeat that.**
- [ ] ⚠️ **Decide about the LAST member of a team and say what you chose.**
- [ ] ⚠️ **Do NOT reuse `ensureTeamAdminOrOwner` for this.** That answers *"may
      you manage this team"*; this answers *"may you remove THIS PERSON"*.

### 1b. An OWNER cannot be a team member, and nothing says so

✅ **Verified at `teams.service.ts:344-356`:** `ensureEligibleTeamMemberRole`
accepts EMPLOYEE, AGENT, LEAD and TEAM_ADMIN — and **rejects OWNER**.

✅ **That is deliberate elsewhere:** `users.service.ts:237` **nulls
`primaryTeamId` when somebody is promoted to OWNER**, and card 1.110's exemption
at `tickets.service.ts:2725` says *"OWNERs have global write access and aren't
required to hold an explicit TeamMember record"*.

⚠️ **So the rule is coherent and the trap is that it is one-way and silent.**

⚠️ **ESTABLISH THIS BEFORE WRITING CODE.** *"Not able to add member"* is two bugs:

| | |
|---|---|
| **Adding THEMSELVES** (an OWNER) | Explained above. Message: *"Only employee, agent, lead, or team admin users can be added as team members"*. |
| **Adding SOMEBODY ELSE** | ⚠️ **NOT explained.** `ensureTeamAdminOrOwner` returns immediately for an OWNER and nothing else on that path rejects one. **A different message means a different bug — report it rather than forcing a fit.** |

- [ ] **Get the exact text and say which it was.**
- [ ] **The dead end must go.** The refusal offers no way forward at all today.
- [ ] ⚠️ **The product question is still the OWNER'S.** Either an owner should not
      hold membership — the **message** is then the bug, and the picker should stop
      offering a person it will refuse — or owners should sit on teams, in which
      case `ensureEligibleTeamMemberRole` accepts OWNER **and
      `syncOperationalUserRole`'s early return for OWNER/TEAM_ADMIN must be
      checked; it is correct and must stay.** **Ask. Do not pick.**

### Tests

- [ ] **A TEAM_ADMIN removing themselves is refused, and the message names the
      way out.** Another TEAM_ADMIN: refused.
- [ ] ⚠️ **An OWNER can remove either.** **Non-vacuity, most likely to break.**
- [ ] **A TEAM_ADMIN can still remove an ordinary AGENT.** Non-vacuity.
- [ ] **`syncOperationalUserRole`'s early return untouched.**

---

## 2 — Commit two: card 1.127, saving a view drops three filters

### ⚠️ It is FOUR lists, not two. This is the whole card.

**The owner asked whether it was because tag is missing from the advanced filter
panel.** ✅ **True — `FilterPanel.tsx` has no tag control; `TagFilterInput` is on
the main toolbar at `TicketsPage.tsx:1483` — but NOT the cause.**

✅ **Verified: the same field list is hand-written in FOUR places.**

| # | Where | `tags` | `resolvedFrom` / `resolvedTo` |
|---|---|---|---|
| 1 | `useFilters.ts:195-215` — builds the URL | ✅ | ✅ |
| 2 | `SaveViewButton.tsx:150-170` — `filtersForPersistence` | ❌ | ❌ |
| 3 | `SavedViewsDropdown.tsx:48-80` — `applyView` | ❌ | ❌ |
| 4 | `SavedViewsDropdown.tsx:82-100` — `filtersToPayload` | ❌ | ❌ |

⚠️ **SO FIXING ONLY THE SAVE WOULD NOT FIX IT.** Even with the tag persisted,
`applyView` drops it again on the way back in.

**It fails silently: the save succeeds, nothing errors, the filter is gone.**
⚠️ **`resolvedFrom`/`resolvedTo` go the same way**, so a *"resolved this week"*
view loses its dates. **Nobody has reported that — which is the point.**

⚠️ **CARD 1.99'S BUG IN A PLACE CARD 1.99 DID NOT REACH** — *"a ticket filter
must be spelled in three places or it silently vanishes"*. **It is four.**

### The fix

- [ ] ⚠️ **DO NOT just add three fields to three lists.** That fixes today and
      guarantees the seventeenth instance. **The lists must stop being hand-written.**
- [ ] **Derive persistence and application from ONE definition.**
- [ ] ⚠️ **Two of them are NOT symmetric and that is deliberate:**
      `filtersForPersistence` strips empty and default values *"so the persisted
      view is portable"*; `applyView` supplies defaults for anything absent.
      **One list of fields, not one function doing both jobs.**
- [ ] ⚠️ **`scope`, `sort` and `order` are in lists 2–4 and NOT in the URL
      builder's block. Check where they come from before unifying, or you will drop
      three filters that work today. This is the trap in this card.**
- [ ] **`SavedViewsDropdown` has two of the four, six lines apart.** At minimum
      those two become one.

### Tests

- [ ] ⚠️ **THE ASSERTION THIS CARD EXISTS FOR: every field that round-trips
      through the URL also round-trips through save → apply.** **Drive it from the
      filter shape itself — a hand-written test list is a fifth copy.**
- [ ] **A tag filter survives save → apply.** Same for the resolved dates.
- [ ] **`scope`, `sort`, `order` still survive.** Non-vacuity.
- [ ] **A view with no tag still applies cleanly.**

⚠️ **Whether `TagFilterInput` also belongs in the advanced panel is a separate UI
decision. Do not fold it in — say what you would suggest.**

---

## 3 — Commit three: card 1.81, owner reports honour the team filter

> ✅ **DECIDED BY THE OWNER 2026-09-16: HONOUR THE FILTER.** The alternative —
> hiding the control for owners — was offered and declined.

### What is wrong

✅ **Verified at `reports.service.ts:165-169`, inside `scopeReportQuery`:**

```ts
if (user.role === UserRole.OWNER) {
  const rest = { ...query };
  delete rest.teamId;      // <- the whole bug
  return rest;
}
```

**So an owner picks HR, the page shows platform-wide numbers under an HR
heading, and the export is labelled HR too.** ⚠️ **The export is the half that
can actually mislead somebody, because it leaves the screen.**

### The fix

- [ ] **For an OWNER, honour `query.teamId` when it is supplied; stay
      platform-wide when it is not.**
- [ ] ⚠️ **VALIDATE THE TEAM ID. Do not pass it through unchecked** — an owner may
      send anything, and a non-existent id should be an error, not a silently empty
      report that looks like "no tickets this month".
- [ ] ✅ **This narrows, never widens, so it cannot weaken the guard.** The
      docblock at `:134-145` says the method *"fails closed"* and *"must not depend
      on that guard staying in place"* — **that reasoning is about not returning an
      UNSCOPED query, and honouring an owner's explicit filter is the opposite
      direction. Update the comment; do not delete it.**
- [ ] ⚠️ **LEAD and TEAM_ADMIN branches must not change.** They pin `teamId` from
      the user, deliberately, and **that is the actual security boundary here.**
- [ ] **Check every reader.** `:215` (`assignedTeamId` in the Prisma filter),
      `:281-283` (the raw-SQL builder) and `:323` all consume `teamId` — **confirm
      they all now receive it for an owner, or say which deliberately do not.**

### Tests

- [ ] **An OWNER with `teamId=HR` gets HR's numbers, not the platform's.**
      The assertion the card exists for.
- [ ] **An OWNER with no `teamId` still gets platform-wide numbers.**
      ⚠️ **Non-vacuity, and the one most likely to break.**
- [ ] **A LEAD still cannot widen their scope by sending another team's id.**
      ⚠️ **This is the security test — it must exist and must fail when inverted.**
- [ ] **An unknown team id is refused rather than returning an empty report.**
- [ ] **The export carries the same scope as the screen.**

---

## 4 — Commit four: card 1.63, the AI routes unrouted inbound email

> ✅ **DECIDED BY THE OWNER 2026-09-16: YES.** An inbound email arriving with no
> department is classified by the AI instead of landing in Unassigned.

⚠️ **This is the biggest thing in this batch. Do it last, and consider doing it
alone.**

### Where it goes — and it is a smaller hook than the card implies

✅ **Verified: `inbound-mailbox.service.ts:269-286` already collects exactly the
case this card is about.** Three paths leave `assignedTeamId` null:

1. a department suffix that resolves to no active team (`:272`),
2. an unusable suffix (`:283`),
3. a bare address with no suffix at all — **the common one**.

✅ **And the existing comment at `:273-277` is the card's own justification:**
*"An unknown suffix is NOT an error and NOT a guess… Guessing here would put one
department's mail in front of another."* ⚠️ **The AI is not a guess — it is a
classifier with a confidence gate. Keep that comment and extend it; do not
delete it.**

### ⚠️ Four things to establish before writing code

- [ ] ⚠️ **THE AI HAS NO CLASSIFY-ONLY ENTRY POINT.** `classifyAndCreateTicket`
      (`ai.service.ts:261`) **creates the ticket**, and here the ticket is created
      by `ingestInboundEmailMessage`. `classifyDepartment` at `:124` is **private**.
      **Expose a classify-only path rather than calling the create path and
      throwing half of it away.**
- [ ] ⚠️ **THE MODULE BOUNDARY IS THE REAL RISK.** `inbound-mailbox` importing
      `ai` is a new edge between two feature modules. **Card 1.103 spent a whole
      batch breaking a cycle that began exactly like this, and card 1.102 exists
      because the app stopped booting and every fast check passed.** **If the
      import cannot be made without a cycle, STOP AND REPORT** — the answer is
      probably an interface in `common/`, not a `forwardRef`.
- [ ] ⚠️ **THERE IS NO FALLBACK TEAM AND NOTHING DEFINES ONE.** Verified: no
      `TRIAGE_TEAM`, no `fallbackTeam`, no default. **Below the confidence
      threshold the correct behaviour is TODAY'S behaviour — ingest unrouted into
      Unassigned.** **Do not invent a triage team as a side effect of this card.**
- [ ] ✅ **The gate already exists** — `confidence-gate.service.ts:137-142` reads
      `AI_CONFIDENCE_THRESHOLD` and `AI_SENSITIVE_DEPT_THRESHOLD`, plus a
      per-department `Team.confidenceThreshold`. **Reuse it. Do not write a second
      threshold check.**

### The fix

- [ ] **When `assignedTeamId` is null, ask the AI to classify the department, and
      use the answer only if it clears the existing gate.**
- [ ] ⚠️ **A failure or timeout in the AI must ingest the mail unrouted, never
      lose it.** **Card 1.105's principle: an attachment problem must not discard
      the sender's words — the same is true of a classifier problem.**
- [ ] ⚠️ **Record that the AI routed it, and with what confidence**, as a ticket
      event. **Without it nobody can ever tell how often it is right — which is the
      number that decides whether the threshold is set correctly.**
- [ ] ✅ **`AI_PIPELINE_ENABLED` must gate this too** (card 1.106). **The off
      switch has to turn this off as well, or it is not an off switch.**
- [ ] ⚠️ **Do not touch the plus-address path.** Card 1.19 had Power Automate
      supply an explicit department slug and **that was right and should stay** —
      367 of 370 tickets arrive that way. **This card is only for mail that has no
      department.**

### Tests

- [ ] **An email with no suffix, and a confident classification, lands on that
      team.** The assertion the card exists for.
- [ ] **Below the threshold it lands unrouted, exactly as today.**
      ⚠️ **Non-vacuity.**
- [ ] **The AI throwing still creates the ticket.** ⚠️ **The most important test
      here — assert the ticket exists, not just that no exception escaped.**
- [ ] **A plus-addressed email never calls the AI at all.** ⚠️ **Assert the
      classifier was NOT called.**
- [ ] **With `AI_PIPELINE_ENABLED=false`, no classification is attempted.**
- [ ] **A routed ticket carries an event naming the AI and its confidence.**

### Browser / live pass

- [ ] ⚠️ **Send a real email to the bare address with an obviously
      department-shaped subject** — a payroll question, say. **Confirm it lands on
      that team rather than in Unassigned, and that the ticket says the AI put it
      there.**
- [ ] **Send one with a deliberately vague subject and confirm it lands
      unrouted.**

---

## 5 — What to report back

1. **Four commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, migration count (**67, unchanged**).
3. The answers:
   - **1.126 —** which failure the owner hit, with the exact message; what you
     decided about the last member of a team; which reading of §1b the owner chose.
   - **1.127 —** where the single definition lives, and how `scope`, `sort` and
     `order` are accounted for; how the round-trip test resists the next new field.
   - **1.81 —** which readers of `teamId` now receive it, and which deliberately
     do not.
   - **1.63 —** how you exposed classify-only, whether the module import needed
     anything unusual, and what a below-threshold email does.
4. **For each card, the assertion that would fail if it regressed — and confirm
   you watched each inversion fail.**
5. Anything that did not match. **This document is wrong somewhere; the planner
   already got 1.127's size wrong once by reading two files instead of four.**

**Stop and report instead of improvising** if 1.126 turns out to be the
add-somebody-else case; if unifying the filter lists would change what an
EXISTING saved view does when applied — **there are real saved views in
production and they must keep working**; or if 1.63's import cannot be made
without a cycle.
