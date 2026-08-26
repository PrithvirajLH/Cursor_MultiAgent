# Implementation Prompt — 0.4 Monitoring and alerts

**Date:** 2026-08-26
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 0.4 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** if email stops sending, the SLA worker stalls, or the app starts throwing 5xx, nobody is told. Production has no telemetry dependency at all (verified: no `applicationinsights`/OpenTelemetry/Sentry in either `package.json`) and container logging is off.

**Two parts, two sessions.** Part A is code (implementer session). Part B is Azure configuration (deploy-agent session, or the owner) and depends on Part A being deployed. Decision already taken (decisions log): Application Insights, because the resource group already runs five of them against one Log Analytics workspace.

---

## 1. Goal

1. The API sends requests, dependencies, exceptions and a handful of **custom metrics** to Application Insights when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set, and does nothing when it is not (dev/test unaffected).
2. Five alerts reach a human: 5xx rate, availability of `/api/health/ready`, failed outgoing emails, SLA worker stalled, database errors.
3. Container logs are switched on so the next deploy can be verified from the log.

## 2. Context read

- `CLAUDE.md` (baselines: **196 unit, 362 integration + 1 skipped, 36 web**), `docs/agent-context/repo-landmines.md`, `.cursorrules`.
- `prompts/2026-08-26-0-5-readiness-endpoint.md` — the health module this card extends; read §12–13 for the hermetic-harness rules (every `AZURE_*` key is blanked in tests — add the new one to that list).
- `docs/azure-env-inventory.md` — what production has switched on.
- `docs/DEPLOYMENT.md` — Part B changes app settings, which restarts the app; and the "Two dead ends" paragraph explains why a browser/availability test is the only functional check.

## 3. Facts established first (verified 2026-08-26)

| Fact | Consequence |
|---|---|
| No telemetry package in `apps/api/package.json`; `main.ts` bootstraps Nest directly with `nestjs-pino` (`level: info` in prod, no transport → stdout). | Add one dependency. Initialise it **before** `NestFactory.create` so HTTP auto-collection wraps the server. Pino keeps writing to stdout; App Service container logging (Part B) captures it. |
| npm: `applicationinsights@3.16.0` (latest, OpenTelemetry-based, keeps the `setup(...).start()` shim) and `@azure/monitor-opentelemetry@1.19.0`. Node in prod is 22 LTS. | Use `applicationinsights@^3`. It auto-collects incoming HTTP, outgoing HTTP, Postgres (`pg`) dependencies and unhandled exceptions, and exposes `defaultClient.trackMetric`. |
| `GET /api/health/ready` exists (card 0.5) with `HealthService` reading live state; `SlaBreachService.getWorkerState()` returns `lastRunAt`; `NotificationOutbox` has `status (PENDING|PROCESSING|SENT|FAILED)`, `attempts`, `lastError`, `sentAt`, `createdAt`. | Metrics come from things the app already knows. Two DB counts are new (outbox failed, outbox pending > 10 min). |
| Production: Easy Auth on (`RedirectToLoginPage`), so an external availability test gets 401 unless the path is excluded. `HEALTH_READY_TOKEN` is not set. App Service already has `healthCheckPath = /api/health` and `WEBSITE_HEALTHCHECK_MAXPINGFAILURES`. | Part B: exclude `/api/health` and `/api/health/ready` from Easy Auth **and** set `HEALTH_READY_TOKEN`; the availability test sends the header. The platform health check on `/api/health` bypasses auth internally and already restarts unhealthy instances. |
| `az webapp auth show` returned all-null fields for `TicketTicket` on 2026-08-26 — the site likely uses the classic auth settings (`authsettings`) or v2 not yet migrated. | Part B must first inspect with `az webapp auth-classic show` **and** `az rest … /config/authsettingsV2/list`, then set `excludedPaths` in whichever is active. Do not guess. |
| RG `csnhc-ai` already contains Log Analytics workspace `workspacecsnhcai85f5` and five `microsoft.insights/components` (`CustomerService`, `deficiencyPOC`, `ocrcsnhc`, `PlanOfCorrection`, `CSNHC-ML-AppInsight`) plus action group `Application Insights Smart Detection`. Container logging: `applicationLogs.fileSystem.level = Off`. | Create **one more** workspace-based component, `TicketTicket-insights`, in the same workspace. Create a new action group for the ticketing owner rather than reusing Smart Detection's. |
| Test harness blanks every `AZURE_*`, `SMTP_*`, `HEALTH_READY_TOKEN` key (`test/setup-tests.ts`). | Add `APPLICATIONINSIGHTS_CONNECTION_STRING` to that list so tests never try to send telemetry. |

