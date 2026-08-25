-- Merge HR Operations into HR — DRY RUN. Reads only, changes nothing.
--
-- Run this first, against a restored copy of production if you can. Eyeball the
-- counts, then run merge-hr-teams.sql.
--
-- Use the DIRECT connection (port 5432), not the pooler (6543).
--   psql "$DIRECT_URL" -f scripts/merge-hr-teams-dryrun.sql

\echo '=== Teams ==='
SELECT slug, id, name, "isActive", left(coalesce(description, ''), 60) AS description
  FROM "Team"
 WHERE slug IN ('hr', 'hr-operations')
 ORDER BY slug;

\echo ''
\echo '=== Rows currently referencing hr-operations ==='
\echo 'These move to hr, EXCEPT the collisions listed in the next section,'
\echo 'which are dropped instead. Moved = this count minus that collision count.'
WITH src AS (SELECT id FROM "Team" WHERE slug = 'hr-operations'),
     dst AS (SELECT id FROM "Team" WHERE slug = 'hr')
SELECT 'Ticket.assignedTeamId'   AS reference, count(*) FROM "Ticket"              WHERE "assignedTeamId" = (SELECT id FROM src)
UNION ALL SELECT 'User.primaryTeamId',         count(*) FROM "User"                WHERE "primaryTeamId"  = (SELECT id FROM src)
UNION ALL SELECT 'TeamMember',                 count(*) FROM "TeamMember"          WHERE "teamId"         = (SELECT id FROM src)
UNION ALL SELECT 'TicketAccess',               count(*) FROM "TicketAccess"        WHERE "teamId"         = (SELECT id FROM src)
UNION ALL SELECT 'RoutingRule',                count(*) FROM "RoutingRule"         WHERE "teamId"         = (SELECT id FROM src)
UNION ALL SELECT 'SlaPolicyAssignment',        count(*) FROM "SlaPolicyAssignment" WHERE "teamId"         = (SELECT id FROM src)
UNION ALL SELECT 'SavedView',                  count(*) FROM "SavedView"           WHERE "teamId"         = (SELECT id FROM src)
UNION ALL SELECT 'CannedResponse',             count(*) FROM "CannedResponse"      WHERE "teamId"         = (SELECT id FROM src)
UNION ALL SELECT 'CustomField',                count(*) FROM "CustomField"         WHERE "teamId"         = (SELECT id FROM src)
UNION ALL SELECT 'AutomationRule',             count(*) FROM "AutomationRule"      WHERE "teamId"         = (SELECT id FROM src)
UNION ALL SELECT 'AdminAuditEvent',            count(*) FROM "AdminAuditEvent"     WHERE "teamId"         = (SELECT id FROM src)
ORDER BY 1;

\echo ''
\echo '=== Rows that would be DROPPED (a unique constraint means they cannot move) ==='
\echo 'These are cases where the equivalent hr row already says the same thing.'
WITH src AS (SELECT id FROM "Team" WHERE slug = 'hr-operations'),
     dst AS (SELECT id FROM "Team" WHERE slug = 'hr')
SELECT 'TeamMember (user already in hr)' AS collision, count(*)
  FROM "TeamMember" tm
 WHERE tm."teamId" = (SELECT id FROM src)
   AND EXISTS (SELECT 1 FROM "TeamMember" t2
                WHERE t2."teamId" = (SELECT id FROM dst) AND t2."userId" = tm."userId")
UNION ALL
SELECT 'TicketAccess (ticket already granted to hr)', count(*)
  FROM "TicketAccess" ta
 WHERE ta."teamId" = (SELECT id FROM src)
   AND EXISTS (SELECT 1 FROM "TicketAccess" t2
                WHERE t2."teamId" = (SELECT id FROM dst) AND t2."ticketId" = ta."ticketId")
UNION ALL
SELECT 'SlaPolicyAssignment (hr already has one)', count(*)
  FROM "SlaPolicyAssignment" sa
 WHERE sa."teamId" = (SELECT id FROM src)
   AND EXISTS (SELECT 1 FROM "SlaPolicyAssignment" s2 WHERE s2."teamId" = (SELECT id FROM dst))
ORDER BY 1;

\echo ''
\echo '=== Sanity: tickets currently unassigned (should not change) ==='
SELECT count(*) AS unassigned_tickets FROM "Ticket" WHERE "assignedTeamId" IS NULL;
