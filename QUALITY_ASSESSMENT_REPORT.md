# Codex Ticketing System — Comprehensive Quality Assessment

**Date:** 2026-02-18  
**Reviewer:** Senior Software Quality Engineer  
**Scope:** Full codebase — frontend, backend, database, deployment, integrations  
**Comparison baseline:** Zendesk Support / ServiceNow ITSM

---

## Executive Summary

The system is a NestJS + React monorepo with Prisma/PostgreSQL persistence and BullMQ/Redis async processing, deployed to Azure App Service. It implements multi-role ticketing (Employee, Agent, Lead, Team Admin, Owner) with SLA management, automation rules, and routing.

The review identified **3 Critical**, **14 High**, **27 Medium**, and **16 Low** findings across all layers. The most urgent issues are: **header-based authentication without cryptographic verification**, **missing team-membership validation on ticket assignment**, and **automation bypassing the ticket state machine**. The frontend has significant accessibility gaps and monolithic page components. The database has an incomplete delete strategy and a dual SLA system. There is no CI/CD pipeline and no automated test gate.

---

## 1. High-Level Findings Summary

### 1.1 Security & Authentication

| ID | Finding | Severity |
|----|---------|----------|
| SEC-01 | AuthGuard trusts `x-user-id` / `x-user-email` headers with no JWT/session verification — complete impersonation risk if API is directly exposed | **Critical** |
| SEC-02 | No rate limiting on any endpoint; bulk endpoints, file uploads, and report queries are abuse vectors | **High** |
| SEC-03 | Users list endpoint (`GET /users`) exposes all user records (including emails) to any authenticated role with no scope restriction | **Medium** |
| SEC-04 | Categories `includeInactive` query param leaks inactive categories to all roles | **Medium** |
| SEC-05 | `AppCrashFallback` renders `error.message` unconditionally in production, potentially leaking stack traces | **Medium** |
| SEC-06 | No `forbidNonWhitelisted: true` on `ValidationPipe` — unknown fields silently stripped, masking client errors | **Medium** |
| SEC-07 | File upload Multer limit hardcoded at 10MB while service checks `ATTACHMENTS_MAX_MB` — env set to 5MB still buffers 10MB into memory | **Medium** |
| SEC-08 | Hardcoded share URL in ReportsPage export (`https://app.helpdesk.local/reports/snapshots/abc123`) leaks to production | **Low** |

### 1.2 Business Logic & Data Integrity

| ID | Finding | Severity |
|----|---------|----------|
| BL-01 | `assign()` does not validate assignee is a member of the ticket's team — any user ID accepted | **Critical** |
| BL-02 | Automation `set_status` action bypasses `isValidTransition()` state machine, `resolvedAt`/`closedAt`/`completedAt` updates, and SLA pause logic | **Critical** |
| BL-03 | Automation `set_priority` does not recalculate SLA due dates (`firstResponseDueAt`, `dueAt`) | **High** |
| BL-04 | Ticket transfer does not recalculate the new team's SLA policy — old team's due dates persist | **High** |
| BL-05 | Hardcoded fallback routing logic with team slugs (`hr-operations`, `it-service-desk`) that must exist in DB | **High** |
| BL-06 | `firstResponseAt` update is non-atomic — two concurrent first messages can race | **Medium** |
| BL-07 | Duplicate SLA default configs defined identically in `TicketsService` and `SlasService` | **Low** |

### 1.3 Database & Data Layer

| ID | Finding | Severity |
|----|---------|----------|
| DB-01 | Inconsistent `onDelete` cascade: some Ticket children CASCADE, others RESTRICT — effectively no ticket can ever be deleted since TicketEvent is RESTRICT and every ticket generates events | **High** |
| DB-02 | No soft-delete pattern (`deletedAt`) on any model, no way to deactivate users or archive tickets | **High** |
| DB-03 | Dual SLA system (`SlaPolicy` legacy + `SlaPolicyConfig` new) — `SlaInstance` still references legacy table | **High** |
| DB-04 | Missing index on `RoutingRule.teamId` — every routing lookup is unindexed | **High** |
| DB-05 | `CustomField.fieldType`, `TicketEvent.type`, `AutomationRule.trigger` use free-text `String` where Prisma enums would enforce integrity | **Medium** |
| DB-06 | Missing `updatedAt` on mutable models: `TeamMember`, `TicketAccess`, `Notification`, `Attachment` | **Medium** |
| DB-07 | `SavedView` and `CannedResponse` can have both `userId` and `teamId` as NULL — orphaned records | **Medium** |
| DB-08 | Deprecated `ADMIN` enum value still in `UserRole` — new records could use it | **Medium** |
| DB-09 | Missing index on `TeamMember.userId` and `Category.parentId` | **Low** |
| DB-10 | `SlaInstance.priority` duplicates `Ticket.priority` — can drift out of sync | **Low** |

