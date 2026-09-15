-- Card 1.83 — a file pasted into an internal note is not for the requester.
--
-- Migration 67. HAND-WRITTEN: `prisma migrate dev` emits six `DROP INDEX`
-- statements for the trigram GIN indexes it cannot model, and applying them
-- destroys ticket and KB search against a stated sub-500ms requirement.
--
-- Additive. Zero DROP statements. One nullable column, one index, one FK.

-- ---------------------------------------------------------------------------
-- `Attachment` linked only to `ticketId`, so an image pasted into an INTERNAL
-- note was indistinguishable from a file attached to the ticket itself - and
-- the requester was shown both, with filename, size and uploader.
--
-- ⚠️ NULLABLE IS CORRECT, NOT A COMPROMISE. Every existing row has no message,
-- and a file attached to the TICKET rather than pasted into a message
-- legitimately has none for ever. NOT NULL would need a backfill that invents
-- an answer, and the honest answer for those rows is "unknown".
--
-- ⚠️ A NULL messageId therefore means VISIBLE. Every attachment that exists
-- today keeps behaving exactly as it does now; only files linked to an internal
-- message become restricted.
-- ---------------------------------------------------------------------------
ALTER TABLE "Attachment" ADD COLUMN "messageId" TEXT;

-- The listing and the download both filter on it per ticket.
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");

-- ⚠️ ON DELETE SET NULL, deliberately. A redacted or deleted message must not
-- take the file row with it: card 1.47 needs the attachment to survive so the
-- blob can be removed on its own terms, and cascading here would delete the
-- evidence a redaction is supposed to manage.
ALTER TABLE "Attachment"
    ADD CONSTRAINT "Attachment_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "TicketMessage"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
