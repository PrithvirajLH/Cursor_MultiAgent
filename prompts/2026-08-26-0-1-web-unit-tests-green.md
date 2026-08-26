# Implementation Prompt — 0.1 Web unit tests green

**Date:** 2026-08-26
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`, HEAD `beec159` + uncommitted `e2e/`)
**Card:** 0.1 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** the red web unit suite — 3 of 13 vitest files fail today, so the CI web step (`npm run -w apps/web test`) cannot pass and nothing downstream can be trusted.

---

## 1. Goal

Make `cd apps/web && npx vitest run` exit 0 with all 13 files passing, without weakening any test, and record the resulting count as the new web baseline in `CLAUDE.md`.

## 2. Context read (do this first)

- `CLAUDE.md` — the five rules; especially rule 3 (kill stray node processes) and rule 5 (trust a live run).
- `docs/agent-context/repo-landmines.md` — "Windows process hygiene" and "Tests and AI configuration".
- `.cursorrules` — explicit types, no `any`, kebab-case files, no blank lines inside functions.
- This card touches **only `apps/web`**. Do not open the API, do not run the integration suite, do not run Playwright.

## 3. Facts established first (verified 2026-08-26 by a live run)

| Fact | Consequence |
|---|---|
| `cd apps/web && npx vitest run` → **Test Files 3 failed / 10 passed (13); Tests 2 failed / 33 passed (35)** | Baseline to beat. The third failing file never loads, so its tests are not in the 35. |
| `apps/web/vite.config.ts` has **no `test:` block** — vitest runs in the default Node environment, no DOM. No test file uses a `// @vitest-environment` pragma. `jsdom`/`happy-dom` are **not installed**. | Anything that needs a browser API at import time crashes the whole file. |
| `apps/web/src/utils/messageBody.ts:11` runs `DOMPurify.addHook("afterSanitizeAttributes", …)` **at module load**. In Node, `dompurify`'s default export is the un-initialised factory: it has `isSupported === false` and **no** `addHook`, `sanitize` methods (they are only attached when a `window` exists). | Importing `messageBody.ts` in Node throws `TypeError: default.addHook is not a function`. |
| `src/components/ticket-detail/ticket-history-state.test.tsx` imports `TicketConversation`, which imports `RichTextEditor.tsx`, which imports `messageBody.ts` (`RichTextEditor.tsx:6`). The test already mocks `../MessageBody` but **not** `RichTextEditor`. | This is failure #1: the file cannot load. |
| `src/sidebar-badges.test.ts:13-15` expects `getSidebarBadge("completed", counts)` to be `11`. `src/sidebar-badges.ts` `getSidebarBadge` only maps `"triage"`; the sidebar in `src/App.tsx` (items at lines ~201-263) has no `completed` entry any more. | Failure #2 is a stale test for a removed sidebar item, not a product bug. |
| `src/components/auth/sign-in-landing-page.test.tsx:17-19` expects the string `"Try signing in again. If the problem continues, contact your administrator."`. `src/components/auth/SignInLandingPage.tsx:206` renders `"Try again or contact your administrator."`. The other three assertions in that test (alert role, "Sign-in failed", the error message) already pass. | Failure #3 is copy drift. The current copy was chosen deliberately in the UI redesign; the test follows the product. |
| `npm run -w apps/web test` = `vitest run`; `.github/workflows/ci.yml:44-45` runs exactly that in the `lint-build` job. | When this card is done, that CI step goes green. |
| Both `dompurify` `sanitize` calls (`messageBody.ts:143`, `:173`) are inside functions, not at module load. | Only the top-level `addHook` needs guarding for the import to succeed; the test never calls `sanitize` (MessageBody is mocked). |

## 4. Decisions and assumptions

1. **Guard the hook with `DOMPurify.isSupported`, not with a jsdom environment.** `isSupported` is a documented DOMPurify property: `false` when there is no DOM (Node), `true` in the browser. Two lines, zero behaviour change in the browser, no new devDependency, and it protects any future server-side or worker import of `messageBody.ts`. Adding jsdom to every test would slow the suite and change the environment for 12 files that are happy in Node. If the team later wants component tests with real DOM, that is its own card.
2. **Delete the stale `completed` test case; do not re-add a `completed` badge.** The sidebar item was removed on purpose during the UI redesign (see `App.tsx` items). Keep the other two cases in that file — they still describe real behaviour.
3. **Update the sign-in assertion to the current copy.** The product owner approved the shorter copy in the redesign; the test's job is to prove the alert renders with recovery guidance, which it still does.
4. **Record the new baseline in `CLAUDE.md`.** The "Baseline — do not regress these" block lists API unit and integration only. Add the web unit line with the real number vitest prints after the fix.
5. **No other files.** If making these three green requires touching anything not listed in §6, stop and report — that is a new fact, not something to work around.

