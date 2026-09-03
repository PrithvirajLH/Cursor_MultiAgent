-- Key a person on the directory object instead of on a string (card 1.30,
-- PREVENT). Additive only: one new nullable column, one new table, four new
-- indexes/constraints. Nothing is altered and nothing is dropped. The 53rd
-- migration.
--
-- ONE migration carrying BOTH changes on purpose. Migrations here go straight
-- to production with no staging behind them, so two round trips would be two
-- chances to get it wrong.
--
-- WHY A TABLE AND NOT A KEY IN User.graphProfile: the alias address must be
-- UNIQUE across all users. If two humans could both claim the same alternate
-- address, resolution becomes ambiguous and the intake path would silently pick
-- one of them. JSON cannot carry that constraint, and the constraint is the
-- entire point.
--
-- HAND-WRITTEN from `prisma migrate diff`, which additionally emitted twelve
-- destructive statements that are NOT part of this change. Every one was
-- removed:
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

-- The Entra directory object id (the `oid` token claim). Nullable because every
-- one of the existing rows has none: they acquire it quietly, on next login.
ALTER TABLE "User" ADD COLUMN "entraObjectId" TEXT;

-- Unique so two rows can never claim the same directory object. Postgres allows
-- many NULLs under a unique index, which is what lets every existing row and
-- every inbound-only requester keep no identity at all.
CREATE UNIQUE INDEX "User_entraObjectId_key" ON "User"("entraObjectId");

-- Every address the directory has told us belongs to one human. Written from
-- the token at login, never inferred from the shape of an address.
CREATE TABLE "UserEmailAlias" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEmailAlias_pkey" PRIMARY KEY ("id")
);

-- The constraint this table exists for.
CREATE UNIQUE INDEX "UserEmailAlias_email_key" ON "UserEmailAlias"("email");

CREATE INDEX "UserEmailAlias_userId_idx" ON "UserEmailAlias"("userId");

ALTER TABLE "UserEmailAlias" ADD CONSTRAINT "UserEmailAlias_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
