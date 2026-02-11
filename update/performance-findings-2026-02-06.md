# Performance Findings (2026-02-06)

This document captures the latest performance measurements and improvement opportunities for the Codex Ticketing System.

## Environment
- Local dev servers running (`npm run dev`).
- Measurement scripts:
  - `scripts/perf/measure.mjs`
  - `scripts/perf/load.mjs`
  - `scripts/perf/ui-perf.mjs`

## Results Summary

### API Latency (measure.mjs, p50/p95)
- API health: p50 5.0 ms, p95 12.7 ms
- API tickets list: p50 805.2 ms, p95 999.3 ms
- API ticket detail: p50 1450.0 ms, p95 1523.9 ms
- API reports summary: p50 692.0 ms, p95 1066.0 ms
- Web home: p50 6.9 ms, p95 9.5 ms

### Load Test (load.mjs, p50/p95/p99)
- API tickets list (open): p50 807.9 ms, p95 988.9 ms, p99 1041.6 ms
- API tickets list (resolved): p50 810.9 ms, p95 855.4 ms, p99 880.7 ms
- API tickets counts: p50 683.5 ms, p95 789.6 ms, p99 1010.0 ms
- API ticket detail: p50 1421.2 ms, p95 1471.8 ms, p99 1488.6 ms
- API reports summary: p50 639.8 ms, p95 717.5 ms, p99 892.3 ms
- API reports by status: p50 579.3 ms, p95 603.1 ms, p99 635.6 ms

### UI Interaction Timings (ui-perf.mjs)
- Tickets page load (table ready): 1456.6 ms
- Ticket detail load (conversation panel): 3608.6 ms
- Timeline tab switch: 199.1 ms

## Findings (What Needs Fixing First)
1. **Ticket detail API**: p95 ~1.5s; UI detail load ~3.6s.
2. **Ticket list API**: p95 ~1.0s.
3. **Counts/summary endpoints**: p95 ~0.7–1.1s.

These exceed the non‑functional targets in `sprint.md` (p95 list <= 400ms, p95 detail <= 300ms).

## Primary Optimization Opportunities

### Backend
1. **Paginate ticket detail children**
   - `getById()` loads messages, events, attachments, followers, custom fields in one call.
   - Split into separate endpoints and paginate messages/events.
2. **Reduce list payload**
   - `list()` uses `include` for requester/assignee/team/category. Replace with `select` and only return list fields.
3. **Avoid full count on every list call**
   - Add optional `includeTotal=false` or use `pageSize + 1` to detect “has next page.”
4. **Collapse counts into one query**
   - `getCounts()` uses four separate `count()` queries. Replace with a single SQL query with conditional sums.
5. **Add/verify indexes**
   - Recommended:
     - `Ticket(status, updatedAt)`
     - `Ticket(assignedTeamId, status, updatedAt)`
     - `Ticket(assigneeId, status, updatedAt)`
     - `Ticket(requesterId, createdAt)`
     - `Ticket(dueAt)`
     - `Ticket(completedAt)`
     - `TicketEvent(ticketId, createdAt)`
     - `TicketMessage(ticketId, createdAt)`
     - `Attachment(ticketId, createdAt)`
6. **Search optimization**
   - `contains` + `insensitive` likely full scans. Use `pg_trgm` + GIN or full‑text search.
7. **Cache summaries**
   - Cache `reports/summary` and `tickets/counts` for 30–60 seconds.

### Frontend
1. **Lazy load detail tabs**
   - Fetch timeline data only when Timeline tab is opened.
2. **Prefetch detail**
   - Prefetch ticket detail on row hover or when list finishes loading.
3. **Non‑blocking updates**
   - Use `startTransition` for filter changes to keep input responsive.

## Notes
- Prisma logging was enabled via code changes to `apps/api/src/prisma/prisma.service.ts` to allow query logging without type errors.
- If required, the next step is to run Prisma logging in a dedicated process and inspect slow queries to validate the specific DB bottlenecks.
