-- Retire legacy SlaInstance -> SlaPolicy linkage.
-- Runtime SLA policy now resolves through SlaPolicyConfig via policyConfigId.

ALTER TABLE "SlaInstance"
  DROP CONSTRAINT IF EXISTS "SlaInstance_policyId_fkey";

DROP INDEX IF EXISTS "SlaInstance_policyId_idx";

ALTER TABLE "SlaInstance"
  DROP COLUMN IF EXISTS "policyId";
