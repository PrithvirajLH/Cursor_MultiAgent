# Implementation Prompt — 1.1 Edit a ticket's title and description

**Date:** 2026-08-27
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.1 in `prompts/2026-08-26-restart-master-plan.md` — first card of Phase 1
**Closes:** a ticket's subject and description are permanent after creation. Email-created tickets arrive as "Re: Re: help" and stay that way; a typo in a title can never be fixed. There is no `PATCH /api/tickets/:id` at all.

**Cost:** none — code only, no Azure change, no migration.

---

## 1. Goal

Agents (and, for a brand-new ticket, its requester) can correct a ticket's subject and description. Every edit is recorded in the ticket's history and pushed live to open screens.

## 2. Context read

- `CLAUDE.md` — baselines **206 unit (26 suites), 374 integration + 1 skipped, 36 web (13 files)**.
- `docs/agent-context/repo-landmines.md` — all of it; the last four entries (concurrent suites, `.env`/`.env.bak`, dev DB lag, busy ports) are new.
- `docs/agent-context/working-agreement.md` — "commit discipline" section.
- `.cursorrules`.

## 3. Facts established first (verified 2026-08-27)

| Fact | Consequence |
|---|---|
| `apps/api/src/tickets/tickets.controller.ts` has no `@Patch(':id')`. Existing per-ticket mutations are `POST :id/assign`, `:id/transfer`, `:id/transition`, `:id/category`, `DELETE :id`, `POST :id/restore`. The `import { … } from '@nestjs/common'` block (lines 1–13) already includes `Body`; check whether `Patch` is imported — add it if not. | Add `@Patch(':id')` with `@ThrottlePolicy('highWrite')` like its neighbours. |
| `TicketsService.setCategory()` (`tickets.service.ts:1752`) is the closest pattern: load ticket → permission check → transaction: update + `TicketEvent` `TICKET_CATEGORY_CHANGED` → realtime `ticket.changed` with `reason: 'category_changed'`. | Copy its shape exactly; do not invent a new one. |
| `TicketRealtimeReason` union (`tickets/ticket-realtime.service.ts:11`) lists every allowed reason; 0.8 added `'deleted' \| 'restored'`. The web reads `payload.reason` as a string. | Add `'edited'`. |
| `AccessControlService.canWriteTicket(user, ticket)` (`common/access-control.service.ts`) — OWNER always; TEAM_ADMIN on their primary team; EMPLOYEE only on their own ticket; LEAD on team tickets; AGENT on team tickets that are theirs or unassigned; **false on a soft-deleted ticket**. | Reuse it; add the EMPLOYEE-only "status must be NEW" rule on top, in the service. |
| `CreateTicketDto` (`tickets/dto/create-ticket.dto.ts`): `subject` `@IsString @IsNotEmpty @MinLength(1) @MaxLength(200)`; `description` same with `@MaxLength(5000)`. `ValidationPipe` runs with `whitelist + forbidNonWhitelisted`. | The update DTO uses the same validators, both optional, and rejects an empty body. |
| `TicketEvent.type` is a free string; existing values include `TICKET_CATEGORY_CHANGED`, `TICKET_PRIORITY_CHANGED`, `TICKET_DELETED`. The web maps event types to labels/icons in `apps/web/src/components/ticket-detail/utils.tsx` and `components/TimelineEvent.tsx` — find the map that knows `TICKET_CATEGORY_CHANGED` and add the new type beside it. | New type `TICKET_EDITED`, payload `{ changes: [{ field, from, to }] }`. |
| Web: `pages/TicketDetailPage.tsx` renders the subject in an `<h1>` at ~:1974 (`{ticket.subject}`), the "Copy ticket link" button at ~:2000, and derives `canManage` at ~:335. `api/client.ts` has `setTicketCategory` at ~:1161 — the pattern for the new client call. | Pencil next to the subject; inline edit. |
| Single-ticket priority change still goes through `POST /tickets/bulk/priority` from the UI. | **Out of scope for this card** — it works; leave it. |
| Integration harness: `test/integration/tickets.lifecycle.spec.ts` has the persona/auth pattern (`x-user-email`, `fixtureEmails`, `createTestApp`, `resetTestDb`). | New spec `test/integration/tickets.edit.spec.ts`. |

## 4. Decisions and assumptions

