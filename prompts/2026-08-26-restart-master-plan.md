# Restart Master Plan — the queue of work, one item at a time

**Date:** 2026-08-26
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`, HEAD `beec159`)
**Source review:** the code-verified audit published 2026-08-26 (artifact "Ticketing Restart Review"). Every gap below was confirmed against code, not against the older planning docs.

> **How to use this file.** This is the *queue*, not an implementation prompt. When an item reaches the top, the planning session writes it up as its own `prompts/YYYY-MM-DD-<item>.md` in the established format (Goal → Context read → Facts established → Decisions → The work → Files → Checks → Manual steps), and an implementer session builds it. Items marked **Needs brainstorming** need a decision from the repo owner before a prompt can be written — the open questions are listed so that conversation is short.
>
> Each item has: **What we are doing** (plain language) · **How** (concrete approach with real file names) · **Size** (S ≤ 2 days, M ≤ 1 week, L 2–3 weeks) · **Depends on** · **Done when**.

---

## Status board

Updated by the planning session as cards move. States: **Queued** → **Handoff written** (prompt exists, kickoff sent) → **Building** (implementer session working) → **Verifying** (planning session re-running checks) → **GREEN** (merge/deploy approved) or **RED** (sent back with reasons) → **Merged** / **Deployed**.

| Card | State | Handoff prompt | Notes |
|---|---|---|---|
| 0.1 Fix the failing front-end tests | **GREEN** (verified 2026-08-26) | `prompts/2026-08-26-0-1-web-unit-tests-green.md` | Commit `d6cc683`. Planner re-ran: vitest 36/36 (13 files), tsc web+api clean, jest 186/186, diff = exactly the 5 files, no lockfile change. Merge OK; nothing to deploy. New web baseline recorded in CLAUDE.md. |
| 0.5 Readiness endpoint | **DONE — deployed & verified** `c2ff777` → production 2026-08-26 17:09 UTC (deployment `9e66be3c`, status 4, asset hash matched, new health files on server, `/api/health/ready` answered from a signed-in browser). Part B written: `docs/azure-env-inventory.md`. **Production findings:** SMTP missing (no email leaves prod), attachment scanner `blocked` (uploads stuck PENDING), Redis off, Blob + PubSub + AI on. Outstanding: owner sets `DEPLOYED_COMMIT_SHA=c2ff777` (planner blocked from app-settings changes). | `prompts/2026-08-26-0-5-readiness-endpoint.md` §12–13 | Commit `7ce9516`. Planner re-ran: unit 196/196, full integration 362 + 1 skipped (269 s, 0 failures), tsc api+web clean, vitest 36/36, diff = §6 list + `test/setup-tests.ts`, no lockfile/schema. Bonus fix: integration harness is now hermetic (attachment/realtime specs no longer hit real Azure from dev machines). **Deploy required** (first of this cycle); then Part B (`docs/azure-env-inventory.md`). New baselines: 196 / 362+1 / 36. |
| 0.2 Deploy gate | **DECIDED 2026-08-26 — no automated gate.** | — | Owner: deploys go through the deploy-agent session only. The gate is human: planning session must say GREEN (after re-running the checks itself) before anyone merges or deploys; the deploy-agent kickoff states the card and expected SHA. `scripts/check-migrations.sh` (0.3) runs locally in the planner's verification and in the deploy pre-flight, not in CI. GitHub/Azure CI stays as-is but is not relied on. |
| 0.3 Migration DROP guard | **GREEN** (verified 2026-08-26) | `prompts/2026-08-26-0-3-migration-drop-guard.md` | Commit `b5b34bd`. Planner re-ran the script against `main` (3 ok, exit 0), read the CI diffs, confirmed mode 755 / no CR / no probe remnants. Implementer used `git add -f` because `scripts/` was gitignored (prompt error); planner then un-ignored `/scripts/`, tracked `scripts/perf/*.mjs`, added the pre-flight line to `DEPLOYMENT.md`, fixed stale "expect 186/360" labels. No CI gate by decision — the script runs in the planner's verification and the deploy pre-flight. Merge OK; no deploy. **0.8 is unblocked.** |
| 0.4 Monitoring + alerts | **Deferred by owner (2026-08-27) — no new Azure spend for now.** Handoff stays ready. | `prompts/2026-08-26-0-4-monitoring-and-alerts.md` | Part A = code (implementer): `applicationinsights@3` + 5 custom metrics + `outbox` in readiness. Part B = Azure (deploy agent, after A is deployed): new App Insights component in the existing workspace, container logging on, Easy Auth exclusions + token, action group, availability test, 5 alerts. Each Azure command needs the owner's yes. |
| 0.6 Staging | **DECIDED 2026-08-26 — not doing.** | — | Owner: no staging environment. Consequences: migrations go straight to production (additive-only, migrate before app — unchanged); 0.9 measures performance locally; the planner's full local test run is the pre-production check. |
| 0.7 Virus scanning | **Deferred — decision pending** | — | Owner (2026-08-26): no decision yet. Production has 0 attachments today, so nothing is stuck. **Must be decided before the first real team uploads a file.** Options on the card; Blob storage is already in place. |
| 0.8 Soft delete + retention | **DONE — deployed & verified** `d1d57bc` → production 2026-08-27 14:22 UTC (status 4; migration applied, 49 total; 6 trigram indexes intact; FKs RESTRICT; delete/restore routes mapped in the container log; retention job logs "disabled"; bundle hash matched). | `prompts/2026-08-26-0-8-soft-delete-and-retention.md` §13 | Commits `c95ee50` `1b5336c` `22b05e3` `491450b`. Planner re-ran: unit 206, full integration 374+1 (40/40 files, 0 failures, run alone), tsc clean, vitest 36; migration `ALLOWED`; dev DB verified (49 migrations, six trigram indexes intact, FKs RESTRICT). Manual steps 1–5 passed in dev with real accounts. **Deploy with migration first** — exactly 1 pending on prod. Retention job ships OFF + dry-run; years still an owner decision. |
| 0.9 Perf re-measure | Queued — **re-scoped** | — | No staging (0.6), so measure against local WSL Postgres with a 20k-ticket perf seed; record relative numbers vs the Feb baseline; regression check runs locally in the planner's verification, not CI. |
| 0.10 Seed cleanup + HR merge | Queued | — | After 0.8. |
| 0.11 Retire stale docs | **GREEN** (verified 2026-08-26) | `prompts/2026-08-26-0-11-retire-stale-docs.md` | Commit `b985644`: 8 banners + README + README-SUPERSEDED (10 files). **Prompt error, not implementer error:** `PROJECT_DOCUMENTATION.md` and `sprint.md` are gitignored, so those two edits could not be committed. Planner then moved the bannered docs into `docs/archive/` during the repo clean-up (same day). Merge OK; no deploy. |
| 0.12 Backup drill | **GREEN** (verified 2026-08-26) — commit `9eb0e54`, `docs/DR.md`. Planner confirmed the drill server is gone (`flexible-server list` = production only). Measured: provisioning RTO 7 min 23 s; first query ≈ 8.5 min technical path. Findings: restored servers inherit **no firewall rules**; blob soft-delete 7 days on, versioning off; storage account `aiprojecttracker`. Owner decisions table in DR.md §5 (retention 7→35 d, geo-redundancy, HA — recommended "no for now" on HA). Merge OK; no deploy. | `prompts/2026-08-26-0-12-backup-restore-drill.md` | Deploy-agent task: PITR restore to a scratch server, verify, delete, write `docs/DR.md` with measured RTO. Facts: 7-day retention, no geo-redundancy, no HA, B1ms. Creates one temporary billable server (owner's yes). |
| 1.1 Edit ticket subject/description | **GREEN — awaiting merge + deploy** (verified 2026-08-27) | `prompts/2026-08-27-1-1-edit-ticket-subject-description.md` §12 | Commit `eeff0a2`. Planner re-ran: integration 380+1 (41/41, 0 failures), unit 206, tsc clean, vitest 36. No migration — plain deploy. New baseline 380. |
| 1.2 Requester confirm / reopen / cancel | **GREEN — awaiting merge + deploy (with 1.1)** (verified 2026-08-27) | `prompts/2026-08-27-1-2-requester-confirm-reopen-cancel.md` §12 | Commits `1252582` `7ff7f40`. Planner re-ran: integration 388+1 (42/42, 0 failures), unit 206, tsc clean, vitest 36; migration `ok` (50th, additive). **Deploy with migration first.** New baseline 388. |
| 1.3 Timed automations | **GREEN — awaiting merge + deploy** (verified 2026-08-27) | `prompts/2026-08-27-1-3-timed-automations.md` §12 | Commit `b0f0c5f`. Planner re-ran: integration 395+1 (43/43, 0 failures), unit 222 (28 suites), tsc clean, vitest 36. No migration. New baselines 222 / 395. Owner: build 1.4 → 1.5, then one deploy for 1.1–1.5. |
| 1.4 More automation actions | **GREEN — awaiting merge + deploy** (verified 2026-08-28) | `prompts/2026-08-27-1-4-more-automation-actions.md` §12 | Commit `156c8e5`. Planner re-ran: integration 401+1 (44/44, 0 failures), unit 227 (28 suites), tsc clean, vitest 36. No migration. New baselines 227 / 401. |
| 1.19 Integration intake endpoint (Power Automate) | **GREEN — awaiting merge + deploy** (verified 2026-08-28) — §12 | `prompts/2026-08-28-1-19-integration-intake-endpoint.md` | Commits `f423fa4` `0c5d4d1`. Planner re-ran: integration 410+1 (45/45, 0 failures), unit 238 (29 suites), tsc clean, vitest 36; migration `ok`. New baselines 238 / 410. **Deploy blocked until the owner adds this laptop's new IP (107.131.98.99) to the production DB firewall** — see §12. Task 6 (secret + Easy Auth exclusion) still owed. | **New card, owner request.** `POST /api/tickets/intake` with a shared secret, explicit `department` slug, required `Idempotency-Key`, channel `API`. Additive migration (51st) + one Easy Auth exclusion (Task 6, owner/deploy agent — no cost). Verified fact: `/api/tickets/inbound-email` is already the only path excluded from the login wall. |
| 1.5 Merge duplicate tickets | **ON HOLD by owner (2026-08-28)** — handoff ready, not started | `prompts/2026-08-27-1-5-merge-tickets.md` | Planner decisions (owner asked to proceed): move conversation, close source as MERGED with banner, no undo, LEAD+ for cross-requester. Additive migration (51st). Owner: build 1.4 → 1.5 → deploy 1.1–1.5 together. |
| Phase 1–3 (rest) | Queued | — | See cards below. Phase 0 remaining: 0.9 (local perf measure), 0.10 (HR merge SQL — needs owner's yes, it changes production data). |

### Decisions log

| Date | Decision | By | Effect |
|---|---|---|---|
| 2026-08-26 | No automated deploy gate; deploys only via the deploy-agent session after the planner's GREEN | owner | 0.2 closed; 0.3 script used locally, not in CI |
| 2026-08-26 | No staging environment | owner | 0.6 closed; 0.9 re-scoped to local measurement; migrations remain additive-only straight to production |
| 2026-08-26 | Virus scanner: no decision yet | owner | 0.7 deferred; hard deadline = before first real team uploads |
| 2026-08-26 | Monitoring via Application Insights (planner recommendation, not objected) | planner | 0.4 handoff written on that basis; resource creation is an Azure change for the owner/deploy agent |
| 2026-08-27 | **No new Azure spend for now** — 0.4 (Application Insights + alerts) deferred | owner | 0.4 parked with its handoff ready; anything else that creates an Azure resource waits too |
| 2026-08-27 | Card 1.2 "cancel": record a `closeReason` (confirmed / cancelled / agent / auto) on CLOSED tickets rather than adding a CANCELLED status | planner (owner unopposed) | Additive enum column; no report/status-list churn; card 1.3 auto-close reuses it |
| 2026-08-28 | Power Automate integration: build a **new dedicated intake endpoint with an explicit `department` field** (option 2 of three) rather than reusing the inbound-email webhook or waiting for full API keys | owner | New card 1.19; 1.5 put on hold to make room |
| open | Email: configure Office 365 SMTP vs stay in-app-only | owner | blocks 1.14, 1.16 and every "email the requester" feature — **and** means an intake flow must send its own acknowledgement |
| open | Retention periods (years) for closed tickets / attachments / audit | owner | 0.8 ships with the job OFF; values are config |

### Follow-ups discovered during implementation (not yet cards)

- **Operations console for the background workers** (owner, 2026-08-28). Three workers now run with no UI: the SLA breach checker, the retention job (0.8, off), and the automation scheduler (1.3, on). Nothing shows whether they are enabled, when they last ran, or lets an owner run one by hand — it is all settings-file controlled. Build an admin "Operations" page modelled on the LMS one (`learningms/apps/lms/app/admin/jobs/page.tsx`): three groups — feature switches / data in / scheduled jobs — with the jobs as one table (Job · Status · Last run · Result · Next run · Actions) plus **Run now** and an on/off toggle per row, and schedule state in a table rather than in code. Much of the plumbing exists already: `/api/health/ready` reports `slaWorker.{enabled,lastRunAt,lastRunOk}`, and `RetentionService.runOnce()` / `AutomationSchedulerService.runOnce()` are public for this purpose. Size: M. Good candidate for the next batch after the current deploy.

- **Team admins see an empty category list in the automation editors** (found in 1.4): `CategoriesService.list()` scopes TEAM_ADMIN to categories already used on their team's tickets, so on a fresh team nothing is selectable — the same scoping presumably hurts the ticket-detail category picker. Pre-existing. Decide: show all active categories to TEAM_ADMIN (recommended) or keep the scoping and seed categories per team. 30-minute fix + one integration case.
- **Web `AutomationAction` type** (`api/client.ts`) lacks the 1.4 fields; the three automation web files use a local `RuleAction` extension. Fold the fields into the shared type — 15 minutes.
- **`components/automation/ActionEditor.tsx` is orphaned** — neither automation page uses it (both have inline editors). Delete it, or make both pages use it (preferred, removes ~400 duplicated lines). Small tidy card.

- **New-automation-rule form race** (found in 1.3 manual test): on a hard load of `/automation/new`, clicking Create within ~1 s — before the team list has arrived — submits `teamId: ''` and a TEAM_ADMIN gets 403 "Only owners can create … global rules". Pre-existing. Fix: disable Create until teams are loaded, or default `teamId` to the admin's primary team. 15-minute tidy.
- **Ticket detail does not live-update on an automation close without realtime** (dev had no Web PubSub); production has it, so no action — noted so nobody chases it.

- **Queue header count does not update on realtime removal** (found in 0.8 manual test 2): `TicketsPage` shows "N open tickets" from the last fetch's `meta.total`; when a ticket is deleted (or, presumably, moves out of the filter) via realtime, the row disappears but the header count stays stale until the next fetch. Cosmetic; fold into 1.13/1.8 list work or a 30-minute tidy.

- **Essentials are gitignored (decision needed, owner).** `.gitignore` deliberately excludes files the repo depends on: `.cursorrules` (the coding conventions `CLAUDE.md` points at), `IT.pdf` (the requirements source), `create-deploy-zip.ps1` (used by `package.json` `deploy:zip` and the deploy runbook), `scripts/perf/*.mjs` (needed by card 0.9), `PROJECT_DOCUMENTATION.md`, `USER_MANUAL.md`, `DATABASE.md`, `BUGS_VERIFIED.md`, `QUALITY_ASSESSMENT_REPORT.md`. A fresh clone — or the deploy agent on another machine — has none of them. The `.gitignore` comment says the exclusion was for a public remote and "no longer applies", yet `origin` and `update` on GitHub are still public. Decide: (a) make the GitHub remotes private (ties into card 0.2), then un-ignore and commit the lot; or (b) keep them local and accept that only this machine can build/deploy. Scanned 2026-08-26: `.cursorrules`, `create-deploy-zip.ps1` and `scripts/perf/*` contain no credentials; `studio.ps1`, `migrate-to-azure-postgres.ps1` and `rollback.ps1` read secrets and must stay ignored.

- **Dead `completed` sidebar-key branches** in `apps/web/src/App.tsx` — the type union (~:190), `resolveActiveSidebarKey` (~:348) and a navigation case (~:677) still reference a sidebar item removed in the redesign. Found by the 0.1 implementer. Fold into 2.12 (enum/label cleanup) or a 15-minute tidy card.
- **`AI_PIPELINE_ENABLED` is documented in `apps/api/.env.example` but read nowhere in `src/`.** AI is on whenever `AZURE_AI_FOUNDRY_ENDPOINT` + `_API_KEY` are set. 0.5 fixes the comment; decide later whether a real kill-switch is wanted (it would be a one-line check in `ai.service.ts`).
- **`apps/api/.env.test` carries a commented-out Supabase connection string with a password.** The file is gitignored and has never been committed (verified with `git ls-files` and `git log -S`), so it is local-only. Delete the two commented lines; rotate the Supabase password if that project still exists. Owner action, 5 minutes.

---

**Pending deploy:** `prompts/2026-08-28-deploy-cards-1-1-to-1-19.md` — cards 1.1, 1.2, 1.3, 1.4, 1.19 (`d1d57bc` → `ba37e61`), two additive migrations, plus the intake endpoint's secret + Easy Auth exclusion. Blocked on the owner adding this laptop's IP to the production DB firewall (§0 of that file).

## Global constraints (apply to every item)

Copied from `CLAUDE.md` and `docs/agent-context/repo-landmines.md`. An implementer must read both before starting anything.

- **Baseline that must not regress:** 186 API unit tests, 360 integration + 1 skipped, both typechecks clean. Web unit tests are currently **33/35 with 3 failing files** (item 0.1 fixes this); after 0.1 the web baseline is 13/13 files green.
- **Migrations are additive only.** `prisma migrate dev` emits `DROP INDEX` for six trigram GIN indexes it cannot model. Hand-write migration folders, verify `grep -cE '^(DROP|ALTER TABLE .* DROP)' migration.sql` is 0, apply with `prisma migrate deploy`. Generate against `TEST_DATABASE_URL` from `apps/api/.env.test`, never against `.env` (Supabase pooler on 6543).
- **Integration runs need** `export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"`, WSL Postgres on 5433 up, ~6 minutes, redirect to a file, never edit source mid-run.
- **Kill stray node processes** before building (`EPERM` on the Prisma engine DLL).
- **Conventions** (`.cursorrules`): explicit types, no `any`, JSDoc on public methods, one export per file, kebab-case filenames, no blank lines inside functions.
- **Migrations run before the app in production** and stay safe only while additive.
- **`npm run lint` auto-fixes** — a passing lint proves nothing.
- Trust a live run over any document, including this one. When this plan is wrong, say so in the report.

---

## Phase 0 — Make it safe to change (2–3 weeks)

Nothing in Phase 1 should start until 0.1–0.5 are done. The repo's own history shows unverified changes producing phantom failures and stale docs.

### 0.1 Fix the three failing front-end test files — **Ready** · S

**What we are doing.** The web unit suite is red, so no automated check can be trusted. Make it green.

**How.**
- `apps/web/src/utils/messageBody.ts:11` calls `DOMPurify.addHook(...)` at import time. Vitest runs in Node (no `test.environment` in `apps/web/vite.config.ts`), where the `dompurify` default export is a factory without `addHook`, so `ticket-history-state.test.tsx` cannot even load. Fix: wrap the hook in `if (typeof DOMPurify.addHook === "function") { ... }` (browser behaviour unchanged) **or** add `test: { environment: "jsdom" }` to `vite.config.ts` and `jsdom` to devDependencies. Prefer the guard — smaller, and it protects any future SSR path.
- `apps/web/src/sidebar-badges.test.ts:14` expects `getSidebarBadge("completed", counts)` to be 11; `sidebar-badges.ts` only maps `triage` and the sidebar no longer has a `completed` item (`App.tsx` items: Dashboard, AI Submit, All Tickets → Assigned to Me, My Tickets, Help Center, …). Delete that test case.
- `apps/web/src/components/auth/sign-in-landing-page.test.tsx:17-19` expects "Try signing in again. If the problem continues, contact your administrator."; `SignInLandingPage.tsx:206` now says "Try again or contact your administrator." Update the assertion to the current copy.

**Depends on.** Nothing.
**Done when.** `cd apps/web && npx vitest run` → 13 files passed, 35+ tests, exit 0; documented as the new web baseline in `CLAUDE.md`.

### 0.2 A gate that blocks a deploy when checks fail — **Needs brainstorming** · S–M

**What we are doing.** Today the checks exist but nothing forces them to run before code goes live. Pick one of three ways to make "CI green" a precondition of `az webapp deploy`.

**Options (pick one).**
1. **Azure DevOps hosted agents** — request the free parallelism grant (Microsoft form, 2–3 business days) or buy one parallel job (~US$40/month). `azure-pipelines.yml` (pool `vmImage: ubuntu-latest`) then runs as written.
2. **Self-hosted Azure DevOps agent** — a small VM (B1s) or an always-on desktop registered to a pool; change `pool:` in `azure-pipelines.yml`. No purchase; you own the machine.
3. **GitHub Actions** — `.github/workflows/ci.yml` is already fixed and runs on this branch, but both GitHub remotes are **public** and `docs/security-audit-2026-08.md` describes live weaknesses. Only viable if the remotes are made private (or the docs stop being pushed there).

**Decision needed.** Which of the three; and whether prod deploys should be automated from a green run or stay manual with a "CI green on HEAD" checklist line in `docs/DEPLOYMENT.md` step 0.
**Depends on.** 0.1.
**Done when.** A commit with a failing test cannot be deployed without a human overriding a red status; runbook updated.

### 0.3 Guard against the Prisma migration trap in CI — **Ready** · S

**What we are doing.** One unedited generated migration destroys ticket and KB search performance. Make the check automatic.

**How.** Add a step to `.github/workflows/ci.yml` (`lint-build` job) and to the verify stage of `azure-pipelines.yml`: for every `apps/api/prisma/migrations/*/migration.sql` added relative to `origin/main`, run `grep -cE '^(DROP|ALTER TABLE .* DROP)'` and fail if any count is non-zero. Allow an opt-out comment `-- allow-drop: <reason>` on the first line for the rare intentional drop.
**Depends on.** 0.2 (so the check actually runs somewhere).
**Done when.** A test PR adding a migration with `DROP INDEX` fails CI with the offending line printed.

### 0.4 Monitoring and alerts — **Ready** (one small decision) · S–M

**What we are doing.** If email stops sending or the SLA worker stalls, nobody is told. Add telemetry and five alerts.

**How.**
- Add `applicationinsights` (Azure Monitor Node SDK) to `apps/api`; initialise in `apps/api/src/main.ts` before `NestFactory.create`, reading `APPLICATIONINSIGHTS_CONNECTION_STRING`; no-op when unset so dev/test are unaffected. Pino logs already carry the correlation id (`common/correlation-id.middleware.ts`) — enable App Service diagnostic settings to ship them.
- Expose the numbers the alerts need through item 0.5's readiness endpoint and as custom metrics: `NotificationOutbox` rows in `FAILED`, `PENDING` older than 10 min, SLA worker `lastRunAt` (add a field to `slas/sla-breach.service.ts`), inbound-email webhook 4xx/5xx count.
- Five Azure Monitor alerts: HTTP 5xx rate > 2 % over 5 min; outbox FAILED > 0 in 15 min; SLA worker last run > 5 min ago; inbound webhook errors > 5 in 15 min; DB connection failures > 0. Action group: email + Teams channel.
**Decision.** Application Insights vs OpenTelemetry → App Insights (you are on Azure; one SDK, one bill).
**Depends on.** 0.5 for the counts.
**Done when.** Killing SMTP in staging produces an alert email within 15 minutes.

### 0.5 Readiness endpoint that says what is actually connected — **Ready** · S

**What we are doing.** Redis, SMTP, Web PubSub, Blob storage, the scanner secret and AI are all optional env vars, and the repo does not record which are set in production. Make the app report it.

**How.** Extend `apps/api/src/app.controller.ts` with `GET /api/health/ready` (`@Public()`, no secrets in the body) returning `{ db: "ok"|"error", redis: "connected"|"disabled"|"error", smtp: "configured"|"missing", webPubSub: "configured"|"disabled", blobStorage: "azure"|"local-disk", attachmentScanner: "configured"|"bypass"|"blocked", aiPipeline: "enabled"|"disabled", slaWorker: { enabled, lastRunAt } }`. Read the same `ConfigService` keys the services already use (`NOTIFICATIONS_QUEUE_ENABLED`, `SMTP_HOST`, `AZURE_WEB_PUBSUB_CONNECTION_STRING`, `AZURE_STORAGE_CONNECTION_STRING`, `ATTACHMENT_SCAN_WEBHOOK_SECRET`, `ATTACHMENT_SCAN_BYPASS`, `AI_PIPELINE_ENABLED`, `SLA_BREACH_WORKER_ENABLED`). Then call it against production and check in a redacted inventory as `docs/azure-env-inventory.md`.
**Depends on.** Nothing.
**Done when.** `curl https://<prod>/api/health/ready` (via Kudu, since Easy Auth returns 401 on the front door) shows the real state and the inventory doc exists.

