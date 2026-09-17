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
 * Card 1.139 — what `GET /api/tickets/:id/messages` really returns.
 *
 * ⚠️ THE UNIT SPEC CANNOT ASSERT THIS AND SAYS SO. It calls
 * `messageBodyForViewer` directly, which proves the function is right and
 * nothing about whether `listMessages` calls it - reverting the fetch path left
 * every behavioural case green and only the source guards red. This drives one
 * STORED body through the real endpoint.
 */
describe('a fetched message is transformed for the viewer (card 1.139)', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;
  let ticketId: string;

  /** A reply carrying both historical faults, exactly as it would be stored. */
  const STORED = [
    'Here is the screenshot you asked for.',
    '',
    '[[cid:5f02c6aa-3d21-4a8b-9c17-2e0b7a6d4f18]]',
    '',
    'Thank you,',
    'Prithviraj Hulgur',
    '',
    'From: Service Desk <glovebox@csnhc.com>',
    '----- Reply above this line -----',
    '',
    '[pilot mode] EMAIL_TEST_RECIPIENTS is set',
    'THIS MESSAGE IS CONFIDENTIAL',
  ].join('\n');

  const PLAIN = 'Can you reset my Kronos password please?';

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;

    const ticket = await prisma.ticket.create({
      data: {
        requesterId: fixtureUserIds.requester,
        subject: 'card 1.139 — one message shape',
        description: 'A reply stored with a marker and a quoted thread.',
        assignedTeamId: fixtureTeamIds.it,
        assigneeId: fixtureUserIds.agent,
      },
    });
    ticketId = ticket.id;
    // Written straight to the table on purpose: this asserts on the READ path,
    // so the stored bytes have to be exactly what an ingest would leave.
    await prisma.ticketMessage.create({
      data: {
        ticketId,
        authorId: fixtureUserIds.requester,
        type: 'PUBLIC',
        body: STORED,
      },
    });
    await prisma.ticketMessage.create({
      data: {
        ticketId,
        authorId: fixtureUserIds.requester,
        type: 'PUBLIC',
        body: PLAIN,
      },
    });
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  async function bodies(): Promise<string[]> {
    const res = await request(server)
      .get(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
    return (res.body as { data: { body: string }[] }).data.map(
      (message) => message.body,
    );
  }

  it('⚠️ the stored marker never reaches the reader as text', async () => {
    // THE ASSERTION THIS CARD EXISTS FOR. Before card 1.139 this endpoint
    // returned `[[cid:5f02c6aa-...]]` verbatim, while the socket push of the
    // same message showed a placeholder - so whoever OPENED the ticket during
    // an upload read worse than whoever already had it open.
    const [withFaults] = await bodies();
    expect(withFaults).not.toContain('[[cid:');
    expect(withFaults).not.toContain('5f02c6aa');
    expect(withFaults).toContain('data-attachment-pending="1"');
  });

  it('the quoted thread is still trimmed (card 1.62 / 1.75 returning)', async () => {
    const [withFaults] = await bodies();
    expect(withFaults).toContain('Here is the screenshot you asked for.');
    expect(withFaults).not.toContain('Reply above this line');
    expect(withFaults).not.toContain('pilot mode');
    expect(withFaults).not.toContain('CONFIDENTIAL');
  });

  it('⚠️ an ordinary message comes back exactly as stored', async () => {
    // NON-VACUITY. A transform that rewrote plain text would be worse than the
    // bug it fixes.
    const [, plain] = await bodies();
    expect(plain).toBe(PLAIN);
  });

  it('⚠️ the stored row still holds every byte', async () => {
    // DISPLAY ONLY, AND THIS IS THE HALF AN AUDIT DEPENDS ON. The transform
    // changes what is SENT, never what is kept.
    const stored = await prisma.ticketMessage.findFirstOrThrow({
      where: { ticketId, body: { contains: '5f02c6aa' } },
    });
    expect(stored.body).toBe(STORED);
  });
});