1. **`PATCH /api/tickets/:id` with `UpdateTicketDto { subject?: string; description?: string }`** — only these two fields. Status, priority, category, assignment have their own endpoints and stay there.
2. **Who may edit:** anyone `canWriteTicket` allows, **plus** the rule that an `EMPLOYEE` may edit only while the ticket is `NEW` (before an agent has touched it). After that, the requester adds a reply instead.
3. **No side effects on content:** editing does not re-run routing rules, AI classification, or SLA maths. Say so in the JSDoc.
4. **No-op edits are not events.** Trim both fields; if nothing changed, return the ticket with HTTP 200 and write nothing.
5. **History:** one `TicketEvent` `TICKET_EDITED` per request with `payload.changes = [{ field: 'subject' | 'description', from, to }]`. `from`/`to` for description may be long — store them; they are the audit trail.
6. **Realtime:** `ticket.changed` with `reason: 'edited'` so open lists/tabs refresh the subject.
7. **Response:** the same shape `getById` returns (the web replaces its ticket object with it).
8. **UI:** a pencil icon beside the subject (shown only when the user may edit); clicking turns the subject into an input and the description into a textarea with Save / Cancel; Enter saves the subject, Esc cancels; validation messages mirror the API (1–200 / 1–5000). After save: toast "Ticket updated" and the timeline shows "Ticket edited".

## 5. The work

Kill stray node processes; Postgres up; no other test run active.

### Task 1 — DTO and controller

**Files:** Create `apps/api/src/tickets/dto/update-ticket.dto.ts`; Modify `apps/api/src/tickets/tickets.controller.ts`

- [ ] DTO:

```ts
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Editable text fields of a ticket. Status, priority, category and assignment have their own endpoints. */
export class UpdateTicketDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(5000)
  description?: string;
}
```

- [ ] Controller, next to `@Post(':id/category')`:

```ts
  @Patch(':id')
  @ThrottlePolicy('highWrite')
  async update(
    @Param('id') id: string,
    @Body() payload: UpdateTicketDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ticketsService.update(id, payload, user);
  }
```

### Task 2 — Service

**Files:** Modify `apps/api/src/tickets/tickets.service.ts`, `apps/api/src/tickets/ticket-realtime.service.ts`

- [ ] Add `'edited'` to `TicketRealtimeReason`.
- [ ] `update(id, payload, user)` modelled on `setCategory()`:
  1. `findUnique` by id (include what `getById` needs for the response, or call `getById` at the end). 404 if missing or (`deletedAt` set and user is not OWNER).
  2. If both fields are undefined → `BadRequestException('Provide subject and/or description')`.
  3. Permission: `if (!this.accessControl.canWriteTicket(user, ticket)) throw new ForbiddenException('No write access to edit this ticket')`. Then `if (user.role === UserRole.EMPLOYEE && ticket.status !== TicketStatus.NEW) throw new ForbiddenException('Requesters can edit a ticket only while it is new — add a reply instead')`.
  4. Compute `changes`: for each provided field, `trim()`; include only if different from the current value. If `changes.length === 0` → return `this.getById(id, user)` (no write).
  5. `$transaction`: `ticket.update({ data: { subject?, description? } })`; `ticketEvent.create({ ticketId, type: 'TICKET_EDITED', payload: { changes }, createdById: user.id })`.
  6. After commit: realtime `ticket.changed` `reason: 'edited'` via the same helper `setCategory` uses.
  7. Return `this.getById(id, user)`.
- [ ] `npx tsc --noEmit` → 0.

### Task 3 — Integration tests

**Files:** Create `apps/api/test/integration/tickets.edit.spec.ts`

- [ ] Cases (create a ticket as `fixtureEmails.requester` on `fixtureTeamIds.it` first, as `csat.spec.ts` does):
  1. Requester edits own **NEW** ticket's subject → 200, body subject updated.
  2. Agent (IT) transitions it to TRIAGED; requester edits again → 403.
  3. Agent edits description → 200; `GET /api/tickets/:id/events` contains one `TICKET_EDITED` with `changes[0].field === 'description'`.
  4. A different requester → 403 or 404 (whichever the access filter yields — assert `[403, 404]` includes it and the subject is unchanged).
  5. Empty body → 400; `{ subject: '' }` → 400; 201-char subject → 400.
  6. Same value again → 200 and the event count does not grow.
- [ ] Run the spec alone, then the full suite to a file (**expect 374 + 6 = 380 passed, 1 skipped** — the real number wins).

### Task 4 — Web

**Files:** Modify `apps/web/src/api/client.ts`, `apps/web/src/pages/TicketDetailPage.tsx`, `apps/web/src/components/ticket-detail/utils.tsx` and/or `apps/web/src/components/TimelineEvent.tsx` (whichever holds the event-type → label map)

- [ ] `client.ts`, beside `setTicketCategory`:

```ts
export function updateTicket(
  ticketId: string,
  payload: { subject?: string; description?: string },
) {
  return apiFetch<TicketDetail>(`/tickets/${ticketId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
```

      (Use the same response type `setTicketCategory` uses if it is not `TicketDetail`.)
- [ ] `TicketDetailPage.tsx`: `canEditText = canManage || (role === "EMPLOYEE" && ticket.status === "NEW" && ticket.requester?.email === currentEmail)` — reuse whatever the page already uses for "is this my ticket". Pencil `IconButton` after the `<h1>` at ~:1974, visible when `canEditText`. Editing state: `{ subject, description }` inputs replacing the header text and the description block; Save → `updateTicket` → replace local ticket, toast "Ticket updated" via the global `useToast()`; Cancel/Esc restores. Disable Save while empty or over limit; show the character count next to the description textarea.
- [ ] Timeline label: add `TICKET_EDITED` → label "Ticket edited", with a one-line detail listing the changed field names (`changes.map(c => c.field).join(", ")`).
- [ ] `cd apps/web && npx tsc --noEmit && npx vitest run` → clean, 13 files / 36.

### Task 5 — Docs, baselines, commit

- [ ] `CLAUDE.md` + `repo-landmines.md` baselines with the real integration count.
- [ ] Commit by explicit path (read `git status --short` first):

```bash
git add apps/api/src/tickets/dto/update-ticket.dto.ts apps/api/src/tickets/tickets.controller.ts apps/api/src/tickets/tickets.service.ts apps/api/src/tickets/ticket-realtime.service.ts apps/api/test/integration/tickets.edit.spec.ts apps/web/src/api/client.ts apps/web/src/pages/TicketDetailPage.tsx <the event-label file> CLAUDE.md docs/agent-context/repo-landmines.md
git commit -m "feat(tickets): edit subject and description (PATCH /tickets/:id) with history event and realtime update"
```

## 6. Files expected to change

`update-ticket.dto.ts` (new) · `tickets.controller.ts` · `tickets.service.ts` · `ticket-realtime.service.ts` · `tickets.edit.spec.ts` (new) · `client.ts` · `TicketDetailPage.tsx` · the one web event-label file · `CLAUDE.md` · `repo-landmines.md`. Ten files. No schema, no migration, no dependency. Anything else — stop and report.

## 7. Security considerations

- Authorisation is `canWriteTicket` plus the requester-NEW rule; a soft-deleted ticket is not editable by anyone (`canWriteTicket` already returns false). Non-owners must not learn a deleted ticket exists — 404, as elsewhere.
- Description is rendered through the existing sanitiser path (`messageBody.ts` / `MessageBody`) — do not introduce a new render path for the edited text.
- The `from` value in the event payload preserves the original text for audit; nothing is redacted (consistent with the rest of the history).

## 8. Acceptance criteria

1. `PATCH /api/tickets/:id` behaves per the six test cases; full suite = baseline + 6, 1 skipped; unit 206; both `tsc` clean; vitest 36.
2. In the UI, an OWNER fixes a subject typo; the header, the list row (via realtime in a second session) and the timeline all reflect it without reload.
3. A requester can edit their own NEW ticket and cannot once it is TRIAGED (button hidden **and** API 403).
4. Baselines updated.

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review/apps/api"
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx jest --config ./test/jest.integration.json test/integration/tickets.edit.spec.ts > ../../it-edit.txt 2>&1; grep Tests: ../../it-edit.txt
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

## 10. Manual test steps

Dev API (`PORT=3077` if 3000 is busy) + web with `VITE_E2E_MODE=true`, accounts `owner@company.com` (OWNER), `lead@company.com` (LEAD), and a requester from the dev DB. (1) OWNER edits a subject → header updates, toast, timeline "Ticket edited: subject". (2) In a LEAD window with the list open, the row's subject changes without reload. (3) Requester on a NEW ticket sees the pencil; after the LEAD moves it to TRIAGED the pencil is gone and a direct `curl -X PATCH` as the requester → 403. Stop the servers; zero repo node processes.

## 11. Handoff notes — what to report back

1. Commit SHA. 2. `Tests:` lines (unit, edit spec, full suite), vitest, both `tsc`. 3. `git diff --stat HEAD~1`. 4. Manual steps 1–3 with accounts used. 5. Anything that did not match — especially the name of the event-label file and whether `Patch` had to be imported.

---

## 12. Post-implementation record (planning session, 2026-08-27)

**Verdict: GREEN.** Commit `eeff0a2`. Planner independently re-ran: full `test:integration` **380 passed + 1 skipped, 41/41 files, 0 failures** (557 s, run alone); `jest` 206/206; `tsc --noEmit` clean in api and web; vitest 13 files / 36. Source read: DTO validators as specified; `update()` — 404 for missing/deleted (non-owner), `canWriteTicket` + requester-only-while-NEW, trim + blank rejection, no-op returns without writing, one `TICKET_EDITED` event with `changes[]`, realtime `reason: 'edited'`; web pencil gated by `canEditText`, "Ticket updated" toast, timeline label "Ticket edited by …: fields".

**Accepted deviation:** `apps/web/src/pages/TicketsPage.tsx` (+11, not in §6) re-reads a row on `reason === 'edited'` so the queue shows the new subject live — required by acceptance criterion 2. Eleven files total.

**Approved to merge and deploy.** No migration; plain deploy per the runbook.