## 4. Decisions and assumptions

1. **SDK: `applicationinsights@^3`, classic `setup().start()` shim.** One file, no OpenTelemetry plumbing to maintain. Sampling left at default. `setAutoCollectConsole(false)` — pino already structures logs; forwarding console would double them.
2. **Init lives in `src/telemetry/telemetry.bootstrap.ts`** (one export: `startTelemetry()`), called as the very first line of `bootstrap()` in `main.ts`. Returns `false` and logs one line when the connection string is absent. No Nest DI involvement — it must run before the app exists.
3. **Custom metrics are pushed by a Nest service on a 60 s interval** (`src/telemetry/telemetry.service.ts`, in a new `TelemetryModule` importing `HealthModule`'s dependencies — or simpler, add the service to `HealthModule` since it needs the same providers). Metrics (all `trackMetric`, names fixed): `outbox.failed` (count of `FAILED`), `outbox.pendingOver10m` (count `PENDING` with `createdAt < now-10m`), `slaWorker.lastRunAgeSeconds` (`-1` when never run, `-2` when disabled), `db.ok` (1/0), `redis.emailQueue.connected` (1/0). Interval disabled when telemetry did not start.
4. **Readiness JSON gains an `outbox` block** `{ failed: number, pendingOver10m: number }` — same counts, so a human and the availability test see what the metric sees.
5. **Alerts are Part B, via `az` commands the deploy agent runs.** Five rules, one action group (email to the owner; add a Teams webhook later). Thresholds are deliberately loose to start; tighten after a week of data.
6. **Container logging on** (`filesystem`, 35 MB quota, 7-day retention) is part of Part B — it is the cheapest observability win and was the blocker for verifying the last deploy.
7. **No dashboards in this card.** Alerts first; a workbook is a follow-up.

## 5. The work — Part A (implementer session, code)

Kill stray node processes. Work in `apps/api`.

### Task A1 — Dependency and bootstrap

**Files:** Modify `apps/api/package.json`; Create `src/telemetry/telemetry.bootstrap.ts`; Modify `src/main.ts`

- [ ] `npm install -w apps/api applicationinsights@^3` (from repo root). Confirm `package-lock.json` changes only for that package and its OpenTelemetry dependencies; note the count of added packages in the report.
- [ ] `telemetry.bootstrap.ts`:

```ts
import appInsights from 'applicationinsights';

/**
 * Starts Application Insights when APPLICATIONINSIGHTS_CONNECTION_STRING is set.
 * Must run before NestFactory.create so HTTP auto-collection wraps the server.
 * Returns false (and does nothing) when the variable is absent — dev and test.
 */
export function startTelemetry(): boolean {
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim();
  if (!connectionString) {
    return false;
  }
  appInsights
    .setup(connectionString)
    .setAutoCollectRequests(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectExceptions(true)
    .setAutoCollectPerformance(true, false)
    .setAutoCollectConsole(false)
    .setSendLiveMetrics(false)
    .start();
  appInsights.defaultClient.context.tags[appInsights.defaultClient.context.keys.cloudRole] = 'ticketing-api';
  return true;
}
```

      If `applicationinsights@3` rejects any of these setters at type-check time (the v3 shim dropped a few), remove the offending call and say so in the report — do not downgrade to v2.

- [ ] `main.ts`: first statement inside `bootstrap()` — `const telemetryStarted = startTelemetry();` — and after the existing "Application is running" log add `app.get(Logger).log(\`Telemetry: ${telemetryStarted ? 'Application Insights on' : 'off (no connection string)'}\`, 'Bootstrap');`.
- [ ] `npx tsc --noEmit` → 0. `npm run build -w apps/api` → 0 (the build must still succeed; this is what ships).

### Task A2 — Custom metrics service and readiness `outbox` block

**Files:** Create `src/telemetry/telemetry.service.ts`, `src/telemetry/telemetry-metrics.type.ts`, `src/telemetry/telemetry.service.spec.ts`; Modify `src/health/health.service.ts`, `src/health/readiness-report.type.ts`, `src/health/health.module.ts`, `src/health/health.service.spec.ts`

- [ ] Type:

```ts
/** The five numbers pushed to Application Insights every minute. */
export type TelemetryMetrics = {
  outboxFailed: number;
  outboxPendingOver10m: number;
  slaWorkerLastRunAgeSeconds: number;
  dbOk: 0 | 1;
  emailQueueConnected: 0 | 1;
};
```

- [ ] `HealthService`: add `async outboxCounts(): Promise<{ failed: number; pendingOver10m: number }>` using `prisma.notificationOutbox.count` twice (`{ status: 'FAILED' }` and `{ status: 'PENDING', createdAt: { lt: new Date(Date.now() - 10 * 60_000) } }`), and include `outbox: await this.outboxCounts()` in `readiness()`. Extend `ReadinessReport` with `outbox: { failed: number; pendingOver10m: number }`. Update the unit spec's mocked prisma with a `notificationOutbox.count` mock returning 0, and add one assertion that `outbox` is present.
- [ ] `TelemetryService` (`@Injectable`, `OnModuleInit`/`OnModuleDestroy`): in `onModuleInit`, if `!process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim()` → log "custom metrics off" and return; else `setInterval(() => this.push(), 60_000)` plus one immediate push. `collect(): Promise<TelemetryMetrics>` builds the five numbers from `HealthService.readiness()` (`slaWorker.lastRunAt` → age in seconds; `null` → `-1`; `enabled === false` → `-2`; `redis.emailQueue === 'connected'` → 1). `push()` calls `collect()` then `appInsights.defaultClient.trackMetric({ name, value })` for each of `outbox.failed`, `outbox.pendingOver10m`, `slaWorker.lastRunAgeSeconds`, `db.ok`, `redis.emailQueue.connected`; errors are caught and logged once per minute at most. Register in `HealthModule.providers`.
- [ ] Unit spec: `collect()` with a mocked `HealthService.readiness()` returning a fixed report → the five numbers are right for three cases (worker never ran → `-1`; worker disabled → `-2`; 90 s old run → ~90). `push()` with a mocked `defaultClient` records five `trackMetric` calls with the exact names.
- [ ] `test/setup-tests.ts`: add `'APPLICATIONINSIGHTS_CONNECTION_STRING'` to the blank-list.
- [ ] `npx jest --silent` → 196 + new tests. Integration `health.spec.ts`: add `expect(body.outbox).toEqual({ failed: 0, pendingOver10m: 0 });` and run it alone, then the full suite (it must still be 362 + 1 skipped + your additions).

### Task A3 — Docs and commit

- [ ] `.env.example`: under a new `# ── Telemetry` header, `APPLICATIONINSIGHTS_CONNECTION_STRING=` with the comment `# Optional. When set, the API sends requests/dependencies/exceptions and five custom metrics to Application Insights.`
- [ ] `docs/azure-env-settings.md`: a "Telemetry" row group with that variable and the five metric names.
- [ ] Baselines in `CLAUDE.md` and `repo-landmines.md` with the real numbers.
- [ ] Commit (do not push):

```bash
git add apps/api/package.json package-lock.json apps/api/src/telemetry apps/api/src/main.ts apps/api/src/health apps/api/test/setup-tests.ts apps/api/test/integration/health.spec.ts apps/api/.env.example docs/azure-env-settings.md CLAUDE.md docs/agent-context/repo-landmines.md
git commit -m "feat(api): Application Insights telemetry with custom health metrics

- applicationinsights@3 started before Nest bootstrap when the connection string is set
- TelemetryService pushes outbox/SLA-worker/db/redis metrics every minute
- readiness report gains outbox counts; tests and baselines updated"
```

## 6. The work — Part B (deploy-agent session, Azure) — only after Part A is GREEN and deployed

Every command below changes production configuration or creates a billable resource. Read each one to the owner before running it (what / effect / blast radius / reversibility / cost) and get a yes.

### Task B1 — Container logging (no cost, one restart)

```bash
az webapp log config -g csnhc-ai -n TicketTicket --docker-container-logging filesystem
az webapp log show -g csnhc-ai -n TicketTicket --query "httpLogs.fileSystem.enabled" -o tsv
```

### Task B2 — Application Insights component (cost: ingestion, expect < US$5/month at current traffic)

```bash
az extension add --name application-insights --upgrade
WS=$(az monitor log-analytics workspace show -g csnhc-ai -n workspacecsnhcai85f5 --query id -o tsv)
az monitor app-insights component create -g csnhc-ai -l southcentralus --app TicketTicket-insights --kind web --application-type web --workspace "$WS"
CONN=$(az monitor app-insights component show -g csnhc-ai --app TicketTicket-insights --query connectionString -o tsv)
# set the connection string and a readiness token in ONE call (one restart), never echo either value
TOKEN=$(openssl rand -hex 24)
az webapp config appsettings set -g csnhc-ai -n TicketTicket --settings APPLICATIONINSIGHTS_CONNECTION_STRING="$CONN" HEALTH_READY_TOKEN="$TOKEN" --query "[].name" -o tsv
```

Store `$TOKEN` in Key Vault `CSNHC-WebApps` as secret `TicketTicket-health-ready-token` (`az keyvault secret set`), so the availability test and future operators can read it without it living in a chat log.

### Task B3 — Let the monitor through Easy Auth

Inspect first, then set `excludedPaths` to `["/api/health", "/api/health/ready"]` in whichever configuration is active:

```bash
az webapp auth-classic show -g csnhc-ai -n TicketTicket -o json | head -40
SITE=$(az webapp show -g csnhc-ai -n TicketTicket --query id -o tsv)
az rest --method post --uri "https://management.azure.com${SITE}/config/authsettingsV2/list?api-version=2022-09-01" --query "properties.{enabled:platform.enabled, unauth:globalValidation.unauthenticatedClientAction, excluded:globalValidation.excludedPaths}" -o json
```

If v2 is active: `az webapp auth update -g csnhc-ai -n TicketTicket --excluded-paths "/api/health" "/api/health/ready"`. If classic is active, migrate to v2 first (`az webapp auth config-version upgrade`) **only with the owner's explicit yes** — it is reversible but touches login. Verify: anonymous `curl -s -o /dev/null -w '%{http_code}' https://ticketticket-…/api/health/ready` → **403** (token required, no longer 401), and with `-H "x-health-token: $TOKEN"` → **200**. `/` must still redirect to login.

### Task B4 — Action group, availability test, five alerts

```bash
az monitor action-group create -g csnhc-ai -n ticketing-oncall --short-name tkt-oncall --action email owner PHulgur@csnhc.com
AG=$(az monitor action-group show -g csnhc-ai -n ticketing-oncall --query id -o tsv)
AI=$(az monitor app-insights component show -g csnhc-ai --app TicketTicket-insights --query id -o tsv)
```

- **Availability test** (standard web test, every 5 min, 3 locations, GET `https://ticketticket-gmgwf9efe4h6bmfb.southcentralus-01.azurewebsites.net/api/health/ready`, header `x-health-token: <token from Key Vault>`, content match `"status":"ok"`): the CLI has no first-class command for standard tests — create it with `az rest` against `Microsoft.Insights/webtests` (API `2022-06-15`, `Kind: standard`, `Request.Headers`, `ValidationRules.ContentValidation.ContentMatch`) or in the portal; record which. Then:

```bash
az monitor metrics alert create -g csnhc-ai -n tkt-availability --scopes "$AI" --condition "avg availabilityResults/availabilityPercentage < 90" --window-size 15m --evaluation-frequency 5m --severity 1 --action "$AG"
az monitor metrics alert create -g csnhc-ai -n tkt-5xx-rate     --scopes "$AI" --condition "count requests/failed > 5" --window-size 5m --evaluation-frequency 5m --severity 2 --action "$AG"
az monitor metrics alert create -g csnhc-ai -n tkt-outbox-failed --scopes "$AI" --condition "max customMetrics/outbox.failed > 0" --window-size 15m --evaluation-frequency 5m --severity 2 --action "$AG"
az monitor metrics alert create -g csnhc-ai -n tkt-sla-worker-stalled --scopes "$AI" --condition "min customMetrics/slaWorker.lastRunAgeSeconds > 300" --window-size 15m --evaluation-frequency 5m --severity 2 --action "$AG"
az monitor metrics alert create -g csnhc-ai -n tkt-db-down --scopes "$AI" --condition "min customMetrics/db.ok < 1" --window-size 5m --evaluation-frequency 1m --severity 1 --action "$AG"
```

If `customMetrics/<name>` is rejected as a metric name, the metrics are namespaced `azure.applicationinsights` — add `--metric-namespace azure.applicationinsights` or switch those three to `az monitor scheduled-query create` over `customMetrics | where name == "outbox.failed"`. Record which form worked in the report.

### Task B5 — Prove each alert once

- Availability: temporarily set `HEALTH_READY_TOKEN` to a different value → test fails within 10 min → alert email; restore.
- 5xx: `for i in $(seq 1 8); do curl -s -o /dev/null -H "x-health-token: wrong" …/api/health/ready; done` produces 403s, not 5xx — so instead confirm the rule exists and rely on Smart Detection; note it as unproven.
- Outbox: insert one `FAILED` outbox row in production (`INSERT … status='FAILED'`) → metric > 0 → alert → delete the row. Owner's yes required (it is a test row in prod).
- SLA worker: `SLA_BREACH_WORKER_ENABLED=false` for 10 min → age metric `-2`… that is < 300, so **the stalled rule cannot fire on "disabled"**; document that the rule catches "enabled but not running" only, and that `-2` is visible in the readiness JSON.
- DB: cannot be safely induced; confirm the rule renders in the portal.

### Task B6 — Docs

- `docs/azure-env-inventory.md`: re-capture the readiness JSON (now with `outbox`), add the new setting names, note the Easy Auth exclusions and the App Insights component.
- `docs/DEPLOYMENT.md`: replace "container logging is off" with the log-verification command: `az webapp log tail -g csnhc-ai -n TicketTicket` and grep for `Telemetry: Application Insights on` and `Mapped {/api/health/ready, GET}`.
- Commit both.

## 7. Files expected to change (Part A)

`apps/api/package.json`, `package-lock.json`, `apps/api/src/telemetry/telemetry.bootstrap.ts` (new), `telemetry.service.ts` (new), `telemetry-metrics.type.ts` (new), `telemetry.service.spec.ts` (new), `apps/api/src/main.ts`, `apps/api/src/health/health.service.ts`, `readiness-report.type.ts`, `health.module.ts`, `health.service.spec.ts`, `apps/api/test/setup-tests.ts`, `apps/api/test/integration/health.spec.ts`, `apps/api/.env.example`, `docs/azure-env-settings.md`, `CLAUDE.md`, `docs/agent-context/repo-landmines.md`. No web changes, no schema.

## 8. Security considerations

- The connection string and the readiness token are secrets: set them in one `az` call with `--query "[].name"` so values never print; keep the token in Key Vault; never paste either into a doc, a prompt, or a chat.
- Excluding `/api/health*` from Easy Auth exposes states-only JSON behind a token. The token compare is constant-time (0.5). `/api/health` (liveness) becomes anonymous — it returns `{ status, timestamp }` only.
- Telemetry auto-collects request URLs. Ticket IDs are UUIDs in paths; no PHI is in URLs or headers. Do **not** enable console/log forwarding, which could carry message bodies.
- Metrics are counts and ages — no content.

## 9. Acceptance criteria

**Part A:** `startTelemetry()` returns `false` with no connection string and the app boots exactly as before; unit + integration suites green with the new tests; readiness JSON has `outbox`; `npm run build -w apps/api` succeeds; no console forwarding.
**Part B:** container logs stream; App Insights shows requests within 5 min of deploy; the five custom metrics appear under Metrics → Custom; availability test green; anonymous `/api/health/ready` → 403, with token → 200, `/` still redirects to login; the availability alert has fired and cleared once; docs updated.

## 10. Checks to run (Part A)

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent && npm run build -w apps/api
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx jest --config ./test/jest.integration.json test/integration/health.spec.ts > ../../it-health.txt 2>&1; grep Tests: ../../it-health.txt
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

## 11. Manual test steps (Part A)

1. `npm run dev -w apps/api` without the variable → log line `Telemetry: off (no connection string)`; `/api/health/ready` shows `outbox: { failed: 0, pendingOver10m: 0 }`.
2. With `APPLICATIONINSIGHTS_CONNECTION_STRING` set to the **dev** component's string (or the new one, once B2 exists): log line `Telemetry: Application Insights on`; after 2 minutes the five metrics are visible in the portal under Metrics → Custom.
3. Stop the dev server.

## 12. Handoff notes — what to report back

**Part A:** commit SHA; `Tests:` lines (unit, health spec, full integration), vitest, both `tsc`, build exit code; `git diff --stat HEAD~1`; number of packages `applicationinsights` pulled into the lockfile; any setter the v3 shim rejected; manual steps 1–2.
**Part B:** every command run with its (value-free) output; which auth config was active and what was changed; how the availability test was created; which alert rules exist (`az monitor metrics alert list -g csnhc-ai --query "[].name" -o tsv`); the alert-proving results; the re-captured readiness JSON.
