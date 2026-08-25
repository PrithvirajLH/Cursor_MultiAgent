# Implementation Prompt — Azure Pipeline (CI, migrations, deploy)

**Date:** 2026-08-25
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Closes:** the gap between 546 passing tests and what actually ships.

---

## 1. Goal

Make the thing that deploys be the thing that passed. Today `create-deploy-zip.ps1` builds a zip from a laptop and `Invoke-RestMethod` POSTs it to Kudu — with **no test, lint or migration step anywhere in that path**.

Three phases, each independently shippable. **Phase 1 alone is most of the value and carries no deployment risk.** Do not start phase 3 until phase 1 has run green on real pushes.

---

## 2. Facts established first

| Fact | Consequence |
|---|---|
| Remote is **Azure DevOps** (`dev.azure.com/PHulgur/TicketTicket`) | Azure Pipelines is the native fit; `.github/workflows/ci.yml` will never run |
| `.github/workflows/ci.yml` is now committed and specifies 4 jobs at Node 22 | it is a **specification to port**, not a working pipeline |
| **The committed CI spec would fail on its first run** — see below | port it *and fix it*; do not transcribe the bug |
| Deploy target: RG `csnhc-ai`, app `TicketTicket`, `southcentralus` | matches the RG that `learningms` already deploys into |
| `create-deploy-zip.ps1` builds both apps, installs prod-only deps, runs `prisma generate`, and bundles the SPA into `public/` so the API serves it same-origin | the packaging logic is sound — port it, do not redesign it |
| Neither deploy script runs a single test (`grep -niE 'test\|jest\|lint'` matches only `Test-Path`) | this is the whole problem |
| `app12.zip` is hand-versioned; no commit SHA in the artifact | "what is in production?" is currently unanswerable |

### The bug in the committed CI spec

`.github/workflows/ci.yml` creates `apps/api/.env.test` with:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres?schema=public
TEST_DB_RESET_STRATEGY=migrate
```

`scripts/reset-test-db.cjs` refuses any target whose **database name or schema** does not match `/(^|[-_])(test|tests|testing|ci|spec)([-_]|$)/`, unless `TEST_DB_RESET_ACK_HOST` exactly matches the host. Database `postgres`, schema `public`, and no ack variable — **it throws, and every integration suite fails in `beforeAll`.**

Nobody found this because the workflow has never executed.

**Fix it properly rather than bypassing it:** set the service container's `POSTGRES_DB: ticketing_test` and point the URL at that database. The safety heuristic then passes on its own merits. Do **not** reach for `TEST_DB_RESET_ACK_HOST` — that switch exists to acknowledge a managed database that cannot be renamed, not to silence a guard you could satisfy honestly.

### What `learningms` already proves, and where it falls short

`learningms/azure-pipelines.yml` deploys to the **same resource group** via `AzureWebApp@1` and a service connection (`CSNHC-AI-LMS-Deploy`). That is the pattern to copy for phase 3, and it removes the publishing-profile credentials and the interactive Azure login entirely.

Two things **not** to copy:

- **It runs no tests.** Neither its pipeline nor its GitHub workflow. Copying it wholesale reproduces the exact gap this work exists to close.
- Its migration history is broken by its own account: `_prisma_migrations` was never populated, so a future `migrate deploy` there would try to re-apply everything. Its own docs say to run migrations from CI and baseline first.

### Verified against Azure (2026-08-25, `az` CLI, subscription `creativesnhc`)

The corporate-network question is **answered: it does not apply here.**

| Verified fact | Consequence |
|---|---|
| Production DB is **`csh-ticketing-db.postgres.database.azure.com:5432/ticketing`** — Azure Database for PostgreSQL 16, Burstable | the Supabase URL in the laptop `.env` is a **dev** database, not production |
| `DATABASE_URL` and `DIRECT_URL` in App Service are **identical**, both port 5432 | no pooler in production; migrations can use either |
| Firewall has **`AllowAllAzureServices` (0.0.0.0)** plus one allowlisted dev laptop | a Microsoft-hosted pipeline agent **can reach the database**. Migrations from the pipeline will work. |
| App Service `TicketTicket`: Linux, **NODE 22-lts**, `alwaysOn=true`, startup `node dist/src/main.js` | matches the committed CI spec's Node 22; startup already correct |
| **Last deployment: 2026-05-28** | production is ~3 months stale; everything from the last two days is undeployed |
| `AI_INLINE_PROMPTS` is **not set** in App Service | the new default (`true`) applies on deploy — the grounding fix goes live |
| `AI_CONFIDENCE_THRESHOLD=0.75`, `AI_SENSITIVE_DEPT_THRESHOLD=0.85` | exactly the code defaults, so those going live changes no behaviour |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` and `ENABLE_ORYX_BUILD` are **not set** | Oryx defaults apply while the zip already ships `node_modules` — set both `false` |
| `httpsOnly` is **not enabled** | separate finding, not this work, but worth raising |
| `TicketingSystem` is a **dormant predecessor** — last deploy Dec 2025, no `DATABASE_URL` | do not touch it; `TicketTicket` is production |

