# Implementation Prompt — 1.21 Operations console

**Date:** 2026-08-30
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.21 in `prompts/2026-08-26-restart-master-plan.md` — **new card**, requested by the owner on 2026-08-28 after pointing at the LMS equivalent as the reference design.
**Closes:** three background workers run in production with **no UI at all**. Nobody can see whether they are on, when they last ran, or whether the last run worked — and nobody can trigger one. The retention job in particular is off and switched purely by settings files, so turning it on today means an Azure config change and a restart.

**Cost:** none. No schema, no migration, no Azure change.

**Reference design:** `C:\Users\PHulgur\Downloads\learningms\apps\lms\app\admin\jobs\page.tsx` and `components/admin/jobs/JobsTable.tsx`. **Read them before designing anything** — the owner has already chosen this shape and the reasoning is in the comments at the top of that page.

---

## 1. Goal

An owner opens **Admin → Operations** and sees, on one screen: which background jobs exist, whether each is on, when it last ran and whether that run succeeded, what it did, and a **Run now** button for each.

## 2. Context read

- `CLAUDE.md` — baselines **255 unit (30 suites), 415 integration + 1 skipped, 36 web (13 files)**.
- `docs/agent-context/repo-landmines.md` (all), `docs/agent-context/working-agreement.md`, `.cursorrules`.
- The LMS reference above — particularly its three-group layout and its "a garnish must never break the console" rule.
- `apps/api/src/health/health.service.ts` — already assembles most of this data for `/api/health/ready`.

## 3. Facts established first (verified 2026-08-30)

| Fact | Consequence |
|---|---|
| Three workers exist. **SLA breach** (`slas/sla-breach.service.ts`): `onModuleInit` → `setInterval`, `SLA_BREACH_WORKER_ENABLED` (default on), `SLA_BREACH_INTERVAL_MS` (60 s), **public `getWorkerState()`** returning `{ enabled, lastRunAt, lastRunOk }` (added by card 0.5), and a private `checkBreaches()`. **Retention** (`retention/retention.service.ts`): `static readPolicy(config)`, `onModuleInit`, **public `runOnce(): Promise<RetentionRunSummary \| null>`**, off by default plus a dry-run switch. **Automation scheduler** (`automation/automation-scheduler.service.ts`): `static readPolicy(config)`, `onModuleInit`, **public `runOnce(): Promise<SchedulerRunSummary \| null>`**, on by default. | Two of the three already expose exactly what a "Run now" needs. The SLA worker does **not** — see §4.3. |
| `runOnce()` returns `null` when the advisory lock is held by another instance. | The UI must say "another instance is running this" rather than "failed". |
| Neither retention nor the scheduler records its last run anywhere durable — the summaries are logged and discarded. `SlaBreachService` keeps `lastRunAt`/`lastRunOk` **in memory**, so a restart loses them. | Either persist runs or accept in-memory. §4.4 decides: **in-memory, and say so in the UI.** No schema change in this card. |
| `AdminGuard` allows OWNER, TEAM_ADMIN, LEAD; `OwnerGuard` (`auth/owner.guard.ts`) allows OWNER only and throws `'This action is restricted to owners only'`. | Operations is **OwnerGuard** — running a job affects the whole system. |
| `components/AdminSidebar.tsx` holds an array of `{ label, to, icon, roles }`; every current entry is `roles: ["TEAM_ADMIN", "OWNER"]`. Routes are registered in `App.tsx` with `guardRoute(<allowed>, <element>)`. | One new sidebar entry with `roles: ["OWNER"]` and one guarded route. Follow the existing shape exactly. |
| `HealthService.readiness()` already reports `slaWorker`, `redis.*`, `smtp`, `webPubSub`, `blobStorage`, `attachmentScanner`, `aiPipeline`, `db`, and (card 0.4 never shipped, so **not**) outbox counts. | The console's "what is switched on" group can be built from a single call to the same service — do not duplicate the env-reading logic. |
| `RetentionService` is provided by `RetentionModule`; `AutomationSchedulerService` by `AutomationModule` (and exported); `SlaBreachService` by `SlasModule` (exported since card 0.5). | An `OperationsModule` can inject all three plus `HealthService`. Check `RetentionModule` exports `RetentionService` — **if it does not, add the export**; that is expected and in scope. |

## 4. Decisions and assumptions

1. **Three groups, in the LMS order and for the LMS reasons:**
   - **Feature switches** — what is turned on system-wide, read-only in this card: retention job, automation scheduler, SLA worker, AI pipeline, realtime, attachment scanning. Each shows its state and, where it is off, the setting that turns it on. **Read-only** because these live in Azure app settings; a card that makes them database-backed toggles is a bigger piece of work and needs its own decision.
   - **Data in** — where tickets arrive from: the inbound-email webhook and the integration intake endpoint, each showing configured / not configured (from the readiness data) and its path.
   - **Scheduled jobs** — the table (§4.2).
