# Implementation Prompt — 1.2 Requester can confirm, reopen or cancel their own ticket

**Date:** 2026-08-27
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.2 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** a requester cannot change their own ticket's status at all — `transition()` returns 403 for every `EMPLOYEE` (`tickets.service.ts`, "Requesters cannot transition tickets"). They cannot say "yes, that fixed it", "no, it's still broken", or "I don't need this any more". The only requester-side reopen today is replying to the email, and production has no email.

**Cost:** none — code plus one small additive database change (a new column). No Azure change.

---

## 1. Goal

From the portal, the person who raised a ticket can: **confirm** a resolved ticket (closes it), **reopen** a resolved or closed ticket, and **cancel** a ticket nobody has started yet. Every closed ticket records *why* it closed. Agents' behaviour is unchanged.

## 2. Context read

- `CLAUDE.md` — baselines **206 unit (26 suites), 380 integration + 1 skipped, 36 web (13 files)**.
- `docs/agent-context/repo-landmines.md` — all of it (hand-written migrations; never two suites at once; `.env`/`.env.bak`; dev DB lags production; busy ports).
- `docs/agent-context/working-agreement.md` — commit discipline.
- `prompts/2026-08-26-0-8-soft-delete-and-retention.md` Task 1 — the most recent hand-written migration, as the pattern.
- `.cursorrules`.

## 3. Facts established first (verified 2026-08-27)