### 0.6 Staging environment — **Ready** (cost decision) · M

**What we are doing.** There is one App Service. Migrations run against production first, by hand, from a laptop. Add a staging copy.

**How.** Second App Service `TicketTicket-staging` on the same plan (or a deployment slot) + database `ticketing_staging` on the existing flexible server `csh-ticketing-db`; copy app settings with staging values; CI (0.2) deploys to staging on green using the `az webapp deploy --async` flow from `docs/DEPLOYMENT.md`; production deploy stays a manual promotion of the same zip. Migrations always run against staging first; `docs/DEPLOYMENT.md` step 2 changes accordingly. Follow `docs/azure-app-service-setup.md` Part 1 Option B for the CLI.
**Decision.** Slot (cheaper, shares the plan) vs separate App Service (cleaner isolation) — recommend separate App Service on the same plan.
**Depends on.** 0.2.
**Done when.** A deploy to staging + migration runs from CI with no laptop involved; prod runbook references staging as step 1.

### 0.7 Real virus scanning for attachments — **Needs brainstorming** · S–M

**What we are doing.** Uploads default to `PENDING` (`ticket-attachment.service.ts:584`) and downloads are blocked until a scanner posts to `POST /api/attachments/:id/scan-status` with `x-attachment-scan-secret`. No scanner exists. Choose one.

