# Implementation Prompt — 1.7b Templates: a way to set one up

**Date:** 2026-09-04
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.7b — completes 1.7, which shipped as `92a6737` + `b959e39`
**Cost:** none. API + web. **No migration.** Size **S/M**.

---

## 0. Why this exists

Card 1.7 built the macro engine and it works: the allowlist holds, substitution
is safe, the audit trail is honest, and an agent can apply a macro in one click.

**But there is no way to create one.** The owner asked "where do I set a template
up, and who can?" and the answer, verified live on 2026-09-04, is: nowhere, by
anybody, through any screen. Four gaps stand between "the engine is done" and "an
agent can use it".

None of these are 1.7 defects — 1.7 scoped itself to the engine and the picker,
and delivered both. These are the gaps around it.

## 1. What was verified, live, on 2026-09-04

| Fact | Evidence |
|---|---|
| **No UI creates a template.** `createCannedResponse`, `updateCannedResponse` and `deleteCannedResponse` exist in `apps/web/src/api/client.ts` and **nothing calls any of them**. The picker only lists and applies. | `grep` across `apps/web/src` returns the definitions and no call sites |
| **In production nobody can create one at all.** Everything is behind Easy Auth, so there is no practical API path for an agent either. | `docs/DEPLOYMENT.md`, "Every URL on production returns 401" |
| **Any signed-in user may create one**, including an EMPLOYEE. There is no role guard on `CannedResponsesController`. | `POST /api/canned-responses` as `requester@company.com` → `201` |
| **Team isolation works.** Private (yours) or shared with exactly one team. An agent's private templates are invisible to their own lead and team admin. | Four personas queried the same endpoint; lead and team admin saw only the shared one |
| ⚠️ **A foreign `teamId` is silently demoted to private.** Creating a template for a team you are not in returns **`201` with `teamId: null`**. | IT agent posted `teamId: <HR>` → `201`, `teamId: null` |
| ⚠️ **Only the creator may edit a shared team template.** Not the lead, not the team admin. | LEAD → `403` "You can only edit your own canned responses"; TEAM_ADMIN → `403`; author → `200` |
| **Administration is TEAM_ADMIN/OWNER only.** Every entry in `adminItems` (`apps/web/src/components/AdminSidebar.tsx:53`) is gated to those two roles, so an agent cannot reach that section at all. | `grep "roles: \[" AdminSidebar.tsx` — no AGENT, no LEAD |

## 2. Where the screen goes, and why not a route

**Put the editor inside `CannedResponsePicker`**, reached from the composer.

The obvious instinct is an admin page. It is wrong here: templates are a working
agent's tool, and Administration is TEAM_ADMIN/OWNER only — an agent would never
see it. A new top-level route means touching `App.tsx` routing, `Sidebar.tsx`'s
key-based nav and the command palette, which is a lot of shared-file churn for a
screen that belongs three inches from where it is used.

The picker already fetches the list and owns a list→preview view stack. Adding a
third view is small, keeps every template concern in one component, and puts
"New template" exactly where an agent notices they need one.

- [ ] Say in the report if you disagree — a route is defensible, it is just more
      surface for the same result.

## 3. The four fixes

### 3a. Only agents and above may create a template

- [ ] Restrict `POST /api/canned-responses` to **AGENT, LEAD, TEAM_ADMIN,
      OWNER**. An EMPLOYEE creating macros is not a hole — theirs are private and
      the allowlist blocks email — but it is not intended either.
- [ ] Use the repo's existing role mechanism rather than a hand-rolled check.
      Find it before writing one.

### 3b. A foreign `teamId` must be refused, not demoted

`CannedResponsesService.create` keeps `dto.teamId` only when it equals
`user.teamId`, and otherwise writes `null`. So "share with HR" from an IT agent
succeeds and quietly becomes private. Somebody will announce a team template that
only they can see.

- [ ] **`400`** with a message naming the problem. Do not silently change what
      the caller asked for.

