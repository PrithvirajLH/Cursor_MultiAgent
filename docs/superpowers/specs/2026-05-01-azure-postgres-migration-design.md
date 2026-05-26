# Azure Postgres Migration — Design

**Date:** 2026-05-01
**Owner:** PHulgur@csnhc.com
**Status:** Approved (pending user review of this spec)

## Goal

Move the Codex Ticketing System backend off Supabase-hosted PostgreSQL and onto **Azure Database for PostgreSQL Flexible Server** in the same subscription as the existing `TicketTicket` App Service. Prisma stays as the ORM. The schema, application code, and local Docker dev workflow do not change.

## Non-goals

- Replacing Prisma with raw SQL or another ORM.
- Migrating to Azure SQL / SQL Server (rejected — schema uses Postgres-only features: scalar arrays, native enums, JSONB; ~3 days of rewrite for ~$10/mo savings).
- Bringing existing Supabase data over (decision: start fresh; Supabase has no data we need to keep).
- Standing up dev/staging environments. Production only.
- VNet / Private Endpoint integration. Public access + firewall rule for now.
- Entra/AAD auth for Postgres. Password auth for now.
- Auto-running Prisma migrations on App Service startup.
- Migrating local dev off Docker. Dev keeps Docker.

## Architecture

**Before:**

```
Local dev (Docker Postgres)         Production (Azure)
   apps/api ──────────────────►     TicketTicket (App Service)
                                       │
                                       ▼
                                    Supabase Postgres (us-east-2)
```

**After:**

```
Local dev (Docker Postgres)         Production (Azure, csnhc-ai RG, South Central US)
   apps/api ──────────────────►     TicketTicket (App Service)
                                       │
                                       ▼
                                    Azure Database for PostgreSQL Flexible Server
                                    csh-ticketing-db.postgres.database.azure.com
                                    Database: ticketing
                                    Tier: Burstable B1ms, 32 GB, PG 16
                                    DATABASE_URL: port 6432 (PgBouncer txn mode)
                                    DIRECT_URL:   port 5432 (direct, for migrations)
                                    Firewall: AllowAllAzureServices ON
                                              + dev IP rule (one-time, for migration run)
```

**App code changes:** none. `apps/api/prisma/schema.prisma` reads `DATABASE_URL` and `DIRECT_URL` from env. Only the env values change.

## Provisioning targets

| Resource | Value |
|---|---|
| Subscription | `de674ee2-d249-4240-8392-810c935b8c33` (Microsoft Azure creativesnhc) |
| Resource group | `csnhc-ai` (existing) |
| Region | `southcentralus` (matches App Service) |
| Server name | `csh-ticketing-db` (globally unique under `*.postgres.database.azure.com`) |
| PostgreSQL version | `16` |
| SKU | `Standard_B1ms` (Burstable tier) |
| Storage | 32 GB |
| Admin user | `pgadmin` |
| Admin password | Generated fresh by script (32 chars), echoed once at end |
| Database | `ticketing` |
| Networking | Public access |
| Firewall rule 1 | `AllowAllAzureServices` (0.0.0.0–0.0.0.0) |
| Firewall rule 2 | `dev-laptop-<date>` for the laptop running the migration |
| Pooling | Built-in PgBouncer enabled, transaction mode, port 6432 |
| Backup | Default 7-day retention, locally redundant |
| HA | Off |

## Cutover sequence

A single PowerShell script (`scripts/migrate-to-azure-postgres.ps1`) orchestrates these steps. It is idempotent where Azure resources allow and writes a local `rollback.ps1` capturing pre-cutover env values before changing App Service settings.

```
Step 1: Provision (az CLI)
  - Create flexible-server with above settings
  - Create database `ticketing`
  - Add firewall rules: AllowAllAzureServices, dev-laptop-<date>
  - Enable pgbouncer server parameter

Step 2: Capture connection strings
  - DATABASE_URL = postgresql://pgadmin:<pwd>@csh-ticketing-db.postgres.database.azure.com:6432/ticketing?sslmode=require&pgbouncer=true
  - DIRECT_URL   = postgresql://pgadmin:<pwd>@csh-ticketing-db.postgres.database.azure.com:5432/ticketing?sslmode=require
  - Held in script-local variables; never written to disk

Step 3: Run schema setup against Azure (from local machine)
  - cd apps/api
  - $env:DATABASE_URL / $env:DIRECT_URL = the new URLs
  - npx prisma migrate deploy
  - npx prisma generate
  - npm run db:seed

Step 4: Update App Service settings + write rollback.ps1
  - Read current TicketTicket DATABASE_URL / DIRECT_URL into rollback.ps1
  - az webapp config appsettings set -g csnhc-ai -n TicketTicket
      DATABASE_URL=<new>  DIRECT_URL=<new>
  - az webapp restart -g csnhc-ai -n TicketTicket

Step 5: Smoke test
  - az webapp log tail -g csnhc-ai -n TicketTicket  (verify boot)
  - curl https://<host>/api/health
  - Web UI: log in, list tickets, create one

Step 6: User updates apps/api/.env locally (manual, optional)

Step 7: User pauses/deletes Supabase project (manual, after confidence)
```

