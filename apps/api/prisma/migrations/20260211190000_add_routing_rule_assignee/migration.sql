-- Add optional assignee target for routing rules.
ALTER TABLE "RoutingRule"
ADD COLUMN "assigneeId" TEXT;

ALTER TABLE "RoutingRule"
ADD CONSTRAINT "RoutingRule_assigneeId_fkey"
FOREIGN KEY ("assigneeId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "RoutingRule_assigneeId_idx" ON "RoutingRule"("assigneeId");
