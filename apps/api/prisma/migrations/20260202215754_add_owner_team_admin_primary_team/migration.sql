-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'TEAM_ADMIN';
ALTER TYPE "UserRole" ADD VALUE 'OWNER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "primaryTeamId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_primaryTeamId_fkey" FOREIGN KEY ("primaryTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Data: migrate existing ADMIN users to TEAM_ADMIN and set primaryTeamId from first team membership
UPDATE "User" u
SET role = 'TEAM_ADMIN',
    "primaryTeamId" = COALESCE(
      (SELECT tm."teamId" FROM "TeamMember" tm WHERE tm."userId" = u.id LIMIT 1),
      u."primaryTeamId"
    )
WHERE u.role = 'ADMIN';
