## Codex Ticketing System – Database Overview

### 1. Technology Stack

- **Database**: PostgreSQL
- **ORM**: Prisma (schema defined in `apps/api/prisma/schema.prisma`)
- **Connection**:
  - `DATABASE_URL` and `DIRECT_URL` environment variables (see `apps/api/.env`)
  - Docker setup provided via `docker-compose.yml` (Postgres 16 + Redis)

---

### 2. High-Level Domain Model

At a high level, the schema models:

- **Users & Teams**
  - `User`: people using the system, with roles and profile data.
  - `Team`: support teams handling tickets.
  - `TeamMember`: membership of users in teams, with team-specific roles.
  - `SavedView`, `CannedResponse`: personalization and preset content per user/team.
- **Tickets & Communication**
  - `Ticket`: core record representing a request/issue.
  - `TicketMessage`: conversation messages (public vs internal).
  - `TicketEvent`: structured events for ticket changes.
  - `TicketFollower`: “watchers” on a ticket.
  - `Attachment`: files attached to tickets.
- **Classification & Customization**
  - `Category`: classification of tickets (hierarchical).
  - `CustomField` & `CustomFieldValue`: dynamic, configurable fields on tickets.
- **Access & Security**
  - `TicketAccess`: cross-team read/write grants for tickets.
  - `AdminAuditEvent`: admin actions audit log.
- **SLA & Time-Based Logic**
  - `SlaPolicyConfig`, `SlaPolicyConfigTarget`, `SlaPolicyAssignment`:
    configuration of SLA policies and their assignment to teams.
  - `SlaBusinessHoursSetting`: global working-hours and holidays.
  - `SlaPolicy`, `SlaInstance`: per-team policies and per-ticket SLA instances.
- **Automation & Routing**
  - `RoutingRule`: keyword-based inbound routing for tickets.
  - `AutomationRule`, `AutomationExecution`: event-driven automations on tickets.
- **Notifications**
  - `NotificationOutbox`: pending/sent notifications.
  - `Notification`: user-facing notifications in the app.

---

### 3. Enums

Key enums define allowed values:

- `TicketStatus`: `NEW`, `TRIAGED`, `ASSIGNED`, `IN_PROGRESS`, `WAITING_ON_REQUESTER`, `WAITING_ON_VENDOR`, `RESOLVED`, `CLOSED`, `REOPENED`
- `TicketPriority`: `P1`, `P2`, `P3`, `P4`
- `TicketChannel`: `PORTAL`, `EMAIL`
- `MessageType`: `PUBLIC`, `INTERNAL`
- `TeamRole`: `AGENT`, `LEAD`, `ADMIN` (team-level)
- `TeamAssignmentStrategy`: `QUEUE_ONLY`, `ROUND_ROBIN`
- `UserRole`: `EMPLOYEE`, `AGENT`, `LEAD`, `ADMIN` (deprecated), `TEAM_ADMIN`, `OWNER`
- `AccessLevel`: `READ`, `WRITE`
- `NotificationChannel`: `EMAIL`
- `OutboxStatus`: `PENDING`, `PROCESSING`, `SENT`, `FAILED`
- `AttachmentScanStatus`: `PENDING`, `CLEAN`, `INFECTED`, `FAILED`
- `NotificationType`: `TICKET_ASSIGNED`, `TICKET_UPDATED`, `NEW_MESSAGE`, `TICKET_MENTIONED`, `SLA_AT_RISK`, `SLA_BREACHED`, `TICKET_RESOLVED`, `TICKET_TRANSFERRED`
- `SlaNotifyRole`: `AGENT`, `LEAD`, `MANAGER`, `OWNER`

These enums enforce consistent values for core workflows and simplify querying.

---

### 4. Core Entities & Relationships

#### 4.1 User

Represents a person using the system.

- **Key fields**:
  - `id` (UUID, PK)
  - `email` (unique)
  - `displayName`
  - `department`, `location` (optional)
  - `role` (`UserRole`, default `EMPLOYEE`)
  - `primaryTeamId` (optional; for `TEAM_ADMIN`)
