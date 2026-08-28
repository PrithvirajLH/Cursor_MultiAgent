-- Tickets created by an integration (Power Automate and friends) through
-- POST /api/tickets/intake — card 1.19. Additive: one new enum value.
-- HAND-WRITTEN — `prisma migrate diff` also emits the six trigram DROP INDEX and
-- DROP DEFAULT drift statements (repo-landmines.md, Prisma); omitted.
ALTER TYPE "TicketChannel" ADD VALUE 'API';
