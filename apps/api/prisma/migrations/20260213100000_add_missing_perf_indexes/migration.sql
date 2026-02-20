-- Add missing performance indexes for common query patterns

-- Ticket: categoryId filtering, priority filtering, createdAt sorting, firstResponseDueAt SLA queries
CREATE INDEX IF NOT EXISTS "Ticket_categoryId_idx" ON "Ticket"("categoryId");
CREATE INDEX IF NOT EXISTS "Ticket_priority_idx" ON "Ticket"("priority");
CREATE INDEX IF NOT EXISTS "Ticket_createdAt_idx" ON "Ticket"("createdAt");
CREATE INDEX IF NOT EXISTS "Ticket_firstResponseDueAt_idx" ON "Ticket"("firstResponseDueAt");

-- TicketMessage: authorId for "messages by user" queries
CREATE INDEX IF NOT EXISTS "TicketMessage_authorId_idx" ON "TicketMessage"("authorId");

-- TicketEvent: type filtering, createdById lookup
CREATE INDEX IF NOT EXISTS "TicketEvent_type_idx" ON "TicketEvent"("type");
CREATE INDEX IF NOT EXISTS "TicketEvent_createdById_idx" ON "TicketEvent"("createdById");

-- SlaInstance: policyId lookup, resolutionDueAt for breach detection
CREATE INDEX IF NOT EXISTS "SlaInstance_policyId_idx" ON "SlaInstance"("policyId");
CREATE INDEX IF NOT EXISTS "SlaInstance_resolutionDueAt_idx" ON "SlaInstance"("resolutionDueAt");

-- AutomationExecution: executedAt for time-based queries
CREATE INDEX IF NOT EXISTS "AutomationExecution_executedAt_idx" ON "AutomationExecution"("executedAt");
