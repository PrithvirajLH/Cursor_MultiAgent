-- AlterTable
ALTER TABLE "AutomationExecution" ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'STATUS_CHANGED';

-- CreateIndex
CREATE INDEX "AutomationExecution_ruleId_ticketId_trigger_idx" ON "AutomationExecution"("ruleId", "ticketId", "trigger");
