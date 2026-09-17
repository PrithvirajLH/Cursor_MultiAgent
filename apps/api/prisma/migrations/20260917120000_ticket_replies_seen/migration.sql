-- Card 1.138: when the desk last opened a ticket, so a reply can be "unread".
--
-- ⚠️ HAND-WRITTEN AND ADDITIVE ONLY. `prisma migrate diff` emitted SIXTEEN
-- statements for this two-column change: six `DROP INDEX` for the trigram GIN
-- indexes it cannot model in schema.prisma, plus ten `ALTER COLUMN ... DROP
-- DEFAULT`. Applying it unedited destroys ticket and KB search performance
-- against a stated sub-500ms requirement. Everything but the two ADD COLUMNs
-- was removed. See docs/agent-context/repo-landmines.md, "Prisma".
--
-- Additive, so the deploy stays safe in both directions: old code ignores both
-- columns, and NULL `repliesSeenAt` reads as "nobody has opened it", which is
-- the correct answer for every row that existed before this ran.
ALTER TABLE "Ticket" ADD COLUMN     "repliesSeenAt" TIMESTAMP(3),
ADD COLUMN     "repliesSeenById" TEXT;