2. **The jobs table**, columns: **Job · Status · Last run · Result · Next run · Actions**. Rows: SLA breach checker, Retention, Automation scheduler. `Actions` holds **Run now**. No enable/disable toggle in this card (see §4.1) — the column exists so a later card can add one without a redesign.
3. **`SlaBreachService` needs a public `runOnce()`** to match the other two: extract the body of the interval callback into `runOnce(): Promise<SlaWorkerRunSummary | null>` that returns `null` when the lock is held, have the timer call it, and keep `lastRunAt`/`lastRunOk` updating exactly as now. Behaviour must not change — the existing SLA tests are the proof.
4. **Last-run state is in-memory and resets on restart.** Each of the three services keeps `lastRunAt`, `lastRunOk` and a short `lastSummary`. The UI shows "—" with the tooltip "not run since the app last restarted" rather than pretending. Persisting runs is a follow-up (it needs a table).
5. **`POST /api/operations/jobs/:key/run`** — `OwnerGuard`, `@ThrottlePolicy('highWrite')`, `key` an `@IsIn` of `sla-breach | retention | automation-scheduler`. Returns `{ key, ran: boolean, skipped: 'locked' | null, summary, startedAt, finishedAt, durationMs }`. A job that throws → 500 with the message, and the row shows the failure.
6. **Running is synchronous** and can take a few seconds. The button shows a spinner and disables; the whole table refetches on completion. If a job ever takes longer than the request timeout (120 s) that is a signal to make it async — out of scope, note it in the docs.
7. **`GET /api/operations`** — `OwnerGuard`, returns everything the page needs in one call: the three groups' data, built from `HealthService.readiness()` plus each worker's state and policy. **A failure in any single part must not break the response** — wrap each in try/catch and return `null` for that piece, exactly like the LMS console treats its queue depth.
8. **No auto-refresh.** A manual **Refresh** button in the page header. A console that repolls every few seconds while an owner reads it is noise.

## 5. The work

Kill stray node processes; Postgres up; no other test run active.

### Task 1 — `runOnce` on the SLA worker

**Files:** Modify `apps/api/src/slas/sla-breach.service.ts`; Create `apps/api/src/slas/sla-worker-run-summary.type.ts`

- [ ] Type: `{ ranAt: string; ok: boolean; breachesProcessed: number; atRiskProcessed: number }` — take the counts the existing code already computes; if it computes none, return `0`s and say so in the report rather than adding counting logic.
- [ ] Extract the interval callback's body into `async runOnce(): Promise<SlaWorkerRunSummary | null>`; return `null` when the advisory lock is not acquired; keep `lastRunAt`/`lastRunOk` assignment where it is. The timer now calls `runOnce()`. `getWorkerState()` gains `lastSummary`.
- [ ] `npx jest --silent` and the SLA integration specs must be unchanged and green — this is a pure extraction.

### Task 2 — Operations module

**Files:** Create `apps/api/src/operations/operations.module.ts`, `operations.controller.ts`, `operations.service.ts`, `operations-snapshot.type.ts`, `job-key.const.ts`, `operations.service.spec.ts`; Modify `apps/api/src/app.module.ts`, and `retention/retention.module.ts` if it does not export its service

- [ ] `job-key.const.ts`: one export, `JOB_KEYS = ['sla-breach', 'retention', 'automation-scheduler'] as const` + `JobKey` type.
- [ ] `operations-snapshot.type.ts`: the response shape — `{ generatedAt, switches: {...}, dataIn: {...}, jobs: JobRow[] }` where `JobRow = { key, label, description, enabled, intervalMs, lastRunAt, lastRunOk, lastSummary, nextRunAt }`. `nextRunAt` is computed as `lastRunAt + intervalMs` when both are known, else `null` — label it "approximate" in the UI, because the timer is not schedule-anchored.
- [ ] `OperationsService.snapshot()` per §4.7; `runJob(key)` per §4.5, dispatching to the three `runOnce()` methods.
- [ ] Controller: `@Controller('operations')`, `@UseGuards(OwnerGuard)`, `@Get()` and `@Post('jobs/:key/run')`.
- [ ] Unit spec: `snapshot()` with all three workers mocked; one worker throwing still returns a snapshot with that part `null`; `runJob('retention')` returns `skipped: 'locked'` when `runOnce()` resolves `null`; an unknown key → `BadRequestException`.

### Task 3 — Integration tests

**Files:** Create `apps/api/test/integration/operations.spec.ts`

- [ ] Cases: `GET /api/operations` as OWNER → 200 with three job rows and the switch group; as TEAM_ADMIN → 403; as AGENT → 403. `POST /api/operations/jobs/retention/run` as OWNER → 200 with a summary and **nothing deleted** (retention is dry-run by default in test); as LEAD → 403. `POST …/jobs/nope/run` → 400. `POST …/jobs/automation-scheduler/run` → 200 (the harness has no timed rules, so `ticketsEnqueued: 0`).
- [ ] Run alone, then the **full** suite. Expect **415 + 7 = 422 passed, 1 skipped** — real number wins.

### Task 4 — The page

**Files:** Create `apps/web/src/pages/OperationsPage.tsx`, `apps/web/src/components/operations/JobsTable.tsx`, `apps/web/src/components/operations/SwitchCard.tsx`; Modify `apps/web/src/App.tsx`, `apps/web/src/components/AdminSidebar.tsx`, `apps/web/src/api/client.ts`

