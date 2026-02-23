-- Improve `%contains%` search performance for ticket subject/description/displayId filters.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Ticket_subject_trgm_idx"
  ON "Ticket" USING GIN ("subject" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Ticket_description_trgm_idx"
  ON "Ticket" USING GIN ("description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Ticket_displayId_trgm_idx"
  ON "Ticket" USING GIN ("displayId" gin_trgm_ops);
