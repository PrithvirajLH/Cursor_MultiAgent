# Requirements Baseline (Sprint 1)

Source: IT.pdf v1.1 (Dec 22, 2025). This document captures the baseline
requirements and scope for Sprint 1 sign-off. It is a living document.

## Objectives
- Single place for employees to request help and track progress.
- Route tickets to the right team quickly and consistently.
- Support SLA tracking (first response + resolution) with escalation hooks.
- Provide auditability and visibility (event history, basic reporting later).

## In-Scope (Phase 1)
- Requester portal: create ticket, view status, add replies.
- Agent console: triage, assign, collaborate (internal notes), resolve/close.
- Team-based routing and assignment (rules + optional round-robin).
- Email outbound notifications (basic).
- Audit trail of ticket events.

## Out of Scope (Phase 1)
- Multi-tenant SaaS model.
- Advanced omnichannel (voice/SMS).
- CMDB / asset management.
- Full ITIL change/problem modules.

## Functional Requirements (Baseline)
- Ticket lifecycle statuses: NEW, TRIAGED, ASSIGNED, IN_PROGRESS,
  WAITING_ON_REQUESTER, WAITING_ON_VENDOR, RESOLVED, CLOSED, REOPENED.
- Minimum fields: subject, description, category, priority, assigned team,
  assignee, requester, channel, timestamps.
- Access: requester sees own tickets; team members see team tickets per role;
  admin sees all.
- Routing rules by keywords/category/department; manual transfer allowed.
- Public replies vs internal notes (agents only).
- Audit events for all state changes and transfers.

## Non-Functional Requirements
- Security: role-based access, audit trail for ticket events and admin changes.
- Performance: ticket list should remain responsive under normal load.
- Scalability: support additional departments without schema changes.

## Open Questions
- Final SLA thresholds per priority and business hours by team.
- Final categories and subcategories per department.
- Notification channels beyond email (Teams/Slack) and escalation rules.
- Teams message intake approach (planned for Sprint 6).
- Attachment retention and malware scanning provider.
