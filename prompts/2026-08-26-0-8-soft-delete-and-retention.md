# Implementation Prompt — 0.8 Soft delete and retention

**Date:** 2026-08-26
**Repo:** `Ticketing System Quality Review` (branch `ui-redesign-and-api-hardening`)
**Card:** 0.8 in `prompts/2026-08-26-restart-master-plan.md`
**Closes:** there is no safe way to remove anything and nothing is ever cleaned up. No ticket can be deleted at all; deleting a category silently strips the classification from every ticket that used it; deleting a team (only possible via the database today) silently un-assigns its tickets; help articles hard-delete; and the original requirements (`IT.pdf` §7.4) call for a retention policy that does not exist.

**Size M–L.** Do this **after** 0.5 is merged (both touch `CLAUDE.md`/`repo-landmines.md` baselines) and **after** 0.3 (this card's migration needs the `-- allow-drop:` opt-out that 0.3 defines).

---

## 1. Goal

1. Tickets and help articles can be **soft-deleted** (hidden, restorable, audited) and are invisible everywhere except to the OWNER role when explicitly asked.
2. Categories and teams **cannot** lose tickets by accident: the database refuses, and the category endpoint says "deactivate instead".
3. A **retention job**, switched off and in dry-run by default, that purges soft-deleted rows after a grace period and — once the owner sets the years — closed tickets, admin audit rows and sent-email outbox rows past their retention, deleting blob files with them.

## 2. Context read

- `CLAUDE.md` rules 1, 2, 3 and the baseline line (numbers as of the 0.5 merge).
- `docs/agent-context/repo-landmines.md` — "Prisma" (hand-written migrations, `prisma migrate diff` recipe, generate against `TEST_DATABASE_URL`), "Database and checks", "Windows process hygiene". Also the sentence 0.3 added about `scripts/check-migrations.sh`.
- `.cursorrules`.
- `prompts/2026-08-25-per-department-business-hours.md` — the last additive-migration card; copy its migration header style.

## 3. Facts established first (verified 2026-08-26)

### Where ticket reads happen (call-site counts, `apps/api/src`)

| Site | Count | Goes through the access chokepoint? |
|---|---|---|
| `tickets/tickets.service.ts` — `buildTicketAccessFilter` / `accessConditionSql` / `canViewTicket` uses | **18** | yes — list, counts, activity, status-breakdown, metrics, messages/events access checks |
| `tickets/tickets.service.ts` — `prisma.ticket.findUnique` (13) + `tx.ticket.findUnique` (3) | 16 | by id; most are followed by `canViewTicket`/`canWriteTicket`/`canPostMessage` on the loaded row |
| `tickets/tickets.service.ts` — `prisma.ticket.findFirst` | 2 (`:890`, `:942`) | yes — `{ id, ...buildTicketAccessFilter(user) }` |
| `reports/reports.service.ts` — raw SQL `FROM "Ticket"` | 20 | yes — 22 uses of `accessConditionSql`/`scopeReportQuery` |
| `agents-admin/agents-admin.service.ts` — raw SQL LATERAL on `"Ticket" t` (`:58-92`) | 1 query (4 mentions) | **no** — add `AND t."deletedAt" IS NULL` |
| `audit/audit.service.ts` — raw SQL join to `"Ticket"` | 1 | leave as is — audit history must still show events of deleted tickets |
| `slas/sla-breach.service.ts` — `tx.ticket.findMany` backfill (`:189`) | 1 | **no** — add `deletedAt: null` |
| `users/users.service.ts` — `ticket.count` (`:317`), `tx.ticket.updateMany` (`:205`) | 2 | **no** — add `deletedAt: null` |
| `ai/tools/user-tools.service.ts` — `prisma.ticket.findMany` (`:60`) | 1 | **no** — add `deletedAt: null` |
| `tickets/inbound-email.service.ts` — `findFirst` ×2, `findUnique` ×1 | 3 | **no** — a reply threading to a deleted ticket must be treated as "no thread" (new ticket), not appended |
| `automation/rule-engine.service.ts` — `findUnique` ×3 (incl. tx) | 3 | **no** — skip the rule when `deletedAt != null` |
| `tags/tags.service.ts` ×2, `csat/csat.service.ts`, `custom-fields/custom-fields.service.ts`, `notifications/notifications.service.ts`, `ai/ai.service.ts`, `ticket-realtime.service.ts`, `ticket-attachment.service.ts`, `slas/sla-engine.service.ts` — `findUnique` by id | 9 | mixed; the ones that call `canViewTicket`/`canWriteTicket` on the full row are covered by the chokepoint change below; the rest act on a ticket the caller already had access to and are acceptable |
| `grep -rn deletedAt apps/api/src` | **0** | nothing to collide with |

### Chokepoint shapes (`common/access-control.service.ts`)

- `buildTicketAccessFilter(user)` returns `{}` for OWNER and an `OR`/`requesterId` object otherwise. Every caller spreads it into a `where`.
- `accessConditionSql(user, alias = 't')` returns `Prisma.sql\`TRUE\`` for OWNER and an `OR` fragment otherwise; callers embed it as `WHERE ${cond}`.
- `canViewTicket`, `canWriteTicket`, `canPostMessage` take a ticket shape `{ requesterId, assignedTeamId, assigneeId, accessGrants? }`. Callers usually pass the whole Prisma row, so a new `deletedAt` column arrives automatically.

### Delete endpoints today

- `DELETE /api/categories/:id` → `categories.service.ts:123` hard-deletes after checking only for child categories; `Ticket.category` has **no `onDelete`** (Prisma default for an optional relation = `SetNull`) → tickets lose their category silently.
- `DELETE /api/kb/articles/:id` → `kb.service.ts:259` hard-deletes. `visibilityWhere()` (`:70`) is the shared filter used by `listArticles`, `getArticleBySlug`; check `listRelated` (`:130`) and `suggest` (`:151`) too.
- **No** `DELETE /api/tickets/:id` and **no** `DELETE /api/teams/:id`. `Ticket.assignedTeam` has no `onDelete` → `SetNull`.
- `tags.deleteTag` already refuses when in use (`tags.service.ts:328`) — the pattern to copy for categories.

### Other precedents to copy

- Periodic worker with single-instance lock: `slas/sla-breach.service.ts` (`onModuleInit` → `setInterval`; `pg_try_advisory_xact_lock(${SLA_BREACH_LOCK_KEY})` inside a transaction; `enabled` flag from env). Find the value of `SLA_BREACH_LOCK_KEY` and pick a **different** constant.
- Small periodic cleanup: `common/idempotency.service.ts:83` `cleanupExpired()` with a `deleteMany` on `expiresAt`.
- Admin audit write: `users.service.ts:342` `recordAdminAuditEvent()` (raw insert, non-blocking). `prisma.adminAuditEvent.create` works too.
- Best-effort blob/file delete: `tickets/ticket-attachment.service.ts:390` `deleteAttachmentFile(storageKey)`.
- Ticket children cascade on `Ticket` delete: `TicketMessage`, `TicketEvent`, `TicketAccess`, `TicketFollower`, `Attachment`, `CustomFieldValue`, `AutomationExecution`, `TicketTag`, `SlaInstance`, `TicketEmailThread` all `onDelete: Cascade`; `InboundEmailReceipt` `SetNull`; `NotificationOutbox.ticket` and `Notification.ticket` are optional with no `onDelete` → `SetNull`. `AiInferenceLog`/`RoutingDecisionLog`/`CorrectionLog` hold `ticketId` as plain strings (no FK) — untouched, by design (AI observability is append-only).
- `TicketEvent.type` is a free string; existing values include `TICKET_CREATED`, `TICKET_STATUS_CHANGED`, `TICKET_ASSIGNED`, `TICKET_TRANSFERRED`, `TICKET_PRIORITY_CHANGED`, `TICKET_CATEGORY_CHANGED`, `MESSAGE_ADDED`.
- Web: `TicketDetailPage.tsx:1929` has the "Copy ticket link" header button — the natural place for a "Delete ticket" button. `components/ConfirmDialog.tsx` props: `open, title, message, confirmLabel?, cancelLabel?, destructive?, loading?, onConfirm, onCancel`. `api/client.ts` has no `deleteTicket`/`restoreTicket`.

### Tests

- Integration harness: `test/utils/test-app.ts`, `resetTestDb()`, personas in `test/utils/fixtures.ts` (`fixtureEmails.requester`, `fixtureTeamIds.it`, …), auth via `x-user-email`. Relevant existing specs to read for style: `tickets.access.spec.ts` (role visibility), `security.scoping.spec.ts`, `categories.spec.ts`, `kb.spec.ts`.
- Unit spec for access control: check whether `src/common/access-control.service.spec.ts` exists; if not, create it (pure functions, no Nest module).

## 4. Decisions and assumptions

1. **Soft delete = `deletedAt` + `deletedById` on `Ticket`; `deletedAt` on `KbArticle`.** Plain columns, no new relation (the audit event carries the actor). Index on `Ticket.deletedAt`.
2. **Filtering lives in the chokepoint.** `buildTicketAccessFilter(user, options?: { includeDeleted?: boolean })` returns `{ AND: [{ deletedAt: null }, <role filter>] }` unless `includeDeleted` **and** OWNER. `accessConditionSql(user, alias, options?)` prepends `${alias}."deletedAt" IS NULL AND (…)`. `canViewTicket` returns `false` for a row with `deletedAt != null` unless OWNER; `canWriteTicket`/`canPostMessage` return `false` for everyone on a deleted row (restore is its own endpoint). The eight non-chokepoint sites listed in §3 get explicit filters.
3. **Who may delete:** OWNER any ticket; TEAM_ADMIN only tickets whose `assignedTeamId` equals their `primaryTeamId`. Nobody else. **Restore:** OWNER only. **See deleted:** OWNER only, via `GET /api/tickets?includeDeleted=true` (any other role → 403).
4. **Deleting writes three things:** `TicketEvent` `TICKET_DELETED` / `TICKET_RESTORED`, an `AdminAuditEvent` of the same type with `{ ticketId, displayId, reason? }`, and a realtime `ticket.changed` with `reason: 'deleted'` so open tabs refresh to a 404 state.
5. **Categories:** `remove()` refuses when any ticket (deleted or not) or custom field references the category — `400 "Category is used by N ticket(s). Deactivate it instead."` — mirroring `tags.deleteTag`. Plus `onDelete: Restrict` on `Ticket.category` as the database backstop.
6. **Teams:** `onDelete: Restrict` on `Ticket.assignedTeam`. No endpoint change (there is no delete endpoint; deactivation already exists).
7. **The FK changes need `DROP CONSTRAINT`.** That is exactly what 0.3's `-- allow-drop:` header is for. No data and no index is dropped. **Verify the real constraint names** in the test database (`\d "Ticket"` or `prisma migrate diff`) before writing the SQL — Prisma's defaults are `Ticket_assignedTeamId_fkey` and `Ticket_categoryId_fkey`, but confirm.
8. **Retention job defaults: `RETENTION_ENABLED=false`, `RETENTION_DRY_RUN=true`.** Even when someone flips `ENABLED`, nothing is deleted until `DRY_RUN=false`. Per-class windows are env vars; **the owner still has to choose the years** — until then `RETENTION_CLOSED_TICKET_DAYS` and `RETENTION_ADMIN_AUDIT_DAYS` are unset and those classes are skipped. Soft-deleted purge (`RETENTION_SOFT_DELETED_DAYS`, default 30) and sent-outbox purge (`RETENTION_OUTBOX_SENT_DAYS`, default 180) have defaults because they are housekeeping, not policy.
9. **Every retention run writes one `AdminAuditEvent` `RETENTION_RUN`** with per-class counts and `dryRun`. That is how the owner sees what *would* be deleted before turning it on.
10. **Web scope is minimal:** a "Delete ticket" button (OWNER/TEAM_ADMIN) with a destructive confirm, then navigate to `/tickets` with a toast. No deleted-tickets list or restore UI in this card — the API supports both; a later UX card adds them.
11. **Baselines move.** Record the real unit/integration counts.

## 5. The work

Kill stray node processes first. Postgres up. Work in `apps/api` unless stated.

### Task 1 — Schema and migration

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/<timestamp>_soft_delete_and_fk_restrict/migration.sql`

- [ ] **Step 1 — schema edits:**
  - `Ticket`: add `deletedAt DateTime?` and `deletedById String?` after `completedAt`; add `@@index([deletedAt])`.
  - `Ticket.assignedTeam`: `@relation(fields: [assignedTeamId], references: [id], onDelete: Restrict)`.
  - `Ticket.category`: `@relation(fields: [categoryId], references: [id], onDelete: Restrict)`.
  - `KbArticle`: add `deletedAt DateTime?` after `viewCount`; add `@@index([deletedAt])`.
- [ ] **Step 2 — see what Prisma would generate, then hand-write.** From `apps/api`, with `TEST_DATABASE_URL` from `.env.test`:
      `DATABASE_URL=<test url> DIRECT_URL=<test url> npx prisma migrate diff --from-url "<test url>" --to-schema-datamodel prisma/schema.prisma --script`
      Expect: two `ADD COLUMN` blocks, two `CREATE INDEX`, two `DROP CONSTRAINT`/`ADD CONSTRAINT` pairs — **and** the six trigram `DROP INDEX` drift lines plus `ALTER COLUMN … DROP DEFAULT` noise. Copy only the six statements you want.
- [ ] **Step 3 — write the migration file.** Timestamp must sort after `20260825120000`. First line **must** be the allow-drop header:

```sql
-- allow-drop: FK action change only (SetNull -> Restrict on Ticket.assignedTeamId and Ticket.categoryId); no data or index is dropped.
-- Hand-written. `prisma migrate dev` also emits DROP INDEX for six trigram GIN
-- indexes it cannot model (see repo-landmines.md, Prisma) — deliberately omitted.

ALTER TABLE "Ticket" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "deletedById" TEXT;
CREATE INDEX "Ticket_deletedAt_idx" ON "Ticket"("deletedAt");

ALTER TABLE "KbArticle" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "KbArticle_deletedAt_idx" ON "KbArticle"("deletedAt");

ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_assignedTeamId_fkey";
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedTeamId_fkey"
  FOREIGN KEY ("assignedTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_categoryId_fkey";
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

      Use the constraint names you verified in Step 2. `bash ../../scripts/check-migrations.sh origin/main` → your file shows as `ALLOWED`.
- [ ] **Step 4 — apply to the test DB and regenerate:** `npx prisma migrate deploy` (with the test URLs), `npx prisma generate`, `npx tsc --noEmit` → 0 (nothing uses the new columns yet).
- [ ] **Step 5 — commit** `feat(db): soft-delete columns for Ticket and KbArticle; Restrict FK on team and category`.

### Task 2 — Access-control chokepoint

**Files:** Modify `src/common/access-control.service.ts`; Create or extend `src/common/access-control.service.spec.ts`

- [ ] **Step 1 — failing unit tests** (create the spec if it does not exist):

```ts
import { UserRole } from '@prisma/client';
import { AccessControlService } from './access-control.service';
import type { AuthUser } from '../auth/current-user.decorator';

const owner = { id: 'o', email: 'o@x', displayName: 'O', role: UserRole.OWNER, teamId: null, teamName: null, teamRole: null, primaryTeamId: null, memberTeamIds: [] } as AuthUser;
const agent = { ...owner, id: 'a', role: UserRole.AGENT, teamId: 't1', memberTeamIds: ['t1'] } as AuthUser;
const live = { requesterId: 'r', assignedTeamId: 't1', assigneeId: 'a', deletedAt: null };
const gone = { ...live, deletedAt: new Date() };

describe('AccessControlService soft-delete rules', () => {
  const svc = new AccessControlService();
  it('excludes deleted tickets from the list filter for every role', () => {
    expect(JSON.stringify(svc.buildTicketAccessFilter(owner))).toContain('"deletedAt":null');
    expect(JSON.stringify(svc.buildTicketAccessFilter(agent))).toContain('"deletedAt":null');
  });
  it('lets only the owner opt in to deleted tickets', () => {
    expect(JSON.stringify(svc.buildTicketAccessFilter(owner, { includeDeleted: true }))).not.toContain('deletedAt');
    expect(JSON.stringify(svc.buildTicketAccessFilter(agent, { includeDeleted: true }))).toContain('"deletedAt":null');
  });
  it('puts the deleted filter into the raw SQL condition', () => {
    expect(svc.accessConditionSql(owner).sql).toContain('"deletedAt" IS NULL');
    expect(svc.accessConditionSql(owner, 't', { includeDeleted: true }).sql).not.toContain('deletedAt');
  });
  it('hides deleted tickets from non-owners and blocks all writes on them', () => {
    expect(svc.canViewTicket(agent, gone)).toBe(false);
    expect(svc.canViewTicket(owner, gone)).toBe(true);
    expect(svc.canWriteTicket(owner, gone)).toBe(false);
    expect(svc.canPostMessage(agent, gone)).toBe(false);
    expect(svc.canWriteTicket(agent, live)).toBe(true);
  });
});
```

- [ ] **Step 2 — implement.** Add `type AccessOptions = { includeDeleted?: boolean }` in a new `src/common/access-options.type.ts` (one export per file). Then:
  - `buildTicketAccessFilter(user, options?)`: compute the existing role filter into `roleFilter`; return `options?.includeDeleted && user.role === UserRole.OWNER ? roleFilter : { AND: [{ deletedAt: null }, roleFilter] }`. (`{ AND: [{deletedAt:null}, {}] }` is valid Prisma.)
  - `accessConditionSql(user, alias, options?)`: compute the existing fragment into `roleSql`; return the same opt-in check, else `Prisma.sql\`(${col('deletedAt')} IS NULL AND (${roleSql}))\``.
  - Extend the ticket shape type on `canViewTicket`, `canWriteTicket`, `canPostMessage` with `deletedAt?: Date | null`. First line of `canWriteTicket` and `canPostMessage`: `if (ticket.deletedAt) return false;`. First lines of `canViewTicket`: `if (ticket.deletedAt && user.role !== UserRole.OWNER) return false;`.
- [ ] **Step 3** — `npx jest src/common/access-control` → pass; `npx tsc --noEmit` → 0 (callers pass `user` only, so the new optional parameter is source-compatible).

### Task 3 — The eight explicit filters

**Files:** Modify `agents-admin/agents-admin.service.ts`, `slas/sla-breach.service.ts:189`, `users/users.service.ts:205,317`, `ai/tools/user-tools.service.ts:60`, `tickets/inbound-email.service.ts` (3 sites), `automation/rule-engine.service.ts` (3 sites)

- [ ] `agents-admin`: in the LATERAL subquery add `AND t."deletedAt" IS NULL` after `WHERE t."assigneeId" = u.id`.
- [ ] `sla-breach` backfill `where`: add `deletedAt: null`.
- [ ] `users.service` both ticket queries: add `deletedAt: null` to `where`.
- [ ] `user-tools` `where`: add `deletedAt: null`.
- [ ] `inbound-email`: each of the three lookups that resolves a thread target adds `deletedAt: null` to its `where` (for `findUnique` by id, check `ticket.deletedAt` after the fetch and treat as null). Net effect: a reply to a deleted ticket creates a new ticket. Add a one-line comment saying so.
- [ ] `rule-engine`: after each `findUnique`, `if (!ticket || ticket.deletedAt) return;` (or the equivalent early exit that the surrounding code already uses for a missing ticket).
- [ ] `npx tsc --noEmit` → 0; `npx jest --silent` → still green.

### Task 4 — Ticket delete / restore / includeDeleted

**Files:** Modify `src/tickets/tickets.controller.ts`, `src/tickets/tickets.service.ts`, `src/tickets/dto/list-tickets.dto.ts`; Create `src/tickets/dto/delete-ticket.dto.ts`

- [ ] **DTOs.** `DeleteTicketDto { @IsOptional() @IsString() @MaxLength(500) reason?: string }`. `ListTicketsDto`: add `@IsOptional() @Transform(parseBoolean) @IsBoolean() includeDeleted?: boolean` (the `parseBoolean` helper already exists in that file).
- [ ] **Controller.** `@Delete(':id') @ThrottlePolicy('highWrite') remove(@Param('id') id, @Body() dto: DeleteTicketDto, @CurrentUser() user)` → `ticketsService.softDelete(id, dto, user)`; `@Post(':id/restore') @ThrottlePolicy('highWrite') restore(...)` → `ticketsService.restore(id, user)`. Place both **before** the `@Get(':id')`-adjacent routes is unnecessary (different verbs), but keep them next to `transition`.
- [ ] **Service — `softDelete`:**
  1. `findUnique` by id including `assignedTeam`; 404 if missing or already deleted.
  2. Authorisation: OWNER, or TEAM_ADMIN with `user.primaryTeamId === ticket.assignedTeamId`; else 403 `'Only owners or the team admin of the assigned team can delete a ticket'`.
  3. In one transaction: `update` `{ deletedAt: new Date(), deletedById: user.id }`; `ticketEvent.create` `{ type: 'TICKET_DELETED', payload: { reason: dto.reason ?? null }, createdById: user.id }`; `adminAuditEvent.create` `{ type: 'TICKET_DELETED', payload: { ticketId, displayId, reason }, createdById: user.id, teamId: ticket.assignedTeamId, actorEmail: user.email, actorName: user.displayName, teamName: ticket.assignedTeam?.name ?? null }`.
  4. After commit: realtime `ticket.changed` with `reason: 'deleted'` through `TicketRealtimeService` (same helper the other mutations use — read how `transition()` emits and copy it).
  5. Return `{ id, deletedAt }`.
- [ ] **Service — `restore`:** OWNER only (403 otherwise); 404 if not deleted; transaction clears both columns, writes `TICKET_RESTORED` event + admin audit; realtime `reason: 'restored'`.
- [ ] **Service — `list()`:** pass `{ includeDeleted: query.includeDeleted }` into `buildTicketAccessFilter`; if `query.includeDeleted && user.role !== OWNER` → 403 `'Only owners can list deleted tickets'`. Include `deletedAt` in the list `select` and in `getById`'s response so the UI can show a "Deleted" state for OWNER.
- [ ] **Service — `getById()`:** after the fetch, if `ticket.deletedAt && user.role !== OWNER` → 404 (do not reveal existence). OWNER gets the ticket with `deletedAt` set and `allowedTransitions: []`.
- [ ] `npx tsc --noEmit` → 0.

### Task 5 — Categories refuse deletion when in use; KB soft delete

**Files:** Modify `src/categories/categories.service.ts:123-148`, `src/kb/kb.service.ts`

- [ ] `categories.remove()`: after the children check, `const [tickets, fields] = await Promise.all([prisma.ticket.count({ where: { categoryId: id } }), prisma.customField.count({ where: { categoryId: id } })])`; if either > 0 → `BadRequestException(\`Category is used by ${tickets} ticket(s) and ${fields} custom field(s). Deactivate it instead.\`)`. (Count deleted tickets too — `where` deliberately has no `deletedAt` filter here.)
- [ ] `kb.removeArticle()`: replace `delete` with `update({ data: { deletedAt: new Date() } })`; keep the admin-changed publish.
- [ ] `kb.visibilityWhere()`: return `{ AND: [{ deletedAt: null }, <existing role object>] }` for every branch (authors included). Then read `listRelated` (`:130`), `suggest` (`:151`) and `uniqueArticleSlug` (`:359`): the first two must use `visibilityWhere` or add `deletedAt: null`; `uniqueArticleSlug` must **keep** seeing deleted rows (the slug is still taken).
- [ ] `npx tsc --noEmit` → 0.

### Task 6 — Retention job

**Files:** Create `src/retention/retention.module.ts`, `retention.service.ts`, `retention-policy.type.ts`, `retention-run-summary.type.ts`, `retention.service.spec.ts`; Modify `src/app.module.ts` (import), `src/tickets/tickets.module.ts` (already exports `TicketAttachmentService` after 0.5 — confirm), `.env.example`

- [ ] **Types.**

```ts
/** Retention windows in days; `null` = class disabled (owner has not decided yet). */
export type RetentionPolicy = {
  enabled: boolean;
  dryRun: boolean;
  intervalMs: number;
  batchSize: number;
  softDeletedDays: number;
  closedTicketDays: number | null;
  adminAuditDays: number | null;
  outboxSentDays: number;
};
```

```ts
/** What one retention tick did (or would have done, when dryRun). */
export type RetentionRunSummary = {
  ranAt: string;
  dryRun: boolean;
  softDeletedTicketsPurged: number;
  closedTicketsPurged: number;
  kbArticlesPurged: number;
  adminAuditEventsPurged: number;
  outboxRowsPurged: number;
  attachmentFilesDeleted: number;
  attachmentFileErrors: number;
};
```

- [ ] **Policy from env** (in `retention.service.ts`, a `readPolicy(config)` function; `parsePositiveInt` from `common/config.utils.ts`):
  `RETENTION_ENABLED` (`'true'` → on; default off) · `RETENTION_DRY_RUN` (default `true`; only the literal `'false'` turns it off) · `RETENTION_INTERVAL_MS` (default 21 600 000 = 6 h) · `RETENTION_BATCH_SIZE` (default 100) · `RETENTION_SOFT_DELETED_DAYS` (default 30) · `RETENTION_CLOSED_TICKET_DAYS` (unset → `null`) · `RETENTION_ADMIN_AUDIT_DAYS` (unset → `null`) · `RETENTION_OUTBOX_SENT_DAYS` (default 180).
- [ ] **Service skeleton** — copy the shape of `SlaBreachService`: `onModuleInit` reads the policy, returns if `!enabled`, else `setInterval(() => this.runOnce())` plus one immediate run; `onModuleDestroy` clears the timer. `runOnce(): Promise<RetentionRunSummary | null>` is **public** so the integration test and a future admin endpoint can call it. Inside: `$transaction` → `pg_try_advisory_xact_lock(<NEW_CONSTANT>)`; return `null` if not acquired.
- [ ] **Per class, in this order, inside the lock:**
  1. Soft-deleted tickets: `findMany({ where: { deletedAt: { lt: cutoff(softDeletedDays) } }, select: { id: true, attachments: { select: { storageKey: true } } }, take: batchSize })`. Dry run → count only. Else `ticket.deleteMany({ where: { id: { in: ids } } })` (cascades), then after the transaction commits call `attachments.deleteAttachmentFile(key)` per key, counting successes/errors.
  2. Closed tickets (skip when `closedTicketDays === null`): same, `where: { deletedAt: null, status: 'CLOSED', closedAt: { lt: cutoff } }`.
  3. KB articles: `kbArticle.deleteMany({ where: { deletedAt: { lt: cutoff(softDeletedDays) } } })`.
  4. Admin audit (skip when null): `adminAuditEvent.deleteMany({ where: { createdAt: { lt: cutoff }, type: { not: 'RETENTION_RUN' } } })` — never delete the retention trail itself.
  5. Outbox: `notificationOutbox.deleteMany({ where: { status: 'SENT', sentAt: { lt: cutoff(outboxSentDays) } } })`.
  Dry run: every `deleteMany` becomes a `count`.
- [ ] **Always** (dry run or not) write one `adminAuditEvent.create({ type: 'RETENTION_RUN', payload: summary, actorEmail: 'system', actorName: 'Retention job' })` and `logger.log(JSON.stringify(summary))`.
- [ ] **Unit test** `retention.service.spec.ts`: `readPolicy` defaults (`enabled=false`, `dryRun=true`, `closedTicketDays=null`), `'false'` string handling, and `cutoff()` arithmetic. Keep the DB parts for the integration test.
- [ ] **Module:** imports `PrismaModule`, `ConfigModule`, `TicketsModule` (for `TicketAttachmentService`); provider `RetentionService`; exported (the integration test resolves it with `app.get(RetentionService)`). Add to `AppModule.imports`.
- [ ] **`.env.example`:** a "Retention" block with all eight variables and one comment line each; state plainly that nothing is deleted until `RETENTION_ENABLED=true` **and** `RETENTION_DRY_RUN=false`, and that closed-ticket/audit windows are unset pending the owner's decision.

### Task 7 — Integration tests

**Files:** Create `test/integration/tickets.soft-delete.spec.ts`, `test/integration/retention.spec.ts`; Modify `test/integration/categories.spec.ts`, `test/integration/kb.spec.ts`

- [ ] **`tickets.soft-delete.spec.ts`** (personas from `fixtures.ts`; create a ticket on the IT team as the requester first, as `csat.spec.ts` does):
  1. AGENT `DELETE /api/tickets/:id` → 403.
  2. TEAM_ADMIN of IT → 200 with `deletedAt`; `GET /api/tickets/:id` as AGENT → 404; as requester → 404; as OWNER → 200 with `deletedAt` set.
  3. `GET /api/tickets` as LEAD → the id is absent; `GET /api/tickets/counts` as LEAD excludes it (compare before/after).
  4. `GET /api/tickets?includeDeleted=true` as LEAD → 403; as OWNER → the id is present.
  5. `POST /api/tickets/:id/messages` as the requester → 404 (hidden), as OWNER → 403 (writes blocked).
  6. `POST /api/tickets/:id/restore` as TEAM_ADMIN → 403; as OWNER → 200; then AGENT can `GET` it again.
  7. `GET /api/tickets/:id/events` as OWNER lists `TICKET_DELETED` and `TICKET_RESTORED`; `GET /api/audit-log` as OWNER contains both types.
- [ ] **`retention.spec.ts`:** create two tickets; soft-delete one (as OWNER) and back-date its `deletedAt` to 40 days ago with `prisma.ticket.update`; `const svc = app.get(RetentionService)`; with the default policy (`enabled=false`) assert `runOnce()` in dry-run reports `softDeletedTicketsPurged: 1` and the row **still exists**; then set `RETENTION_DRY_RUN=false` via a policy override method (`svc.setPolicyForTests({ dryRun: false })` — keep it explicit and named so nobody uses it in prod) and assert the row is gone, the other ticket remains, and an `AdminAuditEvent` `RETENTION_RUN` exists with `dryRun: false`.
- [ ] **`categories.spec.ts`:** add a case: create a category, create a ticket with it, `DELETE /api/categories/:id` as OWNER → 400 with "Deactivate it instead".
- [ ] **`kb.spec.ts`:** add a case: publish an article, delete it as author → 200; `GET /api/kb/articles/:slug` → 404 for everyone including the author; the slug cannot be reused (create with the same title → gets a suffixed slug).
- [ ] Run the four specs individually first (`npx jest --config ./test/jest.integration.json test/integration/<name>.spec.ts > ../../<name>.txt 2>&1`), then the full suite to a file. Expected: previous baseline + ~12. Record the real number.

### Task 8 — Web: delete button

**Files:** Modify `apps/web/src/api/client.ts`, `apps/web/src/pages/TicketDetailPage.tsx`, `apps/web/src/types.ts` (if `deletedAt` needs adding to the ticket type)

- [ ] `client.ts`: `export function deleteTicket(ticketId: string, reason?: string)` → `apiFetch(\`/tickets/${ticketId}\`, { method: 'DELETE', body: JSON.stringify({ reason }) })`; `export function restoreTicket(ticketId: string)` → `POST /tickets/:id/restore`.
- [ ] `TicketDetailPage.tsx`: next to "Copy ticket link" (`:1929`), render a trash icon button **only** when `role === 'OWNER' || (role === 'TEAM_ADMIN' && ticket.assignedTeam?.id === session.primaryTeamId)` (read how the page already derives `canManage` and reuse that source of truth). Clicking opens `ConfirmDialog` (`destructive`, title "Delete this ticket?", message naming the display ID and "It disappears from every queue and report. An owner can restore it."). On confirm: `deleteTicket`, toast "Ticket deleted", `navigate('/tickets')`, invalidate the list queries the page already invalidates on transition.
- [ ] If OWNER opens a deleted ticket, show a slim banner "Deleted on <date>" above the header and hide the composer (reuse the existing read-only state used for closed tickets if there is one).
- [ ] `cd apps/web && npx tsc --noEmit && npx vitest run` → clean, 13 files.

### Task 9 — Docs, baselines, commit

- [ ] `CLAUDE.md` + `docs/agent-context/repo-landmines.md`: new unit and integration baseline numbers (date 2026-08-26 or the day you finish). In landmines "Prisma", update the sentence *"This schema has no soft delete anywhere"* to describe `Ticket.deletedAt`/`KbArticle.deletedAt` and the `Restrict` FKs.
- [ ] `docs/azure-env-settings.md`: add the eight `RETENTION_*` names with the two-switch safety note.
- [ ] Commit in the three logical pieces already suggested (schema; API+tests; web+docs), or one commit — either is fine; do not push.

## 6. Files expected to change

| Area | Files |
|---|---|
| Schema | `prisma/schema.prisma`, `prisma/migrations/<ts>_soft_delete_and_fk_restrict/migration.sql` |
| Access | `common/access-control.service.ts`, `common/access-options.type.ts` (new), `common/access-control.service.spec.ts` (new or extended) |
| Explicit filters | `agents-admin/agents-admin.service.ts`, `slas/sla-breach.service.ts`, `users/users.service.ts`, `ai/tools/user-tools.service.ts`, `tickets/inbound-email.service.ts`, `automation/rule-engine.service.ts` |
| Tickets | `tickets/tickets.controller.ts`, `tickets/tickets.service.ts`, `tickets/dto/list-tickets.dto.ts`, `tickets/dto/delete-ticket.dto.ts` (new) |
| Categories / KB | `categories/categories.service.ts`, `kb/kb.service.ts` |
| Retention | `retention/*` (5 new), `app.module.ts`, `.env.example` |
| Tests | `test/integration/tickets.soft-delete.spec.ts` (new), `test/integration/retention.spec.ts` (new), `categories.spec.ts`, `kb.spec.ts` |
| Web | `api/client.ts`, `pages/TicketDetailPage.tsx`, `types.ts` |
| Docs | `CLAUDE.md`, `docs/agent-context/repo-landmines.md`, `docs/azure-env-settings.md` |

Anything outside this table — especially `reports.service.ts` (should need **no** change if the chokepoint is right) — is a report-back item.

## 7. Security considerations

- Soft-deleted tickets must not leak through: list, counts, activity, status-breakdown, metrics, reports, agents-admin stats, AI user history, realtime payloads, search (`q`), the command palette (uses the list API), saved-view counts, or the inbound-email threading path. The chokepoint covers most; §3 lists the rest. The integration spec checks list/count/detail/messages; **add a reports check**: as LEAD, `GET /api/reports/tickets-by-status` before and after the delete must differ by one.
- Existence must not be revealed: non-owners get 404, not 403, on a deleted ticket's detail.
- Deletion and restoration are audited in two places (ticket events for the ticket's own history; admin audit for governance) with actor snapshots.
- Retention: two independent switches must both be flipped before anything is destroyed; every run leaves an audit row; the retention trail itself is never purged. Blob deletion is best-effort and after commit, so a storage outage cannot roll back a DB purge into an inconsistent state — errors are counted in the summary.
- The migration's `DROP CONSTRAINT` is declared on line 1 with its reason; the guard from 0.3 prints it.

## 8. Acceptance criteria

1. Migration applies cleanly with `prisma migrate deploy` on the test DB; `scripts/check-migrations.sh` reports it `ALLOWED` and nothing else flagged.
2. All §3 non-chokepoint sites carry a `deletedAt` filter (grep `deletedAt` in each listed file returns ≥ 1).
3. `tickets.soft-delete.spec.ts`, `retention.spec.ts`, and the two extended specs pass; full integration suite = previous baseline + new tests, 1 skipped; unit suite = previous + new; both `tsc` clean; web vitest 13 files green.
4. Manual: deleting a ticket in the UI removes it from the queue for a lead's session instantly (realtime) and the owner can restore it via `POST /api/tickets/:id/restore`.
5. With `RETENTION_ENABLED=true` and default dry run, the log shows a `RETENTION_RUN` summary and **nothing is deleted**.
6. `DELETE /api/categories/:id` on a used category → 400 with the "Deactivate it instead" message.
7. Baselines and env docs updated.

## 9. Checks to run

```bash
cd "/c/Users/PHulgur/Downloads/Ticketing System Quality Review"
bash scripts/check-migrations.sh origin/main
cd apps/api
npx tsc --noEmit && npx jest --silent
export PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="Yes, reset the local test database"
for s in tickets.soft-delete retention categories kb; do npx jest --config ./test/jest.integration.json test/integration/$s.spec.ts > ../../it-$s.txt 2>&1; grep -E "Tests:" ../../it-$s.txt; done
npm run test:integration > ../../int-full.txt 2>&1; grep -E "Tests:|Test Suites:" ../../int-full.txt
cd ../web && npx tsc --noEmit && npx vitest run
cd ../.. && git status --short && git diff --stat main...HEAD -- . ':!prompts'
```

## 10. Manual test steps

1. `npm run dev` (API + web). Sign in as the seeded OWNER (`olivia.king@company.com`), open any ticket, click Delete → confirm → you land on `/tickets` and the ticket is gone from the list and the dashboard counts.
2. In a second browser profile as the LEAD (`maria.chen@company.com`), the ticket disappears from the open queue without a refresh (realtime) and its URL returns "not found".
3. `curl -X POST localhost:3000/api/tickets/<id>/restore -H "x-user-email: olivia.king@company.com"` → 200; the ticket is back for the lead.
4. Set `RETENTION_ENABLED=true` in `apps/api/.env`, restart, watch the log for one `RETENTION_RUN` line with `dryRun: true`; confirm `SELECT count(*) FROM "Ticket"` is unchanged. Remove the variable.
5. Try to delete the "Access & Identity" category in the admin UI → the "Deactivate it instead" error appears.
6. Stop the dev servers.

## 11. Handoff notes — what to report back

1. Commit SHA(s).
2. Output of `scripts/check-migrations.sh` (your migration must show `ALLOWED`) and the verified constraint names.
3. `Tests:` lines: unit, each of the four integration specs, and the full integration run (paste the summary block); vitest summary; both `tsc` exit codes.
4. `git diff --stat main...HEAD -- . ':!prompts'` (or against the pre-card commit).
5. Manual steps 1–5 results.
6. Anything that did not match — especially: any site outside §3 that needed a `deletedAt` filter (say where and why), any place that passes a narrowed ticket shape to `canViewTicket` and therefore bypassed the deleted check, whether `reports.service.ts` needed edits, and the real `SLA_BREACH_LOCK_KEY` value and the constant you chose.

---

## 12. Decision after the round-1 report (planning session, 2026-08-26)

Planner reviewed commits `c95ee50`, `1b5336c`, `22b05e3`: migration SQL is exactly the six intended statements under the allow-drop header (trigram indexes intact, 49 migrations on the test DB); the access-control chokepoint change is correct; items 6B–6F are accepted as reported. Stopping on 6A was correct — §3/§6 assumed every report used `accessConditionSql`; three use `prisma.ticket.groupBy` through `reportWhere()`.

### 12.1 Apply the `reportWhere()` fix — **yes**

`apps/api/src/reports/reports.service.ts` `reportWhere()` (~:126): push `{ deletedAt: null }` into `conditions`. One line. `reports.service.ts` joins the §6 list. Re-run the four card specs and the **full** integration suite; expect **373 passed, 1 skipped, 0 failed**.

### 12.2 Accepted deviations (no action)

- 6B: `TicketRealtimeReason` union gains `'deleted' | 'restored'`; `categories.service.spec.ts` mock extended. Both join the §6 list.
- 6C: three `agents-admin` raw queries filtered, not one. §3 was wrong about the count; the fix is right.
- 6D: `listMessages`/`listEvents` pass `{ includeDeleted: true }` (OWNER-only effect) and probe existence with `deletedAt: null` so non-owners get 404. Good — this closes an existence leak §7 asked about.
- 6E: retention advisory lock key 847293 (SLA uses 847291/847292). Record in the JSDoc if not already.
- 6F: statics on `RetentionService`, spec adjustments, global toast — all fine.

### 12.3 Baselines

`CLAUDE.md` and `docs/agent-context/repo-landmines.md`: **206 unit (26 suites), 373 integration + 1 skipped, 36 web (13 files)** — after the full run confirms them. Also note in the landmines Prisma bullet that migration count is now 49.

### 12.4 Bring the dev database up to date, then do the manual steps

The owner's standing rule is **dev (Supabase) before production** for every migration. From `apps/api`, with the normal `.env` (Prisma uses `directUrl`, port 5432, for migrations — the pooler URL on 6543 is only the runtime `url`):

```bash
npx prisma migrate status      # confirm the Datasource line shows the host on :5432, NOT :6543; expect exactly 1 pending
npx prisma migrate deploy      # applies 20260826180000_soft_delete_and_fk_restrict
npx prisma migrate status      # "Database schema is up to date!", 49 migrations
```

If the status line shows port 6543, stop — `.env`'s `DIRECT_URL` is wrong and must be fixed by the owner, not worked around.

Then run §10 manual steps 1–5 with **real dev accounts**: list them with `GET /api/users` as an OWNER (or `SELECT email, role FROM "User" ORDER BY role` against the dev DB) and substitute one OWNER and one LEAD for the seed names the prompt assumed. Report which accounts you used and the outcome of each step, including the realtime disappearance in step 2 if Web PubSub is configured in dev (the readiness endpoint tells you).

### 12.5 Commit and report

One commit for 12.1 + 12.3 (explicit paths: `reports.service.ts`, `CLAUDE.md`, `repo-landmines.md`). Stage by explicit path; read `git status --short` first — the planning session's prompt/plan commits may be interleaved on the branch. Report: commit SHA; the four spec `Tests:` lines and the full-suite summary; both `tsc`; vitest; `git diff --stat ca31593 HEAD -- . ':!prompts' ':!docs/DR.md'`; dev-DB `migrate status` before/after; manual steps 1–5 with the accounts used; anything else that did not match.

---

## 13. Post-implementation record (planning session, 2026-08-27)

**Verdict: GREEN.** Commits `c95ee50` → `1b5336c` → `22b05e3` → `491450b`. Planner independently re-ran: `jest` 206/206 (26 suites); full `test:integration` **374 passed + 1 skipped, 40/40 files, 0 failures** (640 s, run alone — a first attempt run alongside other checks was cut off at 29 files by a 10-minute cap, 0 failures); `tsc --noEmit` clean in api and web; vitest 13 files / 36. `scripts/check-migrations.sh origin/main` → the new migration `ALLOWED` with its declared reason, nothing else flagged. Dev (Supabase) database after the implementer's `migrate deploy`: 49 migrations, `deletedAt` on `Ticket` and `KbArticle`, both FKs `ON DELETE RESTRICT`, **all six trigram indexes present**. Source read: reports fix, owner-only history reads (404 for others), retention two-switch safety, delete/restore authorisation, category refusal, KB filter — all as designed.

**Accepted deviations from round 2:** `TicketsPage.tsx` realtime removal (required for acceptance criterion 4); `TicketConversation.tsx` `readOnly` for a deleted ticket; `listMessages` owner-read fix + one extra integration test (374, not 373); dev DB was three migrations behind, all additive, all applied.

**Approved to merge and deploy.** Deploy order: `prisma migrate status` against production must show exactly **one** pending migration (`20260826180000_soft_delete_and_fk_restrict`); apply it; confirm 49 and that `SELECT indexname FROM pg_indexes WHERE indexname LIKE '%trgm%'` still returns six rows; then the package. Rollback for the schema is not needed (additive columns; FK action change is behaviour-only) — if the FK change must be undone, the reverse `ALTER TABLE … DROP CONSTRAINT / ADD CONSTRAINT … ON DELETE SET NULL` is the down-migration.

**Landmines recorded from this card** (in `repo-landmines.md`, commit `0d8f35d`): never two suites at once; `.env` ↔ `.env.bak` rename during resets; dev DB lags production; ports 3000/3001 busy. Follow-up logged: stale "N open tickets" header on realtime removal.
