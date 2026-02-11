# Unified Delivery Status, Performance, and Backlog

Last updated: 2026-02-09
Owner: Engineering
Scope: Consolidated view of sprint status, current performance findings, verified pending work, and prioritized next-sprint backlog.

## 1. Executive Snapshot

### Current Delivery State

| Area | Status | Notes |
|---|---|---|
| Ticketing core (create, list, detail, assignment, transitions, notes, followers) | Complete | Shipped and working in current codebase. |
| Routing + audit + admin CRUD (teams/categories/rules) | Mostly complete | Keyword + round-robin implemented; skill/on-call routing still pending. |
| SLA policy and breach processing | Mostly complete | Core SLA model and breach worker exist; business hours/holiday calendars pending. |
| Email integration | Partial | Outbound email exists; inbound parsing/threading webhook path not implemented. |
| Attachments security/storage | Partial | Upload/download works, but local disk only and no real malware scanner integration. |
| Auth and production hardening | Pending | Still demo header auth; no idempotency/rate limiting baseline for mutating APIs/webhooks. |
| CI/CD and rollout readiness | Pending | CI workflows and UAT rollout/runbook stabilization still missing. |

### Top Immediate Gaps

1. Inbound email ingestion + threading + replay safety.
2. Production auth migration from header auth to bearer/OIDC path.
3. Idempotency and rate limiting for write-heavy/webhook endpoints.
4. Attachment cloud storage and malware scanning state enforcement.
5. Performance improvements to meet p95 targets for ticket list/detail.

## 2. Sprint Status (Baseline as of 2026-02-09)

Legend: COMPLETE / PARTIAL / PENDING

| Sprint | Window | Status | Summary |
|---|---|---|---|
| Sprint 1 | Weeks 1-2 | PARTIAL | Requirements/workflows/schema completed; CI/CD and SSO still pending. |
| Sprint 2 | Weeks 3-4 | COMPLETE | Ticketing core and agent console shipped, including outbound notification pipeline. |
| Sprint 3 | Weeks 5-6 | PARTIAL | Routing/audit/admin shipped; attachment security and non-local storage pending. |
| Sprint 4 | Weeks 7-8 | PARTIAL | SLA model/worker shipped; inbound email and business-hours calendars pending. |
| Sprint 5 | Weeks 9-10 | PARTIAL | Reporting shipped; performance hardening incomplete; no idempotency/rate-limit layer. |
| Sprint 6 | Weeks 11-12 | PENDING | UAT, rollout runbooks, cutover, and stabilization not yet completed. |

## 3. Performance Snapshot (Measured 2026-02-06)

### API p95 Latency

| Endpoint | p95 | Target | Status |
|---|---:|---:|---|
| `GET /health` | 12.7 ms | n/a | Good |
| Tickets list | 999.3 ms | <= 400 ms | Miss |
| Ticket detail | 1523.9 ms | <= 300 ms | Miss |
| Reports summary | 1066.0 ms | not specified | Needs improvement |
| Tickets counts (load test) | 789.6 ms | not specified | Needs improvement |

### UI Interaction Timings

| Interaction | Time |
|---|---:|
| Tickets page load (table ready) | 1456.6 ms |
| Ticket detail load (conversation panel) | 3608.6 ms |
| Timeline tab switch | 199.1 ms |

### Performance Priority Order

1. Ticket detail endpoint and detail screen loading.
2. Ticket list endpoint and payload optimization.
3. Counts and summary aggregation cost.
4. Search/index path (`contains` to PostgreSQL FTS or trigram).
5. Short-lived summary/count caching.

## 4. Verified Pending Work (Codebase-Validated)

1. Inbound email ingestion and threading are not implemented.
2. Authentication remains demo header-based (`x-user-email` / `x-user-id`).
3. No idempotency-key support for mutating endpoints.
4. No API rate-limiting layer.
5. Attachments are local disk only and currently forced `CLEAN` without real scanning.
6. SLA business-hours and holiday calendar logic are not implemented.
7. Search still uses `contains` filters (no FTS/trigram index path).
8. API-side response caching missing for heavy summary endpoints.
9. CI/CD workflow files are missing.
10. Documentation has drift from implementation state in several files.

