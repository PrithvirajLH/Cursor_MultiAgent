> **SUPERSEDED — 2026-08-26.** This document describes an earlier state and contradicts the code in places.
> Do not plan from it. Current entry points: `CLAUDE.md` → `docs/agent-context/` → `prompts/2026-08-26-restart-master-plan.md`.

# Sprint Status

Status derived from IT.pdf (Sprint Plan) and current codebase. Updated: 2026-02-09.
Canonical planning/status source: `docs/unified-status-and-backlog-2026-02-09.md`.

Legend: ✅ complete · 🟡 partial · ❌ pending

## Sprint 1 (Weeks 1–2) — Discovery and Foundations
- 🟡 Finalize requirements, categories, priority definitions, and SLAs per team.
  - Notes: Requirements and categories are implemented; per-team SLA thresholds are configurable in product, but business-hours calendars are still pending.
- ✅ Define workflows and permissions; draft UI wireframes.
  - Notes: Roles/permissions and wireframes docs exist; access rules are implemented in API.
- 🟡 Set up repo, CI/CD, environments, auth (SSO), database migrations.
  - Notes: Repo/environments/migrations are in place; CI/CD and SSO remain pending.
- ✅ Implement Ticket + Message core schema and basic API skeleton.

## Sprint 2 (Weeks 3–4) — Ticketing Core + Agent Console
- ✅ Ticket creation (portal) and ticket list/detail views.
- ✅ Agent console backlog, assignment, status transitions.
- ✅ Internal notes vs public replies; watchers/followers.
- ✅ Outbox + queue wiring; email outbound notifications (basic).
  - Notes: Outbox + BullMQ + SMTP pipeline is implemented.

## Sprint 3 (Weeks 5–6) — Routing + Attachments + Audit
- ✅ Routing rules engine (team routing + assignment strategies).
  - Notes: Keyword routing + round-robin are implemented; skill/on-call routing is still pending.
- 🟡 Attachments upload/download with malware scanning integration.
  - Notes: Upload/download works; real AV integration and object storage are still pending.
- ✅ TicketEvent audit stream for ticket state changes (status, assignment, transfer, messages, attachments).
- ✅ Basic admin: teams, membership, categories, routing rules CRUD.

## Sprint 4 (Weeks 7–8) — Email Inbound + SLA Engine
- 🟡 Inbound email parsing + threading tokens.
  - Notes: Still pending.
- ✅ SLA policy model + per-ticket SLA instances.
- ✅ Breach/at-risk worker + escalation notifications.
- ✅ Core edge cases: waiting-state pause/resume and reopen status behavior.
  - Notes: Business-hours/holiday calendars still pending.

## Sprint 5 (Weeks 9–10) — Reporting + Performance Hardening
- ✅ Reporting dashboards and report APIs.
- 🟡 Performance hardening.
  - Notes: Major UI latency fixes and API aggregation endpoints are in place, but p95 targets are still not met per latest perf findings.
- ❌ Idempotency keys + rate limiting + full hardening checklist.

## Sprint 6 (Weeks 11–12) — UAT, Rollout, Stabilization
- ❌ UAT, rollout runbooks, production cutover, and stabilization process are pending.
