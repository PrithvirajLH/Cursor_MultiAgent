-- Standardize ticket child FK delete behavior so ticket deletion is possible.
-- These relations were RESTRICT in some environments and blocked deletes.

ALTER TABLE "TicketMessage"
  DROP CONSTRAINT IF EXISTS "TicketMessage_ticketId_fkey";
ALTER TABLE "TicketMessage"
  ADD CONSTRAINT "TicketMessage_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketEvent"
  DROP CONSTRAINT IF EXISTS "TicketEvent_ticketId_fkey";
ALTER TABLE "TicketEvent"
  ADD CONSTRAINT "TicketEvent_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketAccess"
  DROP CONSTRAINT IF EXISTS "TicketAccess_ticketId_fkey";
ALTER TABLE "TicketAccess"
  ADD CONSTRAINT "TicketAccess_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketFollower"
  DROP CONSTRAINT IF EXISTS "TicketFollower_ticketId_fkey";
ALTER TABLE "TicketFollower"
  ADD CONSTRAINT "TicketFollower_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Attachment"
  DROP CONSTRAINT IF EXISTS "Attachment_ticketId_fkey";
ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