## 5. Planned Backlog (Sprints 7-9)

### Sprint 7 (2026-02-09 to 2026-02-20)

| ID | Priority | Task | Estimate |
|---|---|---|---|
| DOC-01 | High | Sync docs to actual implementation status | 1d |
| EMAIL-01 | High | Define inbound provider contract + payload map | 0.5d |
| EMAIL-02 | High | Implement inbound webhook + signature validation | 2d |
| EMAIL-03 | High | Implement threading + reopen-on-reply behavior | 2d |
| EMAIL-04 | High | Add inbound webhook idempotency handling | 1d |
| QA-EMAIL-01 | High | Add integration/e2e coverage for inbound flows | 1.5d |
| IDEMP-01 | High | Add generic `Idempotency-Key` support | 2d |
| RL-01 | Medium | Add API rate limiting for webhook/high-write routes | 1d |

### Sprint 8 (2026-02-23 to 2026-03-06)

| ID | Priority | Task | Estimate |
|---|---|---|---|
| AUTH-01 | High | Implement Azure AD/Entra bearer token auth guard | 2d |
| AUTH-02 | High | Restrict header auth to dev/e2e only | 1d |
| ATT-01 | High | Add attachment storage abstraction + cloud provider | 2d |
| ATT-02 | High | Integrate malware scan workflow + enforce scan states | 2d |
| SLA-01 | Medium | Add business-hours and holiday calendar data model/APIs | 2d |
| SLA-02 | Medium | Make SLA engine business-hours aware | 2d |

### Sprint 9 (2026-03-09 to 2026-03-20)

| ID | Priority | Task | Estimate |
|---|---|---|---|
| PERF-01 | High | Add PostgreSQL FTS/trigram search path + indexes | 2d |
| PERF-02 | Medium | Add short-lived cache for summary/count endpoints | 1.5d |
| PERF-03 | Medium | Add `includeTotal=false` optimization on list APIs | 1d |
| OBS-01 | Medium | Add request correlation ID propagation in logs | 1d |
| CI-01 | High | Add CI workflow for build + integration + e2e smoke | 1.5d |
| PERF-REG-01 | Medium | Add performance regression gate and report artifact | 1d |

## 6. Recommended Execution Sequence

1. Finish `DOC-01` so docs become reliable source of truth.
2. Deliver inbound email baseline (`EMAIL-01`, `EMAIL-02`, `EMAIL-03`).
3. Complete replay safety and shared idempotency (`EMAIL-04`, `IDEMP-01`).
4. Add route protection (`RL-01`) before provider retry/high-volume rollout.
5. Migrate auth (`AUTH-01`, `AUTH-02`) and remove production header-auth path.
6. Close attachment compliance/security gaps (`ATT-01`, `ATT-02`).
7. Implement SLA business-hours/calendar behavior (`SLA-01`, `SLA-02`).
8. Run performance and CI hardening stream (`PERF-*`, `OBS-01`, `CI-01`).

## 7. Risks and Dependencies

1. Inbound email should not go live without signature validation and idempotency.
2. Auth migration needs a temporary overlap switch for dev/e2e personas.
3. Business-hours SLA rollout can change existing due dates; migration/backfill strategy required.
4. Performance work should be benchmarked before/after each major DB/query change.
5. Attachment security rollout depends on provider credentials, queue wiring, and failure-state handling.

## 8. Strategic Gaps Not Yet Scheduled in Sprints 7-9

1. Realtime updates via WebSocket/SSE to reduce polling.
2. SLA delayed-job model replacing interval scanning.
3. Extended observability (metrics/tracing) beyond correlation IDs.
4. Optional product items: first-class tags, multi-tenancy (if business requires).

## 9. Source Documents

- `docs/sprint-status.md`
- `docs/next-sprint-backlog-2026-02-09.md`
- `update/performance-findings-2026-02-06.md`
- `docs/gaps-and-roadmap.md`
