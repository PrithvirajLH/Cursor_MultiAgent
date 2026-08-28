# Implementation Prompt — 1.4 More automation actions

**Date:** 2026-08-27
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.4 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** rules can assign, set priority/status, notify a lead and add a note — and nothing else. Admins cannot make a rule tag a ticket, set its category, add a watcher, or send an email.

**Cost:** none — code only. **No migration** (the "run all matching rules" switch proposed on the card is deferred to keep this migration-free; first match still wins). Depends on 1.3 being merged (it builds on the same action switch).

---

## 1. Goal

Five new rule actions — `add_tag`, `remove_tag`, `set_category`, `add_follower`, `send_email` — available in the automation editor, executed with the same safety as the existing ones.

## 2. Context read

- `CLAUDE.md` — baselines **222 unit (28 suites), 395 integration + 1 skipped, 36 web (13 files)** (after 1.3).
- `docs/agent-context/repo-landmines.md` (all), `docs/agent-context/working-agreement.md`, `.cursorrules`.
- `prompts/2026-08-27-1-3-timed-automations.md` §5 Task 1 — the shape of the last action added (`notify_requester`).

## 3. Facts established first (verified 2026-08-27)

| Fact | Consequence |
|---|---|
| `automation/rule-engine.service.ts` `executeActions(...)` (`:414`) runs inside the rule's transaction (`tx`), iterating `switch (action.type)`; `notify_team_lead`/`notify_requester` write `Notification` rows via `tx.notification.create`; `set_status` calls `applyStatusTransitionAction`. `ACTION_TYPES` in `dto/create-automation-rule.dto.ts` (`:83–101`) and `validateActionParams` in `automation.service.ts` gate what a rule may contain. | Every new action is a new `case` + DTO allowlist entry + `validateActionParams` branch + editor option. |
| `TagsService.attachManyToTicket(ticketId, rawNames, source: TagSource, createdById, tx?)` (`tags/tags.service.ts:133`) accepts a transaction client; `removeFromTicket(ticketId, tagId, user)` (`:216`) takes an `AuthUser` and no `tx`. `TagsModule` exports `TagsService`; `AutomationModule` imports `RealtimeModule`, `SlasModule`, `TicketsModule` — **not** `TagsModule` or `NotificationsModule`. | Import `TagsModule` and `NotificationsModule` into `AutomationModule`. For `remove_tag`, do a direct `tx.ticketTag.deleteMany({ where: { ticketId, tag: { name } } })` rather than the user-scoped service method. |
| `NotificationsService.notifyUsers(recipients: User[], details: QueuedEmailDetails)` where `QueuedEmailDetails = { subject, body, eventType, ticketId?, payload?, emailMetadata?, emailContent? }` writes outbox rows through `this.prisma` (not the rule's `tx`). Production has no SMTP (inventory) — the outbox row is still written and would send once SMTP exists. | `send_email` must run **after the transaction commits**, or a rolled-back rule would still email. Collect post-commit work in `executeActions` and run it in `runForTicket` after the `$transaction` resolves. |
| Followers: `tx.ticketFollower.upsert({ where: { ticketId_userId: { ticketId, userId } }, update: {}, create: { ticketId, userId } })` (`tickets.service.ts:1245`). | `add_follower` uses the same upsert; target is `userId` (a specific person) or `'requester'` / `'assignee'` keywords. |
| `TicketsService.setCategory()` validates the category exists then updates + writes `TICKET_CATEGORY_CHANGED` + realtime. The rule engine already has the tx and the ticket; `applyStatusTransitionAction` is the precedent for reusing a ticket-service internal. | For `set_category`, do it inline in the tx: verify `category.findUnique({ where: { id, isActive: true } })`, `tx.ticket.update({ categoryId })`, `tx.ticketEvent.create({ type: 'TICKET_CATEGORY_CHANGED', payload: { from, to, byAutomation: true } })`. |
| Web editors: `components/automation/ActionEditor.tsx` renders per-type parameter inputs; `ConditionEditor.tsx` untouched by this card. | Add five action options with their inputs. |

## 4. Decisions and assumptions

1. **Action shapes (DTO fields already exist for most):**
   - `add_tag` — `{ type: 'add_tag', tags: string[] }` (1–5 names, each ≤ 40 chars; new DTO field `tags?: string[]`), source `TagSource.AI`? No — add `TagSource.AUTOMATION`? **No enum change:** use `TagSource.MANUAL` with `createdById = ruleCreatedById`, and put `byAutomation: true` in the event payload. (A dedicated source value would need a migration — deferred.)
   - `remove_tag` — `{ type: 'remove_tag', tags: string[] }`.
   - `set_category` — `{ type: 'set_category', categoryId: uuid }` (new DTO field).
   - `add_follower` — `{ type: 'add_follower', userId?: uuid, target?: 'requester' | 'assignee' }` — exactly one of the two.
   - `send_email` — `{ type: 'send_email', to: 'requester' | 'assignee' | 'team_leads' | 'address', address?: email, subject: string (≤ 200), body: string (≤ 4000) }`; placeholders `{{ticket.displayId}}`, `{{ticket.subject}}`, `{{requester.displayName}}` substituted server-side (simple string replace; this is the seed of card 1.7's macro variables — keep the helper in `automation/template-vars.util.ts`, one export).
2. **Post-commit work:** `executeActions` returns `{ current, postCommit: Array<() => Promise<void>> }`; `runForTicket` awaits each after the transaction, catching and logging failures (an email failure must not undo a rule).
3. **`remove_tag` on a tag the ticket lacks is a no-op**, not an error. `add_follower` for a user already following is a no-op (upsert).
4. **Tag events:** write `TicketEvent` `TAGS_CHANGED` `{ added: [...], removed: [...], byAutomation: true }` when anything changed (check what event, if any, `TagsService.attachManyToTicket` already writes and do not duplicate).
5. **No changes to `notify_team_lead` / `notify_requester`.**

## 5. The work

Kill stray node processes; Postgres up; no other test run active; `.env` present.

### Task 1 — DTO and validation

**Files:** Modify `src/automation/dto/create-automation-rule.dto.ts`, `src/automation/automation.service.ts`

- [ ] `ACTION_TYPES` += the five. `AutomationActionDto` += `tags?: string[]` (`@IsArray @ArrayMaxSize(5) @IsString({each}) @MaxLength(40,{each})`), `categoryId?: string` (`@IsUUID`), `target?: 'requester' | 'assignee'` (`@IsIn`), `to?: 'requester' | 'assignee' | 'team_leads' | 'address'` (`@IsIn`), `address?: string` (`@IsEmail`), `subject?: string` (`@MaxLength(200)`); reuse existing `userId`, `body` (raise its cap to 4000 if lower).
- [ ] `validateActionParams`: `add_tag`/`remove_tag` need non-empty `tags`; `set_category` needs `categoryId` **and** the category must exist and be active (400 otherwise); `add_follower` needs exactly one of `userId` (must exist and be active) / `target`; `send_email` needs `to`, `subject`, `body`, and `address` iff `to === 'address'`.

### Task 2 — Executor

**Files:** Modify `src/automation/rule-engine.service.ts`, `src/automation/automation.module.ts`; Create `src/automation/template-vars.util.ts`

- [ ] `AutomationModule.imports` += `TagsModule`, `NotificationsModule` (use `forwardRef` if a cycle appears; report if it does). Inject `TagsService` and `NotificationsService` into `RuleEngineService`.
- [ ] `template-vars.util.ts`: `export function fillTemplateVars(text: string, vars: Record<string, string>): string` — replaces `{{key}}` occurrences; unknown keys become empty strings.
- [ ] `executeActions` gains a `postCommit: Array<() => Promise<void>>` accumulator and returns it alongside `current`; `runForTicket` runs them after the `$transaction` with `try/catch` + `logger.error` per callback.
- [ ] Cases:
  - `add_tag`: `await this.tags.attachManyToTicket(ticketId, action.tags, TagSource.MANUAL, ruleCreatedById, tx)`; event as §4.4.
  - `remove_tag`: `tx.ticketTag.deleteMany({ where: { ticketId, tag: { name: { in: normalized } } } })` (normalise like `TagsService` does — trim + lowercase); event.
  - `set_category`: as §3 row 5; skip if already that category.
  - `add_follower`: resolve `userId` from `target` (`current.requesterId` / `current.assigneeId`, skip if null) or the explicit id; upsert.
  - `send_email`: resolve recipients — `requester` → `[requester]`, `assignee` → `[assignee]` or skip, `team_leads` → `TeamMember` LEAD users of `current.assignedTeamId`, `address` → `notifyAddresses([address])`; build `subject`/`body` via `fillTemplateVars`; push `() => this.notifications.notifyUsers(users, { eventType: 'AUTOMATION_EMAIL', subject, body, ticketId, payload: { ruleId } })` onto `postCommit`. `current` needs `requester`/`assignee` user rows — extend the select.
- [ ] Unit tests in `rule-engine.service.spec.ts`: `fillTemplateVars`; `send_email` is **not** sent when the transaction throws (mock `$transaction` to reject, assert `notifyUsers` not called); `add_follower` with `target: 'assignee'` on an unassigned ticket is a no-op.

### Task 3 — Web editor

**Files:** Modify `apps/web/src/components/automation/ActionEditor.tsx` (and `NewAutomationRulePage.tsx` / `AutomationRulesPage.tsx` only if they hold an action-label map)

- [ ] Options: "Add tags" (chip/comma input), "Remove tags", "Set category" (category select — the page already loads categories for conditions; reuse), "Add follower" (radio: requester / assignee / specific person + user picker), "Send email" (to: requester / assignee / team leads / address; subject; body with a hint listing the three placeholders).
- [ ] `tsc` + `vitest` clean.

### Task 4 — Integration tests

**Files:** Create `test/integration/automation.actions.spec.ts`

- [ ] Rules created via `POST /api/automation-rules` as admin with trigger `TICKET_CREATED` and a `subject contains` condition, then a ticket created to fire them:
  1. `add_tag` → `GET /api/tickets/:id` shows the tags; `TicketTag.source === 'MANUAL'`, `createdById === rule creator`.
  2. `remove_tag` (ticket created with the tag) → tag gone; a second run is a no-op.
  3. `set_category` → `categoryId` set; event `TICKET_CATEGORY_CHANGED` with `byAutomation: true`; invalid category → 400 at rule creation.
  4. `add_follower` `target: 'requester'` → requester in `GET …/followers`; `target: 'assignee'` on unassigned → no change, no error.
  5. `send_email` to `requester` → one `NotificationOutbox` row with `eventType 'AUTOMATION_EMAIL'`, subject with `{{ticket.displayId}}` filled; `to: 'address'` without `address` → 400.
  6. A rule whose later action throws (e.g. `set_category` to a category deleted after rule creation) leaves no outbox row from an earlier `send_email` in the same rule (proves post-commit ordering) — if this is hard to stage, replace with the unit test in Task 2 and say so.
- [ ] Run alone, then the full suite. **Expect 395 + 6 = 401 passed, 1 skipped**; the real number wins.

### Task 5 — Docs, baselines, commit

- [ ] `CLAUDE.md` + `repo-landmines.md` baselines. Commit by explicit path:

```bash
git add apps/api/src/automation apps/api/test/integration/automation.actions.spec.ts apps/web/src/components/automation/ActionEditor.tsx CLAUDE.md docs/agent-context/repo-landmines.md
git commit -m "feat(automation): add_tag, remove_tag, set_category, add_follower, send_email actions with post-commit email delivery"
```

## 6. Files expected to change

`automation/rule-engine.service.ts` · `automation/rule-engine.service.spec.ts` · `automation/dto/create-automation-rule.dto.ts` · `automation/automation.service.ts` · `automation/automation.module.ts` · `automation/template-vars.util.ts` (new) · `test/integration/automation.actions.spec.ts` (new) · `ActionEditor.tsx` (+ the two pages only for labels) · `CLAUDE.md` · `repo-landmines.md`. No schema, no migration, no dependency.

## 7. Security considerations

- `send_email` to an arbitrary `address` is admin-authored configuration (OWNER/TEAM_ADMIN only create rules); it can leak ticket subject text to an external address by design — the placeholders deliberately exclude message bodies and description. Say so in the editor hint.
- Emails go out only after the transaction commits; a failed rule sends nothing.
- `set_category` validates the category is active at rule-save time and skips (logs) at run time if it has since been deactivated.

## 8. Acceptance criteria

1. Six integration cases (or five + the unit proof) pass; full suite = 395 + new, 1 skipped; unit 222 + new; `tsc` clean; vitest 36.
2. An admin can build a rule "when a ticket is created with subject containing 'VPN' → add tag `vpn`, set category Access & Identity, email the requester" in the UI and it fires on a new ticket in dev; the outbox row exists (no SMTP locally is fine).
3. Baselines updated.

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx jest --config ./test/jest.integration.json test/integration/automation.actions.spec.ts > ../../it-actions.txt 2>&1; grep Tests: ../../it-actions.txt
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

## 10. Manual test steps

Dev API (`PORT=3077`) + web (`VITE_E2E_MODE=true`). As `admin@company.com` build the rule from acceptance criterion 2; as a requester create a "VPN broken" ticket; verify tags, category and a `NotificationOutbox` row (dev DB) with the filled subject. Delete the rule and the ticket afterwards; stop servers; zero repo node processes.

## 11. Handoff notes — what to report back

1. Commit SHA. 2. `Tests:` lines (unit, actions spec, full suite), vitest, both `tsc`. 3. `git diff --stat <pre-card sha> HEAD`. 4. Manual step outcome. 5. Anything that did not match — especially whether importing `TagsModule`/`NotificationsModule` into `AutomationModule` created a dependency cycle, whether `attachManyToTicket` already writes an event, and whether case 6 was staged or replaced by the unit proof.

---

## 12. Post-implementation record (planning session, 2026-08-28)

**Verdict: GREEN.** Commit `156c8e5`. Planner independently re-ran: full `test:integration` **401 passed + 1 skipped, 44/44 files, 0 failures** (650 s, run alone); `jest` 227/227 (28 suites); `tsc --noEmit` clean in api and web; vitest 13 files / 36. Source read: the five actions behave as specified; `postCommit` tasks are collected inside `executeActions` and run by `runPostCommit` **after** `$transaction` resolves, each wrapped in try/catch with a logged failure — so a rolled-back rule sends nothing and a failed email never undoes a rule; `fillTemplateVars` replaces unknown keys with empty strings; `TAGS_CHANGED` written only when something changed; `set_category` validated at save time and skipped with a warning at run time; DTO and `validateActionParams` gate every new parameter; `TagsModule`/`NotificationsModule` imported without a cycle.

**Accepted deviations:** §3 was wrong that `ActionEditor.tsx` drives the automation pages — both pages have their own inline editors, so the implementer extended both (+237/+255) and also implemented `ActionEditor.tsx` as specified (now orphaned — logged as a tidy follow-up); `rule-engine.conditions.spec.ts` needed a 2-line constructor-arity fix; the web `AutomationAction` type was extended locally rather than in `client.ts` (follow-up); integration case 6 was staged for real rather than replaced by the unit proof.

**Landmines added by the implementer (verified in the file):** automation rules are first-match and `subject contains` is a substring test, so spec tokens must not prefix one another (`ACT4` swallowed `ACT4B`); `TICKET_CREATED` is enqueued fire-and-forget after the POST returns, so specs must poll for the `AutomationExecution` row.

**Approved to merge; deploy with 1.1, 1.2, 1.3 (and 1.5 when it passes).** No migration in this card.
