# Ticketing System — Gaps & Roadmap (Needs Attention)

Items to build or improve so the system aligns with the full modern ticketing design (MVP → scalable). Use this for backlog prioritization and architecture docs.

---

## 1. Realtime Updates

**Current:** Notifications and ticket list updates use polling (e.g. 30s).

**Target:** WebSocket or SSE for live ticket updates (per team/queue and per ticket).

**Actions:**
- [ ] Add WebSocket or SSE channel (e.g. Socket.io or native SSE).
- [ ] Emit events when `TicketEvent` is written (status change, assign, message, etc.).
- [ ] Subscribe clients by team/queue and by open ticket ID.
- [ ] Optionally reduce or remove notification polling once realtime is stable.

**Refs:** `docs/ui-ux-improvements.md`, `docs/frontend-interaction-latency-issues.md`.

---

## 2. Attachment Storage (S3 / Azure Blob)

**Current:** Attachments stored on local filesystem (`ATTACHMENTS_DIR=uploads`).

**Target:** Object storage (S3, Azure Blob) for durability, scaling, and multi-instance deployments.

**Actions:**
- [ ] Introduce storage abstraction (e.g. `AttachmentStorageService`).
- [ ] Implement S3 or Azure Blob provider; keep local provider for dev.
- [ ] Migrate existing files to object storage or dual-write during transition.
- [ ] Update `resolveAttachmentPath` / download flow to use storage API or signed URLs.

---

## 3. Search (Postgres FTS → Optional OpenSearch)

**Current:** Ticket list search uses `subject`/`description` `contains` (case-insensitive) in Postgres.

**Target (MVP):** Postgres full-text search (FTS) for better relevance and performance.  
**Target (scale):** OpenSearch/Elasticsearch for fuzzy search, facets, and heavy load.

**Actions:**
- [ ] Add Postgres FTS: `tsvector` column or generated column on Ticket (e.g. subject + description), GIN index, `ts_rank` or plainto_tsquery in list API.
- [ ] (Later) Add event-driven indexer: on ticket create/update, publish event → worker updates OpenSearch/Elastic index.
- [ ] (Later) Ticket list/search API: query search index, then hydrate from Postgres if needed.

---

## 4. SLA Timers (Delayed Jobs vs Interval)

**Current:** SLA breach worker runs on a fixed interval (`SLA_BREACH_INTERVAL_MS`), scans `SlaInstance` by `nextDueAt`, uses advisory lock.

**Target:** Job queue with delayed jobs per ticket (e.g. "first response due at T") for scalability and precision.

**Actions:**
- [ ] On ticket create: schedule delayed job for `firstResponseDueAt` (and resolution if applicable).
- [ ] On status change to WAITING_ON_REQUESTER / WAITING_ON_VENDOR: pause SLA (cancel or reschedule jobs).
- [ ] On ticket close/resolve: cancel pending SLA jobs for that ticket.
- [ ] Worker: at job execution, re-read ticket/SlaInstance and only then send at-risk/breach (idempotent).
- [ ] Keep or phase out interval-based breach scanner once delayed jobs cover all cases.

---

## 5. SLA Business Hours / Calendar

**Current:** SLA policies have `firstResponseHours` and `resolutionHours` per priority; no business hours or holidays in schema.

**Target:** Team-specific business hours and optional holiday calendar so SLA timers only count working time.

**Actions:**
- [ ] Add model or config for business hours (e.g. per team: days + start/end time, timezone).
- [ ] Optional: holiday calendar (per org or per team).
- [ ] SLA engine: compute `dueAt` / `nextDueAt` using business-hours-aware logic (or use existing library).
- [ ] Docs: `docs/slas.md` already mentions "team-specific calendars" — implement and document.

---

## 6. Inbound Email & Webhooks

**Current:** Outbound email via BullMQ; no inbound email or Slack/Teams webhooks.

**Target:** Inbound email → create or append to tickets (threading); Slack/Teams actions → transitions or comments; generic webhooks for integrations.

**Actions:**
- [ ] **Inbound email:** `POST /webhooks/email` (or provider-specific path). Validate source (e.g. M365 webhook secret), parse body, resolve ticket by In-Reply-To / token; create ticket or add message (and attachments). Env: `M365_INBOUND_WEBHOOK_SECRET` etc. (see `.env.example`).
- [ ] **Slack/Teams:** `POST /webhooks/slack` (and similar for Teams). Verify signing; map actions to assign/transition/comment.
- [ ] **Idempotency:** All webhook endpoints accept `Idempotency-Key` (or similar); store key + response; return same response on replay.
- [ ] Docs: `docs/zendesk-gap-implementation.md`, `sprint.md` — align implementation with those plans.