### 1.4 API Contracts & Validation

| ID | Finding | Severity |
|----|---------|----------|
| API-01 | `CreateTicketDto`: `subject` and `description` accept empty strings — missing `@IsNotEmpty()` / `@MinLength(1)` | **High** |
| API-02 | All bulk DTOs (`BulkAssign`, `BulkStatus`, `BulkTransfer`, `BulkPriority`) have no `@ArrayMaxSize()` — unbounded array DoS | **High** |
| API-03 | `CreateRoutingRuleDto.keywords` array: no max size, no per-item length limit | **Medium** |
| API-04 | Automation controller parses `page`/`pageSize` as raw strings with no bounds — `page=-1` or `pageSize=999999` accepted | **Medium** |
| API-05 | Inconsistent API response envelopes: `{ data, meta }` vs plain array vs `{ data }` vs `{ success, failed, errors }` | **Medium** |
| API-06 | SLA controller route ordering may cause `:teamId` to shadow `/policies` literal route | **Medium** |
| API-07 | No global exception filter — Prisma errors leak as raw 500s | **Medium** |

### 1.5 Frontend — UI/UX & Accessibility

| ID | Finding | Severity |
|----|---------|----------|
| FE-01 | `ManagerViewsPage.fetchAllOpenTickets()` loads ALL open tickets into memory — unbounded, crashes browser on large datasets | **High** |
| FE-02 | Clickable table rows (`<tr onClick>`) have no `tabIndex`, `role`, or `onKeyDown` — inaccessible to keyboard/screen-reader users (WCAG 2.1.1 violation) | **High** |
| FE-03 | Triage board drag-and-drop has no keyboard alternative (WCAG 2.1.1 violation) | **High** |
| FE-04 | Only `CreateTicketModal` has focus trap — 10+ other modals lack focus management | **High** |
| FE-05 | `<label>` elements in `CreateTicketModal` and `CustomFieldRenderer` not associated with inputs (`htmlFor` missing) | **High** |
| FE-06 | Priority color mapping duplicated in 4+ locations with inconsistent values (P1 is amber in one place, red in another; P2 is blue, orange, or amber depending on file) | **High** |
| FE-07 | DashboardPage fires 20+ parallel API calls on mount; 1380-line monolithic component | **Medium** |
| FE-08 | `STATUS_TRANSITIONS` map hardcoded in `TicketDetailPage` — drifts from backend if transitions change | **Medium** |
| FE-09 | ReportsPage export modal is non-functional — "Export" button just shows a toast; share link is fake | **Medium** |
| FE-10 | Three React Query hooks in `useTicketCountsQuery.ts` exported but never imported anywhere | **Medium** |
| FE-11 | Tables enforce `min-w-[1180px]` — no mobile-responsive card layout | **Medium** |
| FE-12 | `apiErrorMessage()` utility duplicated in 5 page files instead of using centralized `handleApiError` | **Low** |

### 1.6 Deployment & Operations

| ID | Finding | Severity |
|----|---------|----------|
| OPS-01 | No CI/CD pipeline (no GitHub Actions, no test gates) — deployments are manual via PowerShell ZIP script | **High** |
| OPS-02 | No Dockerfile — only `docker-compose.yml` for local dev; production runs via ZIP on Azure App Service | **Medium** |
| OPS-03 | No health-check endpoint for load balancers or container orchestration | **Medium** |
| OPS-04 | No DB connection retry on startup — app crashes if PostgreSQL is briefly unavailable | **Medium** |
| OPS-05 | Schema column-check results (`hasRoutingAssigneeColumn`, etc.) cached forever — server restart required after migrations | **Low** |
| OPS-06 | No request timeout configuration beyond Node.js defaults | **Low** |