**Options.**
1. **Microsoft Defender for Storage — malware scanning** on the blob container → Event Grid → a tiny Azure Function that calls the existing callback. Requires production to be on Azure Blob (`AZURE_STORAGE_CONNECTION_STRING` set — check via 0.5). ~US$0.15/GB scanned. Cleanest.
2. **ClamAV container** (`clamav/clamav`) as a sidecar/Container App plus a small worker that polls `PENDING` attachments, streams the file to ClamAV, and posts the result. No per-GB cost; you run it.
3. **Accept the risk**: set `ATTACHMENT_SCAN_BYPASS=true`, document and get it approved. Not recommended for a healthcare org.

**Also decide.** If production is still on App Service local disk (`ATTACHMENTS_DIR=uploads`), files do not survive restarts — move to Blob first (`npm run attachments:migrate-to-azure` exists).
**Depends on.** 0.5 (to learn the current state).
**Done when.** Upload an EICAR test file in staging → `INFECTED`, download refused; a clean PDF → `CLEAN` within 2 minutes.

### 0.8 Soft delete and a retention policy — **Ready** (periods need a decision) · M

**What we are doing.** Nothing can be deleted safely and nothing is ever cleaned up. Deleting a Team silently unassigns its tickets. IT.pdf §7.4 requires a retention policy.

