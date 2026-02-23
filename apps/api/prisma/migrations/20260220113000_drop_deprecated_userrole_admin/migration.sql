-- Remove deprecated ADMIN from UserRole enum.
-- Safety backfill in case any stale rows still exist.
UPDATE "User"
SET "role" = 'TEAM_ADMIN'
WHERE "role"::text = 'ADMIN';

ALTER TYPE "UserRole" RENAME TO "UserRole_old";

CREATE TYPE "UserRole" AS ENUM (
  'EMPLOYEE',
  'AGENT',
  'LEAD',
  'TEAM_ADMIN',
  'OWNER'
);

ALTER TABLE "User"
ALTER COLUMN "role" DROP DEFAULT,
ALTER COLUMN "role" TYPE "UserRole" USING ("role"::text::"UserRole"),
ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE';

DROP TYPE "UserRole_old";