---

## 7. Idempotency for Mutating APIs

**Current:** No idempotency keys on API endpoints (mentioned in sprint/IT doc only).

**Target:** Critical for webhooks and safe retries; design called out idempotency keys.

**Actions:**
- [ ] Define header (e.g. `Idempotency-Key`) and storage (e.g. Redis or DB table: key → response + status).
- [ ] Apply to: ticket create, message create, webhook handlers (email, Slack). Optionally assign/transition if they can create side effects (e.g. notifications).
- [ ] Return stored response (and same status code) when key is repeated within TTL.

---

## 8. Tags on Tickets (Optional)

**Current:** No `tags[]` on Ticket; flexible taxonomy via CustomFieldValue (e.g. multi-select or text).

**Target:** If product needs "tags" as first-class (e.g. for filters, reporting, routing): add `tags` (array or relation).

**Actions:**
- [ ] Decide: keep using custom fields for "tag-like" use cases, or add `tags` (e.g. `TicketTag` table or `text[]`).
- [ ] If added: list/filter by tags, include in search/FTS, and document in API.

---

## 9. Observability & Audit

**Current:** Structured logs; audit via `TicketEvent`; no explicit correlation IDs or metrics in code reviewed.

**Target:** Correlation IDs (requestId, ticketId), metrics (creation rate, SLA breaches, time-to-first-response, backlog), and optional tracing (API → DB → worker).

**Actions:**
- [ ] Add request correlation ID (middleware); include in logs and optional response header.
- [ ] Add metrics (e.g. Prometheus): ticket created, by status/team; SLA at-risk/breach; first response time; backlog size.
- [ ] Optional: OpenTelemetry (or similar) for traces across API and workers.
- [ ] Keep `TicketEvent` as immutable audit source; ensure all important actions write events.

---

## 10. Rate Limiting

**Current:** Redis used for BullMQ; no rate limiting in codebase.

**Target:** Rate limit by API key or user/IP for public or webhook endpoints to avoid abuse.

**Actions:**
- [ ] Use Redis (e.g. sliding window or token bucket) for rate limit counters.
- [ ] Apply to: webhook endpoints, optional: login/ticket create for unauthenticated or high-volume clients.
- [ ] Return 429 and standard headers (e.g. `Retry-After`).

---

## 11. Multi-Tenancy (If Required)

**Current:** Single-tenant; no `tenant_id` or org model.

**Target:** If multiple orgs/customers share one deployment: tenant isolation (design suggested single DB + `tenant_id` for MVP).

**Actions:**
- [ ] Add tenant (or organization) model and `tenantId` to core entities (User, Team, Ticket, etc.).
- [ ] Enforce tenant scope on every query; middleware or guard to set tenant from auth/subdomain/path.
- [ ] (Later) Consider schema-per-tenant or DB-per-tenant if compliance demands it.

---

## 12. Auth (SSO / OIDC)

**Current:** Demo auth via `x-user-id` / `x-user-email`; Azure AD env vars present but not wired.

**Target:** Production auth: OIDC/SAML (e.g. Azure AD) or NextAuth-style integration.

**Actions:**
- [ ] Integrate Azure AD (or other IdP): validate token or use OIDC flow; map identity to User in DB (by email or subject).
- [ ] Replace or supplement header-based demo auth with real tokens; keep role/team resolution from DB.
- [ ] Document required env vars and callback URLs (see `docs/azure-env-settings.md`).

---

## Summary Table

| # | Area              | Priority (suggested) | Effort |
|---|-------------------|----------------------|--------|
| 1 | Realtime          | High                 | Medium |
| 2 | Attachment storage| High (for scale)     | Medium |
| 3 | Search (FTS)      | Medium               | Small–Medium |
| 4 | SLA delayed jobs  | Medium               | Medium |
| 5 | SLA business hours| Low–Medium           | Medium |
| 6 | Email/webhooks    | High (integrations)   | High   |
| 7 | Idempotency       | High (webhooks)      | Small–Medium |
| 8 | Tags              | Low (product-driven) | Small  |
| 9 | Observability     | Medium               | Medium |
|10 | Rate limiting     | Medium               | Small  |
|11 | Multi-tenancy     | If needed            | High   |
|12 | SSO / OIDC        | High (production)    | Medium |

---

*Generated from system-design alignment review. Revisit as features are shipped.*