- **Key relationships**:
  - `teamMemberships` → `TeamMember[]` (teams the user belongs to).
  - `primaryTeam` → `Team?` (for Team Admins).
  - `requestedTickets` → `Ticket[]` (as requester).
  - `assignedTickets` → `Ticket[]` (as assignee).
  - `messages` → `TicketMessage[]` (authored by this user).
  - `events` → `TicketEvent[]` (ticket events created by this user).
  - `ticketFollows` → `TicketFollower[]` (tickets they follow).
  - `notificationOutbox` → `NotificationOutbox[]` (emails to send to this user).
  - `attachments` → `Attachment[]` (files uploaded by this user).
  - `lastAssignedTeams` → `Team[]` (for round-robin logic).
  - `notifications` → `Notification[]` (in-app notifications).
  - `cannedResponses`, `savedViews`, `automationRulesCreated`, etc.

**Usage**: central identity for auth, role-based access, and ownership across the system.

---

#### 4.2 Team & TeamMember

**Team**

- **Key fields**:
  - `id` (UUID, PK)
  - `name`
  - `slug` (unique)
  - `description` (optional)
  - `assignmentStrategy` (`QUEUE_ONLY` or `ROUND_ROBIN`)
  - `lastAssignedUserId` (for round-robin)
  - `isActive`
- **Relationships**:
  - `members` → `TeamMember[]`
  - `tickets` → `Ticket[]` (assigned to this team)
  - `slaPolicies`, `slaPolicyAssignments`
  - `routingRules`, `automationRules`, `customFields`
  - `ticketAccess`, `savedViews`, `cannedResponses`

**TeamMember**

- **Key fields**:
  - `id` (UUID, PK)
  - `teamId`, `userId`
  - `role` (`TeamRole`: `AGENT`, `LEAD`, `ADMIN`)
  - Unique constraint `@@unique([teamId, userId])`
- **Relationships**:
  - `team` → `Team`
  - `user` → `User`

**Usage**: defines who belongs to which team, with per-team roles that layer on top of global `UserRole`.

---

#### 4.3 Category

Hierarchical classification of tickets.

- **Key fields**:
  - `id`, `name`, `slug` (unique)
  - `description`, `isActive`
  - `parentId` (for nested categories)
- **Relationships**:
  - `parent`, `children` (self-referencing hierarchy)
  - `tickets` → `Ticket[]`
  - `customFields` → `CustomField[]` (fields specific to this category)

**Usage**: used in ticket creation and routing/automation logic.

---

#### 4.4 Ticket

Central entity representing a support request or incident.

- **Key fields**:
  - `id` (UUID, PK)
  - `number` (autoincrement, unique) – human-friendly numeric identifier.
  - `displayId` (optional, unique) – alternate external ID.
  - `subject`, `description`
  - `status` (`TicketStatus`)
  - `priority` (`TicketPriority`)
  - `channel` (`TicketChannel`)
  - `requesterId` (FK → `User`)
  - `assignedTeamId` (FK → `Team`)
  - `assigneeId` (FK → `User`)
  - `categoryId` (FK → `Category`)
  - `dueAt`, `firstResponseDueAt`, `firstResponseAt`
  - `slaPausedAt`, `resolvedAt`, `closedAt`, `completedAt`
  - `createdAt`, `updatedAt`
- **Relationships**:
  - `requester` → `User` (“TicketRequester” relation)
  - `assignedTeam` → `Team`
  - `assignee` → `User` (“TicketAssignee” relation)
  - `category` → `Category`
  - `messages` → `TicketMessage[]`
  - `events` → `TicketEvent[]`
  - `accessGrants` → `TicketAccess[]`
  - `followers` → `TicketFollower[]`
  - `attachments` → `Attachment[]`
  - `notificationOutbox` → `NotificationOutbox[]`
  - `slaInstance` → `SlaInstance?`
  - `notifications` → `Notification[]`
  - `customFieldValues` → `CustomFieldValue[]`
  - `automationExecutions` → `AutomationExecution[]`

**Indexes (performance)**:

- `@@index([status, updatedAt])` – for lists by status with recent changes.
- `@@index([assignedTeamId, status, updatedAt])` – team queues.
- `@@index([assigneeId, status, updatedAt])` – “Assigned to Me” and by agent.
- `@@index([requesterId, createdAt])` – requester history.
- `@@index([dueAt])`, `@@index([completedAt])` – SLA and completion tracking.

---

#### 4.5 CustomField & CustomFieldValue

Enable configurable fields on tickets.

**CustomField**

- **Key fields**:
  - `id`
  - `name`
  - `fieldType` (string enum in comments: `TEXT`, `TEXTAREA`, `NUMBER`, `DROPDOWN`, `MULTISELECT`, `DATE`, `CHECKBOX`, `USER`)
  - `options` (JSON for dropdown/multiselect)
  - `isRequired` (boolean)
  - `teamId`, `categoryId` (optional scoping)
  - `sortOrder`
