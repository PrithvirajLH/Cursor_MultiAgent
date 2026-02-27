# Next Sprint Backlog (2026-02-09)

This backlog is derived from the current codebase state and repo docs.
Date baseline: February 9, 2026.

## Status Updates
1. `DOC-01` completed on 2026-02-09.
2. Canonical planning/status source established: `docs/unified-status-and-backlog-2026-02-09.md`.
3. Workspace verification completed on 2026-02-25 against current `apps/api`, `apps/web`, `scripts`, and `.github/workflows`.

## Verified Pending Work
1. Inbound email provider contract documentation is still not finalized (`EMAIL-01` scope); `docs/email-inbound-contract.md` is not present.
2. Route-specific throttling policies for webhook/high-write routes remain open (`RL-01`); current throttling is global.
3. Attachment cloud storage abstraction/provider is still open (`ATT-01`); attachment read/write remains local filesystem based.
4. API-side response caching is still missing for heavy summary endpoints (`PERF-02`), notably `/reports/summary` and `/tickets/counts`.
5. Request correlation ID propagation in API logs/response headers is still missing (`OBS-01`).
6. Performance regression gate/report artifact is still not wired into CI (`PERF-REG-01`).
7. Sprint-6 operational readiness items remain open (UAT, rollout runbooks, production cutover, stabilization).
8. UI backlog remains open for Related/Linked Tickets, PDF export, and Phase-4 accessibility/mobile acceptance items.

## Sprint Windows
1. Sprint 7: 2026-02-09 to 2026-02-20
2. Sprint 8: 2026-02-23 to 2026-03-06
3. Sprint 9: 2026-03-09 to 2026-03-20

