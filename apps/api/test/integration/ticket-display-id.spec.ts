import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

/**
 * Card 2.12 — a ticket resolves by display id as well as by uuid.
 *
 * `/tickets/7fe5d219-…` is unrecognisable pasted into Teams or an email;
 * `IT-0042` already exists on every row.
 */
describe('tickets resolve by display id (card 2.12)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let ticketId = '';
  let displayId = '';

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: 'card 2.12 fixture',
        description: 'resolve me by either name',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    const body = created.body as { id: string; displayId: string | null };
    ticketId = body.id;
    expect(body.displayId).toBeTruthy();
    displayId = body.displayId as string;
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  const get = async (reference: string, expected = 200) =>
    request(server)
      .get(`/api/tickets/${reference}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(expected);

  it('⚠️ opens the same ticket by display id as by uuid', async () => {
    const byUuid = await get(ticketId);
    const byDisplayId = await get(displayId);
    expect((byDisplayId.body as { id: string }).id).toBe(ticketId);
    expect((byDisplayId.body as { subject: string }).subject).toBe(
      (byUuid.body as { subject: string }).subject,
    );
  });

  it('⚠️ still opens by uuid — the regression assertion', async () => {
    // People have uuid links in email and in Teams already. Those must not
    // stop working the day the pretty form arrives.
    const byUuid = await get(ticketId);
    expect((byUuid.body as { id: string }).id).toBe(ticketId);
  });

  it('carries everything the detail page needs, whichever form asked', async () => {
    // The sub-resources are loaded by the ticket's real id, so the shape must
    // be identical - not merely "a ticket came back".
    const byDisplayId = await get(displayId);
    const body = byDisplayId.body as {
      id: string;
      followers: unknown[];
      attachments: unknown[];
      links: unknown[];
      allowedTransitions: unknown[];
    };
    expect(body.id).toBe(ticketId);
    expect(Array.isArray(body.followers)).toBe(true);
    expect(Array.isArray(body.attachments)).toBe(true);
    expect(Array.isArray(body.links)).toBe(true);
    expect(Array.isArray(body.allowedTransitions)).toBe(true);
  });

  it('404s on a display id that does not exist, rather than 500ing', async () => {
    await get('IT-0000000', 404);
  });

  it('404s on a uuid that does not exist', async () => {
    await get('7fe5d219-4b3c-4a2f-9f3a-1c2d3e4f5a6b', 404);
  });

  it('⚠️ a ticket with no display id is still reachable by its uuid', async () => {
    // The column is nullable in the schema even though every production row
    // has one, so the null case has to work rather than merely not crash.
    await getPrisma().ticket.update({
      where: { id: ticketId },
      data: { displayId: null },
    });
    try {
      const byUuid = await get(ticketId);
      expect((byUuid.body as { id: string }).id).toBe(ticketId);
      await get(displayId, 404);
    } finally {
      await getPrisma().ticket.update({
        where: { id: ticketId },
        data: { displayId },
      });
    }
  });
});
