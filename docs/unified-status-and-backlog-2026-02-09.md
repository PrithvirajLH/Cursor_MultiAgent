# Unified Delivery Status, Performance, and Backlog

Last updated: 2026-02-25
Owner: Engineering
Scope: Consolidated view of sprint status, current performance findings, verified pending work, and prioritized next-sprint backlog.

## 1. Executive Snapshot

### Current Delivery State

| Area | Status | Notes |
|---|---|---|
| Ticketing core (create, list, detail, assignment, transitions, notes, followers) | Complete | Shipped and working in current codebase. |
| Routing + audit + admin CRUD (teams/categories/rules) | Mostly complete | Keyword + round-robin implemented; skill/on-call routing still pending. |
| SLA policy and breach processing | Mostly complete | Core SLA model and breach worker exist; business-hours calendars are implemented; delayed-job scheduling model is still pending. |
| Email integration | Mostly complete | Outbound and inbound email ingestion/threading are implemented with webhook secret validation and replay-safe message dedupe. |
| Attachments security/storage | Partial | Upload/download works, but local disk only and no real malware scanner integration. |
| Auth and production hardening | Mostly complete | Bearer/JWT auth and throttling are active; insecure header auth is dev/test-only fallback; production SSO rollout and identity operations hardening are still pending. |
| CI/CD and rollout readiness | Partial | CI workflow exists for lint/build/integration/e2e; rollout runbooks and deployment cutover remain pending. |

### Top Immediate Gaps

1. Inbound provider contract documentation (`EMAIL-01`) is not finalized.
2. Attachment cloud storage/provider abstraction (`ATT-01`) is not implemented.
3. API summary/count caching (`PERF-02`) is not implemented.
4. Request correlation ID propagation (`OBS-01`) is not implemented.
5. Performance regression gate in CI (`PERF-REG-01`) is not implemented.

## 2. Sprint Status (Baseline as of 2026-02-09)

Legend: COMPLETE / PARTIAL / PENDING

| Sprint | Window | Status | Summary |
|---|---|---|---|
| Sprint 1 | Weeks 1-2 | PARTIAL | Requirements/workflows/schema completed; CI/CD and SSO still pending. |
| Sprint 2 | Weeks 3-4 | COMPLETE | Ticketing core and agent console shipped, including outbound notification pipeline. |
| Sprint 3 | Weeks 5-6 | PARTIAL | Routing/audit/admin shipped; attachment security and non-local storage pending. |
| Sprint 4 | Weeks 7-8 | PARTIAL | SLA model/worker shipped; inbound email and business-hours calendars pending. |
| Sprint 5 | Weeks 9-10 | PARTIAL | Reporting shipped; performance hardening incomplete; idempotency/rate-limit hardening is now baseline. |
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

1. Inbound provider contract documentation (`EMAIL-01`) is not finalized (`docs/email-inbound-contract.md` missing).
2. API throttling baseline is global; route-specific policies for webhook/high-write endpoints remain partial (`RL-01`).
3. Attachments are still local-disk based with no cloud storage abstraction/provider (`ATT-01`).
4. API-side response caching is missing for heavy summary endpoints (`PERF-02`).
5. Request correlation ID propagation in logs/response headers is not implemented (`OBS-01`).
6. Performance regression gating/report artifact is not integrated in CI (`PERF-REG-01`).
7. CI baseline exists, but deployment runbook/cutover automation is still pending.
8. UAT, rollout runbooks, production cutover, and stabilization process are still pending.
9. Documentation drift remains in some planning/status files.

## 5. Planned Backlog (Sprints 7-9)

### Sprint 7 (2026-02-09 to 2026-02-20)

| ID | Status | Priority | Task | Estimate |
|---|---|---|---|---|
| DOC-01 | Completed | High | Sync docs to actual implementation status | 1d |
| EMAIL-01 | Pending | High | Define inbound provider contract + payload map | 0.5d |
| EMAIL-02 | Completed | High | Implement inbound webhook + signature validation | 2d |
| EMAIL-03 | Completed | High | Implement threading + reopen-on-reply behavior | 2d |
| EMAIL-04 | Completed | High | Add inbound webhook idempotency handling | 1d |
| QA-EMAIL-01 | Completed | High | Add integration/e2e coverage for inbound flows | 1.5d |
| IDEMP-01 | Completed | High | Add generic `Idempotency-Key` support | 2d |
| RL-01 | Partial | Medium | Add API rate limiting for webhook/high-write routes | 1d |

### Sprint 8 (2026-02-23 to 2026-03-06)

| ID | Status | Priority | Task | Estimate |
|---|---|---|---|---|
| AUTH-01 | Completed | High | Implement Azure AD/Entra bearer token auth guard | 2d |
| AUTH-02 | Completed | High | Restrict header auth to dev/e2e only | 1d |
| ATT-01 | Pending | High | Add attachment storage abstraction + cloud provider | 2d |
| ATT-02 | Completed | High | Integrate malware scan workflow + enforce scan states | 2d |
| SLA-01 | Completed | Medium | Add business-hours and holiday calendar data model/APIs | 2d |
| SLA-02 | Completed | Medium | Make SLA engine business-hours aware | 2d |

### Sprint 9 (2026-03-09 to 2026-03-20)

| ID | Status | Priority | Task | Estimate |
|---|---|---|---|---|
| PERF-01 | Completed | High | Add PostgreSQL FTS/trigram search path + indexes | 2d |
| PERF-02 | Pending | Medium | Add short-lived cache for summary/count endpoints | 1.5d |
| PERF-03 | Completed | Medium | Add `includeTotal=false` optimization on list APIs | 1d |
| OBS-01 | Pending | Medium | Add request correlation ID propagation in logs | 1d |
| CI-01 | Completed | High | Add CI workflow for build + integration + e2e smoke | 1.5d |
| PERF-REG-01 | Pending | Medium | Add performance regression gate and report artifact | 1d |

## 6. Recommended Execution Sequence

1. Complete `EMAIL-01` (formal inbound provider contract + payload map).
2. Complete `ATT-01` (attachment storage abstraction + cloud provider).
3. Complete route-specific throttling policy layer on top of global throttling (`RL-01`).
4. Deliver API summary/count caching (`PERF-02`).
5. Add request correlation IDs (`OBS-01`).
6. Add performance regression gate + artifact in CI (`PERF-REG-01`).
7. Finish rollout/UAT/cutover runbooks and stabilization planning.

## 7. Risks and Dependencies

1. Inbound email should not go live without signature validation and idempotency.
2. Auth migration needs a temporary overlap switch for dev/e2e personas.
3. Business-hours SLA rollout can change existing due dates; migration/backfill strategy required.
4. Performance work should be benchmarked before/after each major DB/query change.
5. Attachment security rollout depends on provider credentials, queue wiring, and failure-state handling.

## 8. Strategic Gaps Not Yet Scheduled in Sprints 7-9

1. SLA delayed-job model replacing interval scanning.
2. Extended observability (metrics/tracing) beyond correlation IDs.
3. Optional product items: first-class tags, multi-tenancy (if business requires).

## 9. Source Documents

- `docs/sprint-status.md`
- `docs/next-sprint-backlog-2026-02-09.md`
- `update/performance-findings-2026-02-06.md`
- `docs/gaps-and-roadmap.md`
