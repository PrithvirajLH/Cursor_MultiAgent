-- Create enum for idempotency record lifecycle.
CREATE TYPE "IdempotencyState" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- Persist idempotency key outcomes for safe retries on mutating APIs.
CREATE TABLE "IdempotencyRequest" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "state" "IdempotencyState" NOT NULL DEFAULT 'IN_PROGRESS',
    "statusCode" INTEGER,
    "responseBody" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotencyRequest_key_method_route_actorId_key"
    ON "IdempotencyRequest"("key", "method", "route", "actorId");

CREATE INDEX "IdempotencyRequest_expiresAt_idx"
    ON "IdempotencyRequest"("expiresAt");

CREATE INDEX "IdempotencyRequest_state_updatedAt_idx"
    ON "IdempotencyRequest"("state", "updatedAt");
