# Roles & Permissions (Sprint 1 Baseline)

This document defines the baseline access model for the ticketing system.

## Roles
- **EMPLOYEE (Requester)**
- **AGENT**
- **LEAD**
- **ADMIN**

## Core Rules
- Requesters can only view and reply to their own tickets.
- Agents can view tickets in their team scope and update status/assignment.
- Leads can view and manage all tickets in their team; can reassign and transfer.
- Admins have full access across teams and configuration modules.
- Cross-team read-only access can be granted via TicketAccess records.

## Permissions Matrix (Baseline)

### Requester (Employee)
- Create ticket
- View own tickets
- Add public reply to own tickets
- Cannot assign, transfer, or change status

### Agent
- View team tickets (assigned + unassigned)
- Assign to self or other team member (per policy)
- Transition status (except restricted transitions)
- Add public replies + internal notes
- Transfer to another team (if policy allows)

### Lead
- All Agent permissions
- Assign across team, override queue ownership
- Approve transfer and manage escalations
- View team metrics

### Admin
- All Lead permissions
- Manage teams, memberships, categories, routing rules
- Configure SLAs and notification settings
- View global reports and audit logs

## Notes
- Team membership is the primary access boundary.
- Transfers should create a read-only access grant for the prior team.
- All role changes should be audited.

---

## OWNER / TEAM_ADMIN (DB & schema parity)

The system uses **OWNER** (global) and **TEAM_ADMIN** (scoped to a primary team). The legacy **ADMIN** role is deprecated; existing ADMIN users are migrated to TEAM_ADMIN with a primary team.

**Prisma migrations** (ensure these are applied on every environment):

- **`20260202215754_add_owner_team_admin_primary_team`** – Adds `TEAM_ADMIN` and `OWNER` to `UserRole` enum, adds `User.primaryTeamId` (nullable FK to `Team`), and the foreign key constraint.
- **`20260202220000_data_admin_to_team_admin`** – Data migration: sets existing `ADMIN` users to `TEAM_ADMIN` and populates `primaryTeamId` from their first team membership.

Apply with: `npx prisma migrate deploy` (from `apps/api`). New environments get both when running migrations; existing DBs must run them to achieve schema + DB parity.

