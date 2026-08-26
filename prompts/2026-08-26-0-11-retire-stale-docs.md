# Implementation Prompt — 0.11 Retire the stale documents

**Date:** 2026-08-26
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 0.11 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** at least four planning documents contradict the code and will send the next engineer (human or agent) the wrong way. `README.md` lists "next steps" that were done months ago.

**Docs only. No source, no tests, no deploy.** Safe to run in parallel with card 0.5 — the two touch different files (0.5 edits `CLAUDE.md`, `repo-landmines.md`, `azure-env-settings.md`, `.env.example`; this card must **not** touch those four).

---

## 1. Goal

Make `CLAUDE.md`'s "Read these first" table the only entry point, and ensure nothing reachable from it contradicts the code. Superseded documents get a banner (not deleted — they are history), the README stops advertising finished work, and the hand-written API reference points to the real list of modules.

## 2. Context read

- `CLAUDE.md` — the "Read these first" table and "Current state".
- `docs/agent-context/working-agreement.md` — why stale plans are dangerous here (three plans contained factual errors found only on execution).
- The review's §9 "Which documents to trust" (artifact "Ticketing Restart Review", or the summary in `prompts/2026-08-26-restart-master-plan.md` §0.11).

## 3. Facts established first (verified 2026-08-26 against code)

| Document | What it claims | What is true |
|---|---|---|
| `docs/gaps-and-roadmap.md` | no realtime, no idempotency, no rate limiting, no tags, no business hours, no correlation IDs, no inbound email | all exist: `realtime/`, `common/idempotency.*`, `common/route-throttler.guard.ts`, `tags/`, `SlaBusinessHoursSetting`, `common/correlation-id.middleware.ts`, `tickets/inbound-email.service.ts` |
| `docs/sprint-status.md` | inbound email pending; business-hours calendars pending; no CI | inbound email shipped (Feb 2026); per-team business hours shipped (Aug 2026); `.github/workflows/ci.yml` and `azure-pipelines.yml` exist |
| `docs/slas.md` | business-hours/holiday calendars "not implemented yet" | implemented, per team, with timezone (`slas/slas.service.ts` `normalizeSchedule`, migration `20260825120000_per_department_business_hours`) |
| `docs/feature-comparison.md` | compares `/tickets` to `/tickets-revamp`; marks linked tickets, merge, message edit/delete, forward as ✅ in the app | `/tickets-revamp` was deleted 2026-06-08; none of those four features exist in the API (`tickets.controller.ts` has no link/merge/message-edit routes) |
| `docs/zendesk-gap-implementation.md`, `docs/zendesk-gap-reduction.md` | phased plans from Jan/Feb 2026 | most phases delivered; superseded by the master plan |
| `docs/unified-status-and-backlog-2026-02-09.md`, `docs/next-sprint-backlog-2026-02-09.md` | Feb backlog; lists ATT-01 (blob storage), PERF-02 (caching), OBS-01 (correlation IDs) as pending | all three shipped (`ticket-attachment.service.ts` Azure Blob, `CACHE_SUMMARY_TTL_MS` cache, correlation middleware) |
| `sprint.md` (root) | Jan 2026 sprint plan | superseded |
| `ToDo Ticketing.docx` (root) | says SLA engine, reports, inbound email, attachments do not exist | all exist |
| `BUgs.txt` (root) | 142-issue audit | previously found inflated; `BUGS_VERIFIED.md` is the corrected view |
| `README.md` "Next steps" | "Wire Azure AD SSO", "Implement SLA engine + routing rules UI", "Add audit log viewer" | all three exist (`auth/auth.guard.ts` Entra JWT; `slas/`, `routing/` + pages; `audit/` + `AuditLogPage.tsx`) |
| `PROJECT_DOCUMENTATION.md` §5 API reference | lists 15 controller groups | misses `tags`, `kb`, `csat`, `agents-admin`, `ai`, `realtime`; ~135 endpoints exist across 22 controllers |
| `docs/requirements.md`, `docs/roles-permissions.md`, `docs/wireframes.md` | Sprint-1 baselines | still accurate as *intent*; roles doc's "ADMIN" role is now `TEAM_ADMIN`/`OWNER` (its own bottom section already says so) — leave as is |

## 4. Decisions and assumptions

1. **Banner, don't delete.** History is useful; wrong signposting is the problem. Each superseded doc gets a two-line banner at the very top. `.docx` and `.txt` cannot take a Markdown banner — they get a sibling `README-SUPERSEDED.md` note instead, and are listed in the banner index.
2. **One banner text, verbatim everywhere**, so a grep finds them all:
   ```
   > **SUPERSEDED — 2026-08-26.** This document describes an earlier state and contradicts the code in places.
   > Do not plan from it. Current entry points: `CLAUDE.md` → `docs/agent-context/` → `prompts/2026-08-26-restart-master-plan.md`.
   ```