### 3c. A team's leads may edit their team's templates

`update` and `delete` require `existing.userId === user.id`. A shared template
therefore freezes when its author leaves, is on holiday, or moves team — and
nobody can fix a typo in a template that now also **changes ticket state**.

- [ ] Allow **the creator**, or a **LEAD / TEAM_ADMIN / OWNER of the owning
      team**, to edit and delete a TEAM template.
- [ ] A **private** template stays the creator's alone. A lead may not read, edit
      or delete somebody's private drafts.
- [ ] ⚠️ Assert the negative: a lead of a **different** team gets `404`, and the
      404-not-403 rule from 1.7 still holds for a template they cannot see.

### 3d. The screen

- [ ] **New / edit / delete**, in the picker, for templates the caller may write.
- [ ] Name, content, and a **team-or-private** choice. The team option offers only
      the caller's own team — 3b makes anything else an error, so do not offer it.
- [ ] **Actions are editable**: status, priority, tags, category, assignment,
      follower, internal note. Offer **only** `MACRO_ALLOWED_ACTIONS` — the server
      refuses the rest, and a UI that offers a doomed choice is worse than one
      that does not.
- [ ] Show the placeholder list. `{{requester.firstName}}`,
      `{{requester.displayName}}`, `{{ticket.displayId}}`, `{{ticket.subject}}`,
      `{{agent.firstName}}`. These are the keys `buildMacroVars` actually
      produces — **read that file, do not copy a hint string**, since three of
      them in the web already disagreed with the server before card 1.7.
- [ ] An **Edit** control only where the caller may write, and no control at all
      where they may not.

## 4. Tests

- [ ] An EMPLOYEE creating a template is refused; an AGENT is not.
- [ ] A foreign `teamId` is **`400`** and no row is written. Assert the row count.
- [ ] A LEAD of the owning team may edit and delete a **team** template.
- [ ] A LEAD may **not** touch a **private** template of the same team's agent,
      and gets `404` rather than `403`.
- [ ] A LEAD of a **different** team may not touch either.
- [ ] The creator can still do both, whatever their role.
- [ ] Web: the editor offers **only** allowlisted actions, and never `send_email`.
- [ ] Targeted, then the **full** suite. **Do not edit source while it runs.**

## 5. Verification

Baselines after card 1.7, verified 2026-09-04: api `tsc` 0, unit **480 / 48**,
integration **593 + 1 skipped, 61 of 62**, web `tsc` 0, vitest **150 / 26**,
migrations **57**.

> **Correction from the planner, 2026-09-04.** This card said to read
> `CLAUDE.md`'s baselines "with suspicion" because they were stale at
> 468/542/133 during card 1.7. **They were not.** `CLAUDE.md` read
> **470 / 576 + 1 / 143** — updated at 10:46 in `730acfa`, while card 1.7 was
> committed at 11:27. It was stale when that card **started**, not when it
> finished.
>
> **The rule stands: read `CLAUDE.md`.** It is updated at every GREEN, which is
> more often than any card is rewritten. If it looks wrong, **say so** — as this
> card's author reasonably did — but do not carry "distrust the authoritative
> file" forward as standing advice, or the next reader has nothing to trust at
> all.

Browser pass per `repo-landmines.md` § "Running the stack by hand": the API needs
`AUTH_ALLOW_INSECURE_HEADERS=true`, and setting `localStorage.demoUserEmail`
without reloading serves the previous persona's cached data.

## 6. Acceptance criteria

1. An agent can create, edit and delete a template from the composer.
2. A template can be shared with the agent's own team, and only that team.
3. A foreign team is refused with `400`, not silently made private.
4. A team's leads and admins can maintain that team's shared templates.
5. Private templates remain private to their author.
6. An EMPLOYEE cannot create a template.
7. The editor offers only the allowlisted actions.
8. Both `tsc` clean; unit, integration and vitest at or above §5.
