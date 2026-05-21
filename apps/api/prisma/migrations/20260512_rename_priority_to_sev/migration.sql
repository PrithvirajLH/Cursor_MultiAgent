-- Rename TicketPriority enum values from P1-P4 to SEV1-SEV4.
-- Postgres ALTER TYPE ... RENAME VALUE atomically updates the enum
-- type AND every existing row that uses the old value, so no data
-- migration script is needed.

ALTER TYPE "TicketPriority" RENAME VALUE 'P1' TO 'SEV1';
ALTER TYPE "TicketPriority" RENAME VALUE 'P2' TO 'SEV2';
ALTER TYPE "TicketPriority" RENAME VALUE 'P3' TO 'SEV3';
ALTER TYPE "TicketPriority" RENAME VALUE 'P4' TO 'SEV4';
