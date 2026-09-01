# Implementation Prompt — 1.27 SLA breaches and badge counts must reach the screen

**Date:** 2026-09-01
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.27 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** the SLA breach worker changes ticket state every 60 seconds and tells
nobody. An agent watching the queue gets a bell notification while the SLA badge
stays green, the "Breach risk · 1h" count stays put, and the ticket detail SLA
panel does not move. A countdown that is silently wrong is worse than no
countdown, because it actively says you are fine.

**Cost:** none. API + web. **No schema, no migration, no Azure change.**

**Sibling card:** 1.26 covers the same complaint from the other side (the list
going stale when the socket drops) and is **web-only**. Keep the two in separate
commits — this one touches `apps/api`.

---

## 1. Goal

When a ticket breaches or goes at-risk, the queue and the ticket both show it
within seconds, without anyone refreshing. And a realtime change made by
*somebody else* moves the sidebar badge counts, not just your own actions.

## 2. Context read

- `CLAUDE.md` — baselines **272 unit (32 suites), 428 integration + 1 skipped, 58 web (16 files)**.
- `docs/agent-context/repo-landmines.md` (all), `docs/agent-context/working-agreement.md`, `.cursorrules`.

## 3. Facts established first (verified 2026-09-01)

| Fact | Consequence |
|---|---|
| `slas/sla-breach.service.ts` imports `InAppNotificationsService` and `NotificationsService` and **nothing realtime**. Grep for `realtime` in that file returns nothing. `slas/slas.service.ts` does publish, but only `publishAdminChanged` for policy-config edits (`:1484`). | The worker is the gap. The bell updates because `in-app-notifications.service.ts` publishes; the **ticket row** never does. |
| The realtime payload is built in `tickets/ticket-realtime.service.ts:85-118` and selects `id, status, priority, updatedAt, assignedTeam, requesterId, assignee, followers, accessGrants`. **No `dueAt`, no `slaInstance`, no breach state.** | Widening the payload to carry SLA state means keeping two field lists in sync across API and web — the exact drift that causes bugs. **Do not widen it.** See §4.1. |
| `TicketsPage.tsx` already has the pattern for "the payload cannot express this, re-read the row": `if (payload.reason === "edited")` → `fetchTicketById(ticketId)` → merge into the row (~`:768`). | Reuse it verbatim for the new reason. No new mechanism. |
| Sidebar badge counts come from `GET /tickets/counts` (`api/client.ts:801`). `client.ts:45-59` has an invalidation helper that clears the resource prefix **and** `/counts`. | The plumbing exists. |
| **Nothing outside `client.ts` calls that invalidation.** Grep for `invalidateApiGetCache`/`clearApiGetCache` outside the client returns nothing — so it fires after *your own* mutations and never on a realtime push. | A change made by another agent moves the rows but not the counts. That is task 3 and it is not SLA-specific. |
| `retention/retention.service.ts` has no realtime either. The **manual** delete path does emit `deleted`. | Purged tickets linger in an open list. The job is off in production so this is latent, not live. Task 4, and it is small. |
| `csat/csat.service.ts` has no realtime. | Deliberately **out of scope** — see §4.5. |

## 4. Decisions and assumptions

1. **New reason `sla_changed`, and the web re-reads the row.** Chosen over adding
   SLA fields to the realtime payload because breaches are rare (a handful per
   tick at most), so one extra `GET` per affected ticket costs nothing, and it
   keeps a single source of truth for SLA shape. Add `'sla_changed'` to
   `TicketRealtimeReason` in `tickets/ticket-realtime.service.ts:11`.
2. **The worker publishes once per ticket it changed**, after the transaction that
   marks the instance — not once per tick, and not for tickets it looked at and
   left alone. A quiet tick must stay quiet.
3. **Best-effort, never fatal.** Wrap the publish exactly as the other callers do
   (`safeRealtime` / the existing try-catch with a warn). **A realtime failure
   must not fail or abort the tick** — notifications and the breach marking are
   the job; the push is a courtesy.
