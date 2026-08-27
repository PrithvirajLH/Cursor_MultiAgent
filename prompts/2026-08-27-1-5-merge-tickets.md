# Implementation Prompt — 1.5 Merge duplicate tickets

**Date:** 2026-08-27
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 1.5 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** the same problem reported twice (two emails, two portal submissions) lives as two tickets forever. Agents answer both or lose one. There is no merge.

**Cost:** none — code plus one small additive migration (a pointer column and one new close reason).

**Decisions taken by the planner (owner asked to proceed):** merge **moves** messages, attachments, followers and tags into the surviving ticket; the duplicate is **closed** with reason `MERGED` and shows a banner linking to the survivor; **no undo**; allowed for LEAD, TEAM_ADMIN (own team) and OWNER, and for the survivor's assignee; tickets from **different requesters** may be merged only by LEAD+ (the duplicate's requester is told by notification).

---

## 1. Goal

`POST /api/tickets/:id/merge { sourceIds: [...] }` folds one or more duplicate tickets into ticket `:id`. Afterwards the survivor holds the whole conversation, the duplicates are closed and hidden from queues, and every party is told once.

## 2. Context read

- `CLAUDE.md` — baselines (after 1.4; read the real numbers there).
- `docs/agent-context/repo-landmines.md` (all), `docs/agent-context/working-agreement.md`, `.cursorrules`.
- `prompts/2026-08-27-1-2-requester-confirm-reopen-cancel.md` Task 1 — the last hand-written migration (enum + column) as the pattern; `prompts/2026-08-26-0-8-soft-delete-and-retention.md` §12–13 — how soft-deleted tickets are hidden (the merged-source hiding works the same way).

## 3. Facts established first (verified 2026-08-27)

| Fact | Consequence |
|---|---|
| `Ticket` children keyed by `ticketId`: `TicketMessage`, `TicketEvent`, `TicketAccess`, `TicketFollower` (`@@unique([ticketId, userId])`), `Attachment`, `CustomFieldValue` (`@@unique([ticketId, customFieldId])`), `AutomationExecution`, `TicketTag` (`@@id([ticketId, tagId])`), `SlaInstance` (`ticketId @unique`), `TicketEmailThread` (`ticketId @unique`), `InboundEmailReceipt` (nullable), `Notification`/`NotificationOutbox` (nullable). | Move: messages, attachments, followers (skip duplicates), tags (skip duplicates), custom-field values (skip when the survivor already has that field). Leave on the source: events (its own history), SLA instance, email thread (so replies to the old thread can be redirected — see inbound row), notifications. |
| `TicketCloseReason` enum: `REQUESTER_CONFIRMED, REQUESTER_CANCELLED, AGENT_CLOSED, AUTO_CLOSED` (card 1.2). | Add `MERGED` via `ALTER TYPE … ADD VALUE` (additive). |
| Soft-delete hiding lives in `AccessControlService.buildTicketAccessFilter` / `accessConditionSql` (`deletedAt IS NULL` unless OWNER + `includeDeleted`) and `canViewTicket`. | Merged sources are **not** hidden the same way — they stay visible as CLOSED tickets with a banner, so links and searches still resolve. Only the default queue filter (`statusGroup=open`) excludes them, which it already does for CLOSED. |
| `softDelete()` (`tickets.service.ts:2631`) is the authorisation and audit pattern: load with team, role check, transaction, `TicketEvent` + `AdminAuditEvent`, realtime `ticket.changed`. `TicketRealtimeReason` union ends with `'edited'`. | Copy its shape; add `'merged'`. |
| Inbound email threading (`inbound-email.service.ts:119`, `:628`) resolves a reply to a ticket by reply token / display id / outbox id. | After a merge, a reply to the **source** thread must land on the **survivor**: when the resolved ticket has `mergedIntoId`, follow it (one hop; loop guard). |
| Web: `TicketDetailPage.tsx` header has "Copy ticket link" (`:2176`) and "Delete ticket" (`:2186`) buttons; `api/client.ts` `searchAll(query, signal)` (`:2048`) searches tickets for the command palette. `ConfirmDialog` exists. | "Merge into…" button beside Delete; a small dialog with a ticket search (reuse `searchAll` results filtered to tickets) to pick the **survivor**; the current ticket becomes the source. |
| `NotificationsService.notifyUsers` / in-app `InAppNotificationsService` exist; `NotificationType` has `TICKET_UPDATED`. | Tell the source requester once (in-app `TICKET_UPDATED` "Your ticket X was merged into Y"; email via outbox). |

