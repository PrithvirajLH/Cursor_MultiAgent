-- Add performance indexes for common filters and ordered relations
CREATE INDEX "Ticket_status_updatedAt_idx" ON "Ticket"("status", "updatedAt");
CREATE INDEX "Ticket_assignedTeamId_status_updatedAt_idx" ON "Ticket"("assignedTeamId", "status", "updatedAt");
CREATE INDEX "Ticket_assigneeId_status_updatedAt_idx" ON "Ticket"("assigneeId", "status", "updatedAt");
CREATE INDEX "Ticket_requesterId_createdAt_idx" ON "Ticket"("requesterId", "createdAt");
CREATE INDEX "Ticket_dueAt_idx" ON "Ticket"("dueAt");
CREATE INDEX "Ticket_completedAt_idx" ON "Ticket"("completedAt");

CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent"("ticketId", "createdAt");
CREATE INDEX "Attachment_ticketId_createdAt_idx" ON "Attachment"("ticketId", "createdAt");
