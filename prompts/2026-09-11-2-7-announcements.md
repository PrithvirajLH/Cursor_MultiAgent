# Implementation Prompt — 2.7, announcements and the outage banner

**Date:** 2026-09-11
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 2.7 — **one card, three commits: schema + API, admin screen, banner.**

**Migration 64.** Additive — a new model and two new enums. **Zero `DROP`
statements.**

> ## Why this card got its own handoff
>
> The master plan calls it **S**. It is an **M**, and that is why the owner cut it
> from the first Phase 2 batch: it is the only card of the five that is a **new
> user-facing surface** rather than a change to an existing one. New table, new
> API, new admin screen, and a banner that renders on every page in the app.
>
> **It depends on nothing**, which is why it loses nothing by going alone.
>
> ⚠️ **It is also the highest-leverage card in Phase 2 for a desk.** *"The VPN is
> down, don't raise tickets"* on every screen is the difference between one
> announcement and forty duplicate tickets. Build it properly.

---

## ⚠️ COORDINATION — cards 2.7 and 2.6 are both in flight

**Both add a migration and both add an admin screen.** Three things collide if
they run at the same time without this being settled:

| | 2.7 announcements | 2.6 public API |
|---|---|---|
| Migration number | **64** — reserved | **65** — reserved |
| Admin route in `App.tsx` | adds one | adds one |
| Test database | shared | shared |

- **The migration numbers above are assigned. Use yours, do not take "the next
  free one"** — both cards would compute the same answer.
- ⚠️ **THE TEST DATABASE IS THE BINDING CONSTRAINT, and it has already cost a
  day twice.** Every integration suite resets the database in its own
  `beforeAll`, and nothing coordinates between sessions — a second run wipes the
  seed out from under the first, mid-pass, and the failures look like code
  defects. **If these two run concurrently, the second session MUST point
  `TEST_DATABASE_URL` at its own database** (card 1.70's implementer did exactly
  this, creating `ticketing_browser`, after being burned twice).
- **If that is not set up, run them SEQUENTIALLY — 2.7 first.** It is the smaller
  surface and it takes the lower migration number.
- **Both touch `App.tsx`'s route table and the admin nav.** Expect a merge
  conflict there and resolve it by keeping both routes; it is the one file
  guaranteed to overlap. **Never `git add -A`.**

---

## 0. Before anything

- **Read `CLAUDE.md`** and `docs/agent-context/repo-landmines.md`.
- ⚠️ **Check for a live `jest` process before touching `apps/api`** and read from
  the git object store while one is running.
- ⚠️ **If an integration run comes back with many suites failing, grep the log for
  `P1001|P1017|57P01` before believing it.** WSL kills Postgres mid-run and the
  symptom is `Cannot read properties of undefined (reading 'close')` in
  `afterAll`, which looks like broken code and is not. **Hold the VM open**:
  background a blocking `wsl -d Ubuntu-22.04 -- sleep 1500` for the whole run.
- ⚠️ **`scripts/check-migrations.sh` cannot see an uncommitted migration.**
  **Commit first, then run it**, and read the file count rather than the exit
  code.
- **Baseline to beat:** unit **675 / 68**, web **343 / 50**, integration
  **836 + 1 skipped / 81 of 82**, both typechecks clean, migrations **63**.
- **Start from `6f127cb` or later.** ✅ **That commit is now LIVE in production**
  (deployed 2026-09-14, schema 63), so this card builds on a deployed base rather
  than stacking on unshipped work — and **migration 64 is genuinely the next
  number**, with 62 and 63 already applied to production.

---

## 1 — Commit one: the model and the API

### Schema (migration 64)

```prisma
model Announcement {
  id             String                @id @default(uuid())
  title          String
  body           String
  severity       AnnouncementSeverity  @default(INFO)
  audience       AnnouncementAudience  @default(ALL)
  teamId         String?
  linkedTicketId String?
  startsAt       DateTime
  endsAt         DateTime?
  createdById    String
  createdAt      DateTime              @default(now())
  updatedAt      DateTime              @updatedAt
}
```

- [ ] ✅ **Verified: there is no `Announcement` model today.** Nothing to
      reconcile.
- [ ] ✅ **Both enums are NEW types, so `CREATE TYPE` — not `ALTER TYPE … ADD
      VALUE`.** The transaction trap that applied to card 2.1's migration does
      **not** apply here.
- [ ] ⚠️ **Hand-write the migration.** A new model makes `prisma migrate dev`
      emit the standing twelve destructive statements — six `DROP INDEX` on the
      trigram GIN indexes and six `ALTER COLUMN … DROP DEFAULT`. **Applying one
      unedited destroys ticket and KB search.**
- [ ] **`endsAt` nullable means "until I say otherwise".** That is a real answer
      for an outage nobody can put a time on, and a sentinel far-future date would
      be a lie every query then has to special-case. **Same reasoning as card
      2.2's `awayUntil` — follow it.**
- [ ] **Index what the hot query filters on.** `GET /active` runs on every page
      load for every user; it must not table-scan.

### The endpoint

- [ ] **`GET /api/announcements/active`** — returns what this viewer should see,
      **now**, per the database clock.
- [ ] ⚠️ **NOT `@Public()`.** Every route that renders it is behind auth already.
      **Adding `@Public()` would make your outage notice readable by anyone on the
      internet**, and it is the sort of thing that gets copied to the next
      endpoint.
- [ ] ⚠️ **`audience: TEAM` MUST NOT leak to other teams. This is the security
      assertion of the card.** A Payroll announcement is visible to Payroll. **Do
      the filtering in the query, not in the component** — a client-side filter on
      a payload that already contains every team's announcements is not a filter.