## 4. Decisions and assumptions

1. **Schema:** `Ticket.mergedIntoId String?` (+ index), `Ticket.mergedAt DateTime?`; enum value `MERGED`. No FK on `mergedIntoId` (a survivor could later be soft-deleted; keep it a plain pointer). Migration: `ALTER TYPE "TicketCloseReason" ADD VALUE 'MERGED'; ALTER TABLE "Ticket" ADD COLUMN "mergedIntoId" TEXT; ADD COLUMN "mergedAt" TIMESTAMP(3); CREATE INDEX "Ticket_mergedIntoId_idx"`. Note: Postgres cannot **use** a new enum value in the same transaction that added it — Prisma runs each migration file in its own transaction, so this is fine; do not put data updates in the same file.
2. **Endpoint:** `POST /api/tickets/:id/merge` body `{ sourceIds: string[] }` (1–10, UUIDs, none equal to `:id`). `:id` is the survivor.
3. **Authorisation:** actor must `canWriteTicket` the survivor **and** each source; plus role ∈ {OWNER, TEAM_ADMIN, LEAD} **or** be the survivor's assignee. If any source's `requesterId` ≠ survivor's, actor must be LEAD/TEAM_ADMIN/OWNER (403 otherwise: `'Merging tickets from different requesters needs a lead'`).
4. **Preconditions:** no source may be soft-deleted, already merged, or CLOSED-with-`MERGED`; survivor must not be soft-deleted or merged. Sources may be in any other status.
5. **In one transaction, per source:** update `TicketMessage`, `Attachment` → `ticketId = survivor`; `TicketFollower` → upsert into survivor then delete from source; `TicketTag` → same; `CustomFieldValue` → move only fields the survivor lacks, delete the rest; then `applyStatusTransitionInTx(source → CLOSED, closeReason MERGED)` if not already CLOSED (else just set the reason), set `mergedIntoId`, `mergedAt`; write `TicketEvent` on **both** tickets (`TICKET_MERGED_INTO { targetId, targetDisplayId }` on the source, `TICKET_MERGED_FROM { sourceId, sourceDisplayId, movedMessages, movedAttachments }` on the survivor); one `AdminAuditEvent` `TICKETS_MERGED` for the whole call. Survivor's `updatedAt` bumps naturally.
6. **After commit:** realtime `ticket.changed` `reason: 'merged'` for survivor and each source; in-app `TICKET_UPDATED` to each source requester (deduped) with body "Your ticket IT-0043 was merged into IT-0042 — follow it there"; email via `notifyUsers` with the same text (outbox only until SMTP exists). Survivor's followers now include the sources' followers, so future updates reach everyone.
7. **Message provenance:** each moved public/internal message gets `payload`-free but we need to show where it came from — add a small marker: prepend nothing to bodies; instead the survivor's timeline event `TICKET_MERGED_FROM` marks the moment, and moved messages keep their original `createdAt` so they interleave chronologically. (No schema change for messages.)
8. **Inbound email:** when threading resolves to a ticket with `mergedIntoId`, redirect to that id (single hop; if the target is itself merged, follow at most 3 hops then give up and create a new ticket).
9. **UI:** on the source ticket (any status except CLOSED/merged) a "Merge into…" action next to Delete, visible to LEAD/TEAM_ADMIN/OWNER and to an agent who is assignee of the chosen survivor (simplest: show for AGENT too and let the API's 403 message surface). Dialog: search box (reuses `searchAll`'s ticket results, excluding the current ticket and any closed/merged ones), pick one, confirm "Merge IT-0043 into IT-0042? Its 3 messages and 1 attachment move over; IT-0043 closes and points to IT-0042. This cannot be undone." → call → navigate to the survivor with toast "Merged into IT-0042". On a merged source, a banner "This ticket was merged into IT-0042 on <date>" with a link, composer hidden (reuse 0.8's `readOnly`), status row shows "Closed — merged".
10. **Reports:** merged sources are CLOSED tickets; they still count in volume reports (they were real requests) but never in open/backlog — acceptable; note in the card that a "merged" reason filter is a later reporting nicety.

## 5. The work

Kill stray node processes; Postgres up; no other test run active; `.env` present.

### Task 1 — Schema and migration

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/20260827150000_ticket_merge/migration.sql`

- [ ] Schema: `TicketCloseReason` += `MERGED`; `Ticket` += `mergedIntoId String?`, `mergedAt DateTime?`, `@@index([mergedIntoId])`.
- [ ] Migration (hand-written, additive):

```sql
-- Merge duplicate tickets (card 1.5): the closed duplicate points at the survivor.
-- HAND-WRITTEN — `prisma migrate diff` also emits the six trigram DROP INDEX and
-- DROP DEFAULT drift statements (repo-landmines.md, Prisma); omitted.
ALTER TYPE "TicketCloseReason" ADD VALUE 'MERGED';
ALTER TABLE "Ticket" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "mergedAt" TIMESTAMP(3);
CREATE INDEX "Ticket_mergedIntoId_idx" ON "Ticket"("mergedIntoId");
```

- [ ] `bash scripts/check-migrations.sh origin/main` → `ok`; apply to the test DB; `prisma generate`; `tsc` → 0. Commit `feat(db): Ticket.mergedIntoId/mergedAt; MERGED close reason`.

### Task 2 — Service, controller, DTO, realtime

**Files:** Create `src/tickets/dto/merge-tickets.dto.ts`; Modify `src/tickets/tickets.controller.ts`, `src/tickets/tickets.service.ts`, `src/tickets/ticket-realtime.service.ts`, `src/tickets/inbound-email.service.ts`

- [ ] DTO: `MergeTicketsDto { @IsArray @ArrayMinSize(1) @ArrayMaxSize(10) @IsUUID('4', { each: true }) sourceIds!: string[] }`.
- [ ] Controller: `@Post(':id/merge') @ThrottlePolicy('highWrite') merge(@Param('id') id, @Body() dto, @CurrentUser() user)` → `ticketsService.merge(id, dto.sourceIds, user)`.
- [ ] `TicketRealtimeReason` += `'merged'`.
- [ ] `TicketsService.merge()` per §4.3–4.6, returning `getById(survivor)` plus `{ merged: [{ id, displayId }] }`. Reject `sourceIds` containing the survivor (400). Load all tickets in one query; 404 if any missing/deleted (non-owner); 409 `'Ticket IT-0043 is already merged'` for merged sources.
- [ ] `getById` and `list()` select: include `mergedIntoId`, `mergedAt`; for a merged source also include `mergedInto: { id, displayId, subject }` (a follow-up `findUnique`, or a relation if you prefer — no FK either way).
- [ ] Inbound email: where the thread target ticket is loaded, add the one-hop redirect (§4.8) and write it in a small private `resolveMergeTarget(ticketId)` helper with the 3-hop guard.
- [ ] `tsc` → 0; `jest` → unchanged.

### Task 3 — Integration tests

**Files:** Create `test/integration/tickets.merge.spec.ts`

- [ ] Cases (IT team personas; two tickets by the same requester unless stated):
  1. LEAD merges B into A → A has B's messages (count) and attachments; B is `CLOSED`, `closeReason MERGED`, `mergedIntoId === A`; events on both; `AdminAuditEvent` `TICKETS_MERGED` exists.
  2. B's follower is now A's follower; a tag on B appears on A; a tag on both is not duplicated.
  3. AGENT who is not A's assignee → 403; AGENT who is A's assignee → 200.
  4. Different requesters: AGENT-assignee → 403 with the lead message; LEAD → 200 and the source requester has an in-app `TICKET_UPDATED` notification and one outbox row.
  5. Merging an already-merged ticket → 409; `sourceIds` containing `:id` → 400; 11 ids → 400.
  6. B remains visible via `GET /api/tickets/:B` to its requester (CLOSED with `mergedIntoId`), absent from `statusGroup=open` lists.
  7. Inbound email reply carrying B's reply token lands on A (use the existing inbound webhook test helpers from `tickets.inbound-email.spec.ts`).
- [ ] Run alone, then the full suite. Expect previous baseline + 7 (real number wins).

### Task 4 — Web

**Files:** Modify `apps/web/src/api/client.ts`, `apps/web/src/pages/TicketDetailPage.tsx`, `apps/web/src/components/ticket-detail/TicketSidebar.tsx` (status row reason label), `apps/web/src/components/ticket-detail/utils.tsx` (event labels); Create `apps/web/src/components/ticket-detail/MergeTicketDialog.tsx`

- [ ] `client.ts`: `mergeTickets(survivorId, sourceIds)`; types gain `mergedIntoId`, `mergedAt`, `mergedInto?`.
- [ ] `MergeTicketDialog`: search input (debounced, calls `searchAll`, shows ticket rows `IT-0042 — subject — status`, excludes current/closed/merged), selected survivor summary, counts line, destructive confirm.
- [ ] Detail page: "Merge into…" button (icon `GitMerge`) beside Delete for LEAD/TEAM_ADMIN/OWNER/AGENT; on success `navigate` to the survivor and toast. On a merged source: banner + `readOnly` composer; status row "Closed — merged into IT-0042" (link). Timeline labels for `TICKET_MERGED_INTO` / `TICKET_MERGED_FROM`.
- [ ] `tsc` + `vitest` clean.

### Task 5 — Docs, baselines, commit

- [ ] Baselines; landmines migration count (51). Commit by explicit path:

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260827150000_ticket_merge/migration.sql apps/api/src/tickets apps/api/test/integration/tickets.merge.spec.ts apps/web/src/api/client.ts apps/web/src/pages/TicketDetailPage.tsx apps/web/src/components/ticket-detail CLAUDE.md docs/agent-context/repo-landmines.md
git commit -m "feat(tickets): merge duplicate tickets into a survivor; MERGED close reason; inbound replies follow the merge"
```

## 6. Files expected to change

`schema.prisma` · migration (new) · `tickets/dto/merge-tickets.dto.ts` (new) · `tickets.controller.ts` · `tickets.service.ts` · `ticket-realtime.service.ts` · `inbound-email.service.ts` · `tickets.merge.spec.ts` (new) · `client.ts` · `TicketDetailPage.tsx` · `TicketSidebar.tsx` · `ticket-detail/utils.tsx` · `MergeTicketDialog.tsx` (new) · `CLAUDE.md` · `repo-landmines.md`. Anything else — stop and report.

## 7. Security considerations

- Moving messages between tickets moves who can read them: the survivor's readers (its team, followers, requester) gain the source's conversation. That is why cross-requester merges need a lead, and why the source requester is notified. Internal notes move too and stay internal.
- Attachments keep their scan status; nothing becomes downloadable that was not before.
- Merged sources remain visible as closed tickets to the people who could see them — no existence leak, no new exposure.

## 8. Acceptance criteria

1. Seven integration cases pass; full suite = baseline + 7; unit unchanged; `tsc` clean; vitest 36; migration `ok`; test DB 51 migrations, six trigram indexes.
2. In dev: merge two duplicate tickets from the UI; the survivor shows both conversations in order; the duplicate shows the banner and is closed "merged"; the requester of the duplicate has a bell notification.
3. A reply email to the duplicate's thread (inbound webhook in dev) appends to the survivor.

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review"
bash scripts/check-migrations.sh origin/main
cd apps/api && npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
npx jest --config ./test/jest.integration.json test/integration/tickets.merge.spec.ts > ../../it-merge.txt 2>&1; grep Tests: ../../it-merge.txt
npx jest --config ./test/jest.integration.json test/integration/tickets.inbound-email.spec.ts > ../../it-inbound.txt 2>&1; grep Tests: ../../it-inbound.txt
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
```

## 10. Manual test steps

Dev DB first: `npx prisma migrate deploy` from `apps/api` with the normal `.env` (port 5432; exactly 1 pending → 51). Dev API (`PORT=3077`) + web (`VITE_E2E_MODE=true`). As the lead: open the duplicate, "Merge into…", search the survivor, confirm → land on the survivor with the merged conversation; back on the duplicate → banner, read-only, "Closed — merged into …". As the duplicate's requester: bell shows the merge notice. Restore dev data (delete both probe tickets as OWNER); stop servers; zero repo node processes.

## 11. Handoff notes — what to report back

1. Commit SHA(s). 2. Guard line for the migration; test-DB migration and trigram counts. 3. `Tests:` lines (unit, merge spec, inbound spec, full suite), vitest, both `tsc`. 4. `git diff --stat <pre-card sha> HEAD`. 5. Dev-DB `migrate status` before/after. 6. Manual steps. 7. Anything that did not match — especially how `mergedInto` was exposed (relation vs lookup), whether `ALTER TYPE … ADD VALUE` needed to be its own migration, and any inbound-email helper differences.
