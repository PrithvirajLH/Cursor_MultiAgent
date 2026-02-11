# Codex Ticketing System — Project Documentation

Complete reference for the Unified Ticketing System: architecture, APIs, UI, design, and implementation details.
Canonical planning/status source: `docs/unified-status-and-backlog-2026-02-09.md`.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Data Model (Prisma Schema)](#4-data-model-prisma-schema)
5. [API Reference](#5-api-reference)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [Frontend (Web App)](#7-frontend-web-app)
8. [UI & Design Implementation](#8-ui--design-implementation)
9. [Features Implemented](#9-features-implemented)
10. [Infrastructure & DevOps](#10-infrastructure--devops)
11. [Testing](#11-testing)
12. [Related Documentation](#12-related-documentation)

---

## 1. Project Overview

**Name:** Unified Ticketing System (Codex Ticketing System)

**Purpose:** Enterprise ticketing platform for multi-department operations (IT, HR, AI, Medicaid Pending, White Gloves). Single place for employees to request help, route tickets to the right team, track SLAs (first response + resolution), and maintain auditability.

**Scope (Phase 1):**
- Requester portal: create ticket, view status, add replies
- Agent console: triage, assign, internal notes, resolve/close
- Team-based routing (rules + optional round-robin)
- Basic email outbound notifications
- Audit trail of ticket events

**Repository structure:**
- **`apps/api`** — NestJS REST API (Prisma + PostgreSQL)
- **`apps/web`** — React (Vite) SPA
- **`frontend/swiftdesk-hub`** — Separate React/Vite frontend (alternative UI; not the main app)
- **`e2e`** — Playwright end-to-end tests
- **`docs`** — Requirements, roles, SLAs, wireframes, UI/UX tasks

---

## 2. System Architecture

### High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT (Browser)                                │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  apps/web (Vite + React 19)                                          │ │
│  │  - React Router 6                                                    │ │
│  │  - Tailwind CSS, Recharts, Lucide, Motion                            │ │
│  │  - API client (fetch + x-user-email / x-user-id)                     │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ HTTP/REST (CORS, JSON)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  API (NestJS) — Global prefix: /api                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ AuthGuard   │  │ AdminGuard  │  │ OwnerGuard  │  │ Validation  │    │
│  │ (global)    │  │ (reports)   │  │ (optional)  │  │ Pipe        │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│  Controllers: tickets, teams, users, categories, routing-rules, slas,   │
│               saved-views, canned-responses, custom-fields,              │
│               notifications, reports, automation-rules, audit-log,       │
│               attachments, health                                         │
│  Services: business logic + PrismaService                                │
└─────────────────────────────────────────────────────────────────────────┘
                                        │
          ┌─────────────────────────────┼─────────────────────────────┐
          ▼                             ▼                             ▼
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│  PostgreSQL 16   │         │  Redis 7          │         │  Local filesystem │
│  (Prisma ORM)    │         │  (BullMQ queues)  │         │  (uploads/)       │
│  - All entities  │         │  - Email queue    │         │  - Attachments     │
│  - Migrations    │         │  - SLA workers    │         │                   │
└──────────────────┘         └──────────────────┘         └──────────────────┘
```

### Request Flow

1. **Web app** uses `VITE_API_BASE_URL` (default `http://localhost:3000/api`) and sends `x-user-email` or `x-user-id` on every request (demo mode until Azure AD).
2. **API** applies `AuthGuard` globally (except `@Public()` routes). Guard resolves user from DB, attaches `AuthUser` to request (`id`, `email`, `role`, `teamId`, `teamRole`, `primaryTeamId`).
3. **Controllers** use `@CurrentUser()` to get user; services enforce scope (requester sees own tickets, agents see team tickets, OWNER/TEAM_ADMIN/LEAD see admin/reports).
4. **Reports** require `AdminGuard` (OWNER, TEAM_ADMIN, or LEAD).
5. **Automation rules** and **Audit log** require `TeamAdminOrOwnerGuard` (OWNER or TEAM_ADMIN).
6. **Categories** create/update/delete require **OWNER** (enforced in `CategoriesService.ensureOwner`; no controller-level guard).
7. **Teams** create requires **OWNER**; update/members require TEAM_ADMIN (primary team) or OWNER. List: TEAM_ADMIN sees only primary team.

---

## 3. Technology Stack

| Layer        | Technology |
|-------------|------------|
| **API**     | NestJS 11, TypeScript 5.7, Prisma 6.3, class-validator/class-transformer, Helmet, BullMQ, ioredis, nodemailer |
| **Database**| PostgreSQL 16 (Prisma client) |
| **Cache/Queue** | Redis 7 (BullMQ for email and SLA workers) |
| **Web**     | React 19, Vite 7, React Router 6, TypeScript 5.9 |
| **UI**      | Tailwind CSS 3, Lucide React, Recharts 3, Motion 12, clsx, tailwind-merge, class-variance-authority |
| **Content** | marked, DOMPurify (sanitized HTML in messages) |
| **E2E**     | Playwright 1.58 |
| **Infra**   | Docker Compose (Postgres, Postgres test, Redis); npm workspaces |

---

## 4. Data Model (Prisma Schema)

**Location:** `apps/api/prisma/schema.prisma`

### Enums

| Enum | Values |
|------|--------|
| `TicketStatus` | NEW, TRIAGED, ASSIGNED, IN_PROGRESS, WAITING_ON_REQUESTER, WAITING_ON_VENDOR, RESOLVED, CLOSED, REOPENED |
| `TicketPriority` | P1, P2, P3, P4 |
| `TicketChannel` | PORTAL, EMAIL |
| `MessageType` | PUBLIC, INTERNAL |
| `TeamRole` | AGENT, LEAD, ADMIN |
| `TeamAssignmentStrategy` | QUEUE_ONLY, ROUND_ROBIN |
| `UserRole` | EMPLOYEE, AGENT, LEAD, ADMIN (deprecated), TEAM_ADMIN, OWNER |
| `AccessLevel` | READ, WRITE |
| `NotificationChannel` | EMAIL |
| `OutboxStatus` | PENDING, PROCESSING, SENT, FAILED |
| `AttachmentScanStatus` | PENDING, CLEAN, INFECTED, FAILED |
| `NotificationType` | TICKET_ASSIGNED, TICKET_UPDATED, NEW_MESSAGE, TICKET_MENTIONED, SLA_AT_RISK, SLA_BREACHED, TICKET_RESOLVED, TICKET_TRANSFERRED |

### Core Models

| Model | Key Fields | Relations |
|-------|------------|-----------|
| **User** | id, email, displayName, department, location, role, primaryTeamId | teamMemberships, primaryTeam, requestedTickets, assignedTickets, messages, events, ticketFollows, notifications, savedViews, cannedResponses, attachments |
| **Team** | id, name, slug, description, assignmentStrategy, lastAssignedUserId, isActive | members, tickets, routingRules, slaPolicies, savedViews, cannedResponses, customFields |
| **TeamMember** | teamId, userId, role (TeamRole) | team, user |
| **Category** | id, name, slug, description, isActive, parentId | parent, children, tickets, customFields |
| **Ticket** | id, number, displayId, subject, description, status, priority, channel, requesterId, assignedTeamId, assigneeId, categoryId, dueAt, firstResponseDueAt, firstResponseAt, slaPausedAt, resolvedAt, closedAt, completedAt | requester, assignedTeam, assignee, category, messages, events, accessGrants, followers, attachments, slaInstance, notifications, customFieldValues |
| **TicketMessage** | ticketId, authorId, type (PUBLIC/INTERNAL), body | ticket, author |
| **TicketEvent** | ticketId, type, payload, createdById | ticket, createdBy |
| **TicketAccess** | ticketId, teamId, accessLevel | ticket, team |
| **TicketFollower** | ticketId, userId | ticket, user |
| **RoutingRule** | name, keywords[], teamId, priority, isActive | team |
| **SlaPolicy** | teamId, priority, firstResponseHours, resolutionHours | team, instances |
| **SlaInstance** | ticketId, policyId, priority, firstResponseDueAt, resolutionDueAt, pausedAt, nextDueAt, *AtRisk*/*Breached* timestamps | ticket, policy |
| **CustomField** | name, fieldType (TEXT, TEXTAREA, NUMBER, DROPDOWN, MULTISELECT, DATE, CHECKBOX, USER), options (JSON), isRequired, teamId, categoryId, sortOrder | team, category, values |
| **CustomFieldValue** | ticketId, customFieldId, value | ticket, customField |
| **Attachment** | ticketId, uploadedById, fileName, contentType, sizeBytes, storageKey, scanStatus | ticket, uploadedBy |
| **Notification** | userId, type, title, body, ticketId, actorId, isRead, readAt | user, ticket, actor |
| **NotificationOutbox** | channel, status, eventType, toEmail, toUserId, ticketId, subject, body, payload, attempts, lastError, sentAt | toUser, ticket |
| **SavedView** | name, filters (JSON), userId, teamId, isDefault | user, team |
| **CannedResponse** | name, content, userId, teamId | user, team |

### Migrations (Applied)

- `initial_migration`, `add_categories`, `add_completed_at`, `routing_rules`, `add_ticket_display_id`
- `add_sla_fields`, `add_sla_policy`, `sla`, `add_followers_outbox`, `outbox`
- `sprint3_attachments_assignment`, `add_sla_instance`, `add_notifications`, `add_sla_at_risk`
- `add_saved_views`, `add_canned_response`, `admin_custom_fields`, `add_owner_team_admin_primary_team`, `data_admin_to_team_admin`, `seed_owner_user_if_missing`

---

## 5. API Reference

**Base URL:** `http://localhost:3000/api` (or `VITE_API_BASE_URL` from web app)

**Auth headers (until Azure AD):** `x-user-id: <uuid>` or `x-user-email: <email>`

**Content-Type:** `application/json` (multipart for file uploads)

**Pagination (where applicable):** Default `page=1`, `pageSize=20`; max `pageSize=100` (see `PaginationDto`).

---

### 5.1 Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | Public | `{ status: 'ok', timestamp: string }` |

---

### 5.2 Tickets

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tickets` | List tickets. Query: page, pageSize, status, statuses, statusGroup, scope (all\|assigned\|unassigned\|created), priority, priorities, teamId, teamIds, assigneeId, assigneeIds, requesterId, requesterIds, slaStatus[], createdFrom, createdTo, updatedFrom, updatedTo, dueFrom, dueTo, q, sort (createdAt\|completedAt\|updatedAt), order (asc\|desc). Returns `{ data, meta }`. |
| GET | `/api/tickets/counts` | Counts: assignedToMe, triage, open, unassigned. |
| GET | `/api/tickets/activity` | Activity series. Query: from, to, scope (e.g. assigned). |
| GET | `/api/tickets/status-breakdown` | Status breakdown. Query: from, to, scope, dateField (createdAt\|updatedAt). |
| GET | `/api/tickets/:id` | Single ticket with messages, events, followers, attachments, customFieldValues. |
| POST | `/api/tickets` | Create ticket. Body: subject, description, priority?, channel?, assignedTeamId?, assigneeId?, requesterId?, categoryId?, customFieldValues?. Ticket gets auto-increment `number` and optional `displayId` (e.g. `IT_20260123_001` from team code + date + sequence). |
| POST | `/api/tickets/bulk/assign` | Bulk assign. Body: ticketIds[], assigneeId?. |
| POST | `/api/tickets/bulk/transfer` | Bulk transfer. Body: ticketIds[], newTeamId, assigneeId?. |
| POST | `/api/tickets/bulk/status` | Bulk status. Body: ticketIds[], status. |
| POST | `/api/tickets/bulk/priority` | Bulk priority. Body: ticketIds[], priority. |
| POST | `/api/tickets/:id/messages` | Add message. Body: body, type? (PUBLIC\|INTERNAL). |
| POST | `/api/tickets/:id/attachments` | Upload file (multipart, field `file`, max 10MB). |
| POST | `/api/tickets/:id/assign` | Assign. Body: assigneeId?. |
| POST | `/api/tickets/:id/transfer` | Transfer. Body: newTeamId, assigneeId?. |
| POST | `/api/tickets/:id/transition` | Transition status. Body: status. |
| GET | `/api/tickets/:id/followers` | List followers. |
| POST | `/api/tickets/:id/followers` | Follow. Body: userId? (default current user). |
| DELETE | `/api/tickets/:id/followers/:userId` | Unfollow (`userId` or `me`). |

---

### 5.3 Attachments

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/attachments/:id` | Download attachment (StreamableFile). |

---

### 5.4 Teams

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/teams` | List teams. **TEAM_ADMIN** sees only primary team; OWNER sees all. Query: page?, pageSize?, q?. |
| POST | `/api/teams` | Create team. **OWNER only.** Body: name, slug?, description?, assignmentStrategy?. |
| PATCH | `/api/teams/:id` | Update team. **TEAM_ADMIN** (primary team) or **OWNER.** Body: name?, slug?, description?, isActive?, assignmentStrategy?. |
| GET | `/api/teams/:id/members` | List members. Caller must have access to team. |
| POST | `/api/teams/:id/members` | Add member. **TEAM_ADMIN** (primary team) or **OWNER.** Body: userId, role?. |
| PATCH | `/api/teams/:id/members/:memberId` | Update member role. **TEAM_ADMIN** (primary team) or **OWNER.** |
| DELETE | `/api/teams/:id/members/:memberId` | Remove member. **TEAM_ADMIN** (primary team) or **OWNER.** |

---

### 5.5 Users

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List users. Query: role?. |

---

### 5.6 Categories

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/categories` | List. Query: includeInactive?, q?, parentId?. Any authenticated user. |
| POST | `/api/categories` | Create. **OWNER only** (CategoriesService.ensureOwner). Body: name, slug?, description?, parentId?, isActive?. |
| PATCH | `/api/categories/:id` | Update. **OWNER only.** |
| DELETE | `/api/categories/:id` | Delete. **OWNER only.** |

---

### 5.7 Routing Rules

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/routing-rules` | List (user-scoped). |
| POST | `/api/routing-rules` | Create. Body: name, keywords[], teamId, priority?, isActive?. |
| PATCH | `/api/routing-rules/:id` | Update. |
| DELETE | `/api/routing-rules/:id` | Delete. |

---

### 5.8 SLAs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/slas` | List policies. Query: teamId. |
| PUT | `/api/slas/:teamId` | Replace policies. Body: { policies: [{ priority, firstResponseHours, resolutionHours }] }. |
| DELETE | `/api/slas/:teamId` | Reset to default. |

---

### 5.9 Saved Views

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/saved-views` | List (user + team). |
| POST | `/api/saved-views` | Create. Body: name, filters, isDefault?, teamId?. |
| PATCH | `/api/saved-views/:id` | Update. |
| DELETE | `/api/saved-views/:id` | Delete. |

---

### 5.10 Canned Responses

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/canned-responses` | List (user + team). |
| POST | `/api/canned-responses` | Create. Body: name, content, teamId?. |
| PATCH | `/api/canned-responses/:id` | Update. |
| DELETE | `/api/canned-responses/:id` | Delete. |

---

### 5.11 Custom Fields

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/custom-fields` | List. Query: teamId?, categoryId?. TEAM_ADMIN sees primary team + global; OWNER sees all. |
| POST | `/api/custom-fields` | Create. **TEAM_ADMIN** (for primary team) or **OWNER.** Body: name, fieldType, options?, isRequired?, teamId?, categoryId?, sortOrder?. |
| PATCH | `/api/custom-fields/tickets/:ticketId/values` | Set ticket custom values. Body: { values: [{ customFieldId, value? }] }. |
| PATCH | `/api/custom-fields/:id` | Update field. |
| DELETE | `/api/custom-fields/:id` | Delete. |

---

### 5.12 Notifications

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications` | List. Query: page, pageSize, unreadOnly. Returns data + meta (unreadCount). |
| GET | `/api/notifications/unread-count` | `{ count }`. |
| PATCH | `/api/notifications/:id/read` | Mark one read. |
| PATCH | `/api/notifications/read-all` | Mark all read. |

---

### 5.13 Reports (AdminGuard: OWNER, TEAM_ADMIN, LEAD)

| Method | Path | Query Params | Description |
|--------|------|--------------|-------------|
| GET | `/api/reports/ticket-volume` | from, to, teamId, priority?, categoryId?, scope?, dateField?, statusGroup? | Time series count. |
| GET | `/api/reports/sla-compliance` | same | Met/breached counts (first response + resolution). |
| GET | `/api/reports/resolution-time` | from, to, teamId, groupBy? (team\|priority) | Avg resolution by group. |
| GET | `/api/reports/tickets-by-status` | same as ticket-volume | Count by status. |
| GET | `/api/reports/tickets-by-priority` | same | Count by priority. |
| GET | `/api/reports/agent-performance` | same | Per-agent: resolved count, avg resolution, first responses. |
| GET | `/api/reports/agent-workload` | same | Per-agent: assigned open, in progress. |
| GET | `/api/reports/tickets-by-age` | same | Buckets (e.g. 0-24h, 1-7d). |
| GET | `/api/reports/reopen-rate` | same | Reopen time series. |
| GET | `/api/reports/tickets-by-category` | same | Count by category. |
| GET | `/api/reports/team-summary` | same | Team totals (open/resolved/total). |
| GET | `/api/reports/transfers` | same | Transfer volume trend. |

---

### 5.14 Automation Rules (TeamAdminOrOwnerGuard: OWNER, TEAM_ADMIN)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/automation-rules` | List rules (role-scoped). |
| GET | `/api/automation-rules/:id` | Get one rule. |
| GET | `/api/automation-rules/:id/executions` | List execution history (page/pageSize). |
| POST | `/api/automation-rules` | Create rule (trigger, conditions, actions, priority, scope). |
| PATCH | `/api/automation-rules/:id` | Update rule. |
| DELETE | `/api/automation-rules/:id` | Delete rule. |
| POST | `/api/automation-rules/:id/test` | Dry-run evaluate rule against `ticketId`. |

---

### 5.15 Audit Log (TeamAdminOrOwnerGuard: OWNER, TEAM_ADMIN)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/audit-log` | List ticket events with filters (dateFrom/dateTo/userId/type/search/page/pageSize). |
| GET | `/api/audit-log/export` | Export filtered audit log as CSV. |

---

## 6. Authentication & Authorization

### Auth Mechanism (Current)

- **Guard:** `AuthGuard` applied globally via `AuthModule` (`APP_GUARD`).
- **Resolution:** Request must have `x-user-id` or `x-user-email`. User is loaded from DB; first team membership sets `teamId`/`teamRole`. `AuthUser` on request: `id`, `email`, `role`, `teamId`, `teamRole`, `primaryTeamId`.
- **Public routes:** `@Public()` on handler (e.g. `GET /api/health`).

### Role Hierarchy & Access

| Role | Description | Ticket Access | Admin/Config |
|------|-------------|---------------|--------------|
| **EMPLOYEE** | Requester | Own tickets only; create, reply (public) | — |
| **AGENT** | Team member | Team tickets; assign, transition, internal notes, transfer (per policy) | — |
| **LEAD** | Team lead | All team tickets; assign/transfer; team metrics | Manager views, Team, Reports, Admin (no Categories), SLA Settings, Routing |
| **TEAM_ADMIN** | Team admin (primaryTeamId) | Same as Lead for primary team | + Custom Fields, Categories only in UI if OWNER; Reports, SLA, Routing, Admin |
| **OWNER** | Global admin | All | Full: Categories, all admin, Reports, SLA, Routing, Team, Custom Fields |

- **Categories:** API enforces **OWNER** for create/update/delete via `CategoriesService.ensureOwner` (no controller-level OwnerGuard).
- **Teams:** Create team is **OWNER** only; update/members are **TEAM_ADMIN** (primary team) or **OWNER**.
- **Custom fields:** Create/update/delete require **TEAM_ADMIN** (for their primary team) or **OWNER** (`ensureTeamAdminOrOwner`).
- **Routing rules:** Create/update/delete require **TEAM_ADMIN** (for rule’s team) or **OWNER**. List: TEAM_ADMIN sees only primary team rules.
- **Reports:** API uses `AdminGuard` (OWNER, TEAM_ADMIN, LEAD).
- **OwnerGuard:** Class exists for OWNER-only routes; categories/teams/custom-fields use service-level checks instead.

### Seeded Users (from `apps/api/prisma/seed.ts`)

- `jane.doe@company.com` — EMPLOYEE  
- `alex.park@company.com` — AGENT (AI team)  
- `maria.chen@company.com` — LEAD (AI team)  
- `sam.rivera@company.com` — TEAM_ADMIN (AI primary team)  
- `owner@company.com` — OWNER  

E2E seed adds: `requester@company.com`, `agent@company.com`, `lead@company.com`, `admin@company.com`, `owner@company.com`.

---

## 7. Frontend (Web App)

**App:** `apps/web` (Vite + React 19 + TypeScript)

**Entry:** `main.tsx` → `App.tsx` (Router, Sidebar, TopBar, Routes, CommandPalette, CreateTicketModal, KeyboardShortcutsHelp).

**API client:** `src/api/client.ts` — all API calls, types (TicketRecord, TicketDetail, UserRef, TeamRef, etc.), auth headers via `getDemoUserEmail()`/`setDemoUserEmail()`, search cache keyed by user email.

**Utils:** `src/utils/format.ts` (ticket ID, status, dates), `src/utils/messageBody.ts` (markdown/HTML), `src/utils/clipboard.ts` (copy helpers); `src/lib/utils.ts` (cn/classnames).

### 7.1 Routing (React Router)

| Path | Component | Access |
|------|-----------|--------|
| `/` | Redirect to `/dashboard` | All |
| `/dashboard` | DashboardPage | All |
| `/tickets` | TicketsPage | All (scope by role) |
| `/tickets/:ticketId` | TicketDetailPage | All (scope by role) |
| `/triage` | TriageBoardPage | LEAD, TEAM_ADMIN, OWNER |
| `/manager` | ManagerViewsPage | LEAD, TEAM_ADMIN, OWNER |
| `/team` | TeamPage | LEAD, TEAM_ADMIN, OWNER |
| `/sla-settings` | SlaSettingsPage | TEAM_ADMIN, OWNER |
| `/reports` | ReportsPage | TEAM_ADMIN, OWNER |
| `/admin` | AdminPage (hub) | TEAM_ADMIN, OWNER |
| `/routing` | RoutingRulesPage | TEAM_ADMIN, OWNER |
| `/automation` | AutomationRulesPage | TEAM_ADMIN, OWNER |
| `/audit-log` | AuditLogPage | TEAM_ADMIN, OWNER |
| `/categories` | CategoriesPage | OWNER only |
| `/custom-fields` | CustomFieldsAdminPage | TEAM_ADMIN, OWNER |
| `*` | Redirect to `/dashboard` | — |

### 7.2 Sidebar Navigation (Role-Filtered)

- **Dashboard** — All  
- **All Tickets** (children: Assigned to Me, Unassigned) — AGENT+  
- **Created by Me** — All  
- **Completed** — All  
- **Triage Board** — LEAD, TEAM_ADMIN, OWNER  
- **Manager Views** — LEAD, TEAM_ADMIN, OWNER  
- **Team** — LEAD, TEAM_ADMIN, OWNER  
- **SLA Settings** — TEAM_ADMIN, OWNER  
- **Reports** — TEAM_ADMIN, OWNER  
- **Admin** — TEAM_ADMIN, OWNER  

Badges: triage count, open count, assigned-to-me count, unassigned count (from `/api/tickets/counts`).

### 7.3 Pages (Summary)

| Page | Purpose |
|------|---------|
| **DashboardPage** | KPI cards (open, resolved, total, unassigned, assigned to me, resolved by me); recent tickets; activity chart; status/priority/age charts; agent workload; reopen rate; queue by category; SLA compliance; resolution time; agent scorecard; exception queue (at-risk/overdue). Role-based visibility (employee vs agent/lead/admin). |
| **TicketsPage** | Table view with filters (saved views, status, priority, team, assignee, requester, SLA, dates, q), sort, pagination, bulk assign/transfer/status/priority, create ticket. |
| **TicketDetailPage** | Header (displayId, subject, status, priority, assignee, team, due/SLA); conversation thread (public/internal); reply composer (canned responses, internal toggle, attachments); timeline/events; followers; custom fields; attachments. |
| **TriageBoardPage** | Columns by status; tickets as cards; assign/transfer from board. |
| **ManagerViewsPage** | High-level volume/workload views. |
| **TeamPage** | List teams; members; add/update/remove members; update team. |
| **SlaSettingsPage** | Per-team SLA policies (P1–P4 first response + resolution hours); reset to default. |
| **ReportsPage** | Date/team/priority filters; charts: ticket volume, SLA compliance, resolution time, by status, by priority, agent performance, agent workload, tickets by age, reopen rate, by category. |
| **AdminPage** | Links to Routing, Automation Rules, Audit Log, Categories, Custom Fields. |
| **RoutingRulesPage** | CRUD routing rules (name, keywords, team, priority, active). |
| **AutomationRulesPage** | CRUD automation rules (trigger, condition tree, actions, dry-run test, execution history). |
| **AuditLogPage** | Filter/search/export ticket audit events. |
| **CategoriesPage** | CRUD categories (name, slug, description, parent, active). |
| **CustomFieldsAdminPage** | CRUD custom fields (name, type, options, required, team, category, sort). |

### 7.4 Key Components

| Component | Role |
|-----------|------|
| **Sidebar** | Collapsible nav, role-filtered items, badges, “New ticket” CTA. |
| **TopBar** | Title/subtitle, persona switcher (demo user), search trigger, notification center. |
| **CommandPalette** | Cmd/Ctrl+K or search icon; search tickets/users/teams; recent searches; “Create ticket”; navigate to ticket. |
| **CreateTicketModal** | Form: subject, description, priority, channel, team, category, custom fields (by team/category). |
| **FilterPanel / SavedViewsDropdown** | Saved views, status, priority, team, assignee, requester, SLA, date range. |
| **TicketTableView** | Sortable table, selection, bulk toolbar. |
| **BulkActionsToolbar** | Assign, transfer, status, priority. |
| **ActivityTimeline / TimelineEvent** | Ticket events. |
| **MessageBody** | Renders message body (markdown/HTML sanitized). |
| **CannedResponsePicker** | Insert canned response into reply. |
| **SlaCountdownTimer** | Due countdown on ticket. |
| **NotificationCenter** | List, load more, mark read, mark all read. |
| **KPICard, StatusBadge** | Dashboard metrics and status chips. |
| **TicketActivityChart** | Open/resolved over time (Recharts). |
| **Reports charts** | SlaComplianceChart, TicketsByStatusChart, TicketsByPriorityChart, TicketsByAgeChart, AgentWorkloadChart, ReopenRateChart, ResolutionTimeChart, AgentScorecard, TicketVolumeChart, etc. |
| **KeyboardShortcutsHelp** | “?” opens shortcut list (context-aware). |
| **MentionAutocomplete** | @-mention suggestions in reply composer. |
| **RichTextEditor** | Rich text / markdown input for messages. |
| **ViewToggle** | Switch between table/card or list views where applicable. |
| **ReportFilters** | Date range, team, priority, category, scope, dateField, statusGroup for reports. |
| **DateRangeFilter** | From/to date picker for filters. |
| **MultiSelectFilter** | Multi-select for status, priority, team, assignee, etc. |

### 7.5 Hooks

- **useCommandPalette** — Open/close, recent searches, create ticket callback.  
- **useNotifications** — Polling, list, unread count, mark read, load more, keyed by user (persona).  
- **useFilters** — Filter state for ticket list.  
- **useTicketSelection** — Selected IDs for bulk actions.  
- **useTableSettings** — Table preferences.  
- **useKeyboardShortcuts** — “?” help, Cmd+/ focus search.  
- **useCountdown** — SLA countdown refresh.  

### 7.6 State & Persona

- **Demo user:** `getDemoUserEmail()` / `setDemoUserEmail(email)` in `localStorage`; dropdown in TopBar/Dashboard to switch persona (Employee, Agent, Lead, Team Admin, Owner).  
- **Sidebar collapsed:** `localStorage` key `sidebar-collapsed`.  
- **Ticket list preset:** `ticketPresetStatus` (open/resolved), `ticketPresetScope` (all/assigned/unassigned/created) set when navigating from sidebar; passed to TicketsPage.  
- **Refresh:** `refreshKey` incremented after create ticket to refetch counts and lists.  

---

## 8. UI & Design Implementation

### 8.1 Styling

- **Tailwind CSS** — Utility-first; config in `tailwind.config.ts`.  
- **tailwind-merge, clsx, class-variance-authority** — Conditional classes.  
- **styles.css** — Base styles, Tailwind directives.  
- **No global UI library** — Custom components (buttons, inputs, modals, etc.) in `components/ui/` (e.g. `animated-list.tsx`).  

### 8.2 Icons & Charts

- **Lucide React** — Sidebar, TopBar, buttons, status icons.  
- **Recharts** — Dashboard and Reports (line, bar, pie).  

### 8.3 Layout (from wireframes)

- **Sidebar** — Left; collapsible; nav items + “New ticket.”  
- **Main** — TopBar (title, subtitle, persona, search, notifications) + content.  
- **Dashboard** — Full-width; KPI row; then grid of widgets (activity, recent tickets, status/priority/age, workload, SLA, etc.).  
- **Tickets list** — Filters above table; bulk actions when rows selected.  
- **Ticket detail** — Header; conversation + timeline; right column (assignee, team, due, followers, custom fields, attachments).  

### 8.4 Accessibility & UX

- **Command palette** — Cmd/Ctrl+K, Escape to close, keyboard navigation.  
- **Keyboard shortcuts** — “?” for help; Cmd+/ to focus search.  
- **Notifications** — Polling every 30s; mark read / mark all read.  
- **Sanitized HTML** — DOMPurify for message body.  
- **Display ID** — Ticket `displayId` (e.g. team prefix + date + sequence) for easy reference.  

---

## 9. Features Implemented

### 9.1 Ticket Lifecycle

- Create ticket (subject, description, priority, channel, team, category, custom fields).  
- Status flow: NEW → TRIAGED → ASSIGNED → IN_PROGRESS → WAITING_* → RESOLVED → CLOSED; REOPENED.  
- Assign (single + bulk), transfer (single + bulk), transition status, bulk status/priority.  
- Public vs internal messages; timeline/events; followers; attachments (upload/download, 10MB limit).  

### 9.2 Teams & Users

- Teams CRUD; members with roles (AGENT, LEAD, ADMIN); assignment strategy (QUEUE_ONLY, ROUND_ROBIN).  
- Users list (optional filter by role).  
- Primary team for TEAM_ADMIN.  

### 9.3 Categories & Routing

- Categories CRUD; hierarchy (parentId).  
- Routing rules: name, keywords, team, priority, active.  
- (Auto-routing on create can use rules; implementation in tickets service.)  

### 9.4 SLA

- SlaPolicy per team/priority (first response hours, resolution hours).  
- SlaInstance per ticket; first response/resolution due and breach/at-risk tracking.  
- SLA breach/at-risk worker (interval scanner with advisory lock); escalation notifications.  
- UI: SLA settings page; SLA countdown and badges on tickets/dashboard.  

### 9.5 Saved Views & Canned Responses

- Saved views: name, filters (JSON), user/team, isDefault.  
- Canned responses: name, content, user/team; picker in ticket reply.  

### 9.6 Custom Fields

- Custom fields per team/category (TEXT, TEXTAREA, NUMBER, DROPDOWN, MULTISELECT, DATE, CHECKBOX, USER).  
- Values on tickets; set on create and in ticket detail.  
- CustomFieldEditor / CustomFieldRenderer in UI.  

### 9.7 Notifications

- In-app notifications (list, unread count, mark read, mark all read).  
- Outbox + email processor (BullMQ + nodemailer) for outbound.  
- Notification types: assignment, update, new message, mention, SLA at-risk/breach, resolved, transferred.  

### 9.8 Reports

- All report endpoints implemented and consumed by ReportsPage: ticket volume, SLA compliance, resolution time, by status/priority/category, agent performance/workload, tickets by age, reopen rate.  
- Filters: date range, team, priority, category, scope, dateField, statusGroup.  

### 9.9 Search & Command Palette

- Client-side search: tickets (API list with `q`), users and teams (cached); categorized results; recent searches; create ticket action.  
- No dedicated `/api/search`; web uses existing list + cache.  

### 9.10 Automation Rules

- Rule model with trigger + condition tree + actions + execution log.
- Triggered on ticket create/status change and SLA at-risk/breach events.
- Admin UI supports create/update/delete, dry-run test, and execution visibility.

### 9.11 Audit Log

- Audit log API over `TicketEvent` with filters and pagination.
- CSV export endpoint and admin UI for search/filter/export.
- Scope enforcement for OWNER/TEAM_ADMIN.

---

## 10. Infrastructure & DevOps

### 10.1 Docker Compose (`docker-compose.yml`)

- **postgres** — Port 5432, DB `ticketing`, volume `pgdata`.  
- **postgres_test** — Port 5433, DB `ticketing_test`, volume `pgdata_test`.  
- **redis** — Port 6379.  

### 10.2 Environment

- **API** (`apps/api/.env`, from `.env.example`):  
  - **Server:** `PORT` (default 3000), `CORS_ORIGIN`, `WEB_APP_URL`.  
  - **Database:** `DATABASE_URL`, `DIRECT_URL`.  
  - **Redis:** `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_URL`; `NOTIFICATIONS_QUEUE_ENABLED`.  
  - **Attachments:** `ATTACHMENTS_DIR` (default `uploads`), `ATTACHMENTS_MAX_MB` (default 10).  
  - **SMTP:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SMTP_FROM`.  
  - **Azure AD (SSO):** `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.  
  - **Microsoft 365 (email ingestion):** `M365_TENANT_ID`, `M365_CLIENT_ID`, `M365_CLIENT_SECRET`, `M365_INBOUND_WEBHOOK_SECRET`.  
- **SLA workers (optional):** `SLA_BREACH_WORKER_ENABLED`, `SLA_BREACH_INTERVAL_MS`, `SLA_BREACH_BATCH_SIZE`, `SLA_BACKFILL_BATCH_SIZE`, `SLA_AT_RISK_ENABLED`, `SLA_AT_RISK_THRESHOLD_MINUTES`, `SLA_ON_CALL_EMAIL(S)`, `SLA_PRIORITY_BUMP_ENABLED`.  
- **Web** (`apps/web/.env`): `VITE_API_BASE_URL` (default `http://localhost:3000/api`), `VITE_DEMO_USER_EMAIL`; E2E: `VITE_E2E_MODE=true`.  
- **Test:** `apps/api/.env.test` for integration/E2E (test DB, `SEED_MODE=test`).  

### 10.3 Scripts (Root)

- `npm run dev` — Concurrently run API + web.  
- `npm run build` — Build API then web.  
- `npm run test` — Reset test DB, run API integration tests.  
- `npm run e2e` — Playwright (starts dev server with test env).  
- `npm run test:db:up` — Use Docker for test DB.  

### 10.4 Database

- Migrate: `npm run db:migrate -w apps/api`.  
- Seed: `npm run db:seed -w apps/api` (dev or minimal; `SEED_MODE=test` for E2E).  
- Prisma generate: `npm run db:generate -w apps/api`.  

---

## 11. Testing

### 11.1 API

- **Jest** — Unit/integration; config in `apps/api`; integration via `test/jest.integration.json`.  
- **test:db:reset** — Resets test DB (script in `apps/api`).  
- **Supertest** — HTTP assertions.  
- Example: `custom-fields.service.spec.ts`.  

### 11.2 E2E (Playwright)

- **Config:** `playwright.config.ts` — base URL 5173, load `apps/api/.env.test`, `VITE_E2E_MODE=true`, webServer runs reset-test-db + `npm run dev`.  
- **Specs:**  
  - **lifecycle.spec.ts:** requester creates ticket and sees in My Tickets; agent assigns and transitions; internal notes hidden from requester; triage board drag-drop and SLA badge; lead transfers ticket (read-only after); SLA badge on list.  
  - **sprint3.spec.ts:** attachments upload and view in ticket detail; round-robin auto-assign for teams with strategy.  
  - **ui-ux.spec.ts:** command palette searches tickets and navigates; notification center shows assigned and marks read; SLA at-risk alert; bulk actions toolbar assign/update; keyboard shortcuts (palette, create ticket, list/detail actions).  
- Personas: E2E seed users (requester, agent, lead, admin, owner).  

---

## 12. Related Documentation

| Document | Description |
|----------|-------------|
| `README.md` | Quick start, stack, auth headers, seeded users. |
| `docs/unified-status-and-backlog-2026-02-09.md` | Canonical delivery snapshot: sprint status, performance baseline, pending work, and sprint backlog. |
| `docs/requirements.md` | Baseline scope, functional/non-functional requirements. |
| `docs/roles-permissions.md` | Roles, permissions matrix, OWNER/TEAM_ADMIN migration. |
| `docs/slas.md` | Current SLA implementation (policies, instances, breach/at-risk) and remaining gaps. |
| `docs/wireframes.md` | Low-fidelity wireframes (dashboard, tickets, ticket detail). |
| `docs/ui-ux-improvements.md` | Task list for command palette, shortcuts, notifications, etc. |
| `docs/zendesk-gap-implementation.md` | Phased plan for email inbound, macros, triggers, SLA, tags, KB. |
| `docs/azure-app-service-setup.md` | Azure deployment. |
| `sprint.md` | Sprint status. |

---

**End of Project Documentation.**  
For API DTOs and validation rules, see `apps/api/src/**/dto/*.ts`. For frontend types, see `apps/web/src/types.ts` and `apps/web/src/api/client.ts`.