- [ ] **"Active" is `startsAt <= now AND (endsAt IS NULL OR endsAt > now)`,
      evaluated in SQL.** ⚠️ **Not in JavaScript against the browser's clock** — a
      laptop with a wrong clock would show or hide an outage notice, and the one
      thing this feature must be is trustworthy.
- [ ] **CRUD for OWNER and TEAM_ADMIN.** ⚠️ **A TEAM_ADMIN may only create
      `audience: TEAM` for their own team.** An `audience: ALL` announcement is
      OWNER-only — otherwise one team's admin can put a banner on everybody's
      screen.

### Tests

- [ ] ⚠️ **A TEAM announcement does not appear for a member of another team.**
      The one that matters.
- [ ] **An announcement whose `endsAt` has passed disappears with no action** —
      and one whose `startsAt` is in the future does not appear early.
- [ ] **A TEAM_ADMIN cannot create an `audience: ALL` announcement.**
- [ ] **`endsAt: null` stays visible indefinitely.**

---

## 2 — Commit two: the admin screen

- [ ] **Follow the existing admin pattern, do not invent one.** Routes are
      `guardRoute(isAdminOrOwner, <Page/>)` (`App.tsx` around `:1085`), the role
      gate is `canUseAdminMenu` (`App.tsx:278`), and the house pattern for an
      admin list is **list-first with a drawer**, as used on the SLA settings
      page. The primitives exist: `ui/Drawer.tsx`, `ui/EmptyState.tsx`,
      `ui/PageTabs.tsx`, `ui/card.tsx`, `ui/badge.tsx`.
- [ ] **Show active and scheduled separately from expired.** An admin's question
      is almost always "what is showing right now".
- [ ] **`linkedTicketId` connects to card 1.6's ticket links**, so an outage
      announcement can point at the ticket tracking it. **Optional, and say so if
      you leave it for later** — it is the one part of this card nothing else
      depends on.

---

## 3 — Commit three: the banner

### ⚠️ Where it goes, and the trap in the obvious place

`App.tsx` renders routes inside:

```tsx
<div key={location.pathname} className="animate-fade-in">
  <Routes>…</Routes>
</div>
```

- [ ] ⚠️ **Do NOT put the banner inside that div.** Its `key` is the pathname, so
      it remounts on every navigation — the banner would re-run its fade-in each
      time you changed page, and any dismissed state held in component state would
      reset. **Put it in the shell chrome, outside that keyed wrapper.**
- [ ] ✅ **`/submit` is inside the same shell** (`AiSubmitPage`, routed at
      `App.tsx:1197`), so **one placement covers both** — the plan's "app shell
      and on /submit" is one job, not two. **Confirm that is still true rather
      than taking my word.**
- [ ] **An OUTAGE banner should be impossible to miss and an INFO one should not
      shout.** Severity drives the treatment; it is the only reason severity
      exists.

### ⚠️ The dismissal question is the owner's, and it is not a detail

The plan says "dismiss stored per user in `localStorage`". **Two problems worth
raising before you build it:**

1. **`localStorage` is per browser, not per user.** A shared desk machine means
   one person's dismissal hides the notice from the next, and clearing site data
   resurrects everything.
2. **Should an OUTAGE banner be dismissible at all?** The card exists to stop
   forty duplicate tickets. A banner someone dismissed at 9am does not do that at
   2pm.

- [ ] **The planner's recommendation: INFO and WARNING dismiss and stay
      dismissed; OUTAGE may be collapsed but returns on a fresh session.** **Ask
      the owner and build what they say** — do not pick silently.
- [ ] ⚠️ **Wrap every `localStorage` read and write in try/catch.** It throws
      outright in some privacy modes, and a banner that crashes the shell is worse
      than no banner.

### Tests

- [ ] **An OUTAGE announcement renders on every page** — assert on more than one
      route, since the whole point is that it is not per-page.
- [ ] **Dismissing one does not dismiss another.**
- [ ] ⚠️ **The banner renders nothing when there is nothing active** — no empty
      bar, no gap in the layout. **This is the state the app is in 99% of the
      time and the easiest one to get wrong.**
- [ ] ⚠️ **Run the FULL web suite, not just the new file.** This adds an element
      to every page in the app; the existing 343 tests are the check that it did
      not shift anything.

---

## 4 — What to report back

1. **Three commit SHAs** and `git diff --stat` for each.
2. Every `Tests:` line, both `tsc`, vitest, **the migration count (64)**, and
   **`bash scripts/check-migrations.sh` clean — run AFTER committing.**
3. The answers:
   - ⚠️ **The security one: how a TEAM announcement is prevented from reaching
     another team, and the test that proves it.**
   - **What the owner decided about dismissing an OUTAGE banner** — and if they
     have not answered yet, what you built and how easily it changes.
   - **Where you put the banner**, and confirmation it is outside the
     pathname-keyed wrapper.
4. **For each commit, the specific assertion that would fail if it regressed.**
5. Anything that did not match. **This document is wrong somewhere** — the last
   three handoffs each had at least one thing wrong, and each was found by
   running rather than reading.

## 5 — Browser pass

- [ ] **Create an OUTAGE announcement. It appears on the dashboard, the ticket
      list, a ticket, and `/submit`.**
- [ ] **Set `endsAt` to a minute ahead and watch it disappear** without a reload
      trick or a redeploy.
- [ ] ⚠️ **Sign in as someone on another team and confirm a TEAM announcement is
      not there.** The security check, done by eye as well as by test.
- [ ] **With nothing active, confirm no empty bar and no layout shift** on all
      four of those pages.

**Stop and report instead of improvising** if a TEAM announcement can be seen by
another team through any route, if the banner cannot be placed outside the
pathname-keyed wrapper without restructuring the shell, or if the migration
generator emits anything containing `DROP`.
