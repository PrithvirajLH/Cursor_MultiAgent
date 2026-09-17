import { INestApplication } from '@nestjs/common';
import { MessageType } from '@prisma/client';
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
 * Card 1.83 — a file pasted into an internal note is not for the requester.
 *
 * `Attachment` linked only to `ticketId`, so a screenshot pasted into an
 * INTERNAL note was listed to the requester with its filename, size and
 * uploader, and downloadable by them. The audit confirmed that at runtime.
 *
 * ⚠️ THIS IS WHAT HAS TO BE TRUE BEFORE `ATTACHMENT_SCAN_ENABLED=false`. Right
 * now the blocked download is the only thing hiding this bug; turning the gate
 * off with it unfixed makes an agent's private screenshot downloadable by the
 * person it is about.
 *
 * ⚠️ ASSERTED ON THE SERIALISED LISTING, not on a field. Twice this month a
 * field-level assertion passed while the data still went out — card 1.96's
 * follower route and card 1.91's AI canary.
 */
describe('internal-note attachments are not for the requester (card 1.83)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let ticketId: string;
  let internalFileId: string;
  let publicFileId: string;
  let legacyFileId: string;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;

    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: 'card 1.83 fixture',
        description: 'internal note attachment visibility',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    ticketId = (created.body as { id: string }).id;

    // ⚠️ ASSIGN IT TO THE AGENT FIRST, OR THEIR "PUBLIC" REPLY IS NOT PUBLIC.
    // `addMessage` silently coerces a PEER agent - same team, not the assignee -
    // to INTERNAL. The first version of this fixture skipped the assign, so the
    // supposedly-public message was internal and its file correctly vanished
    // from the requester's view. The test was wrong, not the code.
    await request(server)
      .post(`/api/tickets/${ticketId}/assign`)
      .set(authHeader(fixtureEmails.owner))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);

    // Three files on one ticket, covering the three cases that must differ.
    const upload = async (fileName: string, content: string) => {
      const res = await request(server)
        .post(`/api/tickets/${ticketId}/attachments`)
        .set(authHeader(fixtureEmails.agent))
        .attach('file', Buffer.from(content), fileName)
        .expect(201);
      const body = res.body as { id?: string; data?: { id: string } };
      return body.id ?? (body.data as { id: string }).id;
    };
    internalFileId = await upload('private-screenshot.txt', 'internal only');
    publicFileId = await upload('shared-with-requester.txt', 'public');
    legacyFileId = await upload('uploaded-before-this-card.txt', 'legacy');

    // An INTERNAL note carrying the first file, the way the editor does it.
    await request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({
        body: `A private note <img data-attachment-id="${internalFileId}">`,
        type: 'INTERNAL',
      })
      .expect(201);

    // A PUBLIC reply carrying the second.
    await request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({
        body: `Here you go <img data-attachment-id="${publicFileId}">`,
        type: 'PUBLIC',
      })
      .expect(201);
    // The third is never referenced, so it keeps a null messageId — which is
    // every attachment that existed before this migration.

    // ⚠️ MARK THEM CLEAN, AND THIS IS THE POINT OF THE WHOLE BATCH.
    // setup-tests.ts pins ATTACHMENT_SCAN_ENABLED='true', so a PENDING file is
    // refused by the AV gate before card 1.83's rule is ever consulted - which
    // means an untouched fixture "passes" the refusal test for entirely the
    // wrong reason. The owner is about to turn that gate OFF, and this batch
    // exists to be correct when they do. Marking the rows CLEAN tests the world
    // after the flag, which is the only world worth asserting about here.
    await getPrisma().attachment.updateMany({
      where: { ticketId },
      data: { scanStatus: 'CLEAN', scanCheckedAt: new Date() },
    });
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  const ticketAs = async (email: string) => {
    const res = await request(server)
      .get(`/api/tickets/${ticketId}`)
      .set(authHeader(email))
      .expect(200);
    return res.body as Record<string, unknown>;
  };

  it('⚠️ the requester is not shown the internal-note file at all', async () => {
    // THE REGRESSION ASSERTION, on the whole serialised document — the filename
    // must not appear anywhere in it, not merely be absent from one array.
    const body = await ticketAs(fixtureEmails.requester);
    expect(JSON.stringify(body)).not.toContain('private-screenshot.txt');
    expect(JSON.stringify(body)).not.toContain(internalFileId);
  });

  it('⚠️ and cannot download it either', async () => {
    // Hiding it from the listing is not enough on its own: the id is guessable
    // out of a message body, and this route was the only thing in the way.
    await request(server)
      .get(`/api/attachments/${internalFileId}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(403);
  });

  it('⚠️ another agent CAN still see and download it', async () => {
    // The non-vacuity half. A fix that hides the file from everybody passes
    // both assertions above and breaks internal notes.
    const body = await ticketAs(fixtureEmails.owner);
    expect(JSON.stringify(body)).toContain('private-screenshot.txt');
    await request(server)
      .get(`/api/attachments/${internalFileId}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
  });

  it('a file on a PUBLIC message is still the requester’s to see', async () => {
    const body = await ticketAs(fixtureEmails.requester);
    expect(JSON.stringify(body)).toContain('shared-with-requester.txt');
    await request(server)
      .get(`/api/attachments/${publicFileId}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(200);
  });

  it('⚠️ an attachment with no message is still visible — nothing existing disappears', async () => {
    // Every attachment uploaded before this migration has a null messageId. A
    // change that silently hides all of them is worse than the bug it fixes.
    const body = await ticketAs(fixtureEmails.requester);
    expect(JSON.stringify(body)).toContain('uploaded-before-this-card.txt');
    await request(server)
      .get(`/api/attachments/${legacyFileId}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(200);
  });

  it('the link is recorded on the row, so redaction finally has a relation', async () => {
    // Card 1.48 had to read attachment ids back out of the message body because
    // no relation existed. It does now.
    const rows = await getPrisma().attachment.findMany({
      where: { ticketId },
      select: { id: true, messageId: true, message: { select: { type: true } } },
    });
    const internal = rows.find((row) => row.id === internalFileId);
    const legacy = rows.find((row) => row.id === legacyFileId);
    expect(internal?.messageId).toBeTruthy();
    expect(internal?.message?.type).toBe(MessageType.INTERNAL);
    expect(legacy?.messageId).toBeNull();
  });

  it('⚠️ the rule is the requester’s, not a rank: an agent who raised the ticket is excluded too', async () => {
    // Relationship beats rank. Payroll is the only department operationally
    // taking tickets, so a lead with a problem about her own pay files it in
    // her own queue - and must not read the internal notes on it.
    const ownTicket = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.agent))
      .send({
        subject: 'agent raised this themselves',
        description: 'x',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    const ownId = (ownTicket.body as { id: string }).id;

    const res = await request(server)
      .post(`/api/tickets/${ownId}/attachments`)
      .set(authHeader(fixtureEmails.owner))
      .attach('file', Buffer.from('note about the reporter'), 'about-them.txt')
      .expect(201);
    const body = res.body as { id?: string; data?: { id: string } };
    const fileId = body.id ?? (body.data as { id: string }).id;

    await request(server)
      .post(`/api/tickets/${ownId}/messages`)
      .set(authHeader(fixtureEmails.owner))
      .send({
        body: `internal <img data-attachment-id="${fileId}">`,
        type: 'INTERNAL',
      })
      .expect(201);

    await getPrisma().attachment.updateMany({
      where: { ticketId: ownId },
      data: { scanStatus: 'CLEAN', scanCheckedAt: new Date() },
    });

    // The agent is staff, but they are the requester here.
    const seen = await request(server)
      .get(`/api/tickets/${ownId}`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
    expect(JSON.stringify(seen.body)).not.toContain('about-them.txt');
    expect(fixtureUserIds.agent).toBeTruthy();
  });

  /**
   * Card 1.129 fault A, on the fixture card 1.83 already built.
   *
   * The owner asked how an agent is supposed to know a reply carried a file.
   * Until now `listMessages` returned `include: { author: true }` and nothing
   * else, so the answer was the Attachments tab counter changing - which says
   * something arrived, not what, and not on which message.
   */
  const messagesAs = async (email: string) => {
    const res = await request(server)
      .get(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(email))
      .expect(200);
    return res.body as {
      data: {
        id: string;
        type: string;
        attachments?: { id: string; fileName: string; sizeBytes: number }[];
      }[];
    };
  };

  it('names the file on the message it arrived on (card 1.129)', async () => {
    const body = await messagesAs(fixtureEmails.agent);
    const publicMessage = body.data.find(
      (message) => message.type === MessageType.PUBLIC,
    );
    expect(publicMessage?.attachments).toEqual([
      expect.objectContaining({
        id: publicFileId,
        fileName: 'shared-with-requester.txt',
      }),
    ]);
    // The legacy file belongs to no message and must not be attributed to one.
    expect(JSON.stringify(body)).not.toContain('uploaded-before-this-card.txt');
    // ⚠️ `storageKey` names the blob and has no business in a message payload.
    expect(JSON.stringify(body)).not.toContain('storageKey');
  });

  it('⚠️ the requester’s copy of the list carries neither the internal note nor its file', async () => {
    // The rule is INHERITED from the message filter rather than restated: a
    // reader who may not see internal notes never receives the message, so its
    // files cannot come back attached to one. Asserted on the whole serialised
    // listing, for the reason at the top of this file.
    const body = await messagesAs(fixtureEmails.requester);
    expect(JSON.stringify(body)).not.toContain('private-screenshot.txt');
    expect(JSON.stringify(body)).not.toContain(internalFileId);
    // Non-vacuity: the public file IS there, so this is not passing because
    // the list came back empty.
    expect(JSON.stringify(body)).toContain('shared-with-requester.txt');
  });
});
