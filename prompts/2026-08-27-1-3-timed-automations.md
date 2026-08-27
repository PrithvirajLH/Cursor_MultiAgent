# Implementation Prompt — 1.3 Timed automations

**Date:** 2026-08-27
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.3 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** automation rules can only react to events (ticket created, status changed, SLA approaching/breached). Nothing runs on a clock, so resolved tickets never close themselves, a requester who stops answering is never nudged, and an unassigned ticket can sit for days without anyone being told.

**Cost:** none — code only. No Azure change, no migration (rules are rows in the existing `AutomationRule` table).

---

## 1. Goal

Rules that run on a timer: "N hours after a ticket's last activity while in status X, do Y" and "if a ticket has been unassigned for N hours, do Y". Ship three ready-made rules, switched off, that an admin can enable: auto-close 7 days after resolved, remind the requester after 3 days waiting, alert the team lead after 4 hours unassigned.

## 2. Context read

- `CLAUDE.md` — baselines **206 unit (26 suites), 388 integration + 1 skipped, 36 web (13 files)**.
- `docs/agent-context/repo-landmines.md` (all), `docs/agent-context/working-agreement.md` (commit discipline), `.cursorrules`.
- `apps/api/src/retention/retention.service.ts` — the most recent interval worker: `onModuleInit` → `setInterval`, public `runOnce()`, `pg_try_advisory_xact_lock`, env-driven policy. Copy its shape.
- `prompts/2026-08-27-1-2-requester-confirm-reopen-cancel.md` §4.3 — `closeReason` semantics; this card supplies `AUTO_CLOSED`.

## 3. Facts established first (verified 2026-08-27)

| Fact | Consequence |
|---|---|
| `automation/rule-engine.service.ts`: `AutomationTrigger = 'TICKET_CREATED' \| 'STATUS_CHANGED' \| 'SLA_APPROACHING' \| 'SLA_BREACHED'`; `runForTicket(ticketId, trigger)` (`:137`) loads active rules for the trigger ordered by `priority`, skips rules whose `teamId` ≠ ticket team, evaluates conditions against `ticketToContext(ticket)` (`:126` — subject, priority, status, assignedTeamId, assigneeId, categoryId, …), runs the first match's actions, records `AutomationExecution`. For SLA triggers it first calls `alreadyExecutedRecently(ruleId, ticketId, trigger, SLA_DE_DUPE_HOURS = 24)` (`:274`). | Add two triggers; extend the de-dupe condition to them; add two numeric context fields. The rest of the loop is reused unchanged. |
| Condition operators (`dto/create-automation-rule.dto.ts:16`, `evaluateSingle`): `contains, equals, notEquals, in, notIn, isEmpty, isNotEmpty` — all string comparisons. | Add a numeric `gte` ("at least"). Time rules need it. |
| Actions (`ACTION_TYPES` `:83`): `assign_team, assign_user, set_priority, set_status, notify_team_lead, add_internal_note`. `set_status` → `applyStatusTransitionAction(tx, ticketId, current, newStatus, ruleCreatedById)` → `ticketsService.applyStatusTransitionInTx(tx, snapshot, newStatus, actorId)` **without a `closeReason`** (so an automation close currently records `AGENT_CLOSED`). `notify_team_lead` creates in-app `Notification` rows via `tx.notification.create` with `NotificationType.SLA_AT_RISK`. | Pass `TicketCloseReason.AUTO_CLOSED` from `applyStatusTransitionAction` when `newStatus === CLOSED`. Add `notify_requester` modelled on `notify_team_lead` (type `TICKET_UPDATED`, recipient = `ticket.requesterId`). |
| `common/automation-queue.service.ts` `enqueue(ticketId, trigger)` (`:145`) queues a BullMQ job or falls back to `ruleEngine.runForTicket` inline. `AutomationModule` imports `RealtimeModule`, `SlasModule`, `TicketsModule` (forwardRef) and exports `RuleEngineService`; `CommonModule` is `@Global` and exports `AutomationQueueService`. | The scheduler enqueues per ticket; it does not run rules itself. |
| `AutomationExecution` has `@@index([ruleId, ticketId, trigger])` and `executedAt`. | The 24 h de-dupe makes a nudge repeat at most daily while the condition holds, and auto-close runs once (the status changes). |
| Web: trigger option lists in `pages/NewAutomationRulePage.tsx:47-49` and `pages/AutomationRulesPage.tsx:69-71` (labels) with per-trigger colours at `:124/:134`; condition fields in `components/automation/ConditionEditor.tsx:4-10` (subject, priority, status, assignedTeamId, assigneeId, categoryId, …); actions in `components/automation/ActionEditor.tsx`. | Add the two triggers, the two hour fields, the `gte` operator and the `notify_requester` action to the editors. |
| `prisma/seed.ts:145-160` (dev seed) creates one sample rule `[Seed] Automation: …` with `isActive: false`. | Add the three default rules there, off by default. Production gets them through the admin UI, not the seed. |
| Existing advisory lock keys: SLA breach 847291, SLA backfill 847292, retention 847293. | Scheduler uses **847294**. |
| `Ticket.updatedAt` changes on every write (status, message, edit…); `resolvedAt` is set on RESOLVED. | "Hours in status" is defined as **hours since last activity** (`updatedAt`) while in that status — simple, and it is what people mean ("nothing has happened for 7 days"). Say so in the UI label. |

