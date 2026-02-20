-- 8.1  Standardize FK cascade behavior
-- SlaInstance -> Ticket: change from RESTRICT to CASCADE (matches AutomationExecution)
ALTER TABLE "SlaInstance" DROP CONSTRAINT IF EXISTS "SlaInstance_ticketId_fkey";
ALTER TABLE "SlaInstance" ADD CONSTRAINT "SlaInstance_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AdminAuditEvent -> Team/User: make SET NULL explicit (was implicit default)
ALTER TABLE "AdminAuditEvent" DROP CONSTRAINT IF EXISTS "AdminAuditEvent_teamId_fkey";
ALTER TABLE "AdminAuditEvent" ADD CONSTRAINT "AdminAuditEvent_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminAuditEvent" DROP CONSTRAINT IF EXISTS "AdminAuditEvent_createdById_fkey";
ALTER TABLE "AdminAuditEvent" ADD CONSTRAINT "AdminAuditEvent_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 8.1  Add snapshot columns so audit data survives user/team deletion
ALTER TABLE "AdminAuditEvent" ADD COLUMN IF NOT EXISTS "actorEmail" TEXT;
ALTER TABLE "AdminAuditEvent" ADD COLUMN IF NOT EXISTS "actorName"  TEXT;
ALTER TABLE "AdminAuditEvent" ADD COLUMN IF NOT EXISTS "teamName"   TEXT;

-- Backfill snapshot fields from existing relations
UPDATE "AdminAuditEvent" ae
SET "actorEmail" = u."email",
    "actorName"  = u."displayName"
FROM "User" u
WHERE ae."createdById" = u."id"
  AND ae."actorEmail" IS NULL;

UPDATE "AdminAuditEvent" ae
SET "teamName" = t."name"
FROM "Team" t
WHERE ae."teamId" = t."id"
  AND ae."teamName" IS NULL;

-- 8.2  Partial unique index: only one SlaPolicyConfig can be the default
CREATE UNIQUE INDEX IF NOT EXISTS "SlaPolicyConfig_single_default"
  ON "SlaPolicyConfig" ("isDefault")
  WHERE "isDefault" = true;

-- 8.2  Partial unique index: only one default SavedView per user
CREATE UNIQUE INDEX IF NOT EXISTS "SavedView_default_per_user"
  ON "SavedView" ("userId")
  WHERE "isDefault" = true AND "userId" IS NOT NULL;

-- 8.2  Partial unique index: only one default SavedView per team
CREATE UNIQUE INDEX IF NOT EXISTS "SavedView_default_per_team"
  ON "SavedView" ("teamId")
  WHERE "isDefault" = true AND "teamId" IS NOT NULL;

-- 8.4  Text fields without size limits: widen columns to TEXT
-- Ticket.subject -> VARCHAR(200) to enforce a reasonable limit
ALTER TABLE "Ticket" ALTER COLUMN "subject" TYPE VARCHAR(200);
-- Ticket.description -> TEXT (unbounded, validated in DTO)
ALTER TABLE "Ticket" ALTER COLUMN "description" TYPE TEXT;
-- TicketMessage.body -> TEXT (unbounded, validated in DTO)
ALTER TABLE "TicketMessage" ALTER COLUMN "body" TYPE TEXT;
