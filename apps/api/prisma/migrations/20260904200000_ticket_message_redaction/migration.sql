-- Redact a message (card 1.11). Additive only: two nullable columns, one index
-- and one nullable foreign key, on one table. The 58th migration.
--
-- Both columns are NULLABLE with no default, so every message already in the
-- database is simply "not redacted" and nothing is backfilled. The foreign key
-- is ON DELETE SET NULL: deleting the person who redacted something must not
-- cascade into deleting the message, and must not fail either - the redaction
-- still happened, we just stop naming them.
--
-- ⚠️ There is deliberately NO column here for the original body, and no table
-- to hold one. Redaction OVERWRITES `body` with "[message removed by <name>]"
-- and the original text is not kept anywhere the application can read. A
-- healthcare desk redacts precisely because something ended up where it should
-- not be - the wrong patient's details, a credential typed into a reply - and
-- preserving that text in a TicketEvent would MOVE the PHI rather than remove
-- it, into a row with weaker read rules than the message it came from. The
-- repo already takes this line for AiInferenceLog ("never store raw PHI"), and
-- a redaction feature that quietly retains what it claims to have removed is
-- worse than none, because people would rely on it. What IS recorded is that a
-- redaction happened, by whom, when, on which message, and whether that message
-- had already been emailed - which is the audit question anyone would actually
-- ask - without the content.
--
-- No enum is touched, so this carries none of the enum-in-transaction hazard
-- that migrations 54 and 56 documented.
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

-- AlterTable
ALTER TABLE "TicketMessage" ADD COLUMN     "redactedAt" TIMESTAMP(3),
ADD COLUMN     "redactedById" TEXT;

-- CreateIndex
CREATE INDEX "TicketMessage_redactedById_idx" ON "TicketMessage"("redactedById");

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_redactedById_fkey" FOREIGN KEY ("redactedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
