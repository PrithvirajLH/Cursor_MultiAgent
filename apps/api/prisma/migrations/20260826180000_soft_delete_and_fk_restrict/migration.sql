-- allow-drop: FK action change only (SetNull -> Restrict on Ticket.assignedTeamId and Ticket.categoryId); no data or index is dropped.
-- Soft delete for tickets and knowledge-base articles, and database-level
-- protection against losing tickets when a team or category is deleted.
--
--   * Ticket.deletedAt / Ticket.deletedById — a soft-deleted ticket is hidden
--     from every list, count, report and lookup unless an OWNER asks for it
--     explicitly (includeDeleted); it can be restored by an OWNER.
--   * KbArticle.deletedAt — the same for help articles (slug stays reserved).
--   * Ticket.assignedTeam and Ticket.category change from Prisma's implicit
--     ON DELETE SET NULL to ON DELETE RESTRICT, so deleting a Team or Category
--     that still has tickets is refused by the database instead of silently
--     un-assigning / un-classifying those tickets.
--
-- HAND-WRITTEN. `prisma migrate diff` additionally emitted six DROP INDEX
-- statements for the trigram GIN indexes it cannot model
-- (KbArticle_{content,summary,title}_trgm_idx, Ticket_{description,displayId,subject}_trgm_idx)
-- and several ALTER COLUMN ... DROP DEFAULT statements that are NOT part of this
-- change. They were removed — see docs/agent-context/repo-landmines.md, "Prisma".
-- Constraint names were verified against the test database before writing.

-- Soft-delete columns
ALTER TABLE "Ticket" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "deletedById" TEXT;
CREATE INDEX "Ticket_deletedAt_idx" ON "Ticket"("deletedAt");

ALTER TABLE "KbArticle" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "KbArticle_deletedAt_idx" ON "KbArticle"("deletedAt");

-- Foreign-key action change: SET NULL -> RESTRICT (same names, same columns)
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_assignedTeamId_fkey";
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedTeamId_fkey"
  FOREIGN KEY ("assignedTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_categoryId_fkey";
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
