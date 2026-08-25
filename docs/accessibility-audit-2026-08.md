# Accessibility Audit — August 2026

**Date:** 2026-08-25
**Branch:** `ui-redesign-and-api-hardening`
**Standard:** WCAG 2.1 Level AA
**Scope:** the four Phase 1 core flows — sign-in landing, AI intake, ticket queue, ticket detail.

---

> **Status update — 2026-08-25, after the remediation pass.** Three of the four core flows (sign-in, AI intake, ticket detail) now report **zero violations at every severity**. The ticket queue retains `aria-allowed-attr` (critical) and `nested-interactive` (serious), both deferred as a structural change to the row component — see "Deferred" at the end of this document. Findings 2 (focus ring on invalid inputs), 3 (tab order), 5 (live regions) and 7 (not assessed) are unchanged and still open. Finding 6 (`prefers-reduced-motion`) is now implemented. The tables below are the **original** measurement, kept as the baseline to compare against.

---

## Read this before the numbers

**A green axe run is not an accessible product.** Automated rules catch roughly a third of real accessibility problems. axe checks contrast, names, roles and ARIA correctness against the rendered DOM. It cannot tell you whether the tab order makes sense, whether a keyboard user can finish a task, whether a live region reads comprehensibly, or whether a focus indicator survives a state change.

Everything below is marked **`[axe]`** (machine-checked) or **`[judged]`** (human-judged, from a scripted walk plus reading the code). The two most consequential findings in this document are `[judged]` — axe reported neither.

**Current status: all four core flows fail the critical/serious gate.** Fixing them is explicitly the next piece of work; this audit exists to say what needs fixing, not to fix it.

---

## Automated baseline `[axe]`