- **Relationships**:
  - `team` → `Team?`
  - `category` → `Category?`
  - `values` → `CustomFieldValue[]`

**CustomFieldValue**

- **Key fields**:
  - `id`
  - `ticketId`, `customFieldId`
  - `value` (text)
  - `createdAt`, `updatedAt`
- **Constraints & indexes**:
  - `@@unique([ticketId, customFieldId])` – one value per ticket/field.
  - Indexes on `ticketId` and `customFieldId`.

**Usage**: allows teams/admins to add structured data fields without changing the schema.

---

#### 4.6 TicketMessage

Represents a user-visible or internal comment on a ticket.

- **Key fields**:
  - `id`, `ticketId`, `authorId`
  - `type` (`MessageType`: PUBLIC vs INTERNAL)
  - `body`
  - `createdAt`
- **Relationships**:
  - `ticket` → `Ticket`
  - `author` → `User`
- **Index**:
  - `@@index([ticketId, createdAt])` – chronological message rendering.

**Usage**: main conversation stream; internal messages are for staff only.

---

#### 4.7 TicketEvent

Structured log of changes to tickets (for activity feeds and audit).

- **Key fields**:
  - `id`, `ticketId`
  - `type` (string)
  - `payload` (JSON)
  - `createdAt`
  - `createdById` (optional user)
- **Relationships**:
  - `ticket` → `Ticket`
  - `createdBy` → `User?`
- **Index**:
  - `@@index([ticketId, createdAt])`

**Usage**: track status changes, assignment changes, SLA events, automation actions, etc.

---

#### 4.8 AdminAuditEvent

Captures admin-level actions for governance and compliance.

- **Key fields**:
  - `id`
  - `type` (string)
  - `payload` (JSON)
  - `teamId` (optional, scope)
  - `createdById` (optional)
  - `createdAt`
- **Relationships**:
  - `team` → `Team?`
  - `createdBy` → `User?`
- **Indexes**:
  - `@@index([createdAt])`
  - `@@index([type])`
  - `@@index([teamId])`
  - `@@index([createdById])`

**Usage**: admin audit log displayed in the Admin UI.

---

#### 4.9 TicketAccess

Grants additional teams read/write visibility to tickets beyond `assignedTeam`.

- **Key fields**:
  - `id`
  - `ticketId`, `teamId`
  - `accessLevel` (`READ` or `WRITE`)
  - `createdAt`
- **Relationships**:
  - `ticket` → `Ticket`
  - `team` → `Team`
- **Constraint**:
  - `@@unique([ticketId, teamId])`

**Usage**: shared tickets between teams, e.g., collaboration between IT and HR.

---

#### 4.10 RoutingRule

Determines how new tickets are routed.

- **Key fields**:
  - `id`
  - `name`
  - `keywords` (string array)
  - `teamId`
  - `assigneeId` (optional direct assignee)
  - `priority` (rule evaluation order)
  - `isActive`
- **Relationships**:
  - `team` → `Team`
  - `assignee` → `User?`
- **Index**:
  - `@@index([assigneeId])`

**Usage**: assign incoming tickets to teams/agents based on keywords and other logic.

---

#### 4.11 SLA Entities

**SlaPolicyConfig**

- **Key fields**:
  - `id`, `name`, `description`
  - `isDefault` (global default flag)
  - `enabled`, `businessHoursOnly`
  - `escalationEnabled`, `escalationAfterPercent`
  - `breachNotifyRoles` (`SlaNotifyRole[]`)
  - `createdById`, timestamps
- **Relationships**:
  - `createdBy` → `User?`
  - `targets` → `SlaPolicyConfigTarget[]`
  - `assignments` → `SlaPolicyAssignment[]`

**SlaPolicyConfigTarget**

- Per-priority SLA config for a policy.
- Fields: `policyConfigId`, `priority`, `firstResponseHours`, `resolutionHours`.
- Constraint: `@@unique([policyConfigId, priority])`.

**SlaPolicyAssignment**

- Assigns a policy config to a team.
- Fields: `policyConfigId`, `teamId`, timestamps.
- Constraints: `@@unique([teamId])`, `@@unique([policyConfigId, teamId])`.

**SlaBusinessHoursSetting**