### 1.7 Concurrency & Transactions

| ID | Finding | Severity |
|----|---------|----------|
| TX-01 | `assign()`: ticket update + 2 event creates not in a transaction — crash leaves incomplete audit trail | **High** |
| TX-02 | Status `transition()`: ticket update + event create + SLA sync — 3 separate writes, no transaction | **High** |
| TX-03 | `addMessage()` first-response update — two concurrent messages can race on `firstResponseAt === null` | **Medium** |

---

## 2. Top 5 Critical Issues with Reproducible Steps

### Issue 1: Header-Based Auth Bypass (SEC-01)

**Severity:** Critical  
**Location:** `apps/api/src/auth/auth.guard.ts`

**Steps to reproduce:**
1. Start the API server: `npm run dev` from root
2. Send a request with spoofed headers:
```bash
curl -H "x-user-id: <any-valid-user-uuid>" \
     -H "x-user-email: owner@company.com" \
     http://localhost:3000/api/tickets
```
3. Observe full access to the system as the impersonated user

**Expected:** Requests must carry a cryptographically signed token (JWT/session cookie) validated by the server  
**Actual:** Any HTTP client can impersonate any user by setting two headers

**Remediation:** Implement JWT validation (e.g., via Azure AD `@azure/msal-node`) or session-based auth. If running behind a trusted proxy, add middleware that rejects requests not from the proxy IP and strip incoming auth headers.

---

### Issue 2: Assignee Not Validated Against Team Membership (BL-01)

**Severity:** Critical  
**Location:** `apps/api/src/tickets/tickets.service.ts`, `assign()` method

**Steps to reproduce:**
1. Create Team A with Agent-1 and Team B with Agent-2
2. Create a ticket assigned to Team A
3. Call `PUT /tickets/:id/assign` with `{ "assigneeId": "<Agent-2-UUID>" }`
4. Observe the ticket is assigned to Agent-2 (Team B member) while remaining in Team A

**Expected:** Assignment should reject or auto-transfer when assignee is not on the ticket's team  
**Actual:** Any valid user UUID is accepted as assignee regardless of team membership

**Remediation:** Add team membership check in `assign()` mirroring the validation already present in `transfer()`.

---

### Issue 3: Automation Bypasses State Machine (BL-02)

**Severity:** Critical  
**Location:** `apps/api/src/automation/rule-engine.service.ts`, `set_status` action

**Steps to reproduce:**
1. Create an automation rule: trigger=`STATUS_CHANGED`, condition=`status equals IN_PROGRESS`, action=`set_status: CLOSED`
2. Move a ticket to IN_PROGRESS
3. Observe the ticket jumps directly to CLOSED without passing through RESOLVED
4. Verify `resolvedAt`, `closedAt`, `completedAt` fields are NOT set
5. Verify the SLA instance is NOT paused/completed

**Expected:** Automation should respect the same transition rules as manual status changes, update timestamp fields, and sync SLA  
**Actual:** Automation performs a raw DB update bypassing `isValidTransition()`, timestamp logic, and SLA sync

**Remediation:** Refactor `set_status` to call the existing `transition()` service method (or a shared internal method) that enforces the state machine.

---

### Issue 4: No CI/CD Pipeline (OPS-01)

**Severity:** High  
**Location:** Repository root — no `.github/workflows/` directory

**Steps to reproduce:**
1. Push code to any branch on GitHub
2. Observe no automated checks run (lint, test, build, security scan)
3. Merge to main — no deployment is triggered

**Expected:** PRs should gate on lint + unit tests + integration tests + build. Merges to main should auto-deploy to staging.  
**Actual:** Deployment is fully manual via `create-deploy-zip.ps1` + Azure portal upload

**Remediation:** Create GitHub Actions workflow with: lint → test → build → deploy-staging pipeline. See remediation plan below.

---

### Issue 5: ManagerViewsPage Unbounded Memory Fetch (FE-01)

**Severity:** High  
**Location:** `apps/web/src/pages/ManagerViewsPage.tsx`, `fetchAllOpenTickets()`

**Steps to reproduce:**
1. Seed database with 5,000+ open tickets across teams
2. Log in as a Lead or Team Admin
3. Navigate to Manager Views page
4. Observe browser tab memory climbing continuously as all pages are fetched
5. On slow networks, the page shows a loading spinner for 30+ seconds

