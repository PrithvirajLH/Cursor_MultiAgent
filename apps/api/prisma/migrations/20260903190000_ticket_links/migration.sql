-- Link related tickets (card 1.6). Additive only: one new enum, one new table,
-- three indexes, one composite unique and three foreign keys. Nothing existing
-- is altered and nothing is dropped. The 55th migration.
--
-- ONE ROW PER RELATIONSHIP. The composite unique is (fromTicketId, toTicketId,
-- type), and the inverse direction is derived when a ticket is read rather than
-- stored. Storing both directions would double the rows and let the two halves
-- disagree — there would be no way to tell which was right.
--
-- The unique deliberately includes `type`, so the same pair may carry two
-- relationships of different kinds. "A is a duplicate of B" and "A is related to
-- B" are different statements and an agent may reasonably record both.
--
-- Both ticket foreign keys are ON DELETE CASCADE, which matters only for a HARD
-- delete. Tickets here are soft-deleted (Ticket.deletedAt), so in normal
-- operation a link to a deleted ticket survives — that is intended, an agent
-- needs to know what a ticket was linked to. The reader-side rules for that live
-- in TicketsService.buildTicketLinkView.
--
-- createdById is ON DELETE SET NULL: a link outlives the account that made it,
-- and card 1.30 established that accounts do get merged away.
--
-- No new TicketEvent type is needed. TicketEvent.type is a plain String column,
-- so TICKET_LINKED and TICKET_UNLINKED need no schema change at all.
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
-- Verified: grep -cE '^(DROP|ALTER TABLE .* DROP)' migration.sql  =>  0

-- CreateEnum
CREATE TYPE "TicketLinkType" AS ENUM ('RELATED', 'DUPLICATE_OF', 'PARENT_OF');

-- CreateTable
CREATE TABLE "TicketLink" (
    "id" TEXT NOT NULL,
    "fromTicketId" TEXT NOT NULL,
    "toTicketId" TEXT NOT NULL,
    "type" "TicketLinkType" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketLink_fromTicketId_idx" ON "TicketLink"("fromTicketId");

-- CreateIndex
CREATE INDEX "TicketLink_toTicketId_idx" ON "TicketLink"("toTicketId");

-- CreateIndex
CREATE INDEX "TicketLink_createdById_idx" ON "TicketLink"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "TicketLink_fromTicketId_toTicketId_type_key" ON "TicketLink"("fromTicketId", "toTicketId", "type");

-- AddForeignKey
ALTER TABLE "TicketLink" ADD CONSTRAINT "TicketLink_fromTicketId_fkey" FOREIGN KEY ("fromTicketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLink" ADD CONSTRAINT "TicketLink_toTicketId_fkey" FOREIGN KEY ("toTicketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketLink" ADD CONSTRAINT "TicketLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
