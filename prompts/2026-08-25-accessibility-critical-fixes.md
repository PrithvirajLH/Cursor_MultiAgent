# Implementation Prompt — Accessibility Critical Fixes

**Date:** 2026-08-25
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Source of truth:** `docs/accessibility-audit-2026-08.md` — read it before this file.

---

## 1. Goal

Clear the four `critical` axe rules and the app-shell contrast failure, so the four Phase 1 core flows pass the critical/serious gate in `e2e/accessibility.spec.ts`.

This is the fixing pass the audit deliberately did not do. The audit says what is broken; this makes it work.

---

## 2. Scope

**In:** the four critical rules, the two app-shell controls, and `prefers-reduced-motion`.

**Out for now:** every `moderate` finding, the 14th-tab-stop ordering problem, and the missing live-region announcements. Those are design changes with their own trade-offs, not label fixes. Raise them as follow-ups; do not fold them in here.

**Possibly out — assess before starting:** `nested-interactive` on the queue rows (see Part 4).

## 3. Method

1. Re-run `npx playwright test e2e/accessibility.spec.ts --reporter=list` first, to get **current** node targets. The audit's CSS selectors are generated from rendered DOM and several are Tailwind class chains that do not map cleanly to source. Trust the live run over the selectors written down.
2. Fix one rule at a time and re-run after each. Batching makes it unclear which change cleared which violation.
3. Do not chase the count to zero. The spec asserts critical and serious only, on purpose.

---

## 4. The work

### Part 1 — Four unnamed selects on the ticket queue `[critical: select-name]`

`apps/web/src/pages/TicketsPage.tsx`, four `<select>` elements at approximately **lines 1166, 1187, 1219 and 1476**. The file already uses `aria-label` in seven places, so the pattern exists — these four were missed.

A screen reader user currently hears "combo box" four times with nothing to distinguish them. Give each a name describing what it filters. Prefer a visible `<label>` where the layout allows it; `aria-label` is the fallback, not the default.

### Part 2 — Unnamed button on AI intake `[critical: button-name]`

The audit puts it on `.text-primary-foreground` and records that it is **the first tab stop on the page**. A screen reader announces "button" and nothing else, as the very first thing a requester meets.

My source search did not locate it — it is likely composed through a shared component. Use the live axe run to find it. If it is an icon-only button, it needs an `aria-label`; if it wraps text that is visually hidden, check the hiding technique is `sr-only` rather than `display: none`, which removes it from the accessibility tree entirely.

### Part 3 — Unlabelled input on ticket detail `[critical: label]`

One `<input>` with no label at all. Same approach: visible label preferred, `aria-label` acceptable.

### Part 4 — ARIA misuse on queue rows `[critical: aria-allowed-attr]` + `[serious: nested-interactive]`

Two elements carry ARIA attributes their role does not support, and the same two are interactive controls containing interactive children.

**Assess this one before committing to it.** The other three criticals are label fixes. This is structural: a focusable row containing focusable buttons is a genuine pattern problem, and the honest fix may be to make the row a non-interactive container with an explicit link or button inside, rather than patching the ARIA. If that turns out to be a real refactor of the row component, **stop and say so** — it belongs in its own piece of work with its own testing, not smuggled into a label-fixing pass.

### Part 5 — App-shell contrast `[serious: color-contrast]`

`apps/web/src/components/Sidebar.tsx`, around lines **277–280** and **309–312**. The failing values are:

```
dark:  text-white/28        hover:text-white/55
light: text-foreground/55   hover:text-foreground/80
```

28% and 55% opacity are well below the 4.5:1 AA threshold. These two controls appear on **every authenticated page** and account for 6 of the 12 node-level findings across three of the four flows — the single highest-leverage change in this list.

Raise the resting opacity until it measures at or above 4.5:1 against the actual sidebar background in both themes. Measure rather than guess; opacity over a coloured background is not the same as the flat colour.

