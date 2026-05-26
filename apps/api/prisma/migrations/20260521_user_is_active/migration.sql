-- Off-boarding flow: soft-delete users instead of hard-deleting.
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "deactivatedAt" TIMESTAMP(3);

CREATE INDEX "User_isActive_idx" ON "User"("isActive");