3. **`README.md` "Next steps" is replaced**, not deleted, with a pointer to the master plan and the two-sentence current state.
4. **`PROJECT_DOCUMENTATION.md` §5 is not rewritten** (card 2.6 replaces it with generated OpenAPI). Add one paragraph at the top of §5 naming the seven missing controller groups and stating that the source of truth is `apps/api/src/*/*.controller.ts`.
5. **Do not touch** `CLAUDE.md`, `docs/agent-context/*`, `docs/DEPLOYMENT.md`, `docs/azure-env-settings.md`, `apps/api/.env.example` — card 0.5 owns those right now.

## 5. The work

### Task 1 — Banners on Markdown docs

- [ ] Prepend the banner from §4.2 (then a blank line) to each of:
  `docs/gaps-and-roadmap.md`, `docs/sprint-status.md`, `docs/slas.md`, `docs/feature-comparison.md`, `docs/zendesk-gap-implementation.md`, `docs/zendesk-gap-reduction.md`, `docs/unified-status-and-backlog-2026-02-09.md`, `docs/next-sprint-backlog-2026-02-09.md`, `sprint.md`.
- [ ] Verify: `grep -l "SUPERSEDED — 2026-08-26" docs/*.md sprint.md | wc -l` → 9.

### Task 2 — Non-Markdown files

- [ ] Create `README-SUPERSEDED.md` at the repo root:

```markdown
# Superseded planning files

The following files at the repo root describe an earlier state of the project and contradict the code.
They are kept for history only. Do not plan from them.

| File | Why it is stale |
|---|---|
| `ToDo Ticketing.docx` | Says the SLA engine, reports, inbound email and attachments do not exist. All do. |
| `BUgs.txt` | 142-issue audit later found inflated; see `BUGS_VERIFIED.md` for the corrected view. |
| `sprint.md` | January 2026 sprint plan; banner added in-file. |

Current entry points: `CLAUDE.md` → `docs/agent-context/` → `prompts/2026-08-26-restart-master-plan.md`.
```

### Task 3 — README next steps

- [ ] In `README.md`, replace the whole `## Next steps` section (the four bullets at the end) with:

```markdown
## Where the plan lives

The item-by-item plan for taking this system to production is
`prompts/2026-08-26-restart-master-plan.md` (status board at the top). Start from
`CLAUDE.md` for the rules and baselines. Several older planning documents carry a
**SUPERSEDED** banner — they are history, not guidance.
```

### Task 4 — API reference pointer

- [ ] In `PROJECT_DOCUMENTATION.md`, directly under the `## 5. API Reference` heading, insert:

```markdown
> **This section lags the code.** It omits the `tags`, `kb`, `csat`, `agents-admin`, `ai` and `realtime`
> controllers and several routes added since February 2026 (~135 endpoints across 22 controllers today).
> The source of truth is `apps/api/src/**/*.controller.ts`; generated OpenAPI docs are planned (master plan card 2.6).
```

### Task 5 — Commit

- [ ] `git status --short` → only the files in §6.
- [ ] Commit (do not push):

```bash
git add docs/gaps-and-roadmap.md docs/sprint-status.md docs/slas.md docs/feature-comparison.md \
  docs/zendesk-gap-implementation.md docs/zendesk-gap-reduction.md \
  docs/unified-status-and-backlog-2026-02-09.md docs/next-sprint-backlog-2026-02-09.md \
  sprint.md README-SUPERSEDED.md README.md PROJECT_DOCUMENTATION.md
git commit -m "docs: mark superseded planning documents; point README and API reference at the current plan"
```

## 6. Files expected to change

9 banner edits (Task 1) · `README-SUPERSEDED.md` new · `README.md` · `PROJECT_DOCUMENTATION.md`. **12 files, all docs.** Nothing under `apps/`, nothing in `docs/agent-context/`, not `CLAUDE.md`.

## 7. Security considerations

None. Read each file you banner only far enough to confirm it is the one named; do not copy any content out of them.

## 8. Acceptance criteria

1. `grep -rl "SUPERSEDED — 2026-08-26" --include=*.md . | grep -v node_modules | wc -l` → 10 (9 banners + `README-SUPERSEDED.md`).
2. `README.md` no longer contains "Wire Azure AD", "Implement SLA engine" or "Add audit log viewer".
3. `PROJECT_DOCUMENTATION.md` §5 carries the pointer paragraph.
4. `git diff --stat HEAD~1` = exactly 12 files; `apps/` untouched.
5. Both typechecks and unit suites unaffected (nothing to run, but `git diff --stat` proves it).

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review"
grep -rl "SUPERSEDED — 2026-08-26" --include=*.md . | grep -v node_modules
git status --short
git diff --stat HEAD~1
```

## 10. Manual test steps

Open `README.md` and one bannered doc in the editor's Markdown preview; the banner renders as a blockquote at the top.

## 11. Handoff notes — what to report back

1. Commit SHA.
2. Output of the `grep -rl` count and `git diff --stat HEAD~1`.
3. Any file in the list you could not find or that already had a banner.
