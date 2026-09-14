-- Announcements and the outage banner (card 2.7). The 64th migration.
--
-- Additive only: two new enums, one new table, four indexes, three foreign
-- keys. Nothing existing is altered and nothing is dropped.
--
-- Both enums are NEW types, so this is `CREATE TYPE` and not
-- `ALTER TYPE ... ADD VALUE` — the Postgres "cannot use a value added in the
-- same transaction" trap that shaped card 2.1's migration does not apply here.
--
-- `endsAt` is nullable and that means "until I say otherwise". An outage nobody
-- can put a time on is the normal case, and a sentinel far-future date would be
-- a lie every query then has to special-case. Same reasoning as card 2.2's
-- `awayUntil`.
--
-- `createdById` is ON DELETE SET NULL, following TicketLink (card 1.6): an
-- announcement outlives the account that wrote it, and card 1.30 established
-- that accounts do get merged away. The handoff sketched this column as NOT
-- NULL; it is nullable here for that reason, and the API still records an
-- author on every write.
--
-- `Announcement_startsAt_endsAt_idx` exists for one query: GET /announcements
-- /active, which runs on every page load for every signed-in user. Both halves
-- of "active" are time columns, so they are indexed together rather than
-- separately.
--
-- HAND-WRITTEN. `prisma migrate dev` would additionally have emitted the
-- standing twelve destructive statements, which are NOT part of this change:
--
--   * six DROP INDEX for the trigram GIN indexes (Ticket_description/displayId/
--     subject_trgm_idx and KbArticle_content/summary/title_trgm_idx). Prisma
--     cannot express `USING GIN (col gin_trgm_ops)`, so it reads them as drift
--     on every generate. Applying them destroys ticket and KB search against a
--     stated sub-500ms requirement.
--   * six ALTER COLUMN ... DROP DEFAULT on AutomationExecution.trigger and the
--     updatedAt columns of SlaBusinessHoursSetting, SlaPolicyAssignment,
--     SlaPolicyConfig, SlaPolicyConfigTarget and TicketEmailThread.
--
-- Verified: grep -cE '^(DROP|ALTER TABLE .* DROP)' migration.sql  =>  0

-- CreateEnum
CREATE TYPE "AnnouncementSeverity" AS ENUM ('INFO', 'WARNING', 'OUTAGE');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'TEAM');

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "AnnouncementSeverity" NOT NULL DEFAULT 'INFO',
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'ALL',
    "teamId" TEXT,
    "linkedTicketId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_startsAt_endsAt_idx" ON "Announcement"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Announcement_teamId_idx" ON "Announcement"("teamId");

-- CreateIndex
CREATE INDEX "Announcement_createdById_idx" ON "Announcement"("createdById");

-- CreateIndex
CREATE INDEX "Announcement_linkedTicketId_idx" ON "Announcement"("linkedTicketId");

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_linkedTicketId_fkey" FOREIGN KEY ("linkedTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
