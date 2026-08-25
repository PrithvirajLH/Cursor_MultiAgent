# Zendesk Gap Reduction Plan

Last updated: 2026-02-06

This document is a practical plan to reduce the remaining Zendesk feature gaps in the Codex Ticketing System, based on the current monorepo state and recent status docs.

## Current Baseline (Delivered)
- Core ticketing: create, assign, triage, status transitions, internal vs public replies, followers.
- Agent console: backlog, list/detail, bulk actions, triage board.
- Routing rules: keyword routing + round-robin assignment.
- Audit: TicketEvent stream for ticket changes.
- Admin CRUD: teams, members, categories, routing rules.
- Custom fields: admin + ticket usage.
- Reporting dashboards: volume, SLA, resolution time, status, priority, category, agent workload, reopen rate.
- Automation rules: triggers, conditions, actions, executions, test endpoint.
- Saved views: filters saved per user/team.
- Canned responses: API + UI picker in reply composer.
- UX enhancements: command palette, @mentions, performance fixes.

## Gap Summary (What Still Blocks Zendesk Parity)
### High Impact (Immediate)
- Inbound email ingestion + threading.
- Outbound email notifications wired through outbox/queue.
- SLA engine completeness: breach worker behavior + escalation actions must be verified end-to-end.
- SSO (Azure AD/Entra) replacing demo header auth.

### Medium Impact (Next)
- Attachment malware scanning integration (real AV, not placeholder).
- Routing strategies beyond keyword + round-robin (skill/on-call).
- Tags (schema + UI + filter + trigger conditions).
- Business hours + holidays for SLA clocks.
- Audit log viewer UI + access log retention policy.

### Lower Impact (Later)
- Knowledge base/self-service portal.
- Time-based automations (auto-close, idle reminders).
- Related/linked tickets.
- CI/CD pipeline + environment promotion.
- Omnichannel (chat/voice/social) and CRM integrations.
- CSAT + QA workflows.

## Suggested Phased Work (Gap Reduction)
### Phase A: Core Email + Trust
- Build inbound email webhook and threading token logic.
- Wire outbox + queue for outbound email notifications.
- Confirm SLA breach pipeline end-to-end with notifications.
- Implement SSO (Azure AD/Entra) and remove demo header auth.

### Phase B: Automation + Governance
- Add tags (schema + UI + API + filters + automation conditions).
- Add business hours + holidays and apply to SLA timers.
- Implement real malware scanning integration for attachments.
- Add audit log viewer UI and access log retention policies.

### Phase C: Self-Service + Productivity
- Knowledge base MVP with search.
- Time-based automations (auto-close, idle reminders).
- Related/linked tickets.

## Dependencies and Risks
- Email: requires provider decision (M365, SendGrid) and inbound webhook setup.
- SLA: accurate business hours and status pause rules are required for reliable breach timing.
- Security: SSO completion should precede production rollout.
- Attachments: malware scanning integration needs infrastructure and ops support.

## Acceptance Criteria for Phase A
- Inbound email creates new tickets or threads replies reliably.
- Outbound email notifications are queued, retried, and delivered.
- SLA breach events trigger notifications within 5 minutes of breach.
- SSO is enforced and demo header auth is removed from production.

## Notes
If priorities shift, Phase B can be split by impact: tags and business hours first, then audit viewer and malware scanning.
