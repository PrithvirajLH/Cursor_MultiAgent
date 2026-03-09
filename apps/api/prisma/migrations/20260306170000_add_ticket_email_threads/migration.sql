CREATE TABLE "TicketEmailThread" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "replyToken" VARCHAR(128) NOT NULL,
    "canonicalSubject" VARCHAR(200) NOT NULL,
    "rootInboundMessageId" VARCHAR(255),
    "lastInboundMessageId" VARCHAR(255),
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundMessageId" VARCHAR(255),
    "lastOutboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEmailThread_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TicketEmailThread_ticketId_key" ON "TicketEmailThread"("ticketId");
CREATE UNIQUE INDEX "TicketEmailThread_replyToken_key" ON "TicketEmailThread"("replyToken");
CREATE INDEX "TicketEmailThread_replyToken_idx" ON "TicketEmailThread"("replyToken");
CREATE INDEX "TicketEmailThread_lastInboundAt_idx" ON "TicketEmailThread"("lastInboundAt");
CREATE INDEX "TicketEmailThread_lastOutboundAt_idx" ON "TicketEmailThread"("lastOutboundAt");

ALTER TABLE "TicketEmailThread"
ADD CONSTRAINT "TicketEmailThread_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