The TLS-interception problem `learningms` documented was on the **laptop's** outbound path to Azure SQL. A hosted agent does not sit behind that firewall, and this server explicitly allows Azure services.

## 3. Decisions and assumptions

1. **Three phases, shipped separately.** CI, then migrations, then deploy. Each is useful alone, and phase 1 cannot break production because it does not touch it.
2. **The manual deploy path stays working until phase 3 is trusted.** Do not delete `create-deploy-zip.ps1` or `deploy-to-azure.ps1`. Two working paths beats one half-migrated one.
3. **Migrations run from the pipeline, not a laptop.** This gates them, orders them, logs them, and — if the firewall does bite — sidesteps it. They run **before** the app swaps, against the direct connection, never the pooler.
4. **The artifact is stamped with the commit SHA.** Non-negotiable. Without it nobody can answer what is running.
5. **Tests gate the build.** A red suite produces no artifact. That is the entire point.
6. **Node 22**, matching the committed spec.
7. **No e2e in the gating path initially.** E2E needs a running app and a browser; it is the slowest and flakiest stage. Add it once the rest is stable, or run it nightly.

---

## 4. The work

### Phase 1 — CI only (no deployment)

`azure-pipelines.yml` at the repo root, triggering on pushes to the working branch and `main`.

**Stage `verify`:**
- `NodeTool@0` at 22.x
- `npm ci` (not `npm install` — reproducible)
- `npm run lint`
- `npm run -w apps/api test -- --runInBand` — expect **186**
- `npm run -w apps/web test`
- `npm run build`

**Stage `integration`** — needs Postgres and Redis service containers:
- `postgres:16` with **`POSTGRES_DB: ticketing_test`** (see the bug above), `redis:7`
- Write `apps/api/.env.test` pointing at `ticketing_test`, otherwise copying the committed spec's values
- `npm run -w apps/api test:integration` — expect **360 passing, 1 skipped**

Azure Pipelines expresses service containers differently from GitHub Actions — use `resources.containers` plus a `services:` mapping on the job, not GitHub's `services:` block. This is the main porting friction; budget for it.

**Verify on first run:** whether `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` is needed. Prisma requires it when it detects an AI agent; a hosted CI agent should not trip that. If the reset fails asking for consent, set it in the pipeline with a value naming CI as the actor.

**Stage 1 is done when a push produces a green pipeline and a deliberately broken test produces a red one.** Prove the second — a gate never seen to fail is not known to work.

### Phase 2 — Migrations

A `migrate` stage that runs **after `verify` and `integration` pass** and **before** any deploy:

```
npx prisma migrate deploy
```

against `DIRECT_URL` (port 5432, the direct connection — **never** the pgBouncer pooler on 6543, which cannot run migrations).

- The connection string comes from a pipeline **secret variable** or variable group, never the repo.
- Run `prisma migrate status` first and log it, so the run records what it is about to apply.
- Two migrations are currently pending outside the local test DB: `20260824211443_ai_observability_and_department_confidence` and `20260825120000_per_department_business_hours`.
- **`scripts/merge-hr-teams.sql` is a one-time data migration, not part of this stage.** Run it manually, once, after its dry run. Do not automate a one-off.

### Phase 3 — Deploy

Port `create-deploy-zip.ps1` into pipeline steps — same logic, hosted agent:

