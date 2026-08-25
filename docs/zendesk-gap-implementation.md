# Zendesk Gap Implementation Plan (Monorepo)

Last updated: 2026-01-27

This document captures the missing Zendesk features in the current monorepo (`apps/api`, `apps/web`) and a phased plan to implement them.

## Goals
- Close high-impact gaps that improve agent productivity and customer response times.
- Preserve current architecture (NestJS + Prisma + Vite/React).
- Deliver in phases with measurable outcomes.

## Non-Goals (for initial phases)
- Full multi-channel suite (chat/voice/social) until core automation + email inbound is stable.
- AI/ML features until data capture + analytics foundations are in place.

---

## Phase 1 (Core Productivity & Reliability)
**Target outcomes**: faster agent replies, automated routing, basic email parity, measurable SLAs.

### 1. Email inbound + threading
- **API**: inbound webhook endpoint
- **Parsing**: subject parsing + tokenized threading (`[Ticket <id>]`)
- **Data**: store inbound raw email metadata (headers, message-id, in-reply-to)
- **Behavior**:
  - Create new ticket if no thread token
  - Append message if token exists
  - Reopen ticket on reply if status is RESOLVED/CLOSED
- **Notifications**: reuse existing outbox + email sender

### 2. Macros / Canned responses
- **Data model**: Macro { id, title, body, isGlobal, teamId }
- **UI**: select macro in ticket detail and insert into reply
- **Access**: Admin/Lead create, Agents use

### 3. Triggers (event-based rules)
- **Rules engine**: event + condition + action model
- **Initial events**: ticket created, status changed, assigned, message added
- **Initial actions**: assign to team, set priority, add tag, send email
- **UI**: basic rules list + create form

### 4. SLA breach notifications
- **Worker**: scheduled scan for SLA breaches (first response + resolution)
- **Action**: enqueue notification (email or in-app placeholder)

### 5. Tags (minimal)
- **Schema**: Tag + TicketTag join
- **UI**: add/remove tags in ticket detail
- **Use**: target for triggers, filters

---

## Phase 2 (Self-Service + Reporting Basics)
**Target outcomes**: reduce ticket volume, visibility into performance.

### 6. Knowledge base (MVP)
- **Schema**: Article + Category + Section
- **UI**: admin CRUD, public read view
- **Search**: basic title/body keyword search

### 7. Reporting dashboards (core)
- **KPIs**: volume, first response avg, resolution avg, SLA compliance
- **Filters**: team, priority, date range
- **Export**: CSV

### 8. Saved views (filters)
- **Data**: SavedView { name, ownerId, shared, filters }
- **UI**: save current filter on tickets list

---

## Phase 3 (Automation Depth + Compliance)
**Target outcomes**: reduce manual ops, improve governance.

### 9. Automations (time-based)
- **Examples**: auto-close after X days, reminder after idle
- **Scheduler**: cron-based worker

### 10. Business hours & holidays
- **Data**: team calendars
- **SLA**: pause/resume SLA clocks outside working hours

### 11. Audit improvements
- **Access logs**: record auth + admin actions
- **Retention**: configurable retention policy

---

## Phase 4 (Advanced & Expansion)
**Target outcomes**: multi-channel parity, AI augmentation, enterprise readiness.

### 12. Omnichannel & integrations
- Live chat, SMS, social, voice
- Webhooks
- CRM integrations (Salesforce/Jira)

### 13. AI augmentation
- Suggested replies
- Summarization
- Intent detection

### 14. CSAT + QA
- Survey workflows
- Agent scorecards

---

## Architecture Notes

### Queue / Worker
- **Current**: BullMQ + Redis (`notification-email` queue)
- **Add**: `sla-breach`, `automation-runner`, `email-inbound` jobs

### Notifications
- **Current**: outbox table + email queue
- **Add**: in-app notifications table + UI bell

### Data Models (Proposed)
- Macro
- Trigger
- Automation
- Tag, TicketTag
- KnowledgeBase: Article, Section, Category
- SavedView
- Notification (in-app)

---

## Milestones (Suggested)
- **M1**: Email inbound + threading + reopen on reply
- **M2**: Macros + Tags + Trigger MVP
- **M3**: SLA breach worker + basic reporting
- **M4**: Knowledge base MVP

---

## Risks / Dependencies
- Redis required for workers (or disable queue fallback)
- SMTP configuration required for outbound email
- Email inbound may require M365 or SendGrid webhook integration

---

## Acceptance Criteria (Phase 1)
- Inbound email creates or appends to tickets
- Agents can apply macros
- Trigger rules auto-assign based on conditions
- SLA breach email sent within 5 minutes of breach
- Tags are visible + filterable
