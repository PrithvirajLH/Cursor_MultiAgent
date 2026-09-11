-- Card 1.60 — one default saved view per user PER KIND.
--
-- Making a report view your default silently cleared your default ticket view,
-- and vice versa. Card 1.53's implementer tried to scope the clear per kind and
-- could not: the database enforces the same rule one level down, so the second
-- default violated a unique index and the request 500'd. They backed it out and
-- reported it, which was right. This migration moves the invariant.
--
-- ⚠️ WRITTEN BY HAND. `prisma migrate diff` additionally emits twelve standing
-- destructive statements that are drift, never part of any change, and are NOT
-- included here: six `DROP INDEX` for the trigram GIN indexes
-- (KbArticle_*_trgm_idx, Ticket_*_trgm_idx), which Prisma cannot model and
-- whose loss destroys ticket and KB search against a stated sub-500ms
-- requirement, and six `ALTER COLUMN ... DROP DEFAULT`.
--
-- ⚠️ IT DOES CONTAIN ONE `DROP INDEX`, AND THAT ONE IS THE POINT. Every other
-- handoff in this repo says hand-check a migration to zero DROPs; this is the
-- exception. Stripping statement 4 would leave the old one-default-per-user
-- invariant in place, and the fix would do nothing while testing green on
-- everything except the single case it exists for.

-- 1. The discriminator becomes a real column. NOT NULL with a default so every
--    existing row is valid the moment it is added and no window exists where a
--    row has no kind.
ALTER TABLE "SavedView"
  ADD COLUMN "viewType" TEXT NOT NULL DEFAULT 'tickets';

-- 2. Backfill from the JSON key this replaces. Only report views ever carried
--    it; ticket views have no such key, which is exactly why an expression
--    index on `filters->>'viewType'` could not have worked - it is NULL for
--    every ticket view, and a unique index treats NULLs as distinct.
UPDATE "SavedView"
  SET "viewType" = 'reports'
  WHERE "filters" ->> 'viewType' = 'reports';

-- 3. ⚠️ REMOVE THE KEY FROM THE JSON. This is the half that must not be
--    skipped. Leaving it would create a second source of truth for the same
--    discriminator - the drift behind cards 1.36, 1.38, 1.47 and 1.50, and the
--    objection card 1.53's implementer raised at saved-views.service.ts:210.
--    Half of this change is worse than none: the bug stays and gains company.
UPDATE "SavedView"
  SET "filters" = "filters" - 'viewType'
  WHERE "filters" ? 'viewType';

-- 4. ⚠️ THE LEGITIMATE DROP. From 20260213140000_schema_hardening:41-43, which
--    predates the reports/tickets split and so makes ONE DEFAULT PER USER a
--    database invariant. That is what turns a per-kind clear into
--    `Unique constraint failed on the fields: (userId)`.
DROP INDEX "SavedView_default_per_user";

-- 5. The same guarantee, scoped to the kind. Partial, and therefore not
--    expressible in schema.prisma - exactly like the index it replaces, which
--    is why neither appears there and both live in SQL.
CREATE UNIQUE INDEX "SavedView_default_per_user"
  ON "SavedView" ("userId", "viewType")
  WHERE "isDefault" = true AND "userId" IS NOT NULL;

-- NOT TOUCHED, deliberately: "SavedView_default_per_team". Card 1.53 decided
-- team views cannot be default, so that index is currently unreachable rather
-- than wrong. Dropping it would remove a guard for a feature somebody may still
-- want, and this card was not asked to decide that.