## Verification checklist

| Check | How | Pass |
|---|---|---|
| App boots | `az webapp log tail` | No Prisma connection errors |
| Health | `curl /api/health` (or `/api` if no health route) | HTTP 200 |
| DB connection | `npx prisma db execute` with `SELECT 1` | Returns 1 |
| Schema present | `npx prisma db pull --print` | All tables present |
| Seed data | Web UI lists categories / teams | Seeded rows visible |
| End-to-end | Web UI: log in → create ticket → message → assign | Persists |
| Realtime (if `AZURE_WEB_PUBSUB_CONNECTION_STRING` set) | Two-tab message test | Live update arrives |

## Rollback

Trigger condition: any verification check fails or user decides to abort.

```powershell
# rollback.ps1, written by Step 4
az webapp config appsettings set -g csnhc-ai -n TicketTicket --settings `
  DATABASE_URL="<original Supabase pooled URL>" `
  DIRECT_URL="<original Supabase direct URL>"
az webapp restart -g csnhc-ai -n TicketTicket
```

`rollback.ps1` is added to `.gitignore` to prevent committing the Supabase password.

The Azure Postgres server stays provisioned during rollback (deleting on failure costs nothing extra; keeping it lets us debug). Cleanup is a separate manual step after the team is confident the cutover is dead.

## Secrets handling

- Admin password is generated by the script (32 random chars), passed inline to `az` commands, stashed in App Service settings, and echoed **once** at the end so the operator can save it to a password manager.
- The password is never written to a file in the repo. `rollback.ps1` contains only the **old** Supabase URLs (which are being decommissioned anyway).
- `apps/api/.env` is not modified by the script. Operator updates it manually post-cutover; `.env` is already in `.gitignore`.
- Post-cutover, the operator should rotate the **Supabase** admin password (or delete the Supabase project) since it's been read into multiple sessions/logs during this work.

## Files touched

| File | Change |
|---|---|
| `scripts/migrate-to-azure-postgres.ps1` | new — orchestration script |
| `.gitignore` | add `rollback.ps1` |
| `apps/api/.env` | manual post-cutover update by operator |

No changes to: `schema.prisma`, app code under `apps/api/src/`, `docker-compose.yml`, `apps/web/`, existing deploy scripts.

## Out of scope (explicit, deferrable)

These are deliberately deferred. None block the cutover:

- Auto-migrate on App Service startup (Approach C from brainstorm).
- Multi-environment topology (dev/staging/prod separate DBs).
- Entra/AAD authentication for Postgres.
- Private Endpoint / VNet.
- Reserved Instance pricing.
- "Stop server during off-hours" cost-saving automation.
- Monitoring/alerting beyond Azure defaults.
- Connection-pool tuning in Prisma client.
- Local dev cutover off Docker.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Migration run from operator laptop fails mid-way | Script is idempotent; `prisma migrate deploy` resumes from last applied migration; firewall rule for laptop IP added explicitly so connection works |
| App restarts fail to pick up new env vars | Verified by log tail in Step 5; rollback in 30s |
| `pgbouncer=true` causes Prisma migration issues | Migrations use `DIRECT_URL` (port 5432, no pooling) — Prisma's documented pattern for this exact case |
| Admin password lost | Echoed once at end of script; operator responsible for storing; can be reset via `az postgres flexible-server update` |
| Cost surprise from leaving Supabase + Azure both running | Step 7 is explicit; operator decommissions Supabase after smoke test passes |
| Schema differences between local Docker and Azure (PG version, extensions) | Both PG 16; no extensions used by current schema |

## Success criteria

- `TicketTicket` is serving requests against Azure Postgres.
- All 30+ Prisma tables created in `ticketing` database with seed data present.
- End-to-end smoke test (login → create ticket → message → assign) passes against the cutover environment.
- `rollback.ps1` exists and has been spot-checked for correctness.
- Operator has Azure admin password stored securely.
- Supabase project pause/deletion is queued as a follow-up task.