## 4. Decisions and assumptions

1. **Two triggers:** `TIME_IN_STATUS` and `UNASSIGNED_FOR`. A time rule **must** carry a threshold condition — `hoursSinceActivity gte N` for `TIME_IN_STATUS` (plus a `status` condition), `hoursUnassigned gte N` for `UNASSIGNED_FOR` — otherwise the scheduler skips it and logs a warning once per tick. The API rejects a time-trigger rule without its threshold with 400.
2. **Scheduler = one interval worker** (`AutomationSchedulerService`), `AUTOMATION_SCHEDULER_ENABLED` default **true** (rules themselves are opt-in, so the worker is safe to run), `AUTOMATION_SCHEDULER_INTERVAL_MS` default 300000 (5 min), `AUTOMATION_SCHEDULER_BATCH` default 200 tickets per rule per tick. Single-instance via advisory lock. `runOnce()` public for tests.
3. **Per tick:** for each active time rule, build the candidate query from the rule's own conditions (status values + threshold), select up to `BATCH` ticket ids (oldest first, `deletedAt IS NULL`), and `enqueue(ticketId, trigger)` each. The rule engine then re-evaluates the full conditions (so extra conditions like team or priority still apply) and de-dupes.
4. **Numeric context fields** added to `ticketToContext`: `hoursSinceActivity = (now − updatedAt) / 3600000` and `hoursUnassigned = assigneeId ? 0 : (now − createdAt) / 3600000`, both rounded down to integers. `gte` compares `Number(raw) >= Number(value)`; for non-numeric operands it returns false.
5. **All automation closes record `AUTO_CLOSED`** — not just timed ones. An event rule that closes a ticket is also "the system closed it".
6. **`notify_requester`** — in-app only in this card (`NotificationType.TICKET_UPDATED`, title `Reminder: <subject>`, body from the action or a default "This ticket is waiting on you — please reply or let us know if it is resolved."). Email comes with card 1.4's `send_email` once SMTP exists.
7. **Three default rules in the dev seed, `isActive: false`**, named `[Seed] Automation: Auto-close resolved after 7 days` / `… Remind requester after 3 days waiting` / `… Alert lead when unassigned 4 hours`.
8. **Unassigned means** `assigneeId IS NULL` and status not in `RESOLVED, CLOSED`.

## 5. The work

Kill stray node processes; Postgres up; no other test run active; `.env` present.

### Task 1 — Triggers, operator, context, close reason (rule engine + DTO)

**Files:** Modify `src/automation/rule-engine.service.ts`, `src/automation/dto/create-automation-rule.dto.ts`, `src/automation/rule-engine.service.spec.ts` (extend; create if absent)