## 5. The work

Work in `apps/web`. Before starting, kill any node processes from this repo (`CLAUDE.md` rule 3):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*Ticketing System Quality Review*' } |
  Select-Object ProcessId, CommandLine
# Stop-Process -Id <each> -Force
```

### Task 1 — Reproduce (2 min)

- [ ] `cd apps/web && npx vitest run 2>&1 | Select-Object -Last 8`
      Expected: `Test Files 3 failed | 10 passed (13)`, `Tests 2 failed | 33 passed (35)`, and the `TypeError: default.addHook is not a function` trace pointing at `src/utils/messageBody.ts:11`.

### Task 2 — Guard the DOMPurify hook

**Files:** Modify `apps/web/src/utils/messageBody.ts:10-15`

- [ ] **Step 1: run only the failing file to see it fail at import**
      `npx vitest run src/components/ticket-detail/ticket-history-state.test.tsx`
      Expected: FAIL, `default.addHook is not a function`.

- [ ] **Step 2: replace lines 10–15 with the guarded version**

```ts
// Prevent tabnabbing: force rel="noopener noreferrer" on links with target="_blank".
// DOMPurify only attaches its methods when a DOM exists; in Node (vitest,
// any future server-side import) `isSupported` is false and addHook is absent.
if (DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("target") === "_blank") {
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}
```

      Keep the callback body byte-identical to what is there now (it is already correct); only the wrapper changes.

- [ ] **Step 3: run the file again**
      `npx vitest run src/components/ticket-detail/ticket-history-state.test.tsx`
      Expected: PASS (its tests now execute; if any of *them* fails, that is a new fact — report it, do not patch it).

- [ ] **Step 4: typecheck** — `npx tsc --noEmit` → exit 0. (`isSupported` is typed `boolean` in `@types/dompurify` / the bundled types.)

### Task 3 — Remove the stale sidebar badge case

**Files:** Modify `apps/web/src/sidebar-badges.test.ts:12-16`

- [ ] **Step 1:** `npx vitest run src/sidebar-badges.test.ts` → FAIL `expected undefined to be 11`.
- [ ] **Step 2:** delete the first `it(...)` block ("maps completed to the resolved aggregate", lines 13–15). The file keeps the `counts` fixture and the remaining two cases. Also drop `resolved: 11` from the fixture if nothing else reads it (nothing does — check with the two remaining cases).
- [ ] **Step 3:** `npx vitest run src/sidebar-badges.test.ts` → PASS, 2 tests.

### Task 4 — Align the sign-in copy assertion

**Files:** Modify `apps/web/src/components/auth/sign-in-landing-page.test.tsx:17-19`

- [ ] **Step 1:** `npx vitest run src/components/auth/sign-in-landing-page.test.tsx` → FAIL on the fourth `toContain`.
- [ ] **Step 2:** replace lines 17–19 with:

```ts
    expect(html).toContain("Try again or contact your administrator.");
```

- [ ] **Step 3:** `npx vitest run src/components/auth/sign-in-landing-page.test.tsx` → PASS.

### Task 5 — Full run, baseline, commit

- [ ] **Step 1:** `npx vitest run` → `Test Files 13 passed (13)`, `Tests N passed (N)`, exit 0. Write down N.
- [ ] **Step 2:** `npx tsc --noEmit` → exit 0.
- [ ] **Step 3:** `cd ../api && npx jest --silent 2>&1 | Select-String "Tests:"` → `186 passed` (proves you did not touch the API).
- [ ] **Step 4:** In `CLAUDE.md`, "Baseline — do not regress these": change the bold line to `**186 unit tests, 360 integration + 1 skipped, N web unit tests (13 files)**, both typechecks clean.` and add under the code block: `cd apps/web && npx vitest run                  # N, 13 files`. Same edit to the baseline bullet in `docs/agent-context/repo-landmines.md` ("Baseline as of 2026-08-25 …" → add the web number and today's date).
- [ ] **Step 5: commit** (on the current branch; do not push):

