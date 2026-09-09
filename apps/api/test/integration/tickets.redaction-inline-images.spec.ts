import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

/**
 * Card 1.48 — an image pasted into a message goes when the message goes.
 *
 * The leak: redaction overwrites `body`, so the `<img data-attachment-id>`
 * reference disappears — but the `Attachment` row and the blob behind it stay,
 * and stay reachable from the ticket's Attachments tab. The picture that should
 * not have been sent is still one click away, and the conversation no longer
 * shows any sign it was ever there.
 *
 * ⚠️ `Attachment` has NO `messageId`, only `ticketId` (schema.prisma:736-757),
 * so this cannot be done with a cascade — there is no relation to cascade
 * through. The ids are read out of the body HTML before it is overwritten.
 *
 * The blast radius is pinned here by tests, not by a comment: a file attached
 * to the TICKET is untouched, and a file another live message still references
 * is untouched.
 */
describe('Redaction and inline images (card 1.48)', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;

  let seq = 0;
  const unique = () => {
    seq += 1;
    return `${Date.now()}${seq}`;
  };

  async function plantTicket() {
    return prisma.ticket.create({
      data: {
        subject: `Inline image ${unique()}`,
        description: 'Fixture',
        requesterId: fixtureUserIds.requester,
        assignedTeamId: fixtureTeamIds.it,
        assigneeId: fixtureUserIds.agent,
        status: 'IN_PROGRESS',
      },
      select: { id: true },
    });
  }

  /** An attachment row, as an upload would leave it. */
  async function plantAttachment(ticketId: string, fileName: string) {
    return prisma.attachment.create({
      data: {
        ticketId,
        uploadedById: fixtureUserIds.lead,
        fileName,
        contentType: 'image/png',
        sizeBytes: 1234,
        storageKey: `fixtures/${unique()}-${fileName}`,
        scanStatus: 'CLEAN',
      },
      select: { id: true, storageKey: true },
    });
  }

  async function plantMessage(
    ticketId: string,
    body: string,
    type: 'PUBLIC' | 'INTERNAL' = 'INTERNAL',
  ) {
    return prisma.ticketMessage.create({
      data: { ticketId, authorId: fixtureUserIds.lead, type, body },
      select: { id: true },
    });
  }

  const redact = (ticketId: string, messageId: string) =>
    request(server)
      .delete(`/api/tickets/${ticketId}/messages/${messageId}`)
      .set(authHeader(fixtureEmails.lead));

  const attachmentIds = async (ticketId: string) =>
    (
      await prisma.attachment.findMany({
        where: { ticketId },
        select: { id: true },
      })
    ).map((row) => row.id);

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  it('⚠️ removes the image pasted into the redacted message', async () => {
    const ticket = await plantTicket();
    const inline = await plantAttachment(ticket.id, 'wrong-chart.png');
    const survivor = await plantAttachment(ticket.id, 'still-here.pdf');
    const message = await plantMessage(
      ticket.id,
      `<p>Here is the chart</p><img data-attachment-id="${inline.id}">`,
    );

    const res = await redact(ticket.id, message.id).expect(200);
    expect(res.body.inlineAttachmentsRemoved).toBe(1);

    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK: the row is gone, so the
    // Attachments tab cannot offer it.
    expect(await attachmentIds(ticket.id)).not.toContain(inline.id);

    // And the endpoint that serves the file agrees — but assert the REASON,
    // not just the status.
    //
    // ⚠️ A bare `.expect(404)` here is vacuous, and I only found that by
    // adding the control below: these fixtures write no blob, so a LIVE
    // attachment 404s too ("Attachment file missing", from
    // getAttachmentReadStream). Only the message separates "the row is gone"
    // from "the row is there and the file is not".
    const gone = await request(server)
      .get(`/api/attachments/${inline.id}`)
      .set(authHeader(fixtureEmails.lead))
      .expect(404);
    expect(gone.body.message).toBe('Attachment not found');

    const live = await request(server)
      .get(`/api/attachments/${survivor.id}`)
      .set(authHeader(fixtureEmails.lead));
    expect(live.body.message).not.toBe('Attachment not found');
  });

  it('⚠️ leaves a file attached to the TICKET completely alone', async () => {
    // The blast radius, pinned. Removing an arbitrary ticket file is a separate
    // action with its own permission question, not a side effect of redacting.
    const ticket = await plantTicket();
    const inline = await plantAttachment(ticket.id, 'pasted.png');
    const ticketFile = await plantAttachment(ticket.id, 'policy.pdf');
    const message = await plantMessage(
      ticket.id,
      `<img data-attachment-id="${inline.id}">`,
    );

    await redact(ticket.id, message.id).expect(200);

    const remaining = await attachmentIds(ticket.id);
    expect(remaining).toContain(ticketFile.id);
    expect(remaining).not.toContain(inline.id);
  });

  it('leaves an image another live message still shows', async () => {
    // An agent can copy the markup into a second message. Removing the first
    // must not break the second.
    const ticket = await plantTicket();
    const shared = await plantAttachment(ticket.id, 'shared.png');
    const first = await plantMessage(
      ticket.id,
      `<img data-attachment-id="${shared.id}">`,
    );
    await plantMessage(
      ticket.id,
      `<p>as above</p><img data-attachment-id="${shared.id}">`,
    );

    const res = await redact(ticket.id, first.id).expect(200);
    expect(res.body.inlineAttachmentsRemoved).toBe(0);
    expect(await attachmentIds(ticket.id)).toContain(shared.id);
  });

  it('⚠️ cannot be used to reach another ticket\'s file', async () => {
    // The ids come out of body HTML an agent typed. A forged one naming
    // somebody else's attachment must do nothing.
    const mine = await plantTicket();
    const theirs = await plantTicket();
    const theirFile = await plantAttachment(theirs.id, 'not-yours.png');
    const message = await plantMessage(
      mine.id,
      `<img data-attachment-id="${theirFile.id}">`,
    );

    const res = await redact(mine.id, message.id).expect(200);
    expect(res.body.inlineAttachmentsRemoved).toBe(0);
    expect(await attachmentIds(theirs.id)).toContain(theirFile.id);
  });

  it('records the count in the timeline', async () => {
    const ticket = await plantTicket();
    const inline = await plantAttachment(ticket.id, 'evidence.png');
    const message = await plantMessage(
      ticket.id,
      `<img data-attachment-id="${inline.id}">`,
    );
    await redact(ticket.id, message.id).expect(200);
    const event = await prisma.ticketEvent.findFirstOrThrow({
      where: { ticketId: ticket.id, type: 'TICKET_MESSAGE_REDACTED' },
      select: { payload: true },
    });
    expect(
      (event.payload as { inlineAttachmentsRemoved: number })
        .inlineAttachmentsRemoved,
    ).toBe(1);
  });

  it('behaves exactly as before for a message with no attachments', async () => {
    const ticket = await plantTicket();
    const ticketFile = await plantAttachment(ticket.id, 'unrelated.pdf');
    const message = await plantMessage(ticket.id, 'Just words, no images.');

    const res = await redact(ticket.id, message.id).expect(200);
    expect(res.body.inlineAttachmentsRemoved).toBe(0);
    expect(await attachmentIds(ticket.id)).toEqual([ticketFile.id]);
    const after = await prisma.ticketMessage.findUniqueOrThrow({
      where: { id: message.id },
      select: { body: true, redactedAt: true },
    });
    expect(after.body).toMatch(/^\[message removed by .+\]$/);
    expect(after.redactedAt).not.toBeNull();
  });

  it('ignores an image that never finished uploading', async () => {
    // RichTextEditor inserts `<img data-temp-id>` and only stamps the
    // attachment id when the upload resolves; there is nothing to remove.
    const ticket = await plantTicket();
    const message = await plantMessage(
      ticket.id,
      '<img data-temp-id="pending-upload">',
    );
    const res = await redact(ticket.id, message.id).expect(200);
    expect(res.body.inlineAttachmentsRemoved).toBe(0);
  });
});
