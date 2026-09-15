import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

/**
 * Card 3.5 — record who downloaded what.
 *
 * ⚠️ THIS MATTERS MORE NOW THAN WHEN IT WAS WRITTEN. With the AV gate about to
 * be switched off, every file becomes downloadable by anyone entitled to the
 * ticket, so "who opened that file" stops being a nice-to-have.
 */
describe('attachment access is recorded (card 3.5)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let ticketId: string;
  let publicFileId: string;
  let internalFileId: string;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;

    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: 'card 3.5 fixture',
        description: 'download auditing',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    ticketId = (created.body as { id: string }).id;

    await request(server)
      .post(`/api/tickets/${ticketId}/assign`)
      .set(authHeader(fixtureEmails.owner))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);

    const upload = async (fileName: string) => {
      const res = await request(server)
        .post(`/api/tickets/${ticketId}/attachments`)
        .set(authHeader(fixtureEmails.agent))
        .attach('file', Buffer.from('content'), fileName)
        .expect(201);
      const body = res.body as { id?: string; data?: { id: string } };
      return body.id ?? (body.data as { id: string }).id;
    };
    publicFileId = await upload('everyone-can-see.txt');
    internalFileId = await upload('agents-only.txt');

    await request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({
        body: `internal <img data-attachment-id="${internalFileId}">`,
        type: 'INTERNAL',
      })
      .expect(201);

    // The AV gate would refuse everything first; this suite is about what
    // happens once a download is actually allowed.
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

  const accessEvents = (outcome?: string) =>
    getPrisma().ticketEvent.findMany({
      where: {
        ticketId,
        type: 'ATTACHMENT_DOWNLOADED',
        ...(outcome ? { payload: { path: ['outcome'], equals: outcome } } : {}),
      },
      select: { payload: true, createdById: true },
    });

  it('⚠️ a successful download is recorded, with who and which file', async () => {
    await request(server)
      .get(`/api/attachments/${publicFileId}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(200);

    const events = await accessEvents('downloaded');
    expect(events.length).toBeGreaterThan(0);
    const payload = events[0].payload as { fileName: string; attachmentId: string };
    expect(payload.fileName).toBe('everyone-can-see.txt');
    expect(payload.attachmentId).toBe(publicFileId);
    expect(events[0].createdById).toBe(fixtureUserIds.requester);
  });

  it('⚠️ a REFUSAL is recorded too — "did anyone try?" needs an answer', async () => {
    // An empty answer after an incident only means something if an attempt
    // would have shown up.
    await request(server)
      .get(`/api/attachments/${internalFileId}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(403);

    const refusals = await accessEvents('refused_internal');
    expect(refusals.length).toBe(1);
    const payload = refusals[0].payload as { fileName: string };
    expect(payload.fileName).toBe('agents-only.txt');
  });

  it('⚠️ a refusal never reads as a download', async () => {
    // The outcome is on the row precisely so the two cannot be confused by
    // anyone reading the trail later.
    const all = await accessEvents();
    for (const event of all) {
      const payload = event.payload as { outcome: string };
      expect(['downloaded', 'refused_internal', 'refused_no_access']).toContain(
        payload.outcome,
      );
    }
    const downloads = await accessEvents('downloaded');
    const refusals = await accessEvents('refused_internal');
    expect(downloads.length + refusals.length).toBe(all.length);
  });

  it('⚠️ the listing endpoint records nothing — it is hot', async () => {
    const before = (await accessEvents()).length;
    await request(server)
      .get(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    expect((await accessEvents()).length).toBe(before);
  });

  it('⚠️ a failed audit write never fails the download', async () => {
    // Card 1.95's shape. A missing audit row is bad; a file an entitled person
    // cannot open because the AUDIT write failed is a self-inflicted outage.
    const prisma = app.get(PrismaService);
    const broken = jest
      .spyOn(prisma.ticketEvent, 'create')
      .mockRejectedValueOnce(new Error('audit table gone'));

    await request(server)
      .get(`/api/attachments/${publicFileId}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    expect(broken).toHaveBeenCalled();
    broken.mockRestore();
  });
});
