-- Track inbound email webhook receipts for replay-safe deduplication.
CREATE TABLE "InboundEmailReceipt" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "ticketId" TEXT,
    "threaded" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundEmailReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundEmailReceipt_messageId_key"
    ON "InboundEmailReceipt"("messageId");

CREATE INDEX "InboundEmailReceipt_ticketId_idx"
    ON "InboundEmailReceipt"("ticketId");

CREATE INDEX "InboundEmailReceipt_createdAt_idx"
    ON "InboundEmailReceipt"("createdAt");

ALTER TABLE "InboundEmailReceipt"
ADD CONSTRAINT "InboundEmailReceipt_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
