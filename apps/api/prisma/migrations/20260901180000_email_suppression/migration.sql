-- Durable email suppression list (card 1.23). Additive only: one new table,
-- no column changed, no data moved. The 52nd migration.
--
-- HAND-WRITTEN from `prisma migrate diff`, which additionally emitted twelve
-- destructive statements that are NOT part of this change. Every one was
-- removed:
--
--   * six DROP INDEX for the trigram GIN indexes created by
--     20260220150000_add_ticket_search_trigram_indexes and
--     20260528_add_knowledge_base — KbArticle_content/summary/title_trgm_idx and
--     Ticket_description/displayId/subject_trgm_idx. Prisma cannot express
--     `USING GIN (col gin_trgm_ops)` in schema.prisma, so it reads them as drift
--     on every generate. Applying them would silently destroy ticket and KB
--     search performance against the sub-500ms requirement.
--   * six ALTER COLUMN ... DROP DEFAULT on AutomationExecution.trigger and the
--     updatedAt columns of SlaBusinessHoursSetting, SlaPolicyAssignment,
--     SlaPolicyConfig, SlaPolicyConfigTarget and TicketEmailThread — the same
--     standing drift, equally unrelated to this table.
--
-- Strip them from every future generated migration too. See
-- docs/agent-context/repo-landmines.md ("Prisma").

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 1,
    "lastReason" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppression_address_key" ON "EmailSuppression"("address");

-- CreateIndex
CREATE INDEX "EmailSuppression_kind_idx" ON "EmailSuppression"("kind");
