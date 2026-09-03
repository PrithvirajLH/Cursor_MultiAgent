-- "Remind me Friday" (card 1.10). Additive only: one new nullable column, one
-- index, one new enum value. Nothing is altered and nothing is dropped. The
-- 54th migration.
--
-- ⚠️ THE NEW ENUM VALUE IS ADDED AND NOT USED. Postgres will not let a newly
-- added enum value be referenced in the same transaction that adds it, and
-- Prisma runs a migration file inside one. So there is deliberately no seed, no
-- backfill and no row written with 'FOLLOW_UP_DUE' here — the scheduler starts
-- using it on the next tick after this deploys. If a future change wants to
-- write one, it needs a separate migration.
--
-- The enum addition follows 20260828120000_ticket_channel_api, which is the
-- same one-liner for TicketChannel.
--
-- HAND-WRITTEN from `prisma migrate diff`, which additionally emitted the
-- standing twelve destructive statements that are NOT part of this change.
-- Every one was removed:
--
--   * six DROP INDEX for the trigram GIN indexes created by
--     20260220150000_add_ticket_search_trigram_indexes and
--     20260528_add_knowledge_base -- KbArticle_content/summary/title_trgm_idx
--     and Ticket_description/displayId/subject_trgm_idx. Prisma cannot express
--     `USING GIN (col gin_trgm_ops)` in schema.prisma, so it reads them as
--     drift on every generate. Applying them would silently destroy ticket and
--     KB search performance against the stated sub-500ms requirement.
--   * six ALTER COLUMN ... DROP DEFAULT on AutomationExecution.trigger and the
--     updatedAt columns of SlaBusinessHoursSetting, SlaPolicyAssignment,
--     SlaPolicyConfig, SlaPolicyConfigTarget and TicketEmailThread -- the same
--     standing drift, equally unrelated to this change.
--
-- Strip them from every future generated migration too. See
-- docs/agent-context/repo-landmines.md ("Prisma").

ALTER TYPE "NotificationType" ADD VALUE 'FOLLOW_UP_DUE';

-- Nullable: almost no ticket has a follow-up, and one that does clears it when
-- the reminder fires, so it cannot arrive twice.
ALTER TABLE "Ticket" ADD COLUMN "followUpAt" TIMESTAMP(3);

-- The scheduler sweeps for due follow-ups on every tick.
CREATE INDEX "Ticket_followUpAt_idx" ON "Ticket"("followUpAt");
