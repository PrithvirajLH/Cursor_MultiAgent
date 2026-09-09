-- Merge HR Operations into HR.
--
-- Run merge-hr-teams-dryrun.sql FIRST and check the counts.
-- Take a backup before running this against production.
--
-- Use the DIRECT connection (port 5432), not the pooler (6543): this is one
-- multi-statement transaction, and pgBouncer in transaction mode is unreliable
-- for that.
--   psql "$DIRECT_URL" -f scripts/merge-hr-teams.sql
--
-- Safe to run twice: a second run finds nothing left to move and no-ops.
--
-- The old team is DEACTIVATED, never deleted. Ticket.assignedTeam is an
-- optional relation with no explicit onDelete, so Prisma defaults to SetNull —
-- deleting the team would silently unassign every ticket that referenced it,
-- with no error. This schema has no soft delete, so that loss is unrecoverable.

BEGIN;

DO $$
DECLARE
  src   text;
  dst   text;
  src_description text;
  moved integer;
  dropped integer;
  leftover integer;
BEGIN
  SELECT id, description INTO src, src_description FROM "Team" WHERE slug = 'hr-operations';
  SELECT id INTO dst FROM "Team" WHERE slug = 'hr';

  IF src IS NULL THEN
    RAISE NOTICE 'No team with slug hr-operations. Nothing to do.';
    RETURN;
  END IF;
  IF dst IS NULL THEN
    RAISE EXCEPTION 'Target team with slug "hr" not found. Aborting rather than orphaning % rows.', src;
  END IF;
  IF src = dst THEN
    RAISE EXCEPTION 'Source and target resolve to the same team (%). Aborting.', src;
  END IF;

  RAISE NOTICE 'Merging % (hr-operations) into % (hr)', src, dst;

  -- ── Collisions first ──────────────────────────────────────────────────
  -- These rows cannot move because a unique constraint already holds the
  -- equivalent fact on the target team. Dropping them loses nothing.

  DELETE FROM "TeamMember" tm
   WHERE tm."teamId" = src
     AND EXISTS (SELECT 1 FROM "TeamMember" t2
                  WHERE t2."teamId" = dst AND t2."userId" = tm."userId");
  GET DIAGNOSTICS dropped = ROW_COUNT;
  RAISE NOTICE '  dropped % TeamMember rows (user already in hr)', dropped;

  DELETE FROM "TicketAccess" ta
   WHERE ta."teamId" = src
     AND EXISTS (SELECT 1 FROM "TicketAccess" t2
                  WHERE t2."teamId" = dst AND t2."ticketId" = ta."ticketId");
  GET DIAGNOSTICS dropped = ROW_COUNT;
  RAISE NOTICE '  dropped % TicketAccess rows (ticket already granted to hr)', dropped;

  -- teamId alone is unique here, so if hr already has an assignment the
  -- hr-operations one cannot move.
  DELETE FROM "SlaPolicyAssignment" sa
   WHERE sa."teamId" = src
     AND EXISTS (SELECT 1 FROM "SlaPolicyAssignment" s2 WHERE s2."teamId" = dst);
  GET DIAGNOSTICS dropped = ROW_COUNT;
  RAISE NOTICE '  dropped % SlaPolicyAssignment rows (hr already has one)', dropped;

  -- **ADDED 2026-09-09 (card 0.10).** SlaBusinessHoursSetting references Team
  -- and was handled NOWHERE in this script - not moved, and not counted by the
  -- verification block below, so a merge would have reported "0 references
  -- remain" while hr-operations' business hours still pointed at it. One row
  -- per team, so hr's own setting wins and the source's is dropped.
  DELETE FROM "SlaBusinessHoursSetting" bh
   WHERE bh."teamId" = src
     AND EXISTS (SELECT 1 FROM "SlaBusinessHoursSetting" b2 WHERE b2."teamId" = dst);
  GET DIAGNOSTICS dropped = ROW_COUNT;
  RAISE NOTICE '  dropped % SlaBusinessHoursSetting rows (hr already has one)', dropped;

  -- ── Move the survivors ────────────────────────────────────────────────

  UPDATE "Ticket" SET "assignedTeamId" = dst WHERE "assignedTeamId" = src;
  GET DIAGNOSTICS moved = ROW_COUNT;  RAISE NOTICE '  moved % Ticket', moved;

  UPDATE "User" SET "primaryTeamId" = dst WHERE "primaryTeamId" = src;
  GET DIAGNOSTICS moved = ROW_COUNT;  RAISE NOTICE '  moved % User.primaryTeamId', moved;

  UPDATE "TeamMember" SET "teamId" = dst WHERE "teamId" = src;
  GET DIAGNOSTICS moved = ROW_COUNT;  RAISE NOTICE '  moved % TeamMember', moved;

  UPDATE "TicketAccess" SET "teamId" = dst WHERE "teamId" = src;
  GET DIAGNOSTICS moved = ROW_COUNT;  RAISE NOTICE '  moved % TicketAccess', moved;

  UPDATE "RoutingRule" SET "teamId" = dst WHERE "teamId" = src;
  GET DIAGNOSTICS moved = ROW_COUNT;  RAISE NOTICE '  moved % RoutingRule', moved;

  UPDATE "SlaPolicyAssignment" SET "teamId" = dst WHERE "teamId" = src;
  GET DIAGNOSTICS moved = ROW_COUNT;  RAISE NOTICE '  moved % SlaPolicyAssignment', moved;

  UPDATE "SavedView" SET "teamId" = dst WHERE "teamId" = src;
  GET DIAGNOSTICS moved = ROW_COUNT;  RAISE NOTICE '  moved % SavedView', moved;

  UPDATE "CannedResponse" SET "teamId" = dst WHERE "teamId" = src;
  GET DIAGNOSTICS moved = ROW_COUNT;  RAISE NOTICE '  moved % CannedResponse', moved;

  UPDATE "CustomField" SET "teamId" = dst WHERE "teamId" = src;
  GET DIAGNOSTICS moved = ROW_COUNT;  RAISE NOTICE '  moved % CustomField', moved;

  UPDATE "AutomationRule" SET "teamId" = dst WHERE "teamId" = src;
  GET DIAGNOSTICS moved = ROW_COUNT;  RAISE NOTICE '  moved % AutomationRule', moved;

  UPDATE "SlaBusinessHoursSetting" SET "teamId" = dst WHERE "teamId" = src;
  GET DIAGNOSTICS moved = ROW_COUNT;  RAISE NOTICE '  moved % SlaBusinessHoursSetting', moved;

  -- Audit history keeps pointing at the team it was recorded against, but the
  -- team must still exist for the FK. Repointing keeps the row readable.
  UPDATE "AdminAuditEvent" SET "teamId" = dst WHERE "teamId" = src;
  GET DIAGNOSTICS moved = ROW_COUNT;  RAISE NOTICE '  moved % AdminAuditEvent', moved;

  -- ── Description and deactivation ──────────────────────────────────────
  -- The AI classifier reads Team.description via get_departments, so a vague
  -- description is what made these two indistinguishable in the first place.
  -- Only fill it if hr has nothing better already.
  UPDATE "Team"
     SET description = src_description
   WHERE id = dst
     AND src_description IS NOT NULL
     AND (description IS NULL OR length(description) < length(src_description));

  -- **ADDED 2026-09-09 (card 0.10)**, because card 1.53 added the column in
  -- the same batch. `Team.hiddenPresetIds` is which built-in sidebar presets a
  -- team switched off. Two merging teams have two lists; the merged team can
  -- only have one.
  --
  -- THE SURVIVING TEAM'S LIST WINS and the source's is discarded. Unioning
  -- would hide presets from the merged team that neither admin chose to lose,
  -- and hiding something people rely on is worse than showing something they
  -- had turned off - they can turn it off again in one click. The discarded
  -- list is ANNOUNCED rather than dropped silently, so whoever runs this can
  -- put it back if it mattered.
  --
  -- Note this team is deactivated, not deleted, so the row and its list
  -- survive; nothing points at it once the moves above are done.
  SELECT array_length("hiddenPresetIds", 1) INTO leftover FROM "Team" WHERE id = src;
  IF coalesce(leftover, 0) > 0 THEN
    RAISE NOTICE '  NOTE: hr-operations hid % sidebar preset(s); hr keeps its own list. Discarded: %',
      leftover, (SELECT "hiddenPresetIds" FROM "Team" WHERE id = src);
  END IF;

  UPDATE "Team" SET "isActive" = false WHERE id = src;

  -- ── Verify before committing ──────────────────────────────────────────
  SELECT
    (SELECT count(*) FROM "Ticket"              WHERE "assignedTeamId" = src)
  + (SELECT count(*) FROM "User"                WHERE "primaryTeamId"  = src)
  + (SELECT count(*) FROM "TeamMember"          WHERE "teamId"         = src)
  + (SELECT count(*) FROM "TicketAccess"        WHERE "teamId"         = src)
  + (SELECT count(*) FROM "RoutingRule"         WHERE "teamId"         = src)
  + (SELECT count(*) FROM "SlaPolicyAssignment" WHERE "teamId"         = src)
  + (SELECT count(*) FROM "SavedView"           WHERE "teamId"         = src)
  + (SELECT count(*) FROM "CannedResponse"      WHERE "teamId"         = src)
  + (SELECT count(*) FROM "CustomField"         WHERE "teamId"         = src)
  + (SELECT count(*) FROM "AutomationRule"      WHERE "teamId"         = src)
  + (SELECT count(*) FROM "AdminAuditEvent"     WHERE "teamId"         = src)
  + (SELECT count(*) FROM "SlaBusinessHoursSetting" WHERE "teamId"     = src)
  INTO leftover;

  IF leftover <> 0 THEN
    RAISE EXCEPTION 'Merge incomplete: % rows still reference hr-operations. Rolling back.', leftover;
  END IF;

  RAISE NOTICE 'Merge complete. hr-operations deactivated, 0 references remain.';
END $$;

COMMIT;

\echo ''
\echo '=== Result ==='
SELECT slug, "isActive", left(coalesce(description, ''), 70) AS description
  FROM "Team" WHERE slug IN ('hr', 'hr-operations') ORDER BY slug;