**How.**
- Additive migration: `deletedAt DateTime?` on `Ticket`, `Team`, `Category`, `KbArticle`, `CannedResponse`, `SavedView`; index `Ticket(deletedAt)`.
- `common/access-control.service.ts` `buildTicketAccessFilter` and `accessConditionSql` add `deletedAt IS NULL`; list/count/report queries inherit it. Detail fetch of a deleted ticket → 404 except for OWNER.
- Change `Ticket.assignedTeam` relation to `onDelete: Restrict`; team removal becomes `isActive=false` (already exists) and the UI's "delete" becomes "deactivate".
- New `RetentionService` following the `slas/sla-breach.service.ts` pattern (`setInterval` + `pg_try_advisory_xact_lock`), env `RETENTION_ENABLED=false` by default, `RETENTION_CLOSED_TICKET_YEARS`, `RETENTION_ATTACHMENT_YEARS`, `RETENTION_AUDIT_YEARS`; each run soft-deletes then hard-deletes past the window, deleting blobs via the existing best-effort delete in `ticket-attachment.service.ts`. Writes an `AdminAuditEvent` per run with counts.
**Decision needed.** The periods (HIPAA / state record-keeping rules — legal, not engineering).
**Depends on.** Nothing.
**Done when.** Integration tests prove deleted tickets are invisible to non-owners and excluded from reports; retention dry-run logs counts without deleting.

### 0.9 Re-measure performance and add a regression gate — **Ready** · S

**What we are doing.** The last measurement (Feb 2026) missed p95 targets 2.5–5×; indexes, trigram search and caching landed since; nobody re-measured.

**How.** Add `SEED_MODE=perf` to `apps/api/prisma/seed.ts` generating ~20k tickets / 200k messages; run `scripts/perf/measure.mjs`, `load.mjs`, `ui-perf.mjs` against staging; record `update/performance-findings-2026-09.md` against the targets (list p95 ≤ 400 ms, detail ≤ 300 ms). CI job `PERF-REG-01`: run `measure.mjs` against the CI Postgres with the perf seed and fail if list p95 > 800 ms (loose gate, tighten later).
**Depends on.** 0.6.
**Done when.** New findings doc exists; gate runs in CI.

### 0.10 Clean up dev data and run the pending HR merge — **Ready** · S

**What we are doing.** Production still shows `[Seed]` tickets and fake users, and the one-time `merge-hr-teams.sql` has never run.

**How.** Run `apps/api/scripts/merge-hr-teams-dryrun.sql` against production, review counts, then `merge-hr-teams.sql` inside a transaction. Write `scripts/cleanup-seed-data.sql` with a `SELECT count(*)` dry run first, deleting tickets whose subject starts `[Seed]` and users from `seed.ts` who have no real tickets. Remove any demo persona env from production.
**Depends on.** 0.8 (so removal is soft-delete, not hard).
**Done when.** No `[Seed]` rows in prod; HR teams merged; runbook notes it is done.

### 0.11 Prune stale documents — **Ready** · S

**What we are doing.** Four planning docs contradict the code and will send the next engineer the wrong way.

