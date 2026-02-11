# Next Sprint Backlog (2026-02-09)

This backlog is derived from the current codebase state and repo docs.
Date baseline: February 9, 2026.

## Status Updates
1. `DOC-01` completed on 2026-02-09.
2. Canonical planning/status source established: `docs/unified-status-and-backlog-2026-02-09.md`.

## Verified Pending Work
1. Inbound email ingestion and threading are not implemented in API routes/services.
2. Authentication is still demo header based (`x-user-email` / `x-user-id`).
3. No idempotency-key handling exists for mutating endpoints.
4. No API rate limiting layer exists.
5. Attachments use local disk only and are marked `CLEAN` without real malware scanning.
6. SLA business hours and holiday calendars are not implemented.
7. Search still uses `contains` filters (no PostgreSQL FTS/trigram index path).
8. API-side response caching is not implemented for heavy summary endpoints.
9. CI/CD workflow files are not present.
10. Inbound email provider contract documentation is not finalized (`EMAIL-01` scope).

## Sprint Windows
1. Sprint 7: 2026-02-09 to 2026-02-20
2. Sprint 8: 2026-02-23 to 2026-03-06
3. Sprint 9: 2026-03-09 to 2026-03-20

## Prioritized Backlog
| ID | Sprint | Priority | Task | Main File Impact | Acceptance Criteria | Estimate |
|---|---|---|---|---|---|---|
| DOC-01 | 7 | Done | Sync docs to actual implementation status (completed 2026-02-09) | `PROJECT_DOCUMENTATION.md`, `docs/sprint-status.md`, `docs/slas.md`, `docs/ui-ux-improvements.md` | Docs match shipped modules/endpoints; no stale "not implemented" claims for reports/automation/audit | Done |
| EMAIL-01 | 7 | High | Define inbound email provider contract and webhook payload map | `docs/zendesk-gap-reduction.md`, new `docs/email-inbound-contract.md` | Provider selected; sample payloads and signature verification rules documented | 0.5d |
| EMAIL-02 | 7 | High | Implement inbound webhook endpoint with signature validation | new `apps/api/src/webhooks/*`, `apps/api/src/app.module.ts` | Invalid signatures rejected; valid webhook accepted and logged | 2d |
| EMAIL-03 | 7 | High | Implement threading and reopen-on-reply behavior | `apps/api/src/tickets/tickets.service.ts`, new email-threading service | Reply with thread token appends message; resolved/closed ticket reopens on requester reply | 2d |
| EMAIL-04 | 7 | High | Add inbound email idempotency for replay safety | new idempotency store + webhook integration | Duplicate webhook events return same result and do not create duplicate messages/tickets | 1d |
| QA-EMAIL-01 | 7 | High | Add integration/e2e coverage for inbound flows | `apps/api/test/integration/*`, `e2e/*` | Tests cover create-via-email, thread reply, duplicate webhook replay | 1.5d |
| IDEMP-01 | 7 | High | Add generic `Idempotency-Key` support for create ticket/message/webhook endpoints | new middleware/interceptor + persistence model | Repeated key within TTL returns stored status/body; no duplicate side effects | 2d |
| RL-01 | 7 | Medium | Add API rate limiting for webhook and high-write routes | new rate-limit module, route guards | 429 behavior verified with tests; limits configurable via env | 1d |
| AUTH-01 | 8 | High | Implement Azure AD/Entra bearer token auth guard | `apps/api/src/auth/*`, `apps/api/.env.example` | Valid JWT maps to DB user; invalid/expired token rejected | 2d |
| AUTH-02 | 8 | High | Restrict header-based auth to dev/e2e only | `apps/api/src/auth/auth.guard.ts`, env flags | Production mode does not accept header auth | 1d |
| ATT-01 | 8 | High | Add attachment storage abstraction + cloud provider (Azure Blob or S3) | new `apps/api/src/attachments/*`, `apps/api/src/tickets/tickets.service.ts` | Upload/download work via provider; local provider remains for dev | 2d |
| ATT-02 | 8 | High | Integrate malware scan workflow and enforce scan states | attachment service + worker + schema usage | Files progress `PENDING -> CLEAN/INFECTED/FAILED`; infected files blocked from download | 2d |
| SLA-01 | 8 | Medium | Add team business-hours and holiday calendar data model/admin APIs | `apps/api/prisma/schema.prisma`, new SLA/admin DTO/controllers | Business-hours config stored per team and manageable via API | 2d |
| SLA-02 | 8 | Medium | Make SLA due-date engine business-hours aware | `apps/api/src/slas/sla-engine.service.ts`, breach worker | Due dates and breach checks honor calendars in tests | 2d |
| PERF-01 | 9 | High | Add PostgreSQL trigram/FTS search path and index migration | `apps/api/prisma/migrations/*`, `apps/api/src/tickets/tickets.service.ts` | Ticket list search latency improves measurably; functional parity maintained | 2d |
| PERF-02 | 9 | Medium | Add short-lived cache for `reports/summary` and `tickets/counts` | reports/tickets service + Redis cache helper | 30-60s cache hit behavior verified; stale window documented | 1.5d |
| PERF-03 | 9 | Medium | Add optional `includeTotal=false` on list endpoints | `apps/api/src/tickets/dto/list-tickets.dto.ts`, service, client | Clients can skip expensive count when not needed | 1d |
| OBS-01 | 9 | Medium | Add request correlation ID propagation in API logs | middleware + logger usage | Every request logs a stable request ID and returns it in response header | 1d |
| CI-01 | 9 | High | Add CI workflow for build + integration + e2e smoke | `.github/workflows/*` | PR checks run build, API integration tests, and core Playwright smoke tests | 1.5d |
| PERF-REG-01 | 9 | Medium | Add perf regression script gate and reporting output artifact | `scripts/perf/*`, CI workflow | p95 trend captured per run; threshold failures visible in CI | 1d |

## Immediate Execution Order
1. `EMAIL-01` then `EMAIL-02` and `EMAIL-03` (core integration gap).
2. `EMAIL-04` and `IDEMP-01` before enabling provider retries in production.
3. `AUTH-01` and `AUTH-02` to remove non-production auth path.
4. `ATT-01` and `ATT-02` to close attachment security/compliance gap.

## Risks and Sequencing Notes
1. Inbound email work should not ship without idempotency and signature validation.
2. Auth migration should keep a short overlap flag for e2e/dev personas.
3. Business-hours SLA changes can alter existing due dates; include migration and backfill strategy.
4. Performance optimizations should be measured with existing scripts before/after each major change.
