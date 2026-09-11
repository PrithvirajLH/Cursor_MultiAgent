-- Card 2.2 — agent availability, so auto-assignment stops sending tickets to
-- people who are on leave.
--
-- Additive only. Two columns, no index changes, and deliberately NO `DROP` of
-- any kind: `prisma migrate dev` would have emitted six `DROP INDEX` for the
-- trigram GIN indexes it cannot model plus six `ALTER COLUMN ... DROP DEFAULT`,
-- and applying those destroys ticket and KB search against a stated sub-500ms
-- requirement. Hand-written for that reason.
--
-- `isAvailable` defaults to true so every existing row is correct the moment
-- the column exists — nobody is retroactively marked away, and there is no
-- window where auto-assignment sees an empty team because a backfill has not
-- run yet.
--
-- `awayUntil` is nullable because "away indefinitely" is a real answer: someone
-- on long-term leave has no return date, and a sentinel far-future date would
-- be a lie the scheduler would then have to special-case.
ALTER TABLE "User" ADD COLUMN "isAvailable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "awayUntil" TIMESTAMP(3);
