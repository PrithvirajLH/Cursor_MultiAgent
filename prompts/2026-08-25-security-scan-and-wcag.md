# Implementation Prompt — Security Scan and WCAG Audit

**Date:** 2026-08-25
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Closes:** two Phase 1 quality gates that have never been assessed — "security scan clean" and "WCAG 2.1 AA on core flows".

---

## 1. Goal

Produce a defensible answer to two questions nobody can currently answer: which dependency vulnerabilities actually reach production, and whether the core user flows are usable by someone on a screen reader or a keyboard.

This is a **triage and reporting** job more than a fixing job. The deliverable is an honest assessment plus the fixes that are genuinely safe to make now.

---

## 2. Facts established first — read these before running anything

| Fact | Consequence |
|---|---|
| `npm audit` at the repo root reports **56 advisories: 4 critical, 28 high, 22 moderate, 2 low** | that number is misleading, see below |
| `npm audit --omit=dev` returns **the same 56** | the flag does not work here |
| Per-workspace `--omit=dev` still lists `vitest`, `vite`, `rollup`, `postcss` — all `devDependencies` in `apps/web` | workspace hoisting means audit resolves against the shared root tree, so **prod/dev cannot be separated by flag in this monorepo** |
| `concurrently` and `vitest` are reported **critical** | both are dev-only. Anyone reading the raw output will chase phantoms. |
| No a11y tooling is installed anywhere — no axe, pa11y or lighthouse | WCAG has never been measured |
| CI has no security step at all | nothing is watching |
| 6 Playwright e2e specs exist (`lifecycle`, `realtime-*`, `sprint3`, `ui-ux`) | a11y checks can ride on existing page navigation rather than new fixtures |

**The central point: do not report "56 vulnerabilities" to anyone.** The real question is how many reach a running production process, and answering it requires tracing each advisory to the dependency that pulls it in and classifying against the `dependencies` (not `devDependencies`) blocks by hand.

## 3. Decisions and assumptions

1. **Runtime reach is the severity axis that matters**, not the CVSS label. A critical in a test runner is not a production risk; a moderate in an XSS sanitiser is.
2. **Four packages get individual attention regardless of what the tool says**, because of what they do:
   - `dompurify` — the XSS sanitiser in the web app. A hole in your XSS defence is worth more scrutiny than its severity label implies.
   - `nodemailer` — handles outbound email, processes attacker-influenced content.
   - `multer` — file uploads, reached via `@nestjs/platform-express`.
   - `@nestjs/core` / `@nestjs/platform-express` — the HTTP layer everything sits on.
3. **Fix only what is safe to fix now.** A patch or minor bump with green tests goes in. A major bump does not — that is its own piece of work with its own risk, and bundling it here means a security commit that is really a framework upgrade.
4. **CI gets a security step, non-blocking at first.** Making it fail the build on day one, against a backlog this size, guarantees someone disables it within a week. Report first, ratchet later — the same reasoning as the coverage floor.
5. **WCAG scope is Phase 1: core flows only.** Not every page. Specifically: login, AI intake submission, the ticket queue, and ticket detail. Those are what a requester and an agent actually touch.
6. **Automated a11y catches roughly a third of real problems.** axe finds contrast, labels, roles and ARIA misuse. It cannot judge whether the tab order makes sense or whether a screen reader announcement is comprehensible. The plan includes a short manual pass and says plainly which findings are machine-checked and which are not.

---

## 4. The work

### Part 1 — Establish a trustworthy vulnerability picture

- For each advisory, resolve the dependency path (`npm ls <pkg>`) and classify:
  **runtime** (reachable from a `dependencies` entry in `apps/api` or `apps/web`) or **build-time** (only reachable via `devDependencies`).
- Produce `docs/security-audit-2026-08.md` with two tables: runtime advisories with severity, path and whether a non-breaking fix exists; and build-time advisories, counted and summarised but not itemised.
- State the headline honestly: "N runtime advisories, of which M have a safe fix" — never the raw 56.

### Part 2 — Apply the safe fixes

- `npm audit fix` **without** `--force`, then run the full check suite.
- Anything requiring `--force` or a major bump: leave it, and record it in the report with the version jump it would need and what it would touch.
- Re-run the audit and record the new runtime count.