1. Build API and web
2. Assemble the deploy folder: `dist/`, `prisma/`, `package.json`, web `dist` → `public/`
3. `npm install --omit=dev` and `npx prisma generate` inside it
4. Write the commit SHA into the package (a `BUILD_INFO` file or a `version` field)
5. `ArchiveFiles@2`
6. `AzureWebApp@1` with a service connection scoped to `csnhc-ai`, `appType: webAppLinux`, `appName: TicketTicket`, startup command `node dist/src/main.js`

**One-time setup outside the pipeline** (document it in the file header, as `learningms` does):
- An Azure Resource Manager service connection scoped to `csnhc-ai` — needs someone with permissions in that resource group, which may be a person-dependency rather than a technical one
- On the App Service: `SCM_DO_BUILD_DURING_DEPLOYMENT=false` and `ENABLE_ORYX_BUILD=false`, because the package already contains `node_modules` and Oryx rebuilding it would be wrong. Your own script's troubleshooting notes suggest this has bitten before.

---

## 5. Files expected to change

```
azure-pipelines.yml        (new — the deliverable)
.github/workflows/ci.yml   (fix the ticketing_test bug, so the spec stops being wrong)
```

Application source should not change. `create-deploy-zip.ps1` and `deploy-to-azure.ps1` stay untouched until phase 3 is trusted in production.

## 6. Security considerations

- **No connection string, publishing profile or key in `azure-pipelines.yml`.** Secret variables or a variable group, marked secret so they are masked in logs.
- The service connection replaces the publishing-profile Basic auth in the PowerShell script — that is a security improvement, not just a convenience one.
- Migrations use `DIRECT_URL`, which is a privileged credential. It belongs only to the `migrate` stage, not the whole pipeline.
- The `.env.test` written in CI contains deliberately fake values (`ci-inbound-secret` and similar). Keep them obviously fake so nobody mistakes one for real.
- Phase 3 gives the pipeline deploy rights to a production App Service. Scope the service connection to the single resource group, not the subscription.

## 7. Acceptance criteria

1. `azure-pipelines.yml` exists and a push to the branch triggers it.
2. `verify` runs lint, build, **186** unit tests and the web tests; a deliberately broken test turns it red — **demonstrate this, do not assume it**.
3. `integration` runs against service containers and reports **360 passing, 1 skipped**.
4. The `ticketing_test` database-name fix is applied in both the pipeline and the committed GitHub spec.
5. A red suite produces **no artifact**.
6. (Phase 2) `migrate` runs after the test stages, against `DIRECT_URL`, and logs `migrate status` before applying.
7. (Phase 3) A deployed build carries its commit SHA, and the manual scripts still work.
8. No secret appears in any log or in the YAML.

## 8. Checks to run

Locally, before pushing anything:

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
cd apps/api && npx jest                       # 186
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
cd apps/api && npm run test:integration       # 360 + 1 skipped
```

Then in Azure DevOps: push, watch the run, and read the logs even when it is green — a stage that silently skipped is not a stage that passed.

## 9. Manual test steps

1. Push a trivial change. Confirm the pipeline triggers and goes green.
2. Break one assertion deliberately, push, confirm red and that no artifact was produced. Revert.
3. Confirm the integration stage actually reset the database — the log should show the migration reset, not a skipped step.
4. (Phase 2) Run `migrate status` against production **before** the first automated migrate, and keep the output. That is your rollback reference.
5. (Phase 3) Deploy once, then confirm the running app reports the expected commit SHA.

## 10. Out of scope

E2E in the gating path · load tests · email intake · the HR data migration (manual, one-time) · deleting the PowerShell scripts · Key Vault.

## 11. Handoff notes

Environment briefing is in project memory (`atm-repo-landmines`): WSL Postgres on 5433, the `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` requirement locally, the Prisma migration drift trap (**every generated migration must be hand-checked to zero `DROP` statements**), and the rule about not editing source while an integration suite runs.

`e2e/` is now un-ignored but **not yet committed** — the accessibility spec in it was mid-edit. Commit it before adding any e2e stage.

Baseline: **186 unit, 360 integration + 1 skipped**, both typechecks clean.

Reference implementation for phase 3: `C:\Users\PHulgur\Downloads\learningms\azure-pipelines.yml`. Copy its deploy shape; do not copy its absence of tests.