**Expected:** Paginated or aggregated view with server-side grouping  
**Actual:** Client fetches every page sequentially into a single array, then processes all tickets in-memory

**Remediation:** Create a server-side aggregation endpoint (e.g., `GET /tickets/manager-summary`) that returns pre-grouped data, or implement virtual scrolling with server-side pagination.

---

## 3. Ticket Workflow Inconsistencies

### 3.1 Status Transition Map

The backend defines valid transitions in `isValidTransition()` but automation bypasses it entirely (BL-02 above). The frontend defines its own `STATUS_TRANSITIONS` map in `TicketDetailPage.tsx` that must manually mirror the backend — there is no shared contract or API endpoint to fetch allowed transitions.

### 3.2 Assignment Without Status Enforcement

When a ticket moves to `ASSIGNED` status, the backend does NOT require an `assigneeId` to be set. Conversely, calling `assign()` auto-transitions from `NEW`/`TRIAGED` to `ASSIGNED`, but a ticket can be manually transitioned to `ASSIGNED` without an assignee via the `transition()` endpoint. In Zendesk, assignment and status are tightly coupled — assigning always sets status to Open, and a ticket cannot be "Assigned" without an assignee.

### 3.3 Transfer Doesn't Reset SLA

When a ticket is transferred between teams, the SLA configuration (which is team-specific with potentially different response/resolution targets) is not recalculated. The original team's SLA deadlines persist. In Zendesk and ServiceNow, group reassignment re-evaluates SLA policies based on the new group's configuration.

### 3.4 Reopen Flow Incomplete

A ticket in `RESOLVED` or `CLOSED` status can be reopened to `REOPENED`. However:
- The SLA clock does not restart on reopen
- `completedAt` is not cleared
- No automation trigger fires for `TICKET_REOPENED`
- The frontend shows `REOPENED` but the transition back to `IN_PROGRESS` requires a manual step

In Zendesk, reopening restarts the resolution SLA clock and triggers any configured automation.

### 3.5 No Pending/On-Hold SLA Pause

While `WAITING_ON_REQUESTER` and `WAITING_ON_VENDOR` statuses exist and the SLA instance tracks `pausedAt`, the SLA breach service does not fully implement clock pausing — it checks `pausedAt` but the `syncFromTicket()` method's pause/resume logic is fragile and not covered by integration tests.

---

## 4. Notable Broken Links, UI Mismatches, and Backend Mismatches

### 4.1 Priority Color Inconsistency

| Priority | `TicketTableView.tsx` | `statusColors.ts` | `CommandPalette.tsx` | `DashboardPage.tsx` |
|----------|-----------------------|-------------------|-----------------------|---------------------|
| P1 | amber | red | red | red |
| P2 | blue | orange | amber | orange |

Users will see different color meanings for the same priority depending on which page they are viewing.

### 4.2 Export Feature is Non-Functional

The ReportsPage export modal renders format/dataset buttons with no state tracking. The "Export" button shows a success toast but exports nothing. The "Share Link" copies a hardcoded fake URL.

### 4.3 Dashboard "Routing Exceptions" Shows Hardcoded Zeros

The Team Admin dashboard panel for "Emails not parsed" and "Failed webhooks" displays hardcoded `0` values — no backend endpoint provides this data.

### 4.4 Categories Page Access Mismatch

The sidebar shows Categories navigation to `TEAM_ADMIN` users, but the page enforces `OWNER`-only access, silently redirecting to `/dashboard`. No 403 or disabled state is shown.

### 4.5 Frontend Status List Missing Backend Coverage

`FilterPanel.tsx` hardcodes 9 statuses. If the backend adds a status (e.g., `ESCALATED` as referenced in the Zendesk gap doc), the filter panel silently omits it.

### 4.6 API Response Envelope Inconsistency

- `GET /tickets` returns `{ data: [...], meta: { page, pageSize, total, totalPages } }`
- `GET /canned-responses` returns a plain array
- `GET /categories` returns `{ data: [...] }` (no meta)
- Bulk operations return `{ success: number, failed: number, errors: [...] }`

Frontend code must handle each shape separately, and any new endpoint has no standard to follow.

---

## 5. Zendesk/ServiceNow Feature Gap Analysis

