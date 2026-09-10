# Implementation Prompt — 1.61 The sidebar's system views cannot be hidden

**Date:** 2026-09-10
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.61 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** card 1.53 let a team admin hide the built-in sidebar presets their team
does not use. It reaches six of them. The four rows **above** those six are a
different list and cannot be hidden at all.

**Cost:** none. **No migration** — see §2. Web plus one small API change.

> Found by the owner within an hour of 1.53 reaching production, trying to hide
> **Follow-ups due today** on Payroll. The panel says *"6 of 6 shown"* and is
> telling the truth about the list it controls; it simply does not control the
> others.

---

## 1. The two lists

The tickets sidebar renders rows from two places. Only the first is hideable.

| Row | Source | Hideable today |
|---|---|---|
| Assigned to Me | `App.tsx:225` nav children, key `assigned` | no |
| Watching | `SidebarSavedViews.tsx:~173`, id `watching` | **no** |
| Mentions | `SidebarSavedViews.tsx:~180`, id `mentions` | **no** |
| Follow-ups due today | `SidebarSavedViews.tsx:~189`, id `followups` | **no** |
| SEV1 today | `SAVED_VIEWS` id `p1-today` | yes |
| Awaiting reply > 24h | `SAVED_VIEWS` id `awaiting-24h` | yes |
| Breach risk · 1h | `SAVED_VIEWS` id `sla-at-risk` | yes |
| Unassigned | `SAVED_VIEWS` id `unassigned` | yes |
| Resolved this week | `SAVED_VIEWS` id `recent-resolved` | yes |
| Reopened | `SAVED_VIEWS` id `reopened` | yes |

`TeamPresetVisibility` is built from `SAVED_VIEWS` alone, so the three system
views never appear as checkboxes. "Follow-ups due today" arrived with card 1.10
as a system view; 1.53 wired hiding to the presets list. Nobody joined them up.

## 2. Owner decision, already made — do not re-open

Asked and answered on 2026-09-10:

- **`assigned` ("Assigned to Me") stays permanent.** It is load-bearing, and 1.53
  deliberately gives members no way to opt back in — a team admin hiding it from
  everyone is not a power worth having.
- **`watching`, `mentions` and `followups` become hideable**, on the same
  team-admin-only terms as the six presets.

**No migration.** `Team.hiddenPresetIds` is a free-form `TEXT[]` (migration 59),
so it already stores any id. Verified: the three system ids (`watching`,
`mentions`, `followups`) **do not collide** with any `SAVED_VIEWS` id
(`p1-today`, `awaiting-24h`, `sla-at-risk`, `unassigned`, `recent-resolved`,
`reopened`, `inbox`, `my-tickets`, `team-queue`, `created-by-me`). One array,
one namespace, no clash.

## 3. What to change

- [ ] **Give the three system views a shared definition** the panel and the
      sidebar both read, rather than the panel reading `SAVED_VIEWS` and the
      sidebar hard-coding a second array inline. Two lists that must agree is what
      produced this card.
- [ ] **`TeamPresetVisibility` lists nine checkboxes**, not six — the three system
      views and the six presets. `assigned` is not among them.
- [ ] **The count text is derived, not literal.** It reads "6 of 6 shown" today;
      it must read "9 of 9" and count what is actually there, so the next addition
      cannot leave it stale the way this one did.
- [ ] **`visiblePresets` (or its successor) filters the system views too**, so
      hiding one removes the sidebar row.
- [ ] **An unknown id is ignored silently** — the standing rule from 1.53. A
      hidden id whose view is later renamed or removed must never leave a ghost row
      and never crash. That rule now covers system ids as well; say so in the doc
      comment.
- [ ] **Hiding a view must not break its URL.** `?scope=followups` still works if
      someone has it bookmarked or is linked to it; hiding removes the sidebar
      entry, not the route. Do not add a redirect.

## 4. Worth deciding while you are in here

**A hidden view's count still gets fetched.** `useViewCounts` and the
notification-driven refresh compute counts for rows nobody can see. It is
harmless today at this volume, and the natural fix — skipping hidden ids — costs
a round of cache-key churn. Recommend leaving it, and saying so in the report,
rather than doing it silently either way.

## 5. What to verify

Component and unit level; no browser needed for the logic.

1. A team admin sees **nine** checkboxes, and **not** "Assigned to Me".
2. Hiding `followups` removes the row for every member of that team.
3. It does **not** affect any other team.
4. A member of the team cannot restore it — no personal override, per 1.53.
5. An unknown id in `hiddenPresetIds` is ignored, with no ghost row and no crash.
6. `?scope=followups` still loads for someone with the link after it is hidden.
7. A multi-team member sees only their primary team's hides — matching 1.53.

Baselines to hold at time of writing: api `tsc` 0, unit **560 / 56 suites**,
integration **725 + 1 skipped**, web `tsc` 0, vitest **239 / 38 files**.

## 6. Priority

Low. Nothing is broken and nothing is at risk — a team simply sees three rows it
may not want. It is worth doing because the panel currently makes a promise it
half keeps, and because the two-lists-that-must-agree shape is the same one
behind cards 1.36, 1.38, 1.47 and 1.50.
