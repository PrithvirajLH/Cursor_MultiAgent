-- AI observability tables + per-department AI confidence configuration.
--
-- HAND-EDITED. `prisma migrate dev` additionally emitted six DROP INDEX
-- statements and several ALTER COLUMN ... DROP DEFAULT statements that are
-- NOT part of this change. They were removed.
--
-- The dropped indexes were the trigram GIN indexes created by
-- 20260220150000_add_ticket_search_trigram_indexes and 20260528_add_knowledge_base.
-- Prisma cannot express `USING GIN (col gin_trgm_ops)` in schema.prisma, so it
-- sees them as drift and tries to remove them on every migrate dev. Applying
-- that would silently destroy ticket and KB search performance (the <500ms
-- search NFR). Strip them from every future generated migration too.

-- CreateEnum
CREATE TYPE "AiStepStatus" AS ENUM ('SUCCESS', 'ERROR');

-- CreateEnum
CREATE TYPE "AiRoutingMethod" AS ENUM ('AI', 'RULE', 'MANUAL');

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "confidenceThreshold" DOUBLE PRECISION,
ADD COLUMN     "isSensitive" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AiInferenceLog" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "ticketId" TEXT,
    "step" INTEGER NOT NULL,
    "agentName" TEXT NOT NULL,
    "model" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "status" "AiStepStatus" NOT NULL,
    "rawOutput" TEXT,
    "parsed" JSONB,
    "error" TEXT,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInferenceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingDecisionLog" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "ticketId" TEXT,
    "predictedTeamId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "thresholdUsed" DOUBLE PRECISION NOT NULL,
    "method" "AiRoutingMethod" NOT NULL,
    "matchedRuleId" TEXT,
    "alternatives" JSONB,
    "accepted" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingDecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionLog" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "correctedById" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiInferenceLog_createdAt_idx" ON "AiInferenceLog"("createdAt");

-- CreateIndex
CREATE INDEX "AiInferenceLog_correlationId_idx" ON "AiInferenceLog"("correlationId");

-- CreateIndex
CREATE INDEX "AiInferenceLog_ticketId_idx" ON "AiInferenceLog"("ticketId");

-- CreateIndex
CREATE INDEX "RoutingDecisionLog_createdAt_idx" ON "RoutingDecisionLog"("createdAt");

-- CreateIndex
CREATE INDEX "RoutingDecisionLog_predictedTeamId_createdAt_idx" ON "RoutingDecisionLog"("predictedTeamId", "createdAt");

-- CreateIndex
CREATE INDEX "RoutingDecisionLog_ticketId_idx" ON "RoutingDecisionLog"("ticketId");

-- CreateIndex
CREATE INDEX "CorrectionLog_ticketId_idx" ON "CorrectionLog"("ticketId");

-- CreateIndex
CREATE INDEX "CorrectionLog_field_createdAt_idx" ON "CorrectionLog"("field", "createdAt");