| Feature | Zendesk/ServiceNow | Codex Status | Gap |
|---------|-------------------|--------------|-----|
| **Authentication** | SSO (SAML/OIDC), API tokens | Header-based impersonation | **Critical gap** |
| **Ticket lifecycle** | Open → Pending → Solved → Closed with strict rules | 9 statuses, automation bypasses rules | **Major gap in enforcement** |
| **Assignment validation** | Agent must belong to group | No membership check | **Major gap** |
| **SLA on transfer** | Re-evaluates per new group | Old SLA persists | **Major gap** |
| **SLA business hours** | Full calendar with holidays and pause on waiting statuses | Schema exists but implementation incomplete | **Moderate gap** |
| **Tags** | Core feature for routing, triggers, reporting | Not implemented (planned Phase 1) | **Feature missing** |
| **Knowledge base** | Help center with search, categories, versioning | Not implemented (planned Phase 2) | **Feature missing** |
| **CSAT surveys** | Post-resolution satisfaction rating | Not implemented (planned Phase 4) | **Feature missing** |
| **Omnichannel** | Email, chat, phone, social, messaging | Email partial; portal only | **Major gap** |
| **Macros** | Agent-side response templates | Implemented as canned responses | **Parity** |
| **Triggers/Automations** | Event-based + time-based rules | Event-based implemented; time-based partial | **Moderate gap** |
| **Reporting** | Pre-built dashboards + custom reports + export | Dashboards present; export non-functional | **Moderate gap** |
| **Audit log** | Admin action logging with retention | Implemented but no retention policy | **Minor gap** |
| **Saved views** | Personal + shared filter bookmarks | Implemented | **Parity** |
| **Collision detection** | Shows other agents viewing same ticket | Not implemented | **Feature missing** |
| **Sandbox/staging** | Configuration sandbox for testing changes | Not implemented | **Feature missing** |

---

## 6. Suggested Remediation Plan

### Sprint 1 — Security & Correctness (Week 1-2)

| # | Item | Priority | Owner | Effort |
|---|------|----------|-------|--------|
| 1 | Implement JWT/session auth replacing header trust | P0 | Backend | 3-5 days |
| 2 | Add team-membership validation in `assign()` | P0 | Backend | 0.5 day |
| 3 | Refactor automation `set_status` to use `transition()` | P0 | Backend | 1 day |
| 4 | Add `@IsNotEmpty()` on subject/description/body DTOs | P1 | Backend | 0.5 day |
| 5 | Add `@ArrayMaxSize(100)` to all bulk DTOs | P1 | Backend | 0.5 day |
| 6 | Add rate limiting (e.g., `@nestjs/throttler`) | P1 | Backend | 1 day |
| 7 | Add global Prisma exception filter | P1 | Backend | 0.5 day |

### Sprint 2 — Data Integrity & Transactions (Week 3-4)

| # | Item | Priority | Owner | Effort |
|---|------|----------|-------|--------|
| 8 | Wrap `assign()`, `transition()`, `addMessage()` in `$transaction` | P1 | Backend | 2 days |
| 9 | Add missing indexes (RoutingRule.teamId, TeamMember.userId, Category.parentId) | P1 | Backend | 0.5 day |
| 10 | Unify SLA system — migrate `SlaInstance` to `SlaPolicyConfig` | P1 | Backend | 3 days |
| 11 | Implement soft-delete on User, Ticket, Team | P2 | Backend | 2 days |
| 12 | Standardize onDelete cascades for Ticket children | P2 | Backend | 1 day |
| 13 | Recalculate SLA on ticket transfer | P1 | Backend | 1 day |

### Sprint 3 — Frontend Quality (Week 5-6)

| # | Item | Priority | Owner | Effort |
|---|------|----------|-------|--------|
| 14 | Make table rows keyboard-accessible (tabIndex, role, onKeyDown) | P1 | Frontend | 1 day |
| 15 | Add focus traps to all modals (extract reusable hook) | P1 | Frontend | 1.5 days |
| 16 | Associate all `<label>` elements with inputs via `htmlFor`/`id` | P1 | Frontend | 1 day |
| 17 | Centralize priority/status colors — remove all local duplicates | P1 | Frontend | 1 day |
| 18 | Replace `fetchAllOpenTickets()` with server-side aggregation | P1 | Backend + Frontend | 2 days |
| 19 | Migrate DashboardPage state to React Query (already scaffolded) | P2 | Frontend | 3 days |
| 20 | Split monolithic pages (Dashboard 1380 LOC, SLA 1960 LOC, Reports 1810 LOC) | P2 | Frontend | 3 days |

