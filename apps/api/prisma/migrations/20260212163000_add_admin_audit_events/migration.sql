CREATE TABLE IF NOT EXISTS "AdminAuditEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB,
  "teamId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditEvent_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'AdminAuditEvent'
      AND column_name = 'id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE "AdminAuditEvent"
      ALTER COLUMN "id" TYPE TEXT USING "id"::text;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'AdminAuditEvent'
      AND column_name = 'teamId'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE "AdminAuditEvent"
      ALTER COLUMN "teamId" TYPE TEXT USING "teamId"::text;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'AdminAuditEvent'
      AND column_name = 'createdById'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE "AdminAuditEvent"
      ALTER COLUMN "createdById" TYPE TEXT USING "createdById"::text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AdminAuditEvent_createdAt_idx"
  ON "AdminAuditEvent"("createdAt");

CREATE INDEX IF NOT EXISTS "AdminAuditEvent_type_idx"
  ON "AdminAuditEvent"("type");

CREATE INDEX IF NOT EXISTS "AdminAuditEvent_teamId_idx"
  ON "AdminAuditEvent"("teamId");

CREATE INDEX IF NOT EXISTS "AdminAuditEvent_createdById_idx"
  ON "AdminAuditEvent"("createdById");

DO $$
BEGIN
  ALTER TABLE "AdminAuditEvent"
    DROP CONSTRAINT IF EXISTS "AdminAuditEvent_teamId_fkey";
  ALTER TABLE "AdminAuditEvent"
    ADD CONSTRAINT "AdminAuditEvent_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
END $$;

DO $$
BEGIN
  ALTER TABLE "AdminAuditEvent"
    DROP CONSTRAINT IF EXISTS "AdminAuditEvent_createdById_fkey";
  ALTER TABLE "AdminAuditEvent"
    ADD CONSTRAINT "AdminAuditEvent_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
END $$;