**How.** Add a first-line banner `> SUPERSEDED 2026-08-26 — see docs/agent-context/ and prompts/2026-08-26-restart-master-plan.md` (or delete) on: `docs/gaps-and-roadmap.md`, `docs/sprint-status.md`, `docs/slas.md`, `docs/feature-comparison.md`, `docs/zendesk-gap-implementation.md`, `docs/zendesk-gap-reduction.md`, `docs/unified-status-and-backlog-2026-02-09.md`, `docs/next-sprint-backlog-2026-02-09.md`, `sprint.md`, `ToDo Ticketing.docx`, `BUgs.txt`. Fix `README.md` "Next steps" (lists things already done). Update `PROJECT_DOCUMENTATION.md` §5 with tags, KB, CSAT, agents-admin endpoints or point it at 2.6's OpenAPI.
**Depends on.** Nothing.
**Done when.** `CLAUDE.md` "Read these first" table is the only entry point and nothing it links contradicts code.

### 0.12 Backup and restore drill — **Ready** · S

**What we are doing.** Azure Postgres has point-in-time restore by default, but nobody has written down the recovery objectives or tried a restore.

**How.** Record PITR window, RPO/RTO, blob lifecycle policy in `docs/DR.md`; restore `csh-ticketing-db` to a scratch server at a point 1 hour back; run `prisma migrate status` and a row-count sanity query against it; delete the scratch server; write the steps and timings into the doc.
**Depends on.** Nothing.
**Done when.** `docs/DR.md` exists with a dated, successful drill.

---

## Phase 1 — Agent basics: parity with Zendesk (4–6 weeks)

### 1.1 Edit a ticket's title and description — **Ready** · S

**What we are doing.** Titles and descriptions are permanent after creation. Email subjects like "Re: Re: help" become useless. Add an edit.

**How.** `PATCH /api/tickets/:id` in `apps/api/src/tickets/tickets.controller.ts` with `UpdateTicketDto { subject?: string; description?: string }` reusing the validators from `dto/create-ticket.dto.ts` (subject ≤ 200, description ≤ 5000). `TicketsService.update()` guarded by `AccessControlService.canWriteTicket`; EMPLOYEE may edit only their own ticket while `status === NEW`. Write `TicketEvent` type `TICKET_EDITED` with `{ field, from, to }`; publish realtime `ticket.changed` with `reason: 'edited'` via `ticket-realtime.service.ts`. Web: pencil icon on the header in `pages/TicketDetailPage.tsx` → inline edit; `api/client.ts` `updateTicket()`. Also route the single-ticket priority change through this endpoint instead of `bulk/priority` (`client.ts:2205`).
**Depends on.** 0.1–0.3.
**Done when.** Integration tests in `test/integration/tickets.lifecycle.spec.ts`: 403 for a different requester, 200 for the assignee, event row written, realtime event emitted; UI edit round-trips.

### 1.2 Requester can confirm, reopen — and maybe cancel — **Needs brainstorming (cancel only)** · S

**What we are doing.** `tickets.service.ts:1992` forbids every status change for the `EMPLOYEE` role. Requesters should be able to say "yes, it's fixed" and "no, it isn't".

