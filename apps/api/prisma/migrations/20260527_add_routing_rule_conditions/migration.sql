-- Expand RoutingRule with structured conditions/actions for the natural-language
-- rule builder. Defaults keep existing rows valid and the legacy keyword path working.
ALTER TABLE "RoutingRule"
  ADD COLUMN IF NOT EXISTS "matchType" TEXT NOT NULL DEFAULT 'ALL',
  ADD COLUMN IF NOT EXISTS "conditions" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "actions" JSONB NOT NULL DEFAULT '[]';