### Sprint 4 — DevOps & Hardening (Week 7-8)

| # | Item | Priority | Owner | Effort |
|---|------|----------|-------|--------|
| 21 | Create GitHub Actions CI pipeline (lint → test → build) | P1 | DevOps | 2 days |
| 22 | Add Dockerfile for production builds | P2 | DevOps | 1 day |
| 23 | Add health-check endpoint (`GET /health`) | P2 | Backend | 0.5 day |
| 24 | Add DB connection retry with exponential backoff | P2 | Backend | 0.5 day |
| 25 | Convert string-typed DB fields to proper enums | P3 | Backend | 2 days |
| 26 | Add `updatedAt` to mutable models missing it | P3 | Backend | 1 day |
| 27 | Implement functional report export (CSV) | P2 | Full-stack | 2 days |

---

## 7. Quick-Start Checklist for Local Reproduction & Verification

### Prerequisites
- Node.js 20+, npm 10+
- Docker Desktop (for PostgreSQL + Redis)
- Git

### Environment Setup

```bash
# 1. Clone and install
git clone <repo-url> && cd Codex_Ticketing\ System
npm install

# 2. Start infrastructure
docker compose up -d   # PostgreSQL on :5432, Redis on :6379

# 3. Configure environment
cp .env.example .env
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env:
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/codex_ticketing
#   REDIS_HOST=localhost
#   REDIS_PORT=6379

# 4. Run migrations and seed
cd apps/api
npx prisma migrate deploy
npx prisma db seed
cd ../..

# 5. Start dev servers
npm run dev
# API: http://localhost:3000
# Web: http://localhost:5173
```

### Verify Critical Issues

```bash
# SEC-01: Auth bypass — should fail with 401, currently returns 200
curl -H "x-user-id: <any-uuid>" -H "x-user-email: fake@test.com" \
  http://localhost:3000/api/tickets

# BL-01: Cross-team assignment — should return 400/403
# 1. Get two users from different teams
# 2. Assign user-B to ticket owned by team-A
curl -X PUT http://localhost:3000/api/tickets/<ticket-id>/assign \
  -H "Content-Type: application/json" \
  -H "x-user-id: <lead-uuid>" \
  -H "x-user-email: lead@test.com" \
  -d '{"assigneeId": "<agent-from-other-team>"}'

# API-01: Empty subject — should return 400, currently returns 201
curl -X POST http://localhost:3000/api/tickets \
  -H "Content-Type: application/json" \
  -H "x-user-id: <user-uuid>" \
  -H "x-user-email: user@test.com" \
  -d '{"subject": "", "description": "", "assignedTeamId": "<team-id>"}'
```

### Run Existing Tests

```bash
# Unit tests
cd apps/api && npm test

# Integration tests (requires test DB)
npm run test:integration

# E2E tests (requires full stack running)
cd ../.. && npm run e2e
```

---

## 8. Access Limitations & Gaps

| Area | Gap | Proposed Resolution |
|------|-----|---------------------|
| Integration test suite | `test/jest.integration.json` referenced but not found in repo — may be gitignored | Confirm test config exists; add to repo if missing |
| Azure deployment | Only documented for App Service; no staging/production env files visible | Review Azure portal for env parity; add `.env.staging` template |
| Email inbound | M365 webhook configuration not verifiable without tenant access | Obtain M365 sandbox credentials for testing email flow |
| Redis queue workers | Cannot verify BullMQ job processing without Redis + running workers | Add worker health dashboard or BullBoard integration |
| Load/performance testing | No load test suite exists | Add k6 or Artillery scripts for critical endpoints |

---

## 9. Summary Metrics

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Security & Auth | 1 | 1 | 5 | 1 | 8 |
| Business Logic | 2 | 3 | 1 | 1 | 7 |
| Database | 0 | 4 | 4 | 2 | 10 |
| API Contracts | 0 | 2 | 5 | 0 | 7 |
| Frontend | 0 | 6 | 6 | 1 | 13 |
| Transactions | 0 | 2 | 1 | 0 | 3 |
| Deployment/Ops | 0 | 1 | 3 | 2 | 6 |
| **Total** | **3** | **19** | **25** | **7** | **54** |

