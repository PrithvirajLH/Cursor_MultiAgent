-- Per-department business-hours calendars.
--
-- Adds a nullable, unique "teamId" to SlaBusinessHoursSetting. NULL is the
-- organisation default (the existing 'global' row, which is left untouched);
-- a row with a teamId overrides the default for that team only. Purely
-- additive: no data moves and behaviour is unchanged until a team row exists.
--
-- HAND-EDITED. `prisma migrate diff` additionally emitted six DROP INDEX
-- statements and several ALTER COLUMN ... DROP DEFAULT statements that are
-- NOT part of this change. They were removed.
--
-- The dropped indexes were the trigram GIN indexes created by
-- 20260220150000_add_ticket_search_trigram_indexes and 20260528_add_knowledge_base.
-- Prisma cannot express `USING GIN (col gin_trgm_ops)` in schema.prisma, so it
-- sees them as drift and tries to remove them on every migrate dev. Applying
-- that would silently destroy ticket and KB search performance (the <500ms
-- search NFR). Strip them from every future generated migration too.

-- AlterTable
ALTER TABLE "SlaBusinessHoursSetting" ADD COLUMN     "teamId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SlaBusinessHoursSetting_teamId_key" ON "SlaBusinessHoursSetting"("teamId");

-- AddForeignKey
ALTER TABLE "SlaBusinessHoursSetting" ADD CONSTRAINT "SlaBusinessHoursSetting_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