```bash
git add apps/web/src/utils/messageBody.ts apps/web/src/sidebar-badges.test.ts apps/web/src/components/auth/sign-in-landing-page.test.tsx CLAUDE.md docs/agent-context/repo-landmines.md
git commit -m "test(web): make the vitest suite green; record web baseline

- guard DOMPurify.addHook behind isSupported so messageBody.ts imports in Node
- drop the stale 'completed' sidebar badge case (item removed in the redesign)
- align the sign-in alert assertion with the current copy
- add the web unit count to the documented baseline"
```

## 6. Files expected to change

| File | Change |
|---|---|
| `apps/web/src/utils/messageBody.ts` | wrap lines 11–15 in `if (DOMPurify.isSupported) { … }` |
| `apps/web/src/sidebar-badges.test.ts` | delete one `it` block (+ unused `resolved` fixture key) |
| `apps/web/src/components/auth/sign-in-landing-page.test.tsx` | one assertion string |
| `CLAUDE.md` | baseline line + one command line |
| `docs/agent-context/repo-landmines.md` | baseline bullet |

Anything else changing is a red flag — stop and report.

## 7. Security considerations

The `addHook` guard must not change browser behaviour: in the browser `isSupported` is `true` and the tabnabbing protection still applies. Verify by reading — no code path in `messageBody.ts` calls `sanitize` before the module has loaded, and the guard only wraps the hook registration.

## 8. Acceptance criteria

1. `cd apps/web && npx vitest run` → 13/13 files pass, exit 0.
2. `cd apps/web && npx tsc --noEmit` → exit 0.
3. `cd apps/api && npx jest` → still 186/186 (unchanged).
4. `git diff --stat HEAD~1` lists exactly the five files in §6.
5. `CLAUDE.md` and `repo-landmines.md` state the new web baseline with today's date.
6. No new dependencies in any `package.json`; `package-lock.json` unchanged.

## 9. Checks to run (in this order)

```powershell
cd "C:\Users\PHulgur\Downloads\Ticketing System Quality Review\apps\web"
npx vitest run
npx tsc --noEmit
cd ..\api
npx tsc --noEmit
npx jest --silent
cd ..\..
git status --short
git diff --stat HEAD~1
```

## 10. Manual test steps

None required — this card is test-only plus a defensive guard. Optional sanity: `npm run dev -w apps/web`, open any ticket with a link in a message, confirm the rendered `<a>` still carries `rel="noopener noreferrer"` (dev tools → Elements). Stop the dev server afterwards (rule 3).

## 11. Handoff notes — what to report back

Reply with, in this order, so the planning session can verify without re-deriving:

1. Commit SHA.
2. The last 6 lines of `npx vitest run` (the summary block), and the value of N.
3. `npx tsc --noEmit` exit codes for web and api.
4. The `Tests:` line from `npx jest --silent`.
5. `git diff --stat HEAD~1` output.
6. Anything that did not match this prompt — a test that failed after the import was fixed, a file you had to touch that is not in §6, a fact in §3 that was wrong. Say so plainly; the plan is corrected, not the code bent to fit it.

---

## 12. Post-implementation record (planning session, 2026-08-26)

**Verdict: GREEN.** Commit `d6cc683`. Planner independently re-ran: vitest 13 files / 36 tests pass, `tsc --noEmit` clean in web and api, jest 186/186, `git diff --stat HEAD~1` = exactly the five §6 files, no `package*.json` change. Approved to merge; nothing to deploy.

**Corrections to this prompt, reported by the implementer and accepted:**
- §3 row 4: `RichTextEditor.tsx` is at `apps/web/src/components/RichTextEditor.tsx` (not under `ticket-detail/`) and its `messageBody` import is on line 22. The `:6` came from vitest's transformed-module stack trace — do not trust line numbers from vitest traces in future prompts.
- §3 row 5: the sidebar *item list* has no `completed` entry, but dead `completed` branches remain in `App.tsx` (~:190 type union, ~:348 `resolveActiveSidebarKey`, ~:677 navigation case). Logged as a follow-up in the master plan.
- §8 criterion 5 asked for a date in `CLAUDE.md`'s baseline line, but Task 5 step 4 prescribed a line with no date field. The dated baseline lives in `repo-landmines.md` only; that is fine.
