-- Card 2.1: a third assignment strategy, picking the member with the fewest
-- open tickets instead of the next one in rotation.
--
-- This file adds the enum value and NOTHING ELSE, on purpose. Postgres allows
-- ALTER TYPE ... ADD VALUE inside a transaction from 12 onwards (production is
-- 16.14, the local cluster 16.15) but the new value cannot be USED in the same
-- transaction that adds it - so an UPDATE setting a team to LEAST_LOADED here
-- would fail at deploy time. Setting a team to the new strategy is a UI action.
ALTER TYPE "TeamAssignmentStrategy" ADD VALUE 'LEAST_LOADED';