## Prioritized Backlog
| ID | Status | Sprint | Priority | Task | Main File Impact | Acceptance Criteria | Estimate |
|---|---|---|---|---|---|---|---|
| DOC-01 | Completed | 7 | Done | Sync docs to actual implementation status (completed 2026-02-09) | `PROJECT_DOCUMENTATION.md`, `docs/sprint-status.md`, `docs/slas.md`, `docs/ui-ux-improvements.md` | Docs match shipped modules/endpoints; no stale "not implemented" claims for reports/automation/audit | Done |
| EMAIL-01 | Pending | 7 | High | Define inbound email provider contract and webhook payload map | `docs/zendesk-gap-reduction.md`, new `docs/email-inbound-contract.md` | Provider selected; sample payloads and signature verification rules documented | 0.5d |
| EMAIL-02 | Completed | 7 | High | Implement inbound webhook endpoint with signature validation | `apps/api/src/tickets/tickets.controller.ts`, `apps/api/src/tickets/tickets.service.ts` | Invalid signatures rejected; valid webhook accepted and logged | 2d |
| EMAIL-03 | Completed | 7 | High | Implement threading and reopen-on-reply behavior | `apps/api/src/tickets/tickets.service.ts`, `apps/api/test/integration/tickets.inbound-email.spec.ts` | Reply with thread token appends message; resolved/closed ticket reopens on requester reply | 2d |
| EMAIL-04 | Completed | 7 | High | Add inbound email idempotency for replay safety | `apps/api/src/tickets/tickets.service.ts`, `apps/api/prisma/migrations/20260220162000_add_inbound_email_receipts/migration.sql` | Duplicate webhook events return same result and do not create duplicate messages/tickets | 1d |
| QA-EMAIL-01 | Completed | 7 | High | Add integration/e2e coverage for inbound flows | `apps/api/test/integration/tickets.inbound-email.spec.ts` | Integration tests cover create-via-email, thread reply, duplicate webhook replay | 1.5d |
| IDEMP-01 | Completed | 7 | High | Add generic `Idempotency-Key` support for create ticket/message/webhook endpoints | `apps/api/src/common/idempotency.interceptor.ts`, `apps/api/src/common/idempotency.service.ts` | Repeated key within TTL returns stored status/body; no duplicate side effects | 2d |
| RL-01 | Partial | 7 | Medium | Add API rate limiting for webhook and high-write routes | `apps/api/src/app.module.ts` | Global 429 behavior is in place; route-specific policies still pending | 1d |
| AUTH-01 | Completed | 8 | High | Implement Azure AD/Entra bearer token auth guard | `apps/api/src/auth/auth.guard.ts` | Valid JWT maps to DB user; invalid/expired token rejected | 2d |
| AUTH-02 | Completed | 8 | High | Restrict header-based auth to dev/e2e only | `apps/api/src/auth/auth.guard.ts` | Production mode does not accept header auth | 1d |
| ATT-01 | Pending | 8 | High | Add attachment storage abstraction + cloud provider (Azure Blob or S3) | `apps/api/src/tickets/tickets.service.ts` | Upload/download work via provider; local provider remains for dev | 2d |
| ATT-02 | Completed | 8 | High | Integrate malware scan workflow and enforce scan states | `apps/api/src/tickets/attachments.controller.ts`, `apps/api/src/tickets/tickets.service.ts`, `apps/api/test/integration/tickets.attachments.spec.ts` | Files progress `PENDING -> CLEAN/INFECTED/FAILED`; infected files blocked from download | 2d |
| SLA-01 | Completed | 8 | Medium | Add team business-hours and holiday calendar data model/admin APIs | `apps/api/prisma/schema.prisma`, `apps/api/src/slas/slas.controller.ts`, `apps/api/src/slas/slas.service.ts` | Business-hours config stored and manageable via API | 2d |
| SLA-02 | Completed | 8 | Medium | Make SLA due-date engine business-hours aware | `apps/api/src/tickets/tickets.service.ts`, `apps/api/test/integration/slas.business-hours.spec.ts` | Due dates and breach checks honor calendars in tests | 2d |
| PERF-01 | Completed | 9 | High | Add PostgreSQL trigram/FTS search path and index migration | `apps/api/prisma/migrations/20260220150000_add_ticket_search_trigram_indexes/migration.sql` | Search index migration added for `%contains%` ticket search paths | 2d |
| PERF-02 | Pending | 9 | Medium | Add short-lived cache for `reports/summary` and `tickets/counts` | `apps/api/src/reports/reports.service.ts`, `apps/api/src/tickets/tickets.service.ts` | 30-60s cache hit behavior verified; stale window documented | 1.5d |
| PERF-03 | Completed | 9 | Medium | Add optional `includeTotal=false` on list endpoints | `apps/api/src/tickets/dto/list-tickets.dto.ts`, `apps/api/src/tickets/tickets.service.ts` | Clients can skip expensive count when not needed | 1d |
| OBS-01 | Pending | 9 | Medium | Add request correlation ID propagation in API logs | middleware + logger usage | Every request logs a stable request ID and returns it in response header | 1d |
| CI-01 | Completed | 9 | High | Add CI workflow for build + integration + e2e smoke | `.github/workflows/ci.yml` | PR checks run build, API integration tests, and Playwright suite | 1.5d |
| PERF-REG-01 | Pending | 9 | Medium | Add perf regression script gate and reporting output artifact | `scripts/perf/*`, CI workflow | p95 trend captured per run; threshold failures visible in CI | 1d |

## Immediate Execution Order
1. `EMAIL-01` (formal inbound provider contract + payload map).
2. `ATT-01` (attachment storage abstraction + cloud provider).
3. `PERF-02` and `OBS-01` (API caching + request correlation IDs).
4. `PERF-REG-01` (perf regression gate in CI).
5. `RL-01` route-specific policies (keep global throttling baseline).

## Risks and Sequencing Notes
1. Inbound email work should not ship without idempotency and signature validation.
2. Auth migration should keep a short overlap flag for e2e/dev personas.
3. Business-hours SLA changes can alter existing due dates; include migration and backfill strategy.
4. Performance optimizations should be measured with existing scripts before/after each major change.