`TopBar.tsx` around line 303 has an equivalent control that already uses `text-muted-foreground` — check whether it passes, and align the two if it does.

### Part 6 — `prefers-reduced-motion`

Not implemented anywhere, and `AGENTS.md` §3 requires it explicitly: *"Respect `prefers-reduced-motion`."* `motion` v12 is a direct dependency and the app applies ~150ms transitions throughout.

A global CSS media query that reduces transition and animation duration to near-zero is the standard approach and is small. Check whether `motion` needs configuring separately from CSS transitions.

---

## 5. Files expected to change

```
apps/web/src/pages/TicketsPage.tsx          (four select names)
apps/web/src/pages/TicketDetailPage.tsx     (input label)
apps/web/src/components/Sidebar.tsx         (contrast on two controls)
apps/web/src/styles.css                     (prefers-reduced-motion)
<the AI intake button's component>          (located via the axe run)
```

⚠️ `apps/web/src/styles.css` is **already modified and uncommitted** from before any of this work. Do not revert or absorb those changes — add to them and mention the pre-existing diff in your report so it is not mistaken for yours.

## 6. Accessibility considerations

This is the whole task, but two specifics:

- **A visible label beats `aria-label`.** `aria-label` helps screen readers and does nothing for a sighted user with cognitive load, or for voice control where the visible text is what gets spoken. Use it where layout genuinely forbids a label, not as the default.
- **Do not hide text with `display: none` or `visibility: hidden`** to satisfy a name requirement — both remove it from the accessibility tree. `sr-only` (clip-path) is the pattern that works.

## 7. Acceptance criteria

1. `npx playwright test e2e/accessibility.spec.ts` passes — zero critical, zero serious across all four core flows.
2. Each of the four critical rules is individually confirmed cleared, not just the aggregate.
3. `prefers-reduced-motion: reduce` visibly suppresses transitions.
4. Contrast on the two sidebar controls **measured** at ≥4.5:1 in both themes, with the measured values recorded.
5. `apps/web` `tsc --noEmit` exit 0.
6. Unit and integration suites unchanged: **186 unit, 360 integration + 1 skipped**.
7. If Part 4 turns out to be a structural refactor, it is deferred with a written reason rather than half-done.

## 8. Checks to run

```bash
cd apps/web && npx tsc --noEmit
cd apps/api && npx tsc --noEmit
cd apps/api && npx jest                                   # 186
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
cd apps/api && npm run test:integration                   # 360 + 1 skipped
npx playwright test e2e/accessibility.spec.ts --reporter=list
```

The API suites should be untouched by this work. Run them anyway — a shared component change reaching the API would itself be a finding.

## 9. Manual test steps

Automated rules catch roughly a third of real problems. These are the ones that matter and cannot be automated:

1. **Keyboard only, no mouse:** tab to each of the four queue filters. Does each announce what it filters, distinguishably?
2. **Keyboard only:** tab through AI intake from page load. Is the first control now announced with a meaningful name?
3. Toggle OS reduced-motion and reload. Do transitions actually stop?
4. Check the sidebar controls in **both** themes — the dark and light failures have different values and one can pass while the other fails.

## 10. Out of scope

Moderate findings · tab-order restructuring · live-region announcements for the ticket list · load tests · email intake · CI.

## 11. Handoff notes

Environment briefing is in project memory (`atm-repo-landmines`): WSL Postgres on 5433, the `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` requirement, and the rule about not editing source while an integration suite runs.

**Note on committing:** `e2e/` and `docs/` are gitignored in this repo (`.gitignore` lines 80–82, per commit `7f221d2`). The accessibility spec and the audit reports therefore cannot be committed as things stand. The `apps/web/src` fixes **can** be. Commit those; leave the ignored paths alone pending a decision on the exclusion policy, and do not "fix" `.gitignore` as part of this work.

Baseline before this work: **186 unit, 360 integration + 1 skipped**, both typechecks clean.