- [ ] `AutomationTrigger` += `'TIME_IN_STATUS' | 'UNASSIGNED_FOR'`. Export a `const TIME_TRIGGERS: AutomationTrigger[] = ['TIME_IN_STATUS', 'UNASSIGNED_FOR']` from a new one-export file `src/automation/time-triggers.const.ts`.
- [ ] De-dupe: where `runForTicket` checks `trigger === 'SLA_APPROACHING' || trigger === 'SLA_BREACHED'` before `alreadyExecutedRecently`, also include the two time triggers (same 24 h window).
- [ ] `ticketToContext`: ensure the loaded ticket select includes `updatedAt` and `createdAt`; add `hoursSinceActivity` and `hoursUnassigned` as in §4.4.
- [ ] `evaluateSingle`: new `case 'gte'`: `const a = Number(raw), b = Number(value); return Number.isFinite(a) && Number.isFinite(b) && a >= b;`.
- [ ] `applyStatusTransitionAction`: pass `newStatus === TicketStatus.CLOSED ? TicketCloseReason.AUTO_CLOSED : undefined` as the fifth argument to `applyStatusTransitionInTx`.
- [ ] `notify_requester` action, beside `notify_team_lead`: `tx.notification.create({ data: { userId: current.requesterId, type: NotificationType.TICKET_UPDATED, title: \`Reminder: ${current.subject}\`, body: action.body ?? DEFAULT_REQUESTER_REMINDER, ticketId } })`. The `current` shape needs `requesterId` — add it to the select/type.
- [ ] DTO: `CONDITION_OPERATORS` += `'gte'`; `ACTION_TYPES` += `'notify_requester'`; trigger `@IsIn` += the two triggers. Add a class-level validator (or a check in `AutomationService.create/update`) that a `TIME_IN_STATUS` rule has both a `status` condition and an `hoursSinceActivity gte` condition, and an `UNASSIGNED_FOR` rule has an `hoursUnassigned gte` condition — 400 `'Time-based rules need an hours threshold (and a status for TIME_IN_STATUS)'`.
- [ ] Unit tests (`rule-engine.service.spec.ts`): `gte` true/false/non-numeric; context hours computed from fixed dates (use `jest.useFakeTimers().setSystemTime`); `applyStatusTransitionAction` passes `AUTO_CLOSED` for CLOSED (mock `ticketsService.applyStatusTransitionInTx` and assert the 5th arg). `npx jest --silent` → 206 + new.

### Task 2 — Scheduler

**Files:** Create `src/automation/automation-scheduler.service.ts`, `src/automation/scheduler-policy.type.ts`, `src/automation/automation-scheduler.service.spec.ts`; Modify `src/automation/automation.module.ts` (provider + export), `.env.example`

- [ ] Type:

```ts
/** Timer settings for time-based automation rules. */
export type SchedulerPolicy = {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
};
```