### Part 3 — Static checks worth having

- Confirm no secrets are committed: scan tracked files for key-shaped strings, and confirm `.env` is ignored (it is, but verify rather than assume).
- Confirm `helmet` is applied and check which headers are actually set.
- Confirm the throttler covers mutation endpoints, not only reads.

Report findings; do not change behaviour here. Any change to headers or rate limits is its own piece of work with its own testing.

### Part 4 — WCAG on core flows

- Add `@axe-core/playwright` as a dev dependency.
- New spec `e2e/accessibility.spec.ts` covering the four core flows, asserting no `critical` or `serious` violations. Do not assert zero violations of all severities on the first run — you will get a wall of `moderate` colour-contrast findings and no signal.
- Record the baseline count per page in the report so the next run can be compared.

### Part 5 — Manual a11y pass

Machine checks cannot answer these. Walk them and record pass/fail with a note:

- Keyboard only, no mouse: can you complete AI intake end to end?
- Keyboard only: can you open a ticket from the queue, read it, and post a reply?
- Is focus visible at every step, and does tab order follow reading order?
- Does the ticket list announce updates to a screen reader when it changes?
- Does the app respect `prefers-reduced-motion`? (`motion` v12 is a dependency and the design guidance requires this.)

### Part 6 — CI

Add a `security` job: `npm audit --audit-level=high` plus the a11y spec, `continue-on-error: true` initially, with a comment stating the intent to make it blocking once the runtime backlog is cleared.

---

## 5. Files expected to change

```
docs/security-audit-2026-08.md          (new — the deliverable)
docs/accessibility-audit-2026-08.md     (new — the deliverable)
e2e/accessibility.spec.ts               (new)
apps/web/package.json                   (@axe-core/playwright)
package-lock.json                       (audit fix)
.github/workflows/ci.yml                (security job)
```

Application source should ideally not change at all. If a fix requires it, that is a finding to raise, not to quietly absorb.

## 6. Security considerations

- Do not paste advisory detail containing exploit specifics into the report; link the advisory ID.
- The report names weaknesses in a running system. Keep it in the repo, not in a shared doc or an artifact.
- `npm audit fix` rewrites the lockfile. Run the full suite afterwards — a silent transitive bump has broken things before.

## 7. Acceptance criteria

1. `docs/security-audit-2026-08.md` separates runtime from build-time advisories and never quotes the raw 56 as the headline.
2. Every runtime critical/high is individually listed with its dependency path and a disposition: fixed, deferred with reason, or accepted with reason.
3. `dompurify`, `nodemailer`, `multer` and the two `@nestjs` packages each have an explicit disposition, whatever the tool says about them.
4. `npm audit fix` applied without `--force`; typecheck, 186 unit and the integration suite all still pass afterwards.
5. `e2e/accessibility.spec.ts` runs the four core flows and asserts zero critical or serious violations.
6. `docs/accessibility-audit-2026-08.md` records the per-page baseline and the manual pass results, marking clearly which findings are automated and which are human-judged.
7. CI has a security job that runs but does not block, with a comment explaining why.
8. No application source changed, or any change explained in the report.

## 8. Checks to run

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
cd apps/api && npx jest                          # expect 186
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
cd apps/api && npm run test:integration          # expect 357 + 1 skipped
npx playwright test e2e/accessibility.spec.ts
```

## 9. Manual test steps

1. Read `docs/security-audit-2026-08.md` — the headline number should be defensible to someone who will ask "so are we exposed or not?"
2. Run the a11y spec and confirm it fails when a violation is introduced deliberately (remove a label from a form field and watch it go red).
3. Do the keyboard-only walk yourself; automated results are not a substitute.

## 10. Out of scope

Major version bumps of any framework · changing security headers or rate limits · fixing the a11y violations found (that is the next piece of work, informed by this one) · Key Vault · load tests · email intake.

## 11. Handoff notes

See the environment briefing for this repo: WSL Postgres on 5433, the
`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` requirement for integration runs,
the Prisma migration drift trap, and the rule about never editing source while an
integration suite is running. Baseline before this work: **186 unit, 357
integration + 1 skipped**.

Note that item 3 (per-department business hours) may still be uncommitted when you
pick this up. Commit that first rather than mixing two pieces of work in one diff.
