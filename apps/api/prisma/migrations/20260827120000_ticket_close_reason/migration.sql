-- Why a closed ticket closed: requester confirmed / requester cancelled /
-- agent closed / auto-closed (card 1.2). Additive; no status enum change.
-- Set whenever a ticket enters CLOSED, cleared on REOPENED.
--
-- HAND-WRITTEN — `prisma migrate diff` also emits the six trigram DROP INDEX
-- and several ALTER COLUMN ... DROP DEFAULT drift statements
-- (docs/agent-context/repo-landmines.md, "Prisma"); they are omitted.
CREATE TYPE "TicketCloseReason" AS ENUM ('REQUESTER_CONFIRMED', 'REQUESTER_CANCELLED', 'AGENT_CLOSED', 'AUTO_CLOSED');
ALTER TABLE "Ticket" ADD COLUMN "closeReason" "TicketCloseReason";