- [ ] Sidebar: `{ label: "Operations", to: "/admin/operations", icon: Cog, roles: ["OWNER"] }` — **last** in the list, as in the LMS.
- [ ] Route in `App.tsx` with `guardRoute(role === "OWNER", <OperationsPage />)`, lazy-loaded like its neighbours.
- [ ] Page layout, following the reference: `PageHeader`-equivalent with a **Refresh** button, then three sections. Section labels are a **small uppercase eyebrow**, deliberately lighter than the card titles — the LMS comment explains why, and the same reasoning applies here.
- [ ] Switch cards in a `grid-cols-1 lg:grid-cols-2 xl:grid-cols-3`, each `flex flex-col` with a `flex-1` description so a row of cards shares one height and the state chips line up.
- [ ] Jobs as one full-width table; **Run now** per row with a spinner and disabled state; on completion, toast the outcome ("Retention ran — nothing deleted (dry run)" / "Another instance is already running this") and refetch the snapshot.
- [ ] Reuse existing primitives — `Card`, `StatCard`, `PageTabs`, `EmptyState`, `ConfirmDialog` (see `components/ui/`) — rather than new ones. **Run now** on retention with dry-run **off** gets a confirm dialog; the other two run without one.
- [ ] `cd apps/web && npx tsc --noEmit && npx vitest run`; add a small presentational test for the table's status/last-run formatting if it can run without a DOM.

### Task 5 — Docs, baselines, commit

- [ ] `docs/azure-env-settings.md`: a short "Operations console" note — the page is read-only for switches, and which variables each switch reflects.
- [ ] `CLAUDE.md` + `repo-landmines.md` baselines.
- [ ] Commit by explicit path (read `git status --short` first).

## 6. Files expected to change

`slas/sla-breach.service.ts` · `slas/sla-worker-run-summary.type.ts` (new) · `operations/*` (6 new) · `app.module.ts` · `retention/retention.module.ts` (export, if needed) · `test/integration/operations.spec.ts` (new) · `apps/web/src/pages/OperationsPage.tsx` (new) · `components/operations/*` (2 new) · `App.tsx` · `AdminSidebar.tsx` · `client.ts` · `docs/azure-env-settings.md` · `CLAUDE.md` · `repo-landmines.md`. No schema, no migration, no dependency.

## 7. Security considerations

- **OwnerGuard, both routes.** Running retention with dry-run off deletes data; running the scheduler enqueues automation across every team. TEAM_ADMIN and LEAD must be refused — integration tests assert it.
- The snapshot reports **states, never values** — the same rule as `/api/health/ready`. No connection strings, no secrets, no setting values beyond on/off and intervals.
- `Run now` is rate-limited (`highWrite`) so a stuck finger cannot hammer a job.
- The advisory locks already prevent two runs colliding; the UI must surface "locked" as information, not as an error, or an owner will click again.

## 8. Acceptance criteria

1. An owner opens **Admin → Operations** and sees three groups and three job rows with real state.
2. **Run now** on the automation scheduler completes and the row's Last run updates without a page reload.
3. **Run now** on retention says plainly that nothing was deleted because it is in dry run.
4. A team admin cannot see the sidebar entry and gets 403 from both endpoints.
5. Killing one dependency (e.g. point `REDIS_*` at nothing) still renders the page — that section shows unavailable rather than an error page.
6. SLA behaviour is unchanged: existing SLA unit and integration specs green.
7. Full suite = 415 + new, 1 skipped; unit = 255 + new; both `tsc` clean; vitest green.

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx jest --config ./test/jest.integration.json test/integration/operations.spec.ts > ../../it-ops.txt 2>&1; grep Tests: ../../it-ops.txt
npx jest --config ./test/jest.integration.json test/integration/sla.instances.spec.ts test/integration/tickets.sla.spec.ts test/integration/slas.spec.ts > ../../it-sla.txt 2>&1; grep Tests: ../../it-sla.txt
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

(The SLA specs matter: Task 1 is an extraction and must change nothing.)

## 10. Manual test steps

Dev API (`PORT=3077`, and set `AUTOMATION_SCHEDULER_INTERVAL_MS=600000` so the timer does not fire while you watch) + web. As `owner@company.com`: open Admin → Operations; confirm three groups; click **Run now** on the automation scheduler and watch Last run populate; click it on retention and read the dry-run message; confirm the SLA row shows its state. Restart the API and confirm Last run resets to "—" with the tooltip. Sign in as a team admin and confirm the entry is absent and `/admin/operations` redirects. Stop the servers; zero repo node processes.

## 11. Handoff notes — what to report back

1. Commit SHA. 2. `Tests:` lines (unit, operations spec, the three SLA specs, full suite), vitest, both `tsc`. 3. `git diff --stat HEAD~1`. 4. Manual steps. 5. Anything that did not match — especially whether the SLA `runOnce` extraction was truly behaviour-neutral, what counts its summary could honestly report, and whether `RetentionModule` needed an export added.
