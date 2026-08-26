# Frontend Interaction Latency – Findings and Fix Backlog

Date: 2026-02-04  
Scope: `apps/web` frontend

## Summary
User interactions feel delayed primarily due to full-screen reload patterns, heavy request fan-out, and UI state being cleared while requests are in flight. These cause visible pauses, flicker, or waiting for slowest network calls. This document captures the issues so fixes can be scheduled.

## Issues

**Issue 1: Ticket detail actions trigger full refetch and clear state**
Evidence: `apps/web/src/pages/TicketDetailPage.tsx`  
Impact: Every action (assign, transition, follow, upload) waits on a full detail reload and temporarily clears the ticket state, causing visible delays and UI flicker.  
Suggested fix: Keep previous state while loading, apply optimistic updates for the changed fields, and only refresh the specific sub-resources if needed.
Status: Fixed (2026-02-05). Ticket detail no longer clears UI during refresh; actions no longer block on refetch.

**Issue 2: Ticket list clears results before fetch**
Evidence: `apps/web/src/pages/TicketsPage.tsx`  
Impact: Any filter or search change blanks the list, causing perceived delay and UI flicker while the request completes.  
Suggested fix: Use “keep previous data” behavior and show a subtle loading indicator without clearing existing results.
Status: Fixed (2026-02-05). Ticket list now keeps previous results visible while refreshing.

**Issue 3: Search input updates filters on every keystroke (no debounce)**
Evidence: `apps/web/src/pages/TicketsPage.tsx`, `apps/web/src/hooks/useFilters.ts`  
Impact: Each keystroke updates URL params and triggers a full list fetch, creating request churn and noticeable lag on slow networks.  
Suggested fix: Debounce search input and/or delay URL updates until user pauses typing.
Status: Fixed (2026-02-05). Added a debounced search draft and URL updates use `replace` to reduce history churn.

**Issue 4: Dashboard fans out many API calls per refresh**
Evidence: `apps/web/src/pages/DashboardPage.tsx`  
Impact: Loads a large number of parallel requests; UI waits on the slowest response, amplifying perceived latency.  
Suggested fix: Create a single aggregated “dashboard summary” endpoint or cache/dedupe calls with a data-fetching layer.
Status: Mitigated (2026-02-05). UI now keeps previous data visible while refreshing, but request fan-out remains (still a backend/API aggregation opportunity).

**Issue 5: Manager Views page issues N+1 fetches**
Evidence: `apps/web/src/pages/ManagerViewsPage.tsx`  
Impact: One request per priority plus one per team. Latency grows linearly with teams and increases backend load.  
Suggested fix: Replace with aggregated counts endpoint or batch query.
Status: Fixed (2026-02-05). Added `GET /tickets/metrics` and updated Manager Views to fetch once.

**Issue 6: Reports page reloads all charts on any filter change**
Evidence: `apps/web/src/pages/ReportsPage.tsx`  
Impact: Every filter change triggers multiple heavy requests, causing slow refresh and UI waiting states.  
Suggested fix: Cache results, reduce fan-out with a reports aggregate endpoint, and update charts incrementally.
Status: Fixed (2026-02-05). Added `GET /reports/summary` and updated Reports to fetch once.

**Issue 7: Per-row timers for RelativeTime**
Evidence: `apps/web/src/components/RelativeTime.tsx`  
Impact: Each rendered row creates its own interval, which can cause input lag and CPU spikes on large lists.  
Suggested fix: Use a single shared timer (context/store) or update via a global tick.
Status: Fixed (2026-02-05). Introduced a shared minute tick hook used by RelativeTime.

**Issue 8: Rich text editor sanitizes HTML on every input**
Evidence: `apps/web/src/components/RichTextEditor.tsx`  
Impact: DOMPurify work on every keystroke can cause typing lag on large messages.  
Suggested fix: Throttle sanitization or sanitize on blur/send; keep lightweight in-progress state for typing.
Status: Fixed (2026-02-05). Debounced sanitization/onChange and added `RichTextEditorRef.getValue()` so sends are never stale.

**Issue 9: Command palette search uses fixed 300ms debounce**
Evidence: `apps/web/src/components/CommandPalette.tsx`  
Impact: Not a bug, but adds intentional delay to search results; combined with backend latency it feels slower.  
Suggested fix: Consider smaller debounce or cache recent results for quick response.
Status: Tuned (2026-02-05). Reduced debounce to 200ms; further caching could be added if needed.

**Issue 10: Notifications polling and repeated background fetches**
Evidence: `apps/web/src/hooks/useNotifications.ts`, `apps/web/src/App.tsx`  
Impact: Polling every 30s may compete with user-triggered requests; on slower networks this can increase perceived latency.  
Suggested fix: Reduce polling frequency, pause polling when user is active, or consolidate with server-sent events.
Status: Mitigated (2026-02-05). Polling pauses when tab is hidden and avoids overlapping requests; further improvements (SSE) still possible.

**Issue 11: Table column resizing writes to localStorage on every mousemove**
Evidence: `apps/web/src/hooks/useTableSettings.ts`, `apps/web/src/components/TicketTableView.tsx`  
Impact: Synchronous localStorage writes can cause UI jank during drag-resize.  
Suggested fix: Debounce persistence (write on mouseup or after a short idle window).  
Status: Fixed (2026-02-05). Debounced persistence to reduce main-thread jank.

## Cross-Cutting Recommendations
1. Introduce a data-fetching layer (TanStack Query or SWR) for caching, request dedupe, and “keep previous data.”
2. Add client-side instrumentation for interaction timing (Performance API marks) and API timings for regression tracking.
3. Prefer aggregated endpoints for dashboard/manager/reports to reduce request fan-out.

## Follow-Up Tasks
1. Decide which screens are highest priority for latency fixes.
2. Add performance tracing so we can confirm the largest contributors in production.
3. Plan backend aggregation endpoints if needed.