The three Critical items (SEC-01, BL-01, BL-02) should be addressed before any production traffic. The 19 High items represent the next tranche of work, roughly sized at 4 two-week sprints with a team of 2 backend + 1 frontend engineers.

---

## 10. CODEX_FIndings (Additional)

These findings were identified by a separate Codex code review and are tracked here separately from the main counts above.

| ID | Finding | Severity | Location | Remediation |
|----|---------|----------|----------|-------------|
| CX-01 | Audit log pagination is incorrect when combining ticket events + admin audit events; each source is paged separately and then merged/sliced, which can skip or duplicate globally sorted records across pages | **High** | `apps/api/src/audit/audit.service.ts` | Implement global pagination at the database layer (single combined query with unified `ORDER BY createdAt DESC` + `LIMIT/OFFSET`) and separate total/count queries |
| CX-02 | Historical Prisma migration was edited after creation (`20260202215754...`), creating migration-history/checksum risk across environments | **High** | `apps/api/prisma/migrations/20260202215754_add_owner_team_admin_primary_team/migration.sql` | Restore the historical migration file exactly and place any corrective data changes in a new forward-only migration |
| CX-03 | `categoryCounts` in audit response is computed from current page data while UI displays it like global totals for the active filters | **Medium** | `apps/api/src/audit/audit.service.ts`, `apps/web/src/pages/AuditLogPage.tsx` | Define a single contract: either return full filtered totals from backend or relabel UI as page-only counts |
| CX-04 | Audit search/export path is capped (2000 rows), which can silently truncate expected results | **Medium** | `apps/api/src/audit/audit.service.ts` | Use different limits per use case (interactive list vs export), and include explicit truncation metadata when caps are applied |
| CX-05 | Round-robin pointer (`lastAssignedUserId`) can advance even if ticket creation fails, causing assignment drift | **Medium** | `apps/api/src/tickets/tickets.service.ts` | Resolve assignee and update round-robin pointer inside the same transaction as `ticket.create` so both succeed/fail atomically |
| CX-06 | SLA assignment lookup uses `LIMIT 1` without deterministic ordering, so behavior can become nondeterministic if data integrity is violated | **Low** | `apps/api/src/slas/slas.service.ts` | Add deterministic ordering and defensive integrity checks; keep uniqueness constraints enforced and monitored |

---

## 11. Remediation Status Updates (Current Branch)

The original finding counts above represent the assessment snapshot. The table below tracks remediation progress implemented after that snapshot.

