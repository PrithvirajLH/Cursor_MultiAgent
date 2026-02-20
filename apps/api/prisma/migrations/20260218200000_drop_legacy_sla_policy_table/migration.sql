-- Remove legacy runtime SLA table. Runtime SLA now uses:
-- SlaPolicyConfig + SlaPolicyConfigTarget + SlaPolicyAssignment.
DROP TABLE IF EXISTS "SlaPolicy";
