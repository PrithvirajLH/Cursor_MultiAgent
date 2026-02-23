import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import path from 'path';
import { promises as fs } from 'fs';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

const SCAN_SECRET_HEADER = { 'x-attachment-scan-secret': 'test-scan-secret' };

type AttachmentResponse = {
  id: string;
  fileName: string;
};

type TicketResponse = {
  id: string;
  attachments?: AttachmentResponse[];
};

async function createTicket(server: SupertestApp, subject: string) {
  const response = await request(server)
    .post('/api/tickets')
    .set(authHeader(fixtureEmails.requester))
    .send({
      subject,
      description: 'Attachment test ticket',
      priority: 'P3',
      channel: 'PORTAL',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);

  return response.body as TicketResponse;
}

describe('Ticket attachments', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
    const uploadsDir = path.resolve(
      process.cwd(),
      process.env.ATTACHMENTS_DIR ?? 'uploads',
    );
    await fs.rm(uploadsDir, { recursive: true, force: true });
  });

  it('allows requester to upload and download an attachment', async () => {
    const ticket = await createTicket(server, `Attachment ${Date.now()}`);

    const upload = await request(server)
      .post(`/api/tickets/${ticket.id}/attachments`)
      .set(authHeader(fixtureEmails.requester))
      .attach('file', Buffer.from('hello attachment'), {
        filename: 'hello.txt',
        contentType: 'text/plain',
      })
      .expect(201);

    const attachment = upload.body as AttachmentResponse;
    expect(attachment.fileName).toBe('hello.txt');

    const detail = await request(server)
      .get(`/api/tickets/${ticket.id}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(200);

    const detailBody = detail.body as TicketResponse;
    expect(detailBody.attachments?.length).toBe(1);

    await request(server)
      .post(`/api/attachments/${attachment.id}/scan-status`)
      .set(SCAN_SECRET_HEADER)
      .send({ status: 'CLEAN' })
      .expect(201);

    const download = await request(server)
      .get(`/api/attachments/${attachment.id}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(200);

    expect(download.headers['content-type']).toContain('text/plain');
    expect(download.text).toContain('hello attachment');
  });

  it('blocks attachment download while scan status is pending', async () => {
    const ticket = await createTicket(
      server,
      `Attachment Pending ${Date.now()}`,
    );

    const upload = await request(server)
      .post(`/api/tickets/${ticket.id}/attachments`)
      .set(authHeader(fixtureEmails.requester))
      .attach('file', Buffer.from('pending scan'), {
        filename: 'pending.txt',
        contentType: 'text/plain',
      })
      .expect(201);

    const attachment = upload.body as AttachmentResponse;

    await request(server)
      .get(`/api/attachments/${attachment.id}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(403);
  });

  it('blocks attachment download for infected and failed scans', async () => {
    const ticket = await createTicket(
      server,
      `Attachment Scan States ${Date.now()}`,
    );

    const upload = await request(server)
      .post(`/api/tickets/${ticket.id}/attachments`)
      .set(authHeader(fixtureEmails.requester))
      .attach('file', Buffer.from('scan states'), {
        filename: 'states.txt',
        contentType: 'text/plain',
      })
      .expect(201);

    const attachment = upload.body as AttachmentResponse;
    await request(server)
      .post(`/api/attachments/${attachment.id}/scan-status`)
      .set(SCAN_SECRET_HEADER)
      .send({ status: 'INFECTED', error: 'Malware signature detected' })
      .expect(201);

    await request(server)
      .get(`/api/attachments/${attachment.id}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(403);

    await request(server)
      .post(`/api/attachments/${attachment.id}/scan-status`)
      .set(SCAN_SECRET_HEADER)
      .send({ status: 'FAILED', error: 'Scanner timeout' })
      .expect(201);

    await request(server)
      .get(`/api/attachments/${attachment.id}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(403);
  });

  it('rejects scanner callback when secret is missing or invalid', async () => {
    const ticket = await createTicket(
      server,
      `Attachment Secret ${Date.now()}`,
    );

    const upload = await request(server)
      .post(`/api/tickets/${ticket.id}/attachments`)
      .set(authHeader(fixtureEmails.requester))
      .attach('file', Buffer.from('secret checks'), {
        filename: 'secret.txt',
        contentType: 'text/plain',
      })
      .expect(201);

    const attachment = upload.body as AttachmentResponse;

    await request(server)
      .post(`/api/attachments/${attachment.id}/scan-status`)
      .send({ status: 'CLEAN' })
      .expect(403);

    await request(server)
      .post(`/api/attachments/${attachment.id}/scan-status`)
      .set('x-attachment-scan-secret', 'wrong-secret')
      .send({ status: 'CLEAN' })
      .expect(403);
  });
});