**How (ready part).** Replace the blanket 403 in `transition()` with an allow-list for the ticket's own requester: `RESOLVED → CLOSED` (confirm) and `RESOLVED|CLOSED → REOPENED`. Everything else stays forbidden. Web: two buttons on the requester's view of a resolved ticket; add the same two links to the existing `TICKET_STATUS_CHANGED` email for `RESOLVED` in `notifications/notifications.service.ts`.
**Open question (cancel).** "I don't need this any more" while the ticket is `NEW`/`TRIAGED`: add a `CANCELLED` status (enum change, transition map, every report's status grouping) **or** reuse `CLOSED` with a new `closeReason` column (`CONFIRMED | CANCELLED | AUTO_CLOSED`). Recommend `closeReason` — additive, no enum churn, and 1.3's auto-close needs the same field.
**Depends on.** 1.1.
**Done when.** Requester confirm/reopen tested in `tickets.workflow.spec.ts`; agents' transitions unchanged; e2e `lifecycle.spec.ts` gains a requester-confirm case.

### 1.3 Timed automations (auto-close, reminders, escalate-if-idle) — **Ready** · M

**What we are doing.** Rules only react to events. Add rules that run on a clock: close N days after RESOLVED; remind the requester after N days WAITING_ON_REQUESTER; alert the lead when a ticket is unassigned for N hours; stop re-opening after K reopens.

**How.** New `automation/automation-scheduler.service.ts` modelled on `slas/sla-breach.service.ts` (`onModuleInit` → `setInterval`, `pg_try_advisory_xact_lock` so one instance runs; env `AUTOMATION_SCHEDULER_ENABLED`, `AUTOMATION_SCHEDULER_INTERVAL_MS` default 300000). Two new triggers in `rule-engine.service.ts` `AutomationTrigger`: `'TIME_IN_STATUS'` and `'UNASSIGNED_FOR'`, each with a condition `{ field: 'hours', operator: 'equals', value: N }` plus the existing status/priority conditions. Each tick selects candidates (`status`, `updatedAt`/`resolvedAt` older than N hours, `assigneeId IS NULL`) and calls `RuleEngineService.run(trigger, ticketId)`; the existing 24 h de-dupe via `AutomationExecution` prevents repeats. Extend `IsIn` lists in `automation/dto/create-automation-rule.dto.ts` and the web `components/automation/ConditionEditor.tsx`. `set_status` to `CLOSED` from a rule sets `closeReason = AUTO_CLOSED` (1.2). Seed three default rules **disabled**: auto-close 7 d, remind 3 d, unassigned 4 h.
**Depends on.** 1.2 (closeReason).
**Done when.** `automation.spec.ts` covers each trigger with a time-travelled fixture; a resolved ticket in staging closes itself after the configured window.

### 1.4 More automation actions — **Ready** · S

**What we are doing.** Rules can only assign, set priority/status, notify a lead, or add a note. Add the rest agents expect.

**How.** In `rule-engine.service.ts` action switch (from line ~398) add `add_tag` / `remove_tag` (`TagsService.attachManyToTicket` / `removeFromTicket`), `set_category`, `add_follower`, `send_email` (`NotificationsService.notifyUsers` / `notifyAddresses`, body with 1.7's placeholders), and — after 1.7 — `apply_macro`. Update `ACTION_TYPES` in `automation/dto/create-automation-rule.dto.ts` and `components/automation/ActionEditor.tsx`. Also add a per-rule flag `stopProcessing` so admins can choose "run all matching" instead of first-match.
**Depends on.** 1.3 (for the scheduler-fired rules to be useful), 1.7 for `apply_macro`.
**Done when.** Each action has a unit test in `rule-engine.service.spec.ts` and one integration case.

### 1.5 Merge duplicate tickets — **Needs brainstorming** · M

**What we are doing.** Email intake guarantees duplicates. Agents need "merge these into that one".

**Proposed design (to confirm).** `Ticket.mergedIntoId String?`; `POST /api/tickets/:id/merge { sourceIds: string[] }` for LEAD+ (or the assignee of the target); in one transaction re-point `TicketMessage`, `Attachment`, `TicketFollower`, `TicketTag` rows from each source to the target, mark the source `CLOSED` with `closeReason = MERGED`, write `TICKET_MERGED` events on both sides, keep the **target's** SLA, and send the source requester one email "your request was merged into IT-0042". List views hide merged sources by default (`mergedIntoId IS NULL`). No undo (document it).
**Open questions.** Move vs copy messages (move recommended — one thread of truth). Who may merge. Whether requesters of *different* people can be merged (recommend no — same requester only, or LEAD override).
**Depends on.** 1.2 (closeReason), 1.6 (a "duplicate-of" link is the lightweight alternative when merge is inappropriate).
**Done when.** Merge in staging leaves one ticket with all messages, source shows a banner and link, reports count one ticket.

### 1.6 Link related tickets — **Ready** · M

**What we are doing.** No way to say "these two are related" or "this is the parent". Needed before problem/major-incident handling.

**How.** Model `TicketLink { id, fromTicketId, toTicketId, type: RELATED | DUPLICATE_OF | PARENT_OF, createdById, createdAt }` with `@@unique([fromTicketId, toTicketId, type])`, cascade on ticket delete. `POST /api/tickets/:id/links { toTicketId, type }`, `DELETE /api/tickets/:id/links/:linkId`; include links in `getById`. Event `TICKET_LINKED` / `TICKET_UNLINKED`. Web: "Linked tickets" section in `components/ticket-detail/TicketSidebar.tsx` with search-to-link reusing the command palette's ticket search (`api/client.ts` `searchAll`). Access: both tickets must be visible to the actor.
**Depends on.** 1.1 pattern.
**Done when.** Links survive on both tickets, show in the timeline, and a parent's detail lists its children.

### 1.7 Macros: canned responses with actions and placeholders — **Ready** · M

**What we are doing.** Canned responses are plain text. Make them do things (set status, add tag, assign) and fill in names automatically.

**How.** Additive migration: `CannedResponse.actions Json @default("[]")` using the same action shape as automation (validated by the same DTO class). New `POST /api/canned-responses/:id/render?ticketId=` that substitutes `{{requester.firstName}}`, `{{requester.displayName}}`, `{{ticket.displayId}}`, `{{ticket.subject}}`, `{{agent.firstName}}`, `{{team.name}}` server-side and returns text + actions. `components/CannedResponsePicker.tsx` inserts the rendered text; on send, `TicketDetailPage` posts the message then calls a new `POST /api/tickets/:id/apply-actions` (transactional, reusing `RuleEngineService`'s action executor). Admin UI for actions in the canned-response editor.
**Depends on.** 1.4 (shared action executor).
**Done when.** A "Password reset done" macro pastes a personalised reply, sets RESOLVED and adds tag `password` in one click.

### 1.8 Requester history panel — **Ready** · S

**What we are doing.** Agents cannot see what else this person has asked. It is the first thing they check before replying.

**How.** UI only. In `components/ticket-detail/TicketSidebar.tsx` add "Other tickets from this requester": call the existing `GET /api/tickets?requesterIds=<id>&statusGroup=all&pageSize=5&sort=updatedAt&order=desc` (already supported by `dto/list-tickets.dto.ts`; the access filter automatically limits it to what the agent may see). Show display ID, subject, status pill, relative time; open in a new tab. Collapsible, remembers state like the existing sections.
**Depends on.** Nothing.
**Done when.** Visible on every ticket for AGENT+; hidden for EMPLOYEE; one query, cached by React Query.

### 1.9 "Someone is already on this" warning — **Ready** · S

**What we are doing.** Two agents answering the same requester is the classic embarrassment. Show who is viewing.

**How.** Copy the typing plumbing: `POST /api/tickets/:id/viewing { isViewing }` (DTO cloned from `tickets/dto/ticket-typing.dto.ts`), `RealtimeService` event `ticket.viewing` to the same audience as `ticket.typing` (`ticket-realtime.service.ts`); `TicketDetailPage` sends `true` on mount, heartbeat every 30 s, `false` on unmount/tab hide; client keeps a map with 45 s expiry; banner under the header "Maria Chen is viewing this ticket" and a stronger one when they are typing. Works only when Web PubSub is configured (0.5 tells you).
**Depends on.** 0.5.
**Done when.** e2e in `e2e/realtime-chat.spec.ts` shows the banner to agent B when agent A opens the ticket.

### 1.10 Snooze / follow-up date — **Ready** · S

**What we are doing.** "Remind me Friday" — WAITING_ON_VENDOR tickets rely on memory today.

**How.** Additive: `Ticket.followUpAt DateTime?` + index. Set via 1.1's `PATCH`. The scheduler (1.3) fires an in-app notification `FOLLOW_UP_DUE` (new `NotificationType` value) to the assignee when due and clears the field. Sidebar row with a date picker; saved-view preset "Follow-ups due today"; list column/badge when overdue.
**Depends on.** 1.1, 1.3.
**Done when.** Setting a follow-up 1 minute ahead in staging produces the bell notification.

### 1.11 Remove or redact a message within a grace window — **Ready** · S

**What we are doing.** PHI pasted into the wrong ticket must be removable, with a record that it happened.

**How.** Additive: `TicketMessage.redactedAt DateTime?`, `redactedById String?`. `DELETE /api/tickets/:id/messages/:messageId` allowed for the author within `MESSAGE_REDACT_WINDOW_MIN` (default 15) or LEAD+ at any time. Body becomes `[message removed by <name>]`; the original is stored in a `TicketEvent` `MESSAGE_REDACTED` payload visible only to OWNER in the audit log. Realtime `ticket.changed`. Web: trash icon on own messages inside the window.
**Depends on.** Nothing.
**Done when.** Integration test: author can redact at 5 min, cannot at 20 min, LEAD can; audit shows it.

### 1.12 Bulk add/remove tag and bulk macro — **Ready** · S

**What we are doing.** The bulk toolbar stops at assign/transfer/status/priority.

**How.** `POST /api/tickets/bulk/tags { ticketIds, add: string[], remove: string[] }` using `TagsService.attachManyToTicket` / `removeFromTicket`, `@ArrayMaxSize` like the other bulk DTOs in `tickets/dto/bulk-*.dto.ts`; `POST /api/tickets/bulk/macro { ticketIds, cannedResponseId }` after 1.7. Buttons in `components/BulkActionsToolbar.tsx` with the same optimistic/rollback pattern.
**Depends on.** 1.7 for macro.
**Done when.** e2e `sprint3.spec.ts` bulk test extended with tags.

### 1.13 CSV export for the ticket list and every report — **Ready** · S

**What we are doing.** Excel is the real BI tool. The Export button today is a picture.

**How.** `GET /api/tickets/export.csv` accepting `ListTicketsDto` (same access filter as the list), streamed with the async-generator pattern already used by `audit/audit.service.ts:116` `exportCsv`; cap 50k rows, `Content-Disposition` filename with date. `GET /api/reports/:report/export.csv` for the tabular reports (team-summary, agent-performance, sla-breaches, tickets-by-*). Web: toolbar button on `pages/TicketsPage.tsx`; wire the `export` tab in `pages/ReportsPage.tsx` and delete the fake share link (`ReportsPage.tsx:1354`).
**Depends on.** Nothing.
**Done when.** Filtered export opens in Excel with the visible columns; the fake link is gone.

### 1.14 Satisfaction survey email — **Ready** · S

**What we are doing.** The rating widget exists; nobody is sent to it.

**How.** In `TicketsService.transition()` when `newStatus === RESOLVED`, queue email `CSAT_REQUEST` to the requester with five links `${WEB_APP_URL}/tickets/:id?csat=1..5` (`components/ticket-detail/CsatWidget.tsx` reads the query param and pre-fills). The scheduler (1.3) sends one reminder after 3 days if no `CSAT_SUBMITTED` event exists. A rating ≤ 2 notifies team leads (reuse the lead lookup in `slas/sla-breach.service.ts:670`) by email + in-app. `Team.csatEnabled Boolean @default(true)` to opt a team out.
**Depends on.** 1.3 for the reminder (the send itself has no dependency).
**Done when.** Resolving a ticket in staging emails the requester; clicking 5 records a CSAT event; the CSAT report moves.

### 1.15 Notification preferences — **Ready** · S

**What we are doing.** Email fatigue makes people ignore the alerts that matter. Let each person choose.

**How.** Model `NotificationPreference { userId, eventType, email Boolean @default(true), inApp Boolean @default(true) }` unique per (user, event). `GET/PUT /api/notifications/preferences`. `NotificationsService.buildRecipients` (`notifications.service.ts:403`) and `InAppNotificationsService` filter by preference; SLA breach and mentions are not mutable (always on). Web: "Notifications" page under the avatar menu with a checkbox grid. Quiet hours deferred (needs 1.3 + timezone).
**Depends on.** Nothing.
**Done when.** Turning off "new message" email stops that email and nothing else.

### 1.16 Daily digest for leads — **Ready** · S

**What we are doing.** Leads read email, not dashboards. One morning summary per team.

**How.** Scheduler (1.3) job at 07:00 in the team's timezone (`SlaBusinessHoursSetting.timezone`, falling back to global): for each team with `TeamMember.role = LEAD`, email new / unassigned / at-risk / breached / waiting-on-requester > 3 days counts with links to the pre-filtered list. Template in `notifications.service.ts`; opt-in through 1.15 (`eventType = 'DAILY_DIGEST'`).
**Depends on.** 1.3, 1.15.
**Done when.** A lead in staging receives it; counts match the queue.

### 1.17 Missing desk metrics — **Ready** · S

**What we are doing.** Standard KPIs absent from the 22 report endpoints: first-contact resolution, reassignment count, time in each status.

**How.** `reports/reports.service.ts`: FCR = resolved tickets with ≤ 1 public agent `TicketMessage`; reassignments = count of `TicketEvent.type = 'TICKET_ASSIGNED'` per ticket; time-in-status from consecutive status-change events. Three endpoints, scoped by the existing `scopeReportQuery`; cards on the Agents and Backlog tabs.
**Depends on.** Nothing.
**Done when.** `reports.spec.ts` covers each with fixtures.

### 1.18 Draft autosave — **Verify, probably done** · S

**What we are doing.** `apps/web/src/utils/messageDraft.ts` already stores the composer text per ticket in `localStorage`. Confirm it also preserves inline images and the public/internal toggle; if it does, close this item.
**Depends on.** Nothing.
**Done when.** Manual test: type, paste an image, switch to internal, reload — all three survive.

---

## Phase 2 — Management and Microsoft integration (6–8 weeks)

### 2.1 Load-balanced assignment — **Ready** · S

**What we are doing.** Round-robin ignores that one agent has 40 open tickets and another has 4.

**How.** Add `LEAST_LOADED` to `TeamAssignmentStrategy` (enum additions are additive in Postgres). In `tickets.service.ts` near line 2854 pick the active, available (2.2) member with the fewest open tickets; tie-break by round-robin pointer. Team settings dropdown in `pages/TeamPage.tsx`.
**Depends on.** 2.2.
**Done when.** `tickets.assignment.spec.ts` shows the least-loaded agent is chosen.

### 2.2 Agent availability / out of office — **Ready** · S

**What we are doing.** Auto-assignment sends tickets to people on leave.

**How.** Additive: `User.isAvailable Boolean @default(true)`, `awayUntil DateTime?`. Toggle in the avatar menu; round-robin and least-loaded skip unavailable members; when going away, offer "reassign my N open tickets to the queue" (bulk unassign, already exists). Scheduler (1.3) flips `isAvailable` back at `awayUntil`.
**Depends on.** 1.3.
**Done when.** An unavailable agent never receives an auto-assignment.

### 2.3 Skills-based and on-call routing — **Needs brainstorming** · L

**What we are doing.** IT.pdf §6.4 asks for skill and on-call strategies. SEV1 at night needs a named human.

**Open questions.** Is "skill" just the category list (simplest: `TeamMember.categoryIds[]`) or a separate taxonomy? Where does the on-call schedule live — a manual table with weekly rotation, an Entra/Outlook shared calendar via Graph, or an external pager tool? Does on-call apply only outside the team's business hours (the calendar already exists in `SlaBusinessHoursSetting`)?
**Depends on.** 2.1, 2.2.

### 2.4 Microsoft Teams integration — **Needs brainstorming** · L

**What we are doing.** You are a Microsoft shop; Teams replaces most email — notifications as cards, act from Teams, and a Graph mailbox subscription to feed inbound email.

**Options, in increasing effort.**
1. **Incoming webhook per team channel** — one-way adaptive cards for assigned / at-risk / breached (1–2 days; add `teamsWebhookUrl` on `Team`, send from `NotificationsService`).
2. **Teams bot (Bot Framework / Azure Bot)** — assign, reply, change status from the card; requires an app registration, bot channel, and a public callback endpoint with signature validation (2–3 weeks).
3. **Graph change notifications on a shared mailbox** → `POST /api/tickets/inbound-email` — this *is* the missing inbound-email provider adapter (`EMAIL-01`). Requires `Mail.Read` application permission and admin consent; store the subscription renewal in the scheduler (1.3).
**Decision needed.** Which tier, which channels/mailbox, who grants admin consent.
**Depends on.** 0.5, 1.3.

### 2.5 Entra group → team membership sync — **Needs brainstorming** · M

**What we are doing.** Team membership is hand-maintained; users are created on first login only.

**Open questions.** Which Entra groups map to which teams and roles; nightly Graph sync vs on-login claims; who is the source of truth when they disagree; what happens to tickets of someone removed from a group (2.2's away flow?).
**Depends on.** 2.4's app registration (same one).

### 2.6 Public API: keys, outbound webhooks, OpenAPI docs — **Ready** (webhook contract needs brainstorming) · M

**What we are doing.** Every integration after Teams needs a documented API, service credentials, and a way to be told when things change.

**How.** `@nestjs/swagger` decorators on DTOs/controllers, served at `/api/docs` for OWNER only (replaces the lagging §5 of `PROJECT_DOCUMENTATION.md`). `ApiKey { id, name, hashedKey, serviceUserId, teamScope, lastUsedAt, revokedAt }`; `x-api-key` header resolved in `auth/auth.guard.ts` to a service `User` with `role = AGENT` and team scope. `WebhookSubscription { url, secret, events[], isActive }` with delivery through a new outbox table modelled on `NotificationOutbox` (HMAC-SHA256 signature header, 5 retries with backoff, dead state).
**Open question.** Event payload shape and versioning (`ticket.created`, `ticket.status_changed`, `message.added`…), and whether to include message bodies (PHI) or IDs only — recommend IDs only.
**Depends on.** Nothing.
**Done when.** A sample consumer receives signed events; docs render.

### 2.7 Announcements / outage banner — **Ready** · S

**What we are doing.** "VPN is down, don't file tickets" saves real volume during incidents.

**How.** Model `Announcement { id, title, body, severity: INFO|WARNING|OUTAGE, startsAt, endsAt, audience: ALL|TEAM, teamId?, linkedTicketId?, createdById }`; OWNER / TEAM_ADMIN CRUD under `/admin`; `GET /api/announcements/active` (`@Public()` is not needed — any signed-in user). Banner in the app shell and on `/submit`; dismiss stored per user in `localStorage`; linked ticket lets 1.6 attach duplicates as children.
**Depends on.** 1.6 optional.
**Done when.** An OUTAGE announcement shows on every page until `endsAt`.

### 2.8 Executive summary and AI ROI — **Ready** · M

**What we are doing.** Leadership has no page of its own; the AI observability tables already hold the ROI story but nobody sees it.

**How.** New Reports tab "Executive" (LEAD+): volume trend, SLA %, CSAT, backlog age, per department; KB deflection = intake sessions where `suggestedArticles` were shown and no ticket followed (log this in `ai.service.ts` `classifyAndCreateTicket`); auto-routed %, accuracy vs corrections from `RoutingDecisionLog` / `CorrectionLog` via the existing `reports/ai-accuracy.service.ts`; human-triage hours saved = auto-routed count × configurable minutes. Export via 1.13.
**Depends on.** 1.13.
**Done when.** One page answers "is the AI paying for itself" with numbers that reconcile to the raw tables.

### 2.9 KPI ownership cleanup — **Needs brainstorming** · M

**What we are doing.** Dashboard, Manager Views and Reports overlap ~70 % and disagree (UX review Theme 4). Decide who owns which number.

**Proposed.** Dashboard = personal (mine, mentions, my SLA risk). Manager Views = team-strategic (by team, by agent, trends). Reports = analyst (filterable, exportable). Strip duplicates from the page that does not own them; fix the dashboard date range so all cards respect it.
**Depends on.** 2.8.

### 2.10 AI suggested reply and thread summary — **Needs brainstorming** · M

**What we are doing.** The pipeline, prompts, redaction and accuracy scoring exist. The highest-leverage next AI step is drafting a reply and summarising long threads for the agent.

**Open questions.** PHI: for `Team.isSensitive` departments, redact before the model call (reuse `isSensitiveDepartment` in `ai.service.ts`) or skip entirely? Cost cap per ticket per day; where the draft appears (composer pre-fill vs side panel); mandatory human edit before send; logging to `AiInferenceLog` with `redacted = true`. New prompts under `src/ai/prompts/`, new steps in `FoundryClientService`.
**Depends on.** 0.4 (cost telemetry).

### 2.11 Similar-ticket suggestions — **Ready** · S

**What we are doing.** Reuse past resolutions; surface candidates for the KB.

**How.** The trigram GIN index on `Ticket.subject` already exists. `GET /api/tickets/:id/similar` → `SELECT … WHERE <access filter> AND status IN (RESOLVED, CLOSED) ORDER BY similarity(subject, $1) DESC LIMIT 5` using `accessConditionSql`. Sidebar section under 1.8's panel; "Create KB article from this" button opens the editor pre-filled.
**Depends on.** 1.8 layout.
**Done when.** Five relevant resolved tickets show for a typical subject in staging.

### 2.12 Human IDs in URLs — **Ready** · S

**What we are doing.** `/tickets/7fe5d219-…` is unrecognisable in Teams and email; `IT-0042` already exists as `displayId`.

**How.** Route `/tickets/:idOrDisplayId`; in `TicketsService.getById` (line ~818) resolve by `displayId` when the param is not a UUID; every link builder (`utils/format.ts`, `notifications.service.ts` `ticketLink`, command palette, tab bar) uses `displayId`; old UUID links keep working. Same for teams in `?teamIds=` → slugs. Add an enum-to-label map (`utils/statusColors.ts` neighbour) so `IN_PROGRESS` never reaches the screen (UX review Theme 2).
**Depends on.** Nothing.
**Done when.** Copy-link produces `/tickets/IT-0042` and it opens.

### 2.13 Status model refactor — **Needs brainstorming** · L

**What we are doing.** Nine statuses mix lifecycle, waiting-reason and a "reopened" marker (UX review Theme 1). Split into 5–6 lifecycle states + `waitingReason` + `reopenCount`.

**Why it is last in Phase 2.** It touches the state machine, SLA pause logic, automation conditions, triage columns, every report's status grouping, and the transition map env override. Do it only once Phase 1 is stable, with a migration that maps old → new and a compatibility view for reports.
**Depends on.** All of Phase 1.

---

## Phase 3 — Service-management depth: decide, don't drift

### 3.1 Approvals — **Needs brainstorming** · L
Manager sign-off before HR/IT acts (access, equipment, leave). Questions: which categories require it, who approves (requester's manager from Graph `manager` field, or a named approver per category), what happens on timeout, does the SLA pause while awaiting approval.

### 3.2 Service catalog-lite / request types — **Needs brainstorming** · L
Turn "category + custom fields" into a guided menu: request type → form → owner team → SLA → approval. Questions: is a request type just a category with a form layout and guidance text (recommended), or a new entity; do requesters see the whole catalog or only their department's.

### 3.3 Problem and major-incident handling — **Needs brainstorming** · M
On top of 1.6 (links) and 2.7 (banner): a `PARENT_OF` ticket flagged `isMajorIncident` closes its children when resolved and posts one update to all child requesters. Questions: who may declare one; do children keep their own SLA.

### 3.4 Field-level PHI masking — **Needs brainstorming** · M
`CustomField.isSensitive` → value visible only to the owning team and OWNER; masked in list, export, realtime payloads and audit. Questions: which fields, whether messages need the same (probably yes for Medicaid Pending), audit of un-masking.

### 3.5 Attachment download audit — **Ready** · S
In `tickets/attachments.controller.ts` `GET :id` write `TicketEvent` type `ATTACHMENT_DOWNLOADED { attachmentId, fileName }`; add to the audit log filter chips. IT.pdf §6.8.

### 3.6 Knowledge base: feedback, ownership, versioning — **Ready for feedback; versioning needs brainstorming** · M
Ready: `KbArticleFeedback { articleId, userId?, helpful Boolean, comment? }`, thumbs on `pages/KbArticlePage.tsx`, "least helpful" list in `pages/KbAdminPage.tsx`; `KbArticle.ownerId`, `reviewDueAt` with a scheduler reminder (1.3). Brainstorm: versioning/approval (draft → review → publish with diff) — who reviews, is it needed for internal articles.

### 3.7 Mobile card layouts — **Ready** · M
`components/TicketTableView.tsx` card variant below 768 px (one card per ticket: ID, subject, status, SLA, assignee); ticket detail stacks the sidebar below the conversation; bulk toolbar becomes a bottom sheet. Also unblocks the deferred accessibility row refactor (3.8).

### 3.8 Remaining accessibility items — **Ready** · S–M
From `docs/accessibility-audit-2026-08.md`: queue row `aria-allowed-attr` / `nested-interactive` (structural refactor of the row component — do together with 3.7), focus retained on invalid input, intake textarea tab order, live-region announcements for list updates.

### 3.9 Print / PDF of a ticket — **Ready** · S
Print stylesheet for `TicketDetailPage` (hide shell, expand conversation) + "Print" in the header menu; PDF later via the browser's print-to-PDF — no server work.

### 3.10 External CC / vendor participants — **Needs brainstorming** · M
An email address on a ticket that receives public replies and whose replies thread back in (the inbound path already threads by reply token). Questions: PHI exposure to vendors, who may add a CC, whether vendors see attachments.

### 3.11 Time tracking — **Needs brainstorming** · M
Minutes per ticket per agent (`TimeEntry`), optional timer in the composer, totals in reports. Questions: is it wanted at all (agents dislike it), mandatory vs optional, chargeback use.

---

## Order of execution (the queue)

0.1 → 0.5 → 0.2 → 0.3 → 0.4 → 0.6 → 0.7 → 0.8 → 0.9 → 0.10 → 0.11 → 0.12 →
1.1 → 1.2 → 1.3 → 1.4 → 1.8 → 1.13 → 1.14 → 1.15 → 1.10 → 1.9 → 1.11 → 1.6 → 1.7 → 1.12 → 1.5 → 1.16 → 1.17 → 1.18 →
2.2 → 2.1 → 2.12 → 2.7 → 2.11 → 2.6 → 2.8 → 2.4 → 2.5 → 2.3 → 2.10 → 2.9 → 2.13 →
Phase 3 as decided.

Items needing a decision before a prompt can be written (19): 0.2, 0.7, 0.8 (retention years), 1.2 (cancel), 1.5, 2.3, 2.4, 2.5, 2.6 (webhook contract), 2.9, 2.10, 2.13, 3.1, 3.2, 3.3, 3.4, 3.6 (versioning), 3.10, 3.11. Only 0.2, 0.7 and 0.8 block Phase 0. The other 34 items can be written up as implementation prompts today; 1.18 is a verify-and-close.

## What this plan deliberately leaves out

Change management / CAB, a CMDB, a full service catalog, phone/SMS channels, multi-language UI, multi-tenancy, and a second AI pipeline. The original `IT.pdf` scoped the first five out; the last two would duplicate what exists. Revisit only when a named team asks.
