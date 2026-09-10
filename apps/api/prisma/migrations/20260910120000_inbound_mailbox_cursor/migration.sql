-- The Graph delta cursor for the inbound mailbox worker (card 1.24).
-- The 60th migration.
--
-- ONE new table, nothing altered and nothing dropped. No existing row, column,
-- index or enum is touched, so this cannot affect anything already running.
--
-- WHY A TABLE AND NOT A CONFIG VALUE. The delta link is the reason card 1.24
-- polls instead of subscribing to a webhook: it is a durable cursor, so an app
-- that was down for a deploy collects everything that arrived meanwhile on its
-- next poll. Held in memory it would be lost on every restart, which is
-- precisely the failure mode of the push subscription this design rejected.
--
-- `mailbox` is UNIQUE rather than the table being a singleton: pointing the
-- worker at a different address should start a fresh cursor, not silently
-- resume one belonging to another mailbox.
--
-- `deltaLink` is nullable and starts null, meaning "never synced" - the first
-- poll then requests an initial delta page rather than trying to resume from
-- nothing.
--
-- No enum is touched, so this carries none of the enum-in-transaction hazard
-- that migrations 54 and 56 documented.
--
-- HAND-WRITTEN rather than generated. `prisma migrate dev` additionally emits
-- the standing twelve destructive statements, which are drift and are NOT part
-- of this change:
--
--   * six DROP INDEX for the trigram GIN indexes from
--     20260220150000_add_ticket_search_trigram_indexes and
--     20260528_add_knowledge_base -- KbArticle_content/summary/title_trgm_idx
--     and Ticket_description/displayId/subject_trgm_idx. Prisma cannot express
--     `USING GIN (col gin_trgm_ops)`, so it reads them as drift on every
--     generate. Applying them would destroy ticket and KB search performance
--     against the stated sub-500ms requirement -- measured in
--     docs/performance-2026-09-09.md.
--   * six ALTER COLUMN ... DROP DEFAULT on AutomationExecution.trigger and the
--     updatedAt columns of SlaBusinessHoursSetting, SlaPolicyAssignment,
--     SlaPolicyConfig, SlaPolicyConfigTarget and TicketEmailThread.
--
-- Verified: grep -cE '^(DROP|ALTER TABLE .* DROP)' migration.sql  =>  0

-- CreateTable
CREATE TABLE "InboundMailboxCursor" (
    "id" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "deltaLink" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundMailboxCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundMailboxCursor_mailbox_key" ON "InboundMailboxCursor"("mailbox");
