-- Add SlaInstance -> SlaPolicyConfig reference to move runtime SLA tracking
-- away from legacy SlaPolicy-only linkage.

ALTER TABLE "SlaInstance"
  ADD COLUMN IF NOT EXISTS "policyConfigId" TEXT;

CREATE INDEX IF NOT EXISTS "SlaInstance_policyConfigId_idx"
  ON "SlaInstance" ("policyConfigId");

ALTER TABLE "SlaInstance"
  DROP CONSTRAINT IF EXISTS "SlaInstance_policyConfigId_fkey";
ALTER TABLE "SlaInstance"
  ADD CONSTRAINT "SlaInstance_policyConfigId_fkey"
  FOREIGN KEY ("policyConfigId") REFERENCES "SlaPolicyConfig"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Backfill from effective policy assignment (team-specific), falling back to
-- enabled global default policy. Keep existing values when already present.
WITH effective_policy AS (
  SELECT
    si."id" AS "instanceId",
    COALESCE(assigned."policyId", fallback."policyId") AS "policyConfigId"
  FROM "SlaInstance" si
  INNER JOIN "Ticket" t ON t."id" = si."ticketId"
  LEFT JOIN LATERAL (
    SELECT p."id" AS "policyId"
    FROM "SlaPolicyAssignment" a
    INNER JOIN "SlaPolicyConfig" p
      ON p."id" = a."policyConfigId"
     AND p."enabled" = true
    INNER JOIN "SlaPolicyConfigTarget" target
      ON target."policyConfigId" = p."id"
     AND target."priority" = si."priority"
    WHERE a."teamId" = t."assignedTeamId"
    ORDER BY a."updatedAt" DESC
    LIMIT 1
  ) assigned ON true
  LEFT JOIN LATERAL (
    SELECT p."id" AS "policyId"
    FROM "SlaPolicyConfig" p
    INNER JOIN "SlaPolicyConfigTarget" target
      ON target."policyConfigId" = p."id"
     AND target."priority" = si."priority"
    WHERE p."isDefault" = true
      AND p."enabled" = true
    ORDER BY p."updatedAt" DESC
    LIMIT 1
  ) fallback ON true
  WHERE si."policyConfigId" IS NULL
)
UPDATE "SlaInstance" si
SET "policyConfigId" = effective_policy."policyConfigId"
FROM effective_policy
WHERE si."id" = effective_policy."instanceId"
  AND effective_policy."policyConfigId" IS NOT NULL;
