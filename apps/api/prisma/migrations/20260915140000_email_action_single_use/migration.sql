-- Card 1.100 — a one-click email link can only be used once.
--
-- Migration 67. HAND-WRITTEN: `prisma migrate dev` emits six `DROP INDEX`
-- statements for the trigram GIN indexes it cannot model, and applying them
-- destroys ticket and KB search against a stated sub-500ms requirement.
--
-- ⚠️ 66 IS DELIBERATELY SKIPPED — it is reserved by card 1.83, which is in
-- flight in another session. A gap in the sequence is harmless; two files
-- claiming the same number is not.
--
-- Additive. Zero DROP statements. One table.

-- ---------------------------------------------------------------------------
-- The email action token is a stateless HMAC, so nothing in it can record that
-- it has been spent. This table is what makes it single-use.
--
-- Only the SHA-256 of the token is stored: a row here must not be a working
-- credential if somebody reads the table.
-- ---------------------------------------------------------------------------
CREATE TABLE "EmailActionUse" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    -- What the first use answered, so a replay is shown the same friendly
    -- sentence rather than an error. Null while the first use is still running.
    "outcome" TEXT,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailActionUse_pkey" PRIMARY KEY ("id")
);

-- ⚠️ THE UNIQUE INDEX IS THE LOCK. Two simultaneous clicks race to INSERT; the
-- loser conflicts and is served the recorded outcome instead of acting again.
CREATE UNIQUE INDEX "EmailActionUse_tokenHash_key" ON "EmailActionUse"("tokenHash");

-- So a ticket's link usage can be read back without scanning.
CREATE INDEX "EmailActionUse_ticketId_idx" ON "EmailActionUse"("ticketId");