4. **Counts invalidation is its own task and applies to every reason**, not just
   SLA. On any realtime ticket event, clear the `/counts` cache so the sidebar
   badges reflect what the rows already show. Do not add a new endpoint or a
   polling loop for counts.
5. **CSAT is out of scope.** A satisfaction score arriving is read weekly, not
   watched; pushing it earns nothing. Recorded so the next person does not "notice
   the gap" and add it.
6. **`actorId` for a worker-raised event.** The worker has no user. Look at how
   other system-raised events populate the actor and follow it; if there is no
   precedent, pass `null` rather than inventing a synthetic user, and say so in
   the report.

## 5. The work

Kill stray node processes; Postgres up; no other test run active; export the
consent variable for the whole integration run.

### Task 1 — The worker announces what it changed

**Files:** Modify `apps/api/src/slas/sla-breach.service.ts`, `apps/api/src/slas/slas.module.ts` (if the realtime provider is not already available there), `apps/api/src/tickets/ticket-realtime.service.ts`

- [ ] Add `'sla_changed'` to `TicketRealtimeReason`.
- [ ] Inject the same realtime service the ticket paths use. **Watch for a circular
      import** between `SlasModule` and `TicketsModule` — if injecting it creates
      one, stop and report rather than restructuring modules; there are cheaper
      shapes (a forwardRef, or publishing through the lower-level
      `RealtimeService` that `slas.service.ts` already uses at `:1484`).
- [ ] After the worker marks a ticket breached or at-risk, publish one event for
      that ticket with `reason: 'sla_changed'`, per §4.2 and §4.3.
- [ ] `runOnce()`'s summary already counts notification intents. If it can honestly
      report how many events it published, add it; if not, leave the summary alone
      and say so.

### Task 2 — The web re-reads the row

**Files:** Modify `apps/web/src/pages/TicketsPage.tsx`, `apps/web/src/pages/TicketDetailPage.tsx`

- [ ] `TicketsPage`: handle `payload.reason === "sla_changed"` the way `"edited"`
      is handled — `fetchTicketById`, merge into that row. It can share the branch
      with `"edited"` if that reads cleanly.
- [ ] `TicketDetailPage`: the open ticket's SLA panel must update. Check how it
      already reacts to `status_changed`; follow the same route.
- [ ] Add `'sla_changed'` to the web's reason type in `realtime/events.ts` so an
      unhandled reason cannot slip through the type checker.

### Task 3 — Realtime pushes move the badge counts

**Files:** Modify `apps/web/src/api/client.ts` (export the invalidator if it is not exported), `apps/web/src/App.tsx`

- [ ] On a realtime ticket event, invalidate the cached `/tickets/counts` entries.
      The helper at `client.ts:45-59` already does the work — it just needs a
      caller. `App.tsx` is where the realtime callbacks live and is the natural
      place.
- [ ] Do **not** invalidate the whole GET cache; that would re-fetch every list on
      every event. Counts only.

### Task 4 — Retention announces its deletions

**Files:** Modify `apps/api/src/retention/retention.service.ts`

- [ ] Publish `reason: 'deleted'` per purged ticket, best-effort, the same shape as
      the manual delete path.
- [ ] **If a purge can delete a large batch**, do not emit thousands of events —
      cap it, or skip the per-ticket publish and report that you did. A retention
      run is not interactive; correctness here matters less than not flooding the
      socket. Use your judgement and say what you chose.

### Task 5 — Tests

**Files:** Create/modify `apps/api/src/slas/sla-breach.service.spec.ts` (unit), `apps/api/test/integration/slas.spec.ts` or a new `test/integration/sla-realtime.spec.ts`

- [ ] **Unit:** with the realtime service mocked — a tick that breaches one ticket
      publishes exactly one `sla_changed` for that ticket; a tick that changes
      nothing publishes nothing; **a publish that throws does not fail the tick**
      (§4.3 — this is the important one).
- [ ] **Integration:** the existing SLA specs must stay green — they are the proof
      that behaviour did not change. Add a case only if it can assert the publish
      without a live socket.