- Global setting:
  - `id` (default `"global"`)
  - `timezone`
  - `schedule` (JSON)
  - `holidays` (JSON)

**SlaPolicy**

- Per-team, per-priority SLA definition.
- Fields: `teamId`, `priority`, `firstResponseHours`, `resolutionHours`.
- Relationship: `team` → `Team`, `instances` → `SlaInstance[]`.
- Constraint: `@@unique([teamId, priority])`.

**SlaInstance**

- Per-ticket SLA tracking.
- Fields include:
  - `ticketId` (unique)
  - `policyId` (optional)
  - `priority`
  - `firstResponseDueAt`, `resolutionDueAt`
  - `pausedAt`, `nextDueAt`
  - `*_AtRiskNotifiedAt`, `*_BreachedAt`
- Relationships:
  - `ticket` → `Ticket`
  - `policy` → `SlaPolicy?`
- Index:
  - `@@index([nextDueAt])` (for finding next deadlines)

---

#### 4.12 Followers, Attachments, Notifications

**TicketFollower**

- Links users to tickets they follow.
- Constraint: `@@unique([ticketId, userId])`.

**Attachment**

- File metadata for ticket attachments.
- Fields: `fileName`, `contentType`, `sizeBytes`, `storageKey`, virus-scan fields.
- Relationships: `ticket`, `uploadedBy`.
- Indexes on `ticketId`, `uploadedById`, `scanStatus`.

**NotificationOutbox**

- Outgoing notification queue.
- Fields: `channel`, `status`, `eventType`, `toEmail`, `toUserId`, `ticketId`, `subject`, `body`, `payload`, `attempts`, `lastError`, timestamps.
- Indexes to efficiently pick pending jobs and group by email.

**Notification**

- In-app user notifications.
- Fields: `userId`, `type`, `title`, `body`, `ticketId`, `actorId`, `isRead`, `readAt`.
- Indexes for unread notifications and chronological listing.

---

#### 4.13 SavedView & CannedResponse

**SavedView**

- Stores saved filters for users or teams.
- Fields: `name`, `filters` (JSON), `userId`, `teamId`, `isDefault`.
- Indexes on `userId`, `teamId`.

**CannedResponse**

- Predefined message templates.
- Fields: `name`, `content`, `userId`, `teamId`.
- Indexes on `userId`, `teamId`.

---

#### 4.14 AutomationRule & AutomationExecution

**AutomationRule**

- Defines an automation.
- Fields:
  - `name`, `description`
  - `trigger` (e.g. `TICKET_CREATED`, `STATUS_CHANGED`, `SLA_APPROACHING`, `SLA_BREACHED`)
  - `conditions` (JSON array of conditions)
  - `actions` (JSON array of actions)
  - `isActive`, `priority`
  - `teamId` (optional for team-scoped rules)
  - `createdById`, timestamps
- Relationships:
  - `team` → `Team?`
  - `createdBy` → `User`
  - `executions` → `AutomationExecution[]`
- Indexes: `trigger`, `teamId`, `isActive`.

**AutomationExecution**

- Records a rule execution on a ticket.
- Fields: `ruleId`, `ticketId`, `trigger`, `success`, `error`, `executedAt`.
- Relationships: `rule` → `AutomationRule`, `ticket` → `Ticket`.
- Indexes for tracing by rule and ticket.

---

### 5. Operational Notes

- **Migrations**: Maintained under `apps/api/prisma/migrations`. Each migration folder contains SQL generated by Prisma.
- **Performance**:
  - Most list views use **compound indexes** (e.g. status + updatedAt) to support paged queries.
  - SLA and notification processing rely on indexes such as `nextDueAt` and outbox `status`.
- **Multi-tenancy / scoping**:
  - Scoping is primarily by `Team` and `UserRole` / team roles.
  - `TicketAccess` provides cross-team collaboration without duplicating tickets.
  - `SlaPolicyAssignment`, `RoutingRule`, and `AutomationRule` are typically team-scoped, with special/global rules owned by higher roles.

---

### 6. How to Read / Extend the Schema

- Start with `User`, `Team`, and `Ticket` to understand the core model.
- Follow Prisma relations in `schema.prisma` to explore related entities.
- When adding new features:
  - Prefer adding **CustomFields** over schema changes if the feature is purely data collection.
  - For new behavior (e.g. new automation), consider extending **AutomationRule** or **TicketEvent** payloads.
  - Always add appropriate **indexes** for new query patterns (e.g. new list or search view).

