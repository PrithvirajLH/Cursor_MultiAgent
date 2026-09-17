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

/** The `content` half of an outbox row's payload, as the processor reads it. */
function emailContent(payload: unknown): {
  html?: string;
  inlineImages?: { attachmentId: string; cid: string }[];
} {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const content = (payload as { content?: unknown }).content;
  return content && typeof content === 'object'
    ? (content as { html?: string; inlineImages?: never })
    : {};
}

/**
 * Card 1.130 — an agent's pasted image reaches the requester as an image.
 *
 * ⚠️ THIS ASSERTS THE OUTBOX ROW, NOT A SEND, and deliberately: nothing in this
 * suite opens a socket. The row is where the decision lives - ids to carry and
 * an HTML body that refers to them - and the two halves after it (reading the
 * bytes, handing them to nodemailer) are pinned in
 * `inline-email-images.service.spec.ts` and `email-processor.service.spec.ts`.
 */
describe('inline images on an outbound reply (card 1.130)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let ticketId: string;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;

    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `card 1.130 fixture ${Date.now()}`,
        description: 'the agent will paste a screenshot into a reply',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    ticketId = (created.body as { id: string }).id;

    // ⚠️ ASSIGN IT FIRST, OR THE "PUBLIC" REPLY IS NOT PUBLIC. `addMessage`
    // silently coerces a PEER agent's message to INTERNAL, and an internal note
    // emails nobody - so the assertion would pass for the wrong reason.
    await request(server)
      .post(`/api/tickets/${ticketId}/assign`)
      .set(authHeader(fixtureEmails.owner))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  /**
   * A real 1x1 PNG.
   *
   * ⚠️ NOT A STRING PRETENDING TO BE ONE. Uploads are checked against magic
   * bytes as well as the extension and MIME type, so text named `.png` is
   * refused before any of this card's code runs.
   */
  const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  /** Upload a file the way the composer does, and return its id. */
  async function upload(fileName: string): Promise<string> {
    const res = await request(server)
      .post(`/api/tickets/${ticketId}/attachments`)
      .set(authHeader(fixtureEmails.agent))
      .attach('file', PNG_1X1, fileName)
      .expect(201);
    const body = res.body as { id?: string; data?: { id: string } };
    return body.id ?? (body.data as { id: string }).id;
  }

  async function reply(body: string, type: 'PUBLIC' | 'INTERNAL' = 'PUBLIC') {
    await request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({ body, type })
      .expect(201);
  }

  const outboxFor = async (needle: string) => {
    const rows = await getPrisma().notificationOutbox.findMany({
      where: { ticketId, eventType: 'MESSAGE_ADDED' },
      orderBy: { createdAt: 'asc' },
    });
    return rows.filter((row) => emailContent(row.payload).html?.includes(needle));
  };

  it('⚠️ the queued email carries the image id, and its HTML points at it', async () => {
    // THE ASSERTION THIS CARD EXISTS FOR.
    const attachmentId = await upload('screenshot.png');
    await reply(
      `Here is what I see <img data-attachment-id="${attachmentId}" alt="screenshot.png">`,
    );

    const rows = await outboxFor('Here is what I see');
    expect(rows.length).toBeGreaterThan(0);
    const content = emailContent(rows[0].payload);
    expect(content.inlineImages).toEqual([
      { attachmentId, cid: expect.stringContaining(attachmentId) },
    ]);
    const cid = content.inlineImages?.[0].cid as string;
    expect(content.html).toContain(`<img src="cid:${cid}"`);
    // ⚠️ CARD 1.129'S GUARANTEES STILL HOLD. No internal marker reaches the
    // requester, whether or not the picture travels.
    expect(content.html).not.toContain('data-attachment-id');
    expect(content.html).not.toContain('data-temp-id');
  });

  it('a reply with no image queues no inline images at all', async () => {
    // NON-VACUITY: every ordinary reply must produce exactly the payload it
    // produced before this card.
    await reply('No picture on this one.');

    const rows = await outboxFor('No picture on this one');
    expect(rows.length).toBeGreaterThan(0);
    const content = emailContent(rows[0].payload);
    expect(content.inlineImages).toBeUndefined();
    expect(content.html).not.toContain('cid:');
  });

  it('⚠️ an INTERNAL note with an image emails nobody at all', async () => {
    // The first line of defence for card 1.83 at this exit: an internal note
    // never reaches the outbox, so its file can never be embedded. The second
    // line - refusing the file even if an id for one appeared on a public
    // body - is in `inline-email-images.service.spec.ts`.
    const attachmentId = await upload('private-note.png');
    await reply(
      `Not for them <img data-attachment-id="${attachmentId}">`,
      'INTERNAL',
    );

    expect(await outboxFor('Not for them')).toEqual([]);
  });
});
