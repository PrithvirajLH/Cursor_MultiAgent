# Production environment inventory — `TicketTicket`

**Captured:** 2026-08-26 17:12 UTC, immediately after deploying commit `c2ff777` (deployment `9e66be3c`).
**Source of truth:** `GET /api/health/ready` (added in card 0.5) read from a signed-in browser, plus the
**names** of the App Service application settings. **No values are recorded here — ever.** If a value
appears in this file, treat it as a leak: rotate it and scrub history.

Re-capture after any settings change or deploy that touches an integration.

## What production has switched on

Verbatim response from `GET /api/health/ready`:

```json
{"status":"ok","checkedAt":"2026-08-26T17:12:43.377Z","db":"ok",
 "redis":{"emailQueue":"disabled","automationQueue":"disabled"},
 "smtp":"missing","webPubSub":"configured","blobStorage":"azure",
 "attachmentScanner":"blocked","aiPipeline":"configured",
 "slaWorker":{"enabled":true,"lastRunAt":"2026-08-26T17:12:00.369Z","lastRunOk":true}}
```

| Integration | State | What it means for users today | Follow-up |
|---|---|---|---|
| Database | `ok` | Azure Postgres reachable; schema at 48 migrations. | — |
| Redis / queues | `disabled` (both) | No Redis. Emails and automation run inline in the request; no retry queue. Fine at current volume. | Revisit when volume or reliability demands it (IT.pdf §7.2 asks for outbox + retries + DLQ). |
| **Email (SMTP)** | **`missing`** | **No email leaves production.** No ticket-created, reply, assignment, SLA-breach or CSAT emails are sent; only the in-app bell works. Also nothing is *received* by mailbox — the inbound webhook secret exists but no provider calls it (card 2.4). | **Decision needed:** configure `SMTP_*` (Office 365 relay) — or accept in-app-only for now. Directly affects cards 1.14, 1.16. |
| Realtime (Web PubSub) | `configured` | Live updates and typing indicators work. | — |
| Attachments storage | `azure` (Blob) | Files persist across restarts. | Enables card 0.7 option 1 (Defender for Storage). |
| **Attachment scanner** | **`blocked`** | **Every attachment uploaded in production stays `PENDING` and cannot be downloaded** — there is no scanner, no bypass, no secret. Either nobody uploads, or people are getting refused downloads. | **Card 0.7 becomes urgent.** First step: count `Attachment` rows by `scanStatus` in production to see how many are stuck. |
| AI pipeline | `configured` | Foundry endpoint + key present; AI intake works. | — |
| SLA worker | `enabled`, last run OK | Breach/at-risk detection is running every minute. | — |
| Readiness token | not set | `/api/health/ready` is open, but behind Easy Auth. | Set `HEALTH_READY_TOKEN` when card 0.4 excludes the path for a monitor. |

## Usage snapshot (read-only query, 2026-08-26 17:20 UTC)

| Table | Count |
|---|---|
| `Attachment` | **0** — nothing is stuck; the `blocked` scanner state has not affected anyone yet |
| `Ticket` | 3 (none with the `[Seed]` prefix) |
| `User` | 5, all active |

Production is effectively unused so far. That lowers the *urgency* of the SMTP and scanner gaps — not their importance: both must be resolved before the first real team is onboarded (master plan cards 0.7 and the SMTP decision).

## Application setting names (36)

```
AI_CONFIDENCE_THRESHOLD  AI_PIPELINE_ENABLED  AI_PIPELINE_TIMEOUT_MS  AI_SENSITIVE_DEPT_THRESHOLD
AUTOMATION_QUEUE_ENABLED  AZURE_AI_FOUNDRY_API_KEY  AZURE_AI_FOUNDRY_ENDPOINT  AZURE_AI_FOUNDRY_MODEL
AZURE_CLIENT_ID  AZURE_CLIENT_SECRET  AZURE_STORAGE_CONNECTION_STRING  AZURE_STORAGE_CONTAINER
AZURE_TENANT_ID  AZURE_WEB_PUBSUB_CONNECTION_STRING  AZURE_WEB_PUBSUB_HUB  AZURE_WEB_PUBSUB_TOKEN_LIFETIME_MINUTES
CONFIDENCE_GATE_AGENT_ID  CORS_ORIGIN  DATABASE_URL  DEPARTMENT_CLASSIFIER_AGENT_ID  DEPLOYED_COMMIT_SHA
DIRECT_URL  ENABLE_ORYX_BUILD  INBOUND_EMAIL_WEBHOOK_SECRET  INTENT_EXTRACTOR_AGENT_ID
MICROSOFT_PROVIDER_AUTHENTICATION_SECRET  NODE_ENV  NOTIFICATIONS_QUEUE_ENABLED  PORT
SCM_DO_BUILD_DURING_DEPLOYMENT  TICKET_GENERATOR_AGENT_ID  VITE_AZURE_LOGOUT_REDIRECT_URI  VITE_AZURE_REDIRECT_URI
WEB_APP_URL  WEBSITE_AUTH_AAD_ALLOWED_TENANTS  WEBSITE_HEALTHCHECK_MAXPINGFAILURES
```

Notable **absences** (the names tell the story as much as the presence):

- No `SMTP_*` → email off (above).
- No `REDIS_*` → queues inline (above).
- No `ATTACHMENT_SCAN_*` → scanner `blocked` (above).
- No `SLA_*` → SLA worker on defaults (enabled, 60 s interval, at-risk on).
- No `HEALTH_READY_TOKEN`, no `RATE_LIMIT_*`, no `CACHE_SUMMARY_TTL_MS` → all defaults.
- `AI_PIPELINE_ENABLED` is present but **not read by the code** (see `.env.example`); AI is on because the Foundry endpoint and key are set.
- `VITE_*` values are build-time inputs for the web app; setting them on the API App Service has no runtime effect (harmless).
- `DEPLOYED_COMMIT_SHA` still reads `458543a` at capture time — the planning session was blocked from changing app settings; update it to `c2ff777` (it is a label, not a switch).

## How this was captured

```bash
az webapp config appsettings list -g csnhc-ai -n TicketTicket --query "[].name" -o tsv | sort   # names only
# then open https://ticketticket-gmgwf9efe4h6bmfb.southcentralus-01.azurewebsites.net/api/health/ready
# in a browser signed in through Easy Auth and copy the JSON
```