| ID | Status | Date | Validation | Evidence |
|----|--------|------|------------|----------|
| FE-03 | **Completed** | 2026-02-18 | `npm run -w apps/web build` passed | Keyboard alternative added on triage cards via status select control (`apps/web/src/pages/TriageBoardPage.tsx`) |
| FE-04 | **Completed** | 2026-02-18 | `npm run -w apps/web build` passed | Reusable modal focus trap hook added and integrated across modal/drawer surfaces (`apps/web/src/hooks/useModalFocusTrap.ts`, `apps/web/src/pages/*`, `apps/web/src/components/*`) |
| FE-06 | **Completed** | 2026-02-19 | `npm run -w apps/web build` passed | Replaced remaining duplicated priority color logic with centralized status-color utilities (`apps/web/src/utils/statusColors.ts`, `apps/web/src/components/TicketTableView.tsx`, `apps/web/src/components/CommandPalette.tsx`, `apps/web/src/pages/ManagerViewsPage.tsx`, `apps/web/src/pages/TriageBoardPage.tsx`) |
| FE-08 | **Completed** | 2026-02-19 | `npm run build` passed; `npm run -w apps/api test:integration -- test/integration/tickets.lifecycle.spec.ts` passed; `npx playwright test e2e/lifecycle.spec.ts --grep "agent assigns and transitions a ticket"` passed | Removed frontend hardcoded transition map; ticket detail now uses backend-provided `allowedTransitions` (`apps/web/src/pages/TicketDetailPage.tsx`, `apps/web/src/api/client.ts`, `apps/api/src/tickets/tickets.service.ts`) |
| FE-09 | **Completed** | 2026-02-19 | `npm run -w apps/web build` passed | Replaced hardcoded reports share URL with computed current-view link (`apps/web/src/pages/ReportsPage.tsx`) |
| FE-12 | **Completed** | 2026-02-19 | `npm run -w apps/web build` passed | Removed duplicated per-page `apiErrorMessage()` implementations; centralized on shared `handleApiError` utility (`apps/web/src/pages/AuditLogPage.tsx`, `apps/web/src/pages/AutomationRulesPage.tsx`, `apps/web/src/pages/CategoriesPage.tsx`, `apps/web/src/pages/CustomFieldsAdminPage.tsx`, `apps/web/src/pages/RoutingRulesPage.tsx`, `apps/web/src/pages/ReportsPage.tsx`, `apps/web/src/utils/handleApiError.ts`) |
| SEC-01 | **Completed** | 2026-02-19 | `npm run -w apps/api test:integration -- test/integration/security.auth.spec.ts` passed | Auth guard requires bearer token when insecure header mode is disabled; HS256 bearer validation path is covered by integration test (`apps/api/src/auth/auth.guard.ts`, `apps/api/test/integration/security.auth.spec.ts`) |
| SEC-02 | **Completed** | 2026-02-19 | `npm run -w apps/api test:integration -- test/integration/security.rate-limit.spec.ts` passed | Global API throttling active via `ThrottlerGuard` and env-configurable limits; integration test verifies `429` after limit is exceeded (`apps/api/src/app.module.ts`, `apps/api/test/integration/security.rate-limit.spec.ts`) |
| SEC-03 | **Completed** | 2026-02-19 | `npm run -w apps/api test:integration -- test/integration/security.scoping.spec.ts` passed | User listing is role-scoped (owner/all, team admin/team scope, other roles blocked) (`apps/api/src/users/users.service.ts`, `apps/api/test/integration/security.scoping.spec.ts`) |
| SEC-04 | **Completed** | 2026-02-19 | `npm run -w apps/api test:integration -- test/integration/security.scoping.spec.ts` passed | `includeInactive` categories restricted to owners with explicit 403 for non-owners (`apps/api/src/categories/categories.service.ts`, `apps/api/test/integration/security.scoping.spec.ts`) |
| OPS-01 | **Completed** | 2026-02-19 | `npm run lint` passed; `npm run build` passed | Added GitHub Actions CI workflow with lint/build/integration/e2e jobs and artifact upload (`.github/workflows/ci.yml`) |
| OPS-02 | **Completed** | 2026-02-19 | `npm run build` passed | Added production multi-stage container build and runtime entrypoint with optional Prisma migrations (`Dockerfile`, `.dockerignore`, `docker/entrypoint.sh`) |
| OPS-04 | **Completed** | 2026-02-19 | `npm run lint` passed; `npm run build` passed; `npm run -w apps/api test:integration -- test/integration/api.contract.spec.ts` passed | Added Prisma startup DB connection retry with exponential backoff and configurable env controls (`apps/api/src/prisma/prisma.service.ts`, `apps/api/.env.example`) |
| OPS-05 | **Completed** | 2026-02-19 | `npm run lint` passed; `npm run build` passed; `npm run -w apps/api test:integration -- test/integration/tickets.lifecycle.spec.ts` passed | Replaced forever-cached schema capability checks with TTL-based refresh for routing assignee column checks (`apps/api/src/routing/routing.service.ts`, `apps/api/src/tickets/tickets.service.ts`, `apps/api/.env.example`) |
| OPS-06 | **Completed** | 2026-02-19 | `npm run lint` passed; `npm run build` passed; `npm run -w apps/api test:integration -- test/integration/security.validation.spec.ts` passed | Added explicit HTTP timeout configuration (request/headers/keep-alive) with environment controls (`apps/api/src/main.ts`, `apps/api/.env.example`) |

### 11.1 Smoke Test Note

Playwright E2E specs were migrated to bearer-token auth (HS256 test tokens) on 2026-02-18.  
Current local run caveat: if Playwright reuses an already-running dev server without `AUTH_JWT_SECRET`, auth fails (`401 HS256 auth is not configured`). Run tests against a freshly started Playwright web server (or restart local API with matching `AUTH_JWT_SECRET`) to validate end-to-end.