| Fact | Consequence |
|---|---|
| `TicketsService.transition()` loads the ticket, then `if (user.role === UserRole.EMPLOYEE) throw new ForbiddenException('Requesters cannot transition tickets')`, then `canWriteTicket`, then `applyStatusTransitionInTx(tx, snapshot, newStatus, user.id)`, then notifications + realtime `status_changed` + automation queue. | Replace the blanket 403 with an allow-list for the ticket's own requester; everything after stays. |
| `applyStatusTransitionInTx` checks `isValidTransition`, computes `resolvedAt` / `closedAt` / `completedAt` (set on RESOLVED/CLOSED, cleared on REOPENED), writes `TICKET_STATUS_CHANGED`, re-syncs SLA (`resetResolutionSla` on REOPENED). It receives only `userId`, not the role. | Add an optional `closeReason` parameter; `transition()` decides the value. Automation's `set_status` also calls this method — when it closes without a reason, default to `AGENT_CLOSED` (card 1.3 will pass `AUTO_CLOSED`). |
| Default transition map (`DEFAULT_STATUS_TRANSITIONS`): `NEW → [TRIAGED, ASSIGNED]`, `TRIAGED → [ASSIGNED]`, `RESOLVED → [REOPENED, CLOSED]`, `CLOSED → [REOPENED]`. Overridable via `TICKET_STATUS_TRANSITIONS` env. | Confirm and reopen are already legal moves. **Cancel needs `CLOSED` added to `NEW` and `TRIAGED`.** That also lets agents close an untouched ticket directly — acceptable and useful ("duplicate, closing"). |
| `TicketStatus` enum has no `CANCELLED`; `Ticket` has `resolvedAt`, `closedAt`, `completedAt` and (since 0.8) `deletedAt`; **no** `closeReason`. | Add `closeReason` as a new enum column — see §4.1. Decision log: no new status. |
| `test/integration/tickets.lifecycle.spec.ts:96` "blocks employees from assign/transition/transfer actions" posts `{ status: 'IN_PROGRESS' }` as the requester and expects 403. | Still 403 under the allow-list (IN_PROGRESS is not a requester move) — the test stays as is. No other spec asserts the blanket message. |
| `NotificationsService.ticketStatusChanged()` (`notifications.service.ts:278–336`) emails requester/assignee/followers with a text body ending in `View: <link>`, then creates in-app `notifyTicketResolved` for RESOLVED/CLOSED. Production has no SMTP (inventory), but the code path is live in dev. | Add the confirm/reopen links to the RESOLVED email for the requester. The web reads `?action=` to pre-open the dialog. |
| Web: `components/ticket-detail/TicketSidebar.tsx` props include `canManage: boolean`, `availableTransitions: string[]`, `onTransitionTo(status)`, `currentEmail?`; the status dropdown is gated by `canManage`; `<CsatWidget` renders at `:143` for resolved/closed tickets. `TicketDetailPage.tsx` derives `canManage` (`:347`, EMPLOYEE → false) and has `transitionTo(status)`. `api/client.ts` `transitionTicket(ticketId, { status })` at `:1131`; `TicketRecord.closedAt` at `:238`. | Put the requester's three buttons in the sidebar's Status area, reuse `onTransitionTo`, add `closeReason` to the web types beside `closedAt`. |
| `ConfirmDialog` props: `open, title, message, confirmLabel?, cancelLabel?, destructive?, loading?, onConfirm, onCancel` (used by 0.8's delete). | Reuse for all three actions. |
| Integration harness personas: `fixtureEmails.requester` (EMPLOYEE), agent/lead/admin on `fixtureTeamIds.it`; `csat.spec.ts` has `createResolvedTicket()` driving NEW → TRIAGED → assign → IN_PROGRESS → RESOLVED. | Copy that helper into the new spec. |

## 4. Decisions and assumptions

1. **`closeReason` enum, not a `CANCELLED` status.** New Prisma enum `TicketCloseReason { REQUESTER_CONFIRMED, REQUESTER_CANCELLED, AGENT_CLOSED, AUTO_CLOSED }`, column `Ticket.closeReason TicketCloseReason?`. Set whenever a ticket enters CLOSED; cleared on REOPENED. Additive migration (`CREATE TYPE` + `ADD COLUMN`), no header needed.
2. **Requester allow-list** (only when `ticket.requesterId === user.id`): `RESOLVED → CLOSED` (confirm), `RESOLVED → REOPENED`, `CLOSED → REOPENED` (reopen), `NEW → CLOSED`, `TRIAGED → CLOSED` (cancel). Everything else → 403 `'Requesters can confirm, reopen or cancel their own ticket only'`. A requester who does not own the ticket → 403 from `canWriteTicket` as today (or 404 if soft-deleted, unchanged).
3. **Reason derivation in `transition()`:** requester + `RESOLVED → CLOSED` = `REQUESTER_CONFIRMED`; requester + `NEW|TRIAGED → CLOSED` = `REQUESTER_CANCELLED`; anyone else → CLOSED = `AGENT_CLOSED`. `REOPENED` sets `closeReason = null`. The reason goes into the `TICKET_STATUS_CHANGED` event payload too.
4. **No reopen time limit** in this card (the map already allows CLOSED → REOPENED for agents; the requester gets the same). Card 1.3 can add "no reopen after N days" as an automation rule if wanted.
5. **UI wording (plain, for staff who are not agents):** on a RESOLVED ticket — primary "Yes, it's fixed — close ticket", secondary "Not fixed — reopen"; on CLOSED — "Reopen ticket"; on NEW/TRIAGED — "I no longer need this — cancel", each behind a confirm dialog. The Status row shows the reason once closed: "Closed — you confirmed it was fixed" / "Closed — cancelled by you" / "Closed by the support team". CSAT widget behaviour unchanged (it already shows for RESOLVED/CLOSED).
6. **Email:** for `RESOLVED`, the requester's email gains two lines: `Fixed? Close it: <link>?action=confirm` and `Not fixed? Reopen: <link>?action=reopen`. The detail page reads `action` from the URL and opens the matching confirm dialog once (then strips the param). Harmless in production until SMTP exists.
7. **List/detail payloads include `closeReason`** (add to the explicit `select` in `list()` and to `TicketRecord`/`TicketDetail` on the web).

## 5. The work

Kill stray node processes; Postgres up; no other test run active; `.env` present.

### Task 1 — Schema and migration

**Files:** Modify `apps/api/prisma/schema.prisma`; Create `apps/api/prisma/migrations/20260827120000_ticket_close_reason/migration.sql`

- [ ] Schema: add after `enum TicketStatus { … }`:

```prisma
enum TicketCloseReason {
  REQUESTER_CONFIRMED
  REQUESTER_CANCELLED
  AGENT_CLOSED
  AUTO_CLOSED
}
```

      and on `Ticket`, after `closedAt`: `closeReason    TicketCloseReason?`.
- [ ] Migration (hand-written; the timestamp sorts after `20260826180000`):

```sql
-- Why a closed ticket closed: requester confirmed / requester cancelled /
-- agent closed / auto-closed (card 1.2). Additive; no status enum change.
-- HAND-WRITTEN — `prisma migrate diff` also emits the six trigram DROP INDEX
-- and DROP DEFAULT drift statements (repo-landmines.md, Prisma); omitted.
CREATE TYPE "TicketCloseReason" AS ENUM ('REQUESTER_CONFIRMED', 'REQUESTER_CANCELLED', 'AGENT_CLOSED', 'AUTO_CLOSED');
ALTER TABLE "Ticket" ADD COLUMN "closeReason" "TicketCloseReason";
```

- [ ] `bash scripts/check-migrations.sh origin/main` → your file `ok`. Apply to the **test** DB (`prisma migrate deploy` with `TEST_DATABASE_URL` as both URLs), `prisma generate`, `tsc` → 0. Commit `feat(db): Ticket.closeReason`.

### Task 2 — Service

**Files:** Modify `apps/api/src/tickets/tickets.service.ts`

- [ ] `DEFAULT_STATUS_TRANSITIONS`: `NEW → [TRIAGED, ASSIGNED, CLOSED]`, `TRIAGED → [ASSIGNED, CLOSED]`. Update the JSDoc/comment if there is one.
- [ ] New private constant next to the map:

```ts
  /** The only moves a ticket's own requester may make (card 1.2). */
  private readonly REQUESTER_TRANSITIONS: ReadonlyArray<[TicketStatus, TicketStatus]> = [
    [TicketStatus.RESOLVED, TicketStatus.CLOSED],
    [TicketStatus.RESOLVED, TicketStatus.REOPENED],
    [TicketStatus.CLOSED, TicketStatus.REOPENED],
    [TicketStatus.NEW, TicketStatus.CLOSED],
    [TicketStatus.TRIAGED, TicketStatus.CLOSED],
  ];
```

- [ ] In `transition()`, replace the blanket EMPLOYEE 403 with:

```ts
    if (user.role === UserRole.EMPLOYEE) {
      const allowed =
        ticket.requesterId === user.id &&
        this.REQUESTER_TRANSITIONS.some(
          ([from, to]) => from === ticket.status && to === payload.status,
        );
      if (!allowed) {
        throw new ForbiddenException(
          'Requesters can confirm, reopen or cancel their own ticket only',
        );
      }
    }
```

      (keep the `canWriteTicket` check after it — for the requester it passes on their own ticket).
- [ ] Compute the reason in `transition()` and pass it down:

```ts
    const closeReason = this.resolveCloseReason(user, ticket.status, payload.status);
```

```ts
  /** Why a ticket is closing; null unless the target status is CLOSED. */
  private resolveCloseReason(
    user: AuthUser,
    from: TicketStatus,
    to: TicketStatus,
  ): TicketCloseReason | null {
    if (to !== TicketStatus.CLOSED) return null;
    if (user.role !== UserRole.EMPLOYEE) return TicketCloseReason.AGENT_CLOSED;
    return from === TicketStatus.RESOLVED
      ? TicketCloseReason.REQUESTER_CONFIRMED
      : TicketCloseReason.REQUESTER_CANCELLED;
  }
```

- [ ] `applyStatusTransitionInTx(tx, ticket, newStatus, actorId, closeReason?: TicketCloseReason | null)`: in the `data` for the update add `closeReason: newStatus === TicketStatus.CLOSED ? (closeReason ?? TicketCloseReason.AGENT_CLOSED) : newStatus === TicketStatus.REOPENED ? null : undefined` (undefined = leave untouched), and include `closeReason` in the `TICKET_STATUS_CHANGED` event payload. Check every caller compiles (automation's `set_status` passes nothing → `AGENT_CLOSED`).
- [ ] `list()` select: add `closeReason: true`. (`getById` uses `findUnique` without a narrowing select for the ticket itself — verify it returns the column.)
- [ ] `npx tsc --noEmit` → 0; `npx jest --silent` → 206.

### Task 3 — Email links

**Files:** Modify `apps/api/src/notifications/notifications.service.ts` (`ticketStatusChanged`)

- [ ] When `fullTicket.status === TicketStatus.RESOLVED`, append to the text body before `View:`:

```
Is it fixed? Close it: <ticketLink>?action=confirm
Not fixed? Reopen it: <ticketLink>?action=reopen
```

      Only the requester acts on these, but the same body goes to all recipients — acceptable (agents already have the controls). If the HTML body builder exists for status changes, add the two links there too; if only the text body exists, leave HTML alone and say so.

### Task 4 — Integration tests

**Files:** Create `apps/api/test/integration/tickets.requester-actions.spec.ts`

- [ ] Copy `createResolvedTicket()` from `csat.spec.ts`. Cases:
  1. Requester confirms a RESOLVED ticket → 200 (or 201 — match the existing transition route), status `CLOSED`, `closeReason === 'REQUESTER_CONFIRMED'`, `closedAt` set; `GET …/events` last `TICKET_STATUS_CHANGED` payload has `closeReason: 'REQUESTER_CONFIRMED'`.
  2. Requester reopens that CLOSED ticket → `REOPENED`, `closeReason === null`, `resolvedAt === null`, `closedAt === null`.
  3. Requester reopens a RESOLVED ticket directly → `REOPENED`.
  4. Requester cancels a fresh NEW ticket → `CLOSED`, `closeReason === 'REQUESTER_CANCELLED'`.
  5. Requester tries `IN_PROGRESS` on own NEW ticket → 403; tries to cancel an `ASSIGNED` ticket → 403.
  6. A different requester tries to confirm → 403; subject/status unchanged.
  7. Agent closes a RESOLVED ticket → `closeReason === 'AGENT_CLOSED'`.
  8. Agent closes a NEW ticket directly (new map entry) → 200, `AGENT_CLOSED`.
- [ ] Run alone, then the full suite to a file. **Expect 380 + 8 = 388 passed, 1 skipped**; the real number wins.

### Task 5 — Web

**Files:** Modify `apps/web/src/api/client.ts` (types), `apps/web/src/components/ticket-detail/TicketSidebar.tsx`, `apps/web/src/pages/TicketDetailPage.tsx`

- [ ] Types: `closeReason?: "REQUESTER_CONFIRMED" | "REQUESTER_CANCELLED" | "AGENT_CLOSED" | "AUTO_CLOSED" | null` beside `closedAt` on the ticket record/detail types.
- [ ] `TicketSidebar`: new props `isRequester: boolean` (page computes `role === "EMPLOYEE" && ticket.requester?.email === currentEmail`) and reuse `onTransitionTo`. When `isRequester && !canManage`, render under the Status row a "Your ticket" block:
  - status `RESOLVED`: primary button "Yes, it's fixed — close ticket" → confirm dialog (title "Close this ticket?", message "Marks IT-0042 as done. You can reopen it later if the problem comes back.") → `onTransitionTo("CLOSED")`; secondary "Not fixed — reopen" → dialog → `onTransitionTo("REOPENED")`.
  - status `CLOSED`: "Reopen ticket" → dialog → `REOPENED`.
  - status `NEW` or `TRIAGED`: "I no longer need this — cancel" → destructive dialog ("Cancel this ticket? It will be closed and the team will not work on it.") → `CLOSED`.
  - Status row text when `CLOSED`: append " — you confirmed it was fixed" / " — cancelled by you" / " — closed by the support team" / " — closed automatically" from `closeReason`.
- [ ] `TicketDetailPage`: pass `isRequester`; on mount read `?action=confirm|reopen` from the URL — if present and the ticket is RESOLVED, open the matching dialog once and remove the param (`navigate(location.pathname, { replace: true })`). Toasts: "Ticket closed", "Ticket reopened", "Ticket cancelled". Realtime `status_changed` already refreshes the page and lists.
- [ ] `cd apps/web && npx tsc --noEmit && npx vitest run` → clean, 13 files / 36.

### Task 6 — Docs, baselines, commit

- [ ] `CLAUDE.md` + `repo-landmines.md` baselines (real integration count; migration count is now **50**).
- [ ] `docs/agent-context/repo-landmines.md` Prisma bullet that says "migration count is 49" → 50.
- [ ] Commit by explicit path (schema/migration commit from Task 1; one more for the rest, or one for all — your call):

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260827120000_ticket_close_reason/migration.sql apps/api/src/tickets/tickets.service.ts apps/api/src/notifications/notifications.service.ts apps/api/test/integration/tickets.requester-actions.spec.ts apps/web/src/api/client.ts apps/web/src/components/ticket-detail/TicketSidebar.tsx apps/web/src/pages/TicketDetailPage.tsx CLAUDE.md docs/agent-context/repo-landmines.md
git commit -m "feat(tickets): requester can confirm, reopen or cancel their own ticket; closeReason recorded on close"
```

## 6. Files expected to change

`schema.prisma` · `migrations/20260827120000_ticket_close_reason/migration.sql` (new) · `tickets.service.ts` · `notifications.service.ts` · `tickets.requester-actions.spec.ts` (new) · `client.ts` · `TicketSidebar.tsx` · `TicketDetailPage.tsx` · `CLAUDE.md` · `repo-landmines.md`. Ten files. If `rule-engine.service.ts` or the web `types.ts` need a touch for the new parameter/type, that is expected — name it in the report. Anything else — stop and report.

## 7. Security considerations

- The allow-list is checked **before** anything else and only for `ticket.requesterId === user.id`; `canWriteTicket` still runs after it. A requester can never move a ticket to a working state, assign, or transfer.
- Deleted tickets: `canWriteTicket` returns false → 403/404 as today.
- The `?action=` URL parameter only pre-opens a dialog; the user still confirms, and the API still authorises. No action happens from the link alone.

## 8. Acceptance criteria

1. Eight new integration cases pass; full suite = 380 + 8, 1 skipped; unit 206; `tsc` clean; vitest 36; `lifecycle.spec` "blocks employees…" unchanged and green.
2. Migration `ok` under the guard; test DB at 50 migrations with all six trigram indexes present.
3. In the UI as a requester: confirm, reopen and cancel work with their dialogs and toasts; the Status row shows the reason; agents see no change.
4. Baselines and migration count updated.

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review"
bash scripts/check-migrations.sh origin/main
cd apps/api && npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx jest --config ./test/jest.integration.json test/integration/tickets.requester-actions.spec.ts > ../../it-req.txt 2>&1; grep Tests: ../../it-req.txt
npx jest --config ./test/jest.integration.json test/integration/tickets.lifecycle.spec.ts > ../../it-life.txt 2>&1; grep Tests: ../../it-life.txt
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

## 10. Manual test steps

Dev DB first: `npx prisma migrate deploy` from `apps/api` with the normal `.env` (Datasource must show port **5432**; expect exactly 1 pending → 50). Dev API (`PORT=3077` if 3000 is busy) + web with `VITE_E2E_MODE=true`. As a requester account from the dev DB: (1) create a ticket → "cancel" button visible → cancel → toast, Status "Closed — cancelled by you". (2) On a ticket an agent (`lead@company.com`) has resolved: "Yes, it's fixed" → closed, reason "you confirmed"; "Reopen" → back to Reopened, reason gone. (3) Open the ticket URL with `?action=reopen` while RESOLVED → the reopen dialog is already open; cancel it → param gone from the URL. (4) As the lead, the status dropdown is unchanged and closing a NEW ticket directly now works. Restore dev data; stop servers; zero repo node processes.

## 11. Handoff notes — what to report back

1. Commit SHA(s). 2. `check-migrations.sh` line for your migration; test-DB migration count and trigram index count. 3. `Tests:` lines (unit, requester-actions spec, lifecycle spec, full suite), vitest, both `tsc`. 4. `git diff --stat <pre-card sha> HEAD`. 5. Dev-DB `migrate status` before/after. 6. Manual steps 1–4 with accounts. 7. Anything that did not match — especially any extra file (e.g. `rule-engine.service.ts`, web `types.ts`) and whether the HTML email body exists.
