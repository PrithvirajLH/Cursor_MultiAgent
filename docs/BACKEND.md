# Backend Documentation

**Ticketing System — API & Database**

This document describes the backend for the Ticketing System: stack, database schema, API, configuration, and operations. Use it for onboarding, migration planning, or integration work.

---

## Table of contents

1. [Overview](#1-overview)
2. [Tech stack](#2-tech-stack)
3. [Project structure](#3-project-structure)
4. [Database](#4-database)
5. [API](#5-api)
6. [Services and data flow](#6-services-and-data-flow)
7. [Configuration](#7-configuration)
8. [Authentication and authorization](#8-authentication-and-authorization)
9. [External integrations](#9-external-integrations)
10. [Scripts and commands](#10-scripts-and-commands)
11. [Database migration notes](#11-database-migration-notes)

---

## 1. Overview

- **Framework:** NestJS (Node.js)
- **ORM:** Prisma
- **Database:** PostgreSQL
- **API base path:** `/api`
- **Env file:** `apps/api/.env` (copy from `apps/api/.env.example`)

The backend is a REST API with optional background queues (BullMQ/Redis), email (SMTP), realtime (Azure Web PubSub), and attachment storage (local or Azure Blob). There is no Supabase SDK; Supabase is used only as a PostgreSQL host via connection strings.

---

## 2. Tech stack

| Layer        | Technology                          |
|-------------|--------------------------------------|
| Runtime     | Node.js                              |
| Framework   | NestJS 11                            |
| ORM         | Prisma 6                             |
| Database    | PostgreSQL 16                        |
| Cache       | NestJS Cache (in-memory)             |
| Queues      | BullMQ (Redis), optional             |
| Auth        | Azure AD / Entra ID (JWT) or HS256   |
| Email       | Nodemailer (SMTP)                    |
| Realtime    | Azure Web PubSub (optional)         |
| Attachments | Local disk or Azure Blob Storage     |
| Validation  | class-validator, class-transformer   |

---

## 3. Project structure

```
apps/api/
├── prisma/
│   ├── schema.prisma       # Database schema
│   ├── seed.ts             # Seed (minimal / test / dev)
│   └── migrations/         # 38 migrations
├── scripts/
│   ├── reset-dev-db.cjs
│   ├── reset-test-db.cjs
│   ├── flush-db.cjs
│   ├── migrate-attachments-to-azure.ts
│   └── setup-ai-department.ts
├── src/
│   ├── main.ts             # Bootstrap, CORS, global prefix /api
│   ├── app.module.ts       # Root module
│   ├── app.controller.ts   # Health, root
│   ├── auth/               # Guards, JWT, provisioning
│   ├── audit/               # Admin audit log
│   ├── automation/         # Rules + rule engine
│   ├── canned-responses/
│   ├── categories/
│   ├── common/              # Access control, idempotency, throttling
│   ├── custom-fields/
│   ├── notifications/      # Email, in-app, outbox, queues
│   ├── prisma/             # PrismaService
│   ├── realtime/            # Azure Web PubSub
│   ├── reports/
│   ├── routing/            # Routing rules
│   ├── saved-views/
│   ├── slas/               # SLA policies, breach worker, engine
│   ├── teams/
│   ├── tickets/            # Tickets, messages, attachments, inbound email
│   └── users/
├── test/                    # Integration tests
├── .env.example
└── package.json
```

---

## 4. Database

### 4.1 Connection

- **DATABASE_URL** — Used at runtime (pooled connection, e.g. Supabase pooler or PgBouncer).
- **DIRECT_URL** — Used for migrations and schema operations (direct to Postgres, no pooler).

Prisma schema:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

**Connection retry:** `PrismaService` retries on startup with exponential backoff:

- `DB_CONNECT_MAX_RETRIES` (default 8)
- `DB_CONNECT_INITIAL_DELAY_MS` (500)
- `DB_CONNECT_MAX_DELAY_MS` (10_000)

**Binary targets:** `native` and `debian-openssl-3.0.x` (for Azure App Service Linux). Adjust if deploying elsewhere.

### 4.2 Models (tables)

| Model                  | Purpose |
|------------------------|--------|
| User                   | Users; roles EMPLOYEE, AGENT, LEAD, TEAM_ADMIN, OWNER; team memberships; primaryTeamId |
| Team                   | Teams; assignment strategy QUEUE_ONLY, ROUND_ROBIN |
| TeamMember             | User–team link; TeamRole AGENT, LEAD, ADMIN |
| Category               | Hierarchical categories (parentId) |
| Ticket                 | Core entity: status, priority, channel (PORTAL/EMAIL), requester, assignee, team, SLA fields |
| TicketMessage          | Messages; MessageType PUBLIC, INTERNAL |
| TicketEvent            | Event log (status changes, inbound email, etc.) |
| TicketAccess           | Team access; AccessLevel READ, WRITE |
| TicketFollower         | Followers |
| InboundEmailReceipt    | Idempotency for inbound email (unique messageId) |
| Attachment             | Attachments; AttachmentScanStatus PENDING, CLEAN, INFECTED, FAILED |
| CustomField            | Field definitions (team/category scoped) |
| CustomFieldValue       | Ticket custom field values |
| RoutingRule            | Keyword-based routing to team/assignee |
| SlaPolicyConfig        | SLA policy configs |
| SlaPolicyConfigTarget  | Per-priority firstResponseHours, resolutionHours |
| SlaPolicyAssignment    | Policy–team assignment |
| SlaBusinessHoursSetting| Business hours, timezone, holidays |
| SlaInstance            | Per-ticket SLA state (due dates, breach flags) |
| NotificationOutbox    | Email outbox; OutboxStatus PENDING, PROCESSING, SENT, FAILED |
| Notification           | In-app notifications |
| IdempotencyRequest     | Idempotency for mutating API requests |
| SavedView              | Saved list views (user/team) |
| CannedResponse         | Canned responses (user/team) |
| AutomationRule         | Triggers: TICKET_CREATED, STATUS_CHANGED, SLA_APPROACHING, SLA_BREACHED |
| AutomationExecution    | Execution history for de-duplication |
| AdminAuditEvent        | Admin audit events |

### 4.3 Enums (summary)

- **TicketStatus:** NEW, TRIAGED, ASSIGNED, IN_PROGRESS, WAITING_ON_REQUESTER, WAITING_ON_VENDOR, RESOLVED, CLOSED, REOPENED
- **TicketPriority:** P1, P2, P3, P4
- **TicketChannel:** PORTAL, EMAIL
- **MessageType:** PUBLIC, INTERNAL
- **UserRole:** EMPLOYEE, AGENT, LEAD, TEAM_ADMIN, OWNER
- **TeamRole:** AGENT, LEAD, ADMIN
- **AccessLevel:** READ, WRITE
- **NotificationType:** TICKET_ASSIGNED, TICKET_UPDATED, NEW_MESSAGE, TICKET_MENTIONED, SLA_AT_RISK, SLA_BREACHED, TICKET_RESOLVED, TICKET_TRANSFERRED

### 4.4 Indexes (important)

- **Ticket:** `(status, updatedAt)`, `(assignedTeamId, status, updatedAt)`, `(assigneeId, status, updatedAt)`, `(requesterId, createdAt)`, `dueAt`, `firstResponseDueAt`, `completedAt`, `categoryId`, `priority`, `createdAt`
- **SlaInstance:** `nextDueAt`, `policyConfigId`, `resolutionDueAt`
- **NotificationOutbox:** `(status, createdAt)`, `toEmail`, `ticketId`
- **InboundEmailReceipt:** unique `messageId`, `ticketId`, `createdAt`
- **IdempotencyRequest:** unique `(key, method, route, actorId)`, `expiresAt`
- **Ticket:** GIN trigram indexes on `subject`, `description`, `displayId` (migration `20260220150000_add_ticket_search_trigram_indexes` uses `pg_trgm`)

### 4.5 Migrations

- Location: `apps/api/prisma/migrations/` (38 migrations).
- Deploy: `npm run db:migrate -w apps/api`
- Dev (create new): `npm run db:migrate:dev -w apps/api`

---

## 5. API

### 5.1 Base and auth

- **Base path:** `/api`
- **Auth:** Bearer JWT (Azure AD or HS256). In dev/test, `AUTH_ALLOW_INSECURE_HEADERS=true` allows `x-user-id` and `x-user-email`.
- **Validation:** Global ValidationPipe (whitelist, forbidNonWhitelisted, transform).
- **Errors:** PrismaExceptionFilter maps Prisma errors to HTTP responses.

### 5.2 Public endpoints (no auth)

| Method | Path | Notes |
|--------|------|--------|
| GET | / | Root |
| GET | /health | Health check |
| POST | /tickets/inbound-email | Inbound email webhook; requires `x-inbound-email-secret` or `x-m365-inbound-secret` |
| POST | /attachments/:id/scan-status | Scanner callback; requires `x-attachment-scan-secret` |

### 5.3 Tickets

| Method | Path |
|--------|------|
| GET | /tickets |
| GET | /tickets/counts |
| GET | /tickets/activity |
| GET | /tickets/status-breakdown |
| GET | /tickets/metrics |
| GET | /tickets/:id |
| POST | /tickets |
| POST | /tickets/bulk/assign |
| POST | /tickets/bulk/transfer |
| POST | /tickets/bulk/status |
| POST | /tickets/bulk/priority |
| GET | /tickets/:id/messages |
| POST | /tickets/:id/messages |
| POST | /tickets/:id/typing |
| POST | /tickets/:id/attachments |
| POST | /tickets/:id/assign |
| POST | /tickets/:id/transfer |
| POST | /tickets/:id/transition |
| GET | /tickets/:id/events |
| GET | /tickets/:id/followers |
| POST | /tickets/:id/followers |
| DELETE | /tickets/:id/followers/:userId |

### 5.4 Other modules

- **Attachments:** GET /attachments/:id (download; requires scanStatus CLEAN)
- **Categories:** GET/POST /categories, PATCH/DELETE /categories/:id
- **Teams:** GET/POST /teams, PATCH /teams/:id, GET/POST/PATCH/DELETE /teams/:id/members
- **Users:** GET /users, PATCH /users/:id/role
- **Routing:** GET/POST /routing-rules, PATCH/DELETE /routing-rules/:id
- **SLAs:** GET/PUT/DELETE /slas, GET/POST/PATCH/DELETE /slas/policies, GET/PATCH /slas/settings
- **Custom fields:** GET/POST /custom-fields, PATCH /custom-fields/:id, PATCH /custom-fields/tickets/:ticketId/values
- **Notifications:** GET /notifications, GET /notifications/unread-count, PATCH read/read-all
- **Saved views:** GET/POST /saved-views, PATCH/DELETE /saved-views/:id
- **Canned responses:** GET/POST /canned-responses, PATCH/DELETE /canned-responses/:id
- **Automation:** GET/POST /automation-rules, GET/PATCH/DELETE /automation-rules/:id, GET executions, POST test
- **Reports:** GET /reports/summary, /ticket-volume, /sla-compliance, /resolution-time, etc.
- **Audit:** GET /audit-log, GET /audit-log/export (TeamAdminOrOwner)
- **Realtime:** GET /realtime/negotiate (Web PubSub token)

### 5.5 Idempotency

Mutating endpoints (POST/PATCH/PUT/DELETE) support header `Idempotency-Key`. Stored in `IdempotencyRequest` with TTL from `IDEMPOTENCY_TTL_MS` (default 24h).

### 5.6 Rate limiting

- Default: 120 requests per window (`RATE_LIMIT_LIMIT`, `RATE_LIMIT_TTL_MS`).
- Webhook routes: 30/min (`RATE_LIMIT_WEBHOOK_*`).
- High-write ticket routes: 60/min (`RATE_LIMIT_HIGH_WRITE_*`).

---

## 6. Services and data flow

### 6.1 Main services

| Service | Responsibility |
|---------|----------------|
| TicketsService | Ticket CRUD, list, assign, transfer, status transitions, bulk ops, inbound email orchestration |
| InboundEmailService | Webhook validation, threading (In-Reply-To/References), requester provisioning, InboundEmailReceipt idempotency |
| TicketAttachmentService | Upload (local or Azure Blob), download, scan status, allowed types |
| TicketRealtimeService | Publish realtime events for ticket changes |
| TicketSlaCalculationService | SLA due dates from policy and business hours |
| NotificationsService | Ticket events → email + in-app notifications |
| OutboxService | Create/update NotificationOutbox |
| EmailService | Send via nodemailer (SMTP) |
| EmailProcessorService | Process outbox and send |
| SlaEngineService | Sync SlaInstance from tickets |
| SlaBreachService | Periodic breach/at-risk checks, notifications, automation triggers (uses advisory lock) |
| AccessControlService | Ticket visibility and write rules by role/team |
| RuleEngineService | Evaluate automation rules, run actions |
| IdempotencyService | Idempotency for mutating requests |
| RoutingRulesService | Keyword-based routing |
| RealtimeService | Azure Web PubSub negotiate and publish |

### 6.2 Inbound email flow

1. Webhook receives payload at POST /tickets/inbound-email.
2. Validate `x-inbound-email-secret` or `x-m365-inbound-secret`.
3. Idempotency via `InboundEmailReceipt` (messageId).
4. Threading via In-Reply-To/References → existing or new ticket.
5. Requester created/updated from fromEmail/fromName.
6. Message and attachments stored; notifications and realtime events sent.

### 6.3 SLA flow

1. **Sync:** SlaEngineService.syncFromTicket() on ticket create/update.
2. **Policy:** Team → SlaPolicyAssignment → SlaPolicyConfig + targets.
3. **Breach worker:** SlaBreachService runs on interval; processes SlaInstance by nextDueAt; uses `pg_try_advisory_xact_lock` for single-worker behavior.
4. **At-risk/breach:** Notifications to leads/on-call; automation triggers SLA_APPROACHING / SLA_BREACHED.

### 6.4 Background queues

When Redis is configured and enabled:

- **NOTIFICATIONS_QUEUE_ENABLED:** Email sending via BullMQ.
- **AUTOMATION_QUEUE_ENABLED:** Automation rule execution via BullMQ.

Otherwise processing is inline.

---

## 7. Configuration

All configuration is via environment variables. Copy `apps/api/.env.example` to `apps/api/.env`.

### 7.1 Server

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | HTTP port | 3000 |
| CORS_ORIGIN | Allowed origins (comma-separated) | — |
| WEB_APP_URL | Frontend base URL | — |
| REQUEST_TIMEOUT_MS | HTTP request timeout | 120000 |
| KEEP_ALIVE_TIMEOUT_MS | Keep-alive timeout | 5000 |
| HEADERS_TIMEOUT_MS | Headers timeout | 121000 |

### 7.2 Database

| Variable | Description |
|----------|-------------|
| DATABASE_URL | Pooled connection string |
| DIRECT_URL | Direct connection string (migrations) |
| DB_CONNECT_MAX_RETRIES | Startup retries |
| DB_CONNECT_INITIAL_DELAY_MS | Backoff initial delay |
| DB_CONNECT_MAX_DELAY_MS | Backoff cap |
| SCHEMA_CHECK_CACHE_TTL_MS | Schema capability cache TTL |

### 7.3 Auth

| Variable | Description |
|----------|-------------|
| AUTH_ALLOW_INSECURE_HEADERS | Allow x-user-id / x-user-email (dev only) |
| AUTH_JWT_ISSUER, AUTH_JWKS_URI | Azure AD / JWKS |
| AUTH_JWT_SECRET, AUTH_JWT_AUDIENCE | HS256 fallback |
| AUTH_BOOTSTRAP_OWNER_EMAILS | Comma-separated emails promoted to OWNER |
| AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET | Azure AD app |

### 7.4 Redis and queues

| Variable | Description |
|----------|-------------|
| REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_URL | Redis connection |
| NOTIFICATIONS_QUEUE_ENABLED | Use BullMQ for email |
| AUTOMATION_QUEUE_ENABLED | Use BullMQ for automation |

### 7.5 Rate limiting and cache

| Variable | Description |
|----------|-------------|
| RATE_LIMIT_LIMIT, RATE_LIMIT_TTL_MS | Default throttle |
| RATE_LIMIT_WEBHOOK_LIMIT, RATE_LIMIT_WEBHOOK_TTL_MS | Webhook throttle |
| RATE_LIMIT_HIGH_WRITE_LIMIT, RATE_LIMIT_HIGH_WRITE_TTL_MS | High-write throttle |
| IDEMPOTENCY_TTL_MS | Idempotency key TTL |
| CACHE_SUMMARY_TTL_MS | Cache for summary/counts |

### 7.6 Attachments

| Variable | Description |
|----------|-------------|
| ATTACHMENTS_DIR | Local upload directory |
| ATTACHMENTS_MAX_MB | Max file size (MB) |
| AZURE_STORAGE_CONNECTION_STRING, AZURE_STORAGE_CONTAINER | Azure Blob (optional) |
| ATTACHMENT_SCAN_WEBHOOK_SECRET | Secret for scan-status webhook |

### 7.7 SMTP

| Variable | Description |
|----------|-------------|
| SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE | SMTP server |
| SMTP_REPLY_TO, SMTP_FROM | From/Reply-To |

### 7.8 Realtime

| Variable | Description |
|----------|-------------|
| AZURE_WEB_PUBSUB_CONNECTION_STRING | Web PubSub (optional) |
| AZURE_WEB_PUBSUB_HUB | Hub name |
| AZURE_WEB_PUBSUB_TOKEN_LIFETIME_MINUTES | Token lifetime |

### 7.9 Inbound email

| Variable | Description |
|----------|-------------|
| M365_TENANT_ID, M365_CLIENT_ID, M365_CLIENT_SECRET | Microsoft Graph |
| INBOUND_EMAIL_WEBHOOK_SECRET, M365_INBOUND_WEBHOOK_SECRET | Webhook secret |
| INBOUND_EMAIL_MAX_ATTACHMENTS | Max attachments per email |
| INBOUND_EMAIL_ATTACHMENT_FETCH_TIMEOUT_MS | Timeout for fetching attachment |
| INBOUND_EMAIL_ATTACHMENT_ALLOWED_HOSTS | Allowed contentUrl hosts |

### 7.10 SLA

| Variable | Description |
|----------|-------------|
| SLA_BREACH_WORKER_ENABLED | Run breach worker |
| SLA_BREACH_INTERVAL_MS | Check interval |
| SLA_BREACH_BATCH_SIZE, SLA_BACKFILL_BATCH_SIZE | Batch sizes |
| SLA_AT_RISK_THRESHOLD_MINUTES | At-risk window |
| SLA_AT_RISK_ENABLED | Send at-risk notifications |
| SLA_ON_CALL_EMAILS | On-call emails for breach |
| SLA_PRIORITY_BUMP_ENABLED | Auto priority bump on breach |

### 7.11 Optional (Prisma)

| Variable | Description |
|----------|-------------|
| PRISMA_LOG_QUERIES | Log queries (true/false) |
| PRISMA_SLOW_QUERY_MS | Slow query threshold (ms) |
| PRISMA_QUERY_MAX_LEN | Max query length in log |

---

## 8. Authentication and authorization

### 8.1 Authentication

- **Production:** Azure AD / Entra ID (RS256 JWT, JWKS). First login creates/updates user in DB.
- **Fallback:** HS256 JWT when `AUTH_JWT_SECRET` is set.
- **Dev/test:** With `AUTH_ALLOW_INSECURE_HEADERS=true`, `x-user-id` and `x-user-email` are accepted (not for production).
- **Owner bootstrap:** `AUTH_BOOTSTRAP_OWNER_EMAILS` (comma-separated) promotes users to OWNER on sign-in.

### 8.2 Authorization (ticket access)

- **OWNER:** All tickets.
- **TEAM_ADMIN:** Tickets of primary team.
- **LEAD:** Tickets of teams where user is lead.
- **AGENT:** Assigned tickets or unassigned tickets of their teams.
- **EMPLOYEE:** Only tickets they requested.

Guards: `OwnerGuard`, `TeamAdminOrOwnerGuard` (e.g. audit log). Ticket-level access is enforced via `AccessControlService` in services.

### 8.3 Webhook secrets

- Inbound email: header `x-inbound-email-secret` or `x-m365-inbound-secret` must match `INBOUND_EMAIL_WEBHOOK_SECRET`.
- Attachment scan: header `x-attachment-scan-secret` must match `ATTACHMENT_SCAN_WEBHOOK_SECRET`.

---

## 9. External integrations

| Integration | Purpose | Required config |
|-------------|---------|------------------|
| PostgreSQL | Primary database | DATABASE_URL, DIRECT_URL |
| Redis | BullMQ (email, automation) | REDIS_* or REDIS_URL when queues enabled |
| Azure AD | SSO | AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET |
| Azure Blob Storage | Attachments (optional) | AZURE_STORAGE_CONNECTION_STRING, AZURE_STORAGE_CONTAINER |
| Azure Web PubSub | Realtime (optional) | AZURE_WEB_PUBSUB_CONNECTION_STRING |
| SMTP | Outbound email | SMTP_* |
| Microsoft 365 Graph | Inbound email (optional) | M365_*, INBOUND_EMAIL_WEBHOOK_SECRET |

---

## 10. Scripts and commands

Run from repo root unless noted.

| Command | Purpose |
|---------|---------|
| `npm run db:migrate -w apps/api` | Deploy Prisma migrations |
| `npm run db:migrate:dev -w apps/api` | Create and apply migration (dev) |
| `npm run db:seed -w apps/api` | Run seed (SEED_MODE=minimal\|test\|dev) |
| `npm run db:flush -w apps/api` | Flush database |
| `npm run db:setup-ai -w apps/api` | Setup AI department (script) |
| `npm run test:db:reset` | Reset test DB for integration tests |
| `npm run attachments:migrate-to-azure -w apps/api` | Migrate local uploads to Azure Blob |
| `npm run dev` (from root) | Run API + web (see root package.json) |

**Local infrastructure:** `docker compose up -d` runs Postgres (5432, DB `ticketing`), Postgres test (5433, DB `ticketing_test`), and Redis (6379).

---

## 11. Database migration notes

When moving from Supabase (or any Postgres) to another PostgreSQL host:

1. **Connection strings:** Set `DATABASE_URL` (pooled) and `DIRECT_URL` (direct) in `apps/api/.env`. No code change required for a standard Postgres move.
2. **Extensions:** One migration creates `pg_trgm`. Ensure the new instance allows extensions (or run `CREATE EXTENSION pg_trgm;` manually if needed).
3. **Advisory locks:** SlaBreachService uses `pg_try_advisory_xact_lock`; supported on any PostgreSQL.
4. **Binary targets:** Prisma targets `native` and `debian-openssl-3.0.x`. If you deploy to another OS/version, add the matching target or generate on the target.
5. **Data migration:** Export from current DB, import to new DB. Attachments may be on local disk or Azure Blob; use `attachments:migrate-to-azure` if moving local files to Blob.
6. **Test DB:** Use a separate database and set `apps/api/.env.test` (or test env) with the test connection string.

---

*Backend documentation — Ticketing System.*
