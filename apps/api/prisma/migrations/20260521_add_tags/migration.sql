-- First-class tags: Tag + TicketTag tables, TagSource enum.
CREATE TYPE "TagSource" AS ENUM ('AI', 'MANUAL');

CREATE TABLE "Tag" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "color"       TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");
CREATE INDEX "Tag_name_idx" ON "Tag"("name");

CREATE TABLE "TicketTag" (
    "ticketId"    TEXT NOT NULL,
    "tagId"       TEXT NOT NULL,
    "source"      "TagSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "TicketTag_pkey" PRIMARY KEY ("ticketId", "tagId")
);

CREATE INDEX "TicketTag_tagId_idx" ON "TicketTag"("tagId");
CREATE INDEX "TicketTag_ticketId_idx" ON "TicketTag"("ticketId");

ALTER TABLE "TicketTag" ADD CONSTRAINT "TicketTag_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketTag" ADD CONSTRAINT "TicketTag_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