Run: `npx playwright test e2e/accessibility.spec.ts`, axe-core via `@axe-core/playwright` 4.13, tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`. Counts are **distinct rules**; node counts are in brackets.

| Page | Route | Critical | Serious | Moderate | Minor |
|---|---|---:|---:|---:|---:|
| Sign-in landing | `/` | 0 | 1 | 0 | 0 |
| AI intake | `/submit` | 1 | 1 | 0 | 0 |
| Ticket queue | `/tickets` | 2 | 2 | 0 | 0 |
| Ticket detail | `/tickets/:id` | 1 | 1 | 0 | 0 |

### Findings in detail

| Page | Rule | Impact | Nodes | Offending selector | What it means |
|---|---|---|---:|---|---|
| login | `color-contrast` | serious | 1 | `.gap-2` | Text below the 4.5:1 AA threshold. |
| ai-intake | `button-name` | **critical** | 1 | `.text-primary-foreground` | A button with no accessible name. It is the **first tab stop on the page** — a screen reader announces "button" and nothing else. |
| ai-intake | `color-contrast` | serious | 2 | `button[aria-label="Switch to dark mode"] > span`, `button[aria-label="Collapse sidebar"] > span` | App-shell controls. |
| ticket-queue | `select-name` | **critical** | 4 | `.pl-3`, `.gap-1.flex.items-center:nth-child(5) > .relative > .pl-8…`, … | Four filter `<select>`s with no accessible name. A screen reader user hears "combo box" four times with no way to tell them apart. |
| ticket-queue | `aria-allowed-attr` | **critical** | 2 | `.bg-white\/\[0\.05\]`, `.hover\:bg-white\/\[0\.04\]…` | ARIA attributes used on elements whose role does not support them. |
| ticket-queue | `nested-interactive` | serious | 2 | same two elements | Interactive controls nested inside interactive controls — a focusable row containing focusable children. Screen readers report this unpredictably. |
| ticket-queue | `color-contrast` | serious | 2 | app-shell controls (as above) | |
| ticket-detail | `label` | **critical** | 1 | `input` | A form input with no label at all. |
| ticket-detail | `color-contrast` | serious | 2 | app-shell controls (as above) | |

### The cheapest fix first

`button[aria-label="Switch to dark mode"] > span` and `button[aria-label="Collapse sidebar"] > span` are **app-shell controls that appear on every authenticated page**, and account for the serious contrast finding on three of the four flows. One change to those two controls clears 6 of the 12 total node-level findings.

After that, the four critical rules are four separate, small fixes: name the intake button, name the four queue selects, correct the ARIA attributes on the queue row, and label the ticket-detail input.

---

## Manual pass

Method: a scripted keyboard walk driving real Chromium (Tab traversal with computed-style capture after transitions settle), plus reading the relevant source. Marked `[judged]` because the conclusions are mine, not a tool's.

### 1. Focus is visible on interactive controls — **PASS** `[judged]`

Every control reached in a 16-stop Tab traversal of `/submit` showed a settled `2px solid` outline from the global `:focus-visible` rule in `styles.css`.

> **A measurement caveat worth recording.** An initial pass read `outline-width: 0px` on the sidebar controls and looked like a serious finding — no focus ring on primary navigation. It was an artifact: the app applies ~150ms transitions, and the measurement was sampling mid-animation. Re-measured with a 350ms settle, every control has its ring. **The finding was withdrawn, not reported.** Anyone re-running this must let transitions settle before reading computed styles.

### 2. Focus disappears on an invalid input — **FAIL** `[judged]`

This is the most serious finding in this document and **axe did not report it**, because it only manifests in a dynamic state.

`styles.css` suppresses native invalid styling:

```css
input:invalid, textarea:invalid, select:invalid {
  box-shadow: none;
  outline: none;
}
```

`input:invalid` (specificity 0-1-1) outranks `:focus-visible` (0-1-0), so the rule wins while the field is invalid. Measured in the browser on a focused input:

| Field state | `outline-style` | `outline-width` | `box-shadow` |
|---|---|---|---|
| invalid | `none` | `0px` | `none` |
| valid | `solid` | `2px` | — |

**A keyboard user editing a field that has failed validation has no focus indicator at all** — precisely when they are most likely to be lost. This fails **WCAG 2.4.7 Focus Visible (AA)**.

The fix is small: scope the suppression to `:not(:focus-visible)`, or re-assert the focus ring after it.

### 3. The intake textarea is the 14th tab stop — **FAIL (usability/AA risk)** `[judged]`

Captured Tab order on `/submit`:

| Stop | Element |
|---:|---|
| 1 | unnamed `<button>` — the `button-name` critical above |
| 2–5 | four example-prompt buttons |
| 6 | **`<body>`** — a focus stop with nothing to focus |
| 7–13 | sidebar navigation (Dashboard, AI Submit, My Tickets, Help Center, New Ticket, dark mode, collapse) |
| **14** | **the intake `<textarea>` — the primary control of the page** |

Two problems. The **`<body>` receives focus at stop 6**: an invisible, meaningless stop that reads as a dead keystroke. And a requester whose entire task is "type what you need" must press Tab **thirteen times** to reach the input.

Neither breaks a specific success criterion outright, but together they make the flagship flow materially worse by keyboard than by mouse. A skip-link to main content, or ordering the main input ahead of the shell, would fix both. This is the flow the product is built around; it deserves the better treatment.

### 4. Keyboard-only completion of AI intake — **PARTIAL** `[judged]`

The intake textarea and the submit control are both reachable and focusable by keyboard. **I did not complete a submission**, and the reason is environmental rather than accessibility-related: `.env.test` deliberately carries no Azure Foundry configuration, so the AI pipeline throws on the first agent call and returns an error envelope. A failed submission in this environment would say nothing about accessibility.

**This item needs a human pass against a configured environment** before it can be called PASS.

### 5. The ticket list does not announce updates — **FAIL** `[static]`

`apps/web/src/pages/TicketsPage.tsx` contains no `aria-live`, `role="status"`, `role="alert"` or `aria-atomic`. When the queue updates — a new ticket arriving over Web PubSub, a filter changing the result set — **a screen reader user is told nothing**. The visual change is silent.

The app does use live regions elsewhere and correctly (`Toast.tsx` switches between `assertive` and `polite` by severity; `NotificationCenter.tsx`, `TicketConversation.tsx`, `EmptyState.tsx`, `ErrorState.tsx`, `SignInLandingPage.tsx`). The pattern is understood in this codebase; the queue simply does not use it.

A `role="status"` region announcing "N tickets" on result-set change would close it.

### 6. `prefers-reduced-motion` is not implemented — **FAIL** `[static]`

There is **no handling anywhere in `apps/web/src`**: no `@media (prefers-reduced-motion: reduce)` block, no `useReducedMotion` from `motion`. `motion` v12 is a production dependency, the design guidance requires respecting the setting, and 57 elements on `/tickets` carry active transitions or animations.

**Honesty note:** the runtime confirmation was inconclusive. Playwright's `reducedMotion: 'reduce'` emulation did not register in the page (`matchMedia('(prefers-reduced-motion: reduce)').matches` returned `false`), so I could not observe behaviour under a genuinely reduced setting. The static evidence is unambiguous — nothing in the codebase reads the setting, so nothing can respond to it — but the runtime half should be redone when the emulation is working.

### 7. Not assessed

Stated plainly rather than left implied:

- **No screen reader was run.** Whether announcements are *comprehensible* — as opposed to merely present — is untested. NVDA or VoiceOver on the four flows is the obvious next step.
- **Zoom and reflow** (WCAG 1.4.10) at 400% is untested.
- **Colour-blind simulation** beyond contrast ratios is untested.
- **Ticket detail and queue keyboard task completion** (open a ticket from the queue, read it, post a reply) was not walked end to end.

---

## The spec

`e2e/accessibility.spec.ts` covers the four flows and asserts **zero critical or serious** violations. It deliberately does not assert on moderate or minor: doing so on the first run produces a wall of contrast findings and no signal. The moderate and minor counts are still recorded above (currently zero on all four pages) so the floor can be ratcheted later.

The spec includes a **self-test**: it injects an unlabelled `<input>` into a live page and asserts axe reports the `label` rule. Without it, a misconfigured scanner — wrong tags, wrong context, running before render — would make every test pass while checking nothing. That test passes, so the four failures above are real findings and not a broken harness.

**The spec currently fails 4 of 4 flows.** That is the intended state: it encodes the target, and the target is not yet met. It is wired into the non-blocking `security` CI job rather than the blocking `e2e` job, so it reports without breaking the build — the same ratchet reasoning as the coverage floor. The `e2e` job excludes it via `--grep-invert "WCAG 2.1 AA"`, verified locally: 24 tests total, 19 with the filter applied, 5 in the accessibility spec.

> **Neither the spec nor the CI job is in the repository.** `.gitignore` excludes `e2e/` and `.github/` (commit `7f221d2`, *"kept locally, gitignored"*), so `e2e/accessibility.spec.ts` and the workflow that runs it exist only on the machine that produced them — as does this document, since `docs/` is excluded too. Until that policy changes, this baseline is reproducible only locally. See the corresponding section in `docs/security-audit-2026-08.md`.

---

## Priority

| # | Finding | Severity | Effort |
|---|---|---|---|
| 1 | Focus ring lost on invalid inputs (2.4.7) | High — affects every form, invisible to axe | Small (one CSS selector) |
| 2 | Four unnamed `<select>`s in the queue filters | High — critical, blocks screen-reader filtering | Small |
| 3 | Unnamed button as first tab stop on intake | High — critical, on the flagship flow | Small |
| 4 | Unlabelled input on ticket detail | High — critical | Small |
| 5 | Ticket list announces nothing on update | Medium — silent UI for screen readers | Small |
| 6 | App-shell contrast (2 controls, 3 pages) | Medium — serious, one fix clears three pages | Small |
| 7 | `nested-interactive` / `aria-allowed-attr` on queue rows | Medium — needs a rethink of the row's interaction model | Medium |
| 8 | 13 tab stops before the intake input; `<body>` focus stop | Medium — flagship flow | Medium (skip-link or reorder) |
| 9 | `prefers-reduced-motion` unimplemented | Medium — vestibular accessibility | Medium |
| 10 | Screen-reader pass, zoom/reflow at 400% | Unknown until done | — |

Items 1–6 are all small and together would clear every critical finding plus the highest-value judged one.

---

## Deferred: the queue row's interaction model

`aria-allowed-attr` (critical) and `nested-interactive` (serious) on the ticket queue were **not fixed**, deliberately. Both come from one element in `components/TicketTableView.tsx`:

```html
<tr role="button" tabindex="0" aria-selected="true"> … <input type="checkbox"> … </tr>
```

`aria-selected` is not permitted on `role="button"`, and a `role="button"` element declares its children presentational while genuinely containing a focusable checkbox.

Neither has a safe local fix:

- **Deleting `aria-selected`** clears the critical rule but removes the only programmatic signal that a row is selected — the tool goes green while screen-reader users lose information. That is the failure mode this audit exists to avoid.
- **Removing `role="button"` / `tabindex`** clears `nested-interactive` but strips the queue's keyboard entry point entirely unless a real focusable control is added inside each row.
- **Doing it properly** means either full ARIA grid semantics (`role="grid"`/`gridcell"` plus arrow-key navigation) or making the subject cell a link and moving selection onto the checkbox. Both are new interaction models.

