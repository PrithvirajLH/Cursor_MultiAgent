-- Card 2.6 — the public API: issued keys and outbound webhooks.
--
-- Migration 65. HAND-WRITTEN, and deliberately so: `prisma migrate dev` emits
-- six `DROP INDEX` statements for the trigram GIN indexes it cannot model, plus
-- `ALTER COLUMN … DROP DEFAULT` lines, and applying them destroys ticket and KB
-- search performance against a stated sub-500ms requirement.
--
-- Everything below is additive. Zero DROP statements. Two new tables, one new
-- enum value, one foreign key.

-- ---------------------------------------------------------------------------
-- Webhook deliveries ride the existing NotificationOutbox rather than a second
-- table. Every query in outbox.service.ts already filters `channel = 'EMAIL'`,
-- so the mail sender cannot pick these rows up, and the retry/attempt/dead-state
-- behaviour card 1.32 built is reused instead of reimplemented.
--
-- Adding a value is additive and safe; it is not USED in this migration, which
-- matters because Postgres will not let a new enum value be used in the same
-- transaction that adds it.
-- ---------------------------------------------------------------------------
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'WEBHOOK';

-- ---------------------------------------------------------------------------
-- ApiKey: a machine credential that resolves to a real User, so every existing
-- access check applies unchanged. Only the hash is stored.
-- ---------------------------------------------------------------------------
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "serviceUserId" TEXT NOT NULL,
    "teamScope" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- The lookup on every authenticated machine request is by hash, so it must be
-- unique and indexed.
CREATE UNIQUE INDEX "ApiKey_hashedKey_key" ON "ApiKey"("hashedKey");

-- Listing live keys for the admin screen.
CREATE INDEX "ApiKey_revokedAt_idx" ON "ApiKey"("revokedAt");

ALTER TABLE "ApiKey"
    ADD CONSTRAINT "ApiKey_serviceUserId_fkey"
    FOREIGN KEY ("serviceUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- WebhookSubscription: where outbound events go. `secret` signs the payload.
-- ---------------------------------------------------------------------------
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookSubscription_isActive_idx" ON "WebhookSubscription"("isActive");