- [ ] Service skeleton (copy `RetentionService`'s lifecycle): `static readPolicy(config)` (`AUTOMATION_SCHEDULER_ENABLED !== 'false'`, `parsePositiveInt` for the other two), `onModuleInit` (log "Automation scheduler disabled" or "… enabled (every N ms)"; `setInterval`; immediate first run), `onModuleDestroy`, `runOnce(): Promise<SchedulerRunSummary | null>` returning `{ ranAt, rulesConsidered, rulesSkippedNoThreshold, ticketsEnqueued }` or `null` when the lock is held elsewhere.
- [ ] Inside `runOnce`, within a transaction holding `pg_try_advisory_xact_lock(847294)`: `automationRule.findMany({ where: { isActive: true, trigger: { in: TIME_TRIGGERS } } })`. For each rule, `extractThreshold(rule)` (static, pure): walk `conditions` (flat leaves and `and` groups; ignore `or` groups for candidate selection — the engine re-evaluates anyway) to find `hoursSinceActivity`/`hoursUnassigned` `gte` → hours, and `status` `equals`/`in` → status list. Missing threshold → count as skipped, `logger.warn` once per rule per tick.
  - `TIME_IN_STATUS`: `ticket.findMany({ where: { deletedAt: null, status: { in: statuses }, updatedAt: { lte: now − hours }, ...(rule.teamId ? { assignedTeamId: rule.teamId } : {}) }, select: { id: true }, orderBy: { updatedAt: 'asc' }, take: batchSize })`.
  - `UNASSIGNED_FOR`: `where: { deletedAt: null, assigneeId: null, status: { notIn: [RESOLVED, CLOSED] }, createdAt: { lte: now − hours }, ...(teamId) }`.
  - Collect `(ticketId, trigger)` pairs, de-duplicated within the tick.
- [ ] **After the transaction commits**, `await this.automationQueue.enqueue(ticketId, trigger)` for each pair (the queue runs inline when Redis is off — in production today). Log the summary.
- [ ] Unit tests: `readPolicy` defaults; `extractThreshold` for the three seed rules and for a rule without threshold; the candidate `where` builders (pure functions — return the object and assert it).
- [ ] `.env.example`: under "Background queues", `AUTOMATION_SCHEDULER_ENABLED=true`, `AUTOMATION_SCHEDULER_INTERVAL_MS=300000`, `AUTOMATION_SCHEDULER_BATCH=200`, one comment line each.

### Task 3 — Default rules (dev seed)

**Files:** Modify `prisma/seed.ts` (dev seed only, beside the existing `[Seed] Automation:` rule)

- [ ] Three `automationRule.create` calls, all `isActive: false`, `createdById: args.samId`, `priority: 100`:
  1. `Auto-close resolved after 7 days` — trigger `TIME_IN_STATUS`, conditions `[{ field: 'status', operator: 'equals', value: 'RESOLVED' }, { field: 'hoursSinceActivity', operator: 'gte', value: 168 }]`, actions `[{ type: 'set_status', status: 'CLOSED' }]`.
  2. `Remind requester after 3 days waiting` — `TIME_IN_STATUS`, `status equals WAITING_ON_REQUESTER`, `hoursSinceActivity gte 72`, actions `[{ type: 'notify_requester' }]`.
  3. `Alert lead when unassigned 4 hours` — `UNASSIGNED_FOR`, `hoursUnassigned gte 4`, actions `[{ type: 'notify_team_lead', body: 'This ticket has been unassigned for 4 hours.' }]`.
  The existing `deleteMany({ name: { startsWith: '[Seed] Automation:' } })` already clears them on re-seed.

### Task 4 — Integration tests

**Files:** Create `test/integration/automation.timed.spec.ts`

- [ ] Setup: `resetTestDb()`, `createTestApp()`, `const scheduler = app.get(AutomationSchedulerService)`. Create rules through `POST /api/automation-rules` as the admin persona (so the DTO validation is exercised), `isActive: true`, small thresholds (`gte 1`).
- [ ] Cases:
  1. Time rule without a threshold → 400.
  2. Auto-close: create a ticket, drive it to RESOLVED (helper from `csat.spec.ts`), back-date `updatedAt` to 2 h ago with `prisma.ticket.update` (use `$executeRaw` if Prisma refuses to set `updatedAt`), `await scheduler.runOnce()` → `ticketsEnqueued ≥ 1`; ticket is `CLOSED` with `closeReason === 'AUTO_CLOSED'`; one `AutomationExecution` row for the rule.
  3. Same ticket, `runOnce()` again → no new execution (status no longer RESOLVED).
  4. Reminder: ticket in `WAITING_ON_REQUESTER`, back-dated 2 h → one `Notification` of type `TICKET_UPDATED` for the requester; second `runOnce()` → still one (24 h de-dupe).
  5. Unassigned: new unassigned ticket back-dated `createdAt` 2 h → `Notification` for each IT lead; a freshly created ticket (0 h) is not touched.
  6. Rule scoped to the HR team does not fire for an IT ticket.
  7. Soft-deleted ticket is never a candidate.
- [ ] Run alone, then the full suite to a file. **Expect 388 + 7 = 395 passed, 1 skipped**; the real number wins.

### Task 5 — Web editors

**Files:** Modify `apps/web/src/pages/NewAutomationRulePage.tsx`, `apps/web/src/pages/AutomationRulesPage.tsx`, `apps/web/src/components/automation/ConditionEditor.tsx`, `apps/web/src/components/automation/ActionEditor.tsx`

- [ ] Trigger options: `{ value: "TIME_IN_STATUS", label: "Time in status (no activity)" }`, `{ value: "UNASSIGNED_FOR", label: "Unassigned for" }` in both pages; a colour for each at `AutomationRulesPage.tsx:124/:134`.
- [ ] Condition fields: `{ value: "hoursSinceActivity", label: "Hours since last activity" }`, `{ value: "hoursUnassigned", label: "Hours unassigned" }`; operator list gains `gte` labelled "is at least"; when the field is one of the hour fields, render a number input.
- [ ] Action types: `notify_requester` labelled "Notify requester (in-app)" with an optional message.
- [ ] Rule form: when trigger is `TIME_IN_STATUS`, pre-add a `status equals …` and an `hoursSinceActivity gte 24` condition; for `UNASSIGNED_FOR`, pre-add `hoursUnassigned gte 4`. Show the API's 400 message inline if the threshold is removed.
- [ ] `cd apps/web && npx tsc --noEmit && npx vitest run` → clean, 13 files / 36.

### Task 6 — Docs, baselines, commit

- [ ] `docs/azure-env-settings.md`: the three scheduler variables under "Background queues" with one sentence: "rules are off until an admin enables them; the scheduler itself is safe to leave on".
- [ ] `CLAUDE.md` + `repo-landmines.md` baselines (real numbers).
- [ ] Commit by explicit path (read `git status --short` first):

```bash
git add apps/api/src/automation apps/api/prisma/seed.ts apps/api/test/integration/automation.timed.spec.ts apps/api/.env.example apps/web/src/pages/NewAutomationRulePage.tsx apps/web/src/pages/AutomationRulesPage.tsx apps/web/src/components/automation/ConditionEditor.tsx apps/web/src/components/automation/ActionEditor.tsx docs/azure-env-settings.md CLAUDE.md docs/agent-context/repo-landmines.md
git commit -m "feat(automation): time-based triggers (TIME_IN_STATUS, UNASSIGNED_FOR), scheduler, gte operator, notify_requester; automation closes record AUTO_CLOSED"
```

## 6. Files expected to change

`automation/rule-engine.service.ts` · `automation/rule-engine.service.spec.ts` · `automation/dto/create-automation-rule.dto.ts` · `automation/time-triggers.const.ts` (new) · `automation/automation-scheduler.service.ts` (new) · `automation/scheduler-policy.type.ts` (new) · `automation/automation-scheduler.service.spec.ts` (new) · `automation/automation.module.ts` · `automation/automation.service.ts` (only if the threshold validation lives there) · `prisma/seed.ts` · `test/integration/automation.timed.spec.ts` (new) · `.env.example` · four web files · `docs/azure-env-settings.md` · `CLAUDE.md` · `repo-landmines.md`. No schema, no migration, no dependency. Anything else — stop and report.

## 7. Security considerations

- The scheduler only enqueues ticket ids; every rule still runs through `runForTicket` with its team scoping, condition evaluation and de-dupe. No new write path.
- `notify_requester` writes an in-app row for the ticket's own requester only; the body is admin-authored text (same trust level as `notify_team_lead`).
- Candidate queries exclude soft-deleted tickets; auto-close goes through `applyStatusTransitionInTx`, so SLA sync, events and realtime behave exactly as a manual close.
- The worker takes the advisory lock so two app instances never enqueue the same tick twice; the 24 h de-dupe protects against overlap anyway.

## 8. Acceptance criteria

1. Seven new integration cases pass; full suite = 388 + 7, 1 skipped; unit 206 + new; both `tsc` clean; vitest 36.
2. In dev: enable the seeded "Auto-close" rule, resolve a ticket, back-date its `updatedAt` 8 days, wait for the next tick (or set `AUTOMATION_SCHEDULER_INTERVAL_MS=10000`) → the ticket closes with "Closed automatically" in the Status row; the requester sees the reminder notification for a back-dated waiting ticket; the lead sees the unassigned alert.
3. A time rule cannot be saved without its threshold (UI shows the message; API 400).
4. Baselines and env docs updated.

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx jest --config ./test/jest.integration.json test/integration/automation.timed.spec.ts > ../../it-timed.txt 2>&1; grep Tests: ../../it-timed.txt
npx jest --config ./test/jest.integration.json test/integration/automation.spec.ts test/integration/automation.status-transition.spec.ts > ../../it-auto.txt 2>&1; grep Tests: ../../it-auto.txt
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

## 10. Manual test steps

Dev API (`PORT=3077`, `AUTOMATION_SCHEDULER_INTERVAL_MS=15000`) + web (`VITE_E2E_MODE=true`). Re-run the dev seed so the three rules exist (or create them in the UI). As `admin@company.com`: enable "Auto-close resolved after 7 days"; as the lead resolve a ticket; in the dev DB set its `updatedAt` to 8 days ago; within 15 s the ticket shows Closed — "closed automatically"; the Automation page's executions list shows the run. Enable the unassigned rule; create a ticket as a requester and back-date `createdAt` 5 h; the lead's bell shows the alert; a second tick adds nothing. Restore dev data; stop servers; zero repo node processes.

## 11. Handoff notes — what to report back

1. Commit SHA. 2. `Tests:` lines (unit, timed spec, the two existing automation specs, full suite), vitest, both `tsc`. 3. `git diff --stat <pre-card sha> HEAD`. 4. Manual steps with accounts. 5. Anything that did not match — especially: where the threshold validation ended up (DTO vs service), whether `updatedAt` could be back-dated through Prisma or needed raw SQL, and whether the existing automation specs needed any change.