The blocking evidence: `e2e/ui-ux.spec.ts` (*"keyboard shortcuts navigate tickets list and detail actions"*) locates rows with `getByRole('button', { name: <subject> })` and drives a `j` / `x` / `Shift+X` / `Enter` roving-focus model built on the row being a widget. Any of the above breaks that locator and that model, so the change carries a test rewrite and a keyboard-navigation redesign with it.

**This belongs in its own piece of work.** Scope: choose the semantic model, implement roving focus, preserve middle-click-new-tab and context-menu behaviour, rewrite the keyboard E2E test.

## Also found during remediation, not fixed

- **White on the primary colour fails AA in dark theme.** `--primary: 232 72% 64%` in `.dark` gives white text **4.05:1** (axe measured 4.12:1) against the 4.5:1 threshold, on primary buttons and the selected segmented control. Changing lightness `64% → 60%` yields **4.84:1**. Left alone because it is a brand token affecting every primary surface in dark mode — a design decision, not a label fix.
- **Light-theme section headings** in `SidebarSavedViews.tsx` use `text-foreground/45` ("Saved views", "Teams"), which computes below 4.5:1. axe did not flag them because neither section renders with the current test data. Latent, but real.
- **The paperclip button is the first tab stop on AI intake**, not the send button as this document originally recorded. It was named only by `title`, which is a weak accessible name. Given `aria-label` during this pass.

## Reproducing

```bash
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx playwright test e2e/accessibility.spec.ts --reporter=list --retries=0
```

Each page logs a machine-readable `A11Y_BASELINE {...}` line with per-severity counts, rule ids and offending selectors, so successive runs can be diffed rather than re-read.

Port 5173 must be free — Playwright starts the web dev server itself with `VITE_E2E_MODE=true`, which the persona auth requires. A dev server left running from a normal `npm run dev -w apps/web` will be reused and the three authenticated flows will fail on authentication.