- [ ] Web: a small test for the new reason if it can run without jsdom, following
      `linkified-text.test.tsx`.

### Task 6 — Docs, baselines, commit

- [ ] `CLAUDE.md` + `repo-landmines.md` with the real numbers.
- [ ] **Two commits**, API and web, or one if they are genuinely inseparable — say
      which in the report. **`e2e/` is untracked on purpose; leave it.**

## 6. Files expected to change

`slas/sla-breach.service.ts` · `slas/slas.module.ts` (maybe) ·
`tickets/ticket-realtime.service.ts` · `retention/retention.service.ts` ·
`sla-breach.service.spec.ts` · an SLA realtime integration case ·
`apps/web/src/realtime/events.ts` · `TicketsPage.tsx` · `TicketDetailPage.tsx` ·
`client.ts` · `App.tsx` · `CLAUDE.md` · `repo-landmines.md`.

## 7. Security considerations

- **The publish must respect the audience.** The existing
  `emitTicketRealtimeEvent` derives its audience from `followers`,
  `accessGrants`, `assignedTeamId`, `requesterId` — go through that path so an
  SLA event cannot broadcast a ticket's existence to someone who could not open
  it. **Do not publish to a global channel.**
- The event carries **no new fields**, so nothing new is exposed. That is a second
  reason for §4.1 beyond drift.
- Counts invalidation causes a re-fetch of `/tickets/counts`, which is already
  scoped to the caller. No new data path.

## 8. Acceptance criteria

1. A ticket crossing its SLA deadline turns red **in the open queue** within one
   worker tick, with no refresh.
2. The same ticket's detail page SLA panel updates without a refresh.
3. The **"Breach risk · 1h"** sidebar count moves.
4. A change made by **another** agent moves your sidebar counts too (task 3 is not
   SLA-specific).
5. A tick that changes nothing publishes nothing.
6. With the realtime service throwing, the worker still marks breaches and still
   sends notifications — no failed tick, no lost work.
7. Existing SLA unit and integration specs green: behaviour unchanged.
8. Both `tsc` clean; unit and full integration at or above baseline; vitest green.

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx jest --config ./test/jest.integration.json test/integration/sla.instances.spec.ts test/integration/tickets.sla.spec.ts test/integration/slas.spec.ts > ../../it-sla.txt 2>&1; grep Tests: ../../it-sla.txt
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

**Do not edit source while the full integration run is going** — it resets the
database and reloads modules; a mid-run edit once produced 81 phantom failures
here. Wait the ~8 minutes.

## 10. Manual test steps

Dev API on `PORT=3077` (`AUTH_ALLOW_INSECURE_HEADERS=true`, `NODE_ENV=development`)
+ web with `VITE_API_BASE_URL=http://localhost:3077/api` and `VITE_E2E_MODE=true`.
Persona via `localStorage.setItem("demoUserEmail", "lead@company.com")`.

Set `SLA_BREACH_INTERVAL_MS=15000` so you are not waiting a minute per attempt.
Create a ticket, then move its SLA deadline into the past directly in the dev
database so the next tick breaches it. Watch the open queue **without touching
it**: the row should turn red, the sidebar count should move, and the ticket
detail SLA panel should update. Then confirm a tick with nothing to do produces
no visible change and no requests.

Stop the servers; zero repo node processes. **Note:** a service on port 3000 is
the *LMS*, not this app — leave it alone.

## 11. Handoff notes — what to report back

1. Commit SHA(s). 2. Every `Tests:` line (unit, the three SLA specs, full
integration) plus vitest and both `tsc`. 3. `git diff --stat`. 4. Manual steps —
especially criteria 1, 3 and 6.
5. Anything that did not match, in particular: whether injecting realtime into
`SlasModule` caused a circular import and what you did about it; what you passed
as `actorId` for a worker-raised event; whether the worker summary could honestly
count publishes; and what you decided about batch size in Task 4.

**Stop and report instead of improvising** if this appears to need a schema
change, a migration, a payload widening, or a new endpoint. None should be
necessary.
