import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type ValidationErrorBody = {
  message?: string | string[];
};

type CreatedTicketBody = {
  id: string;
};

describe('Security validation hardening', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unknown payload properties with forbidNonWhitelisted', async () => {
    const response = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.admin))
      .send({
        subject: `Validation hardening ${Date.now()}`,
        description: 'Validation test',
        assignedTeamId: fixtureTeamIds.it,
        unexpectedField: 'not-allowed',
      })
      .expect(400);

    const body = response.body as ValidationErrorBody;
    const messages = Array.isArray(body.message)
      ? body.message
      : [body.message ?? ''];
    expect(
      messages.some((message) =>
        message.includes('property unexpectedField should not exist'),
      ),
    ).toBe(true);
  });

  it('rejects attachment content when magic bytes do not match extension', async () => {
    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `Attachment signature check ${Date.now()}`,
        description: 'Validate magic-byte enforcement',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    const createdBody = created.body as CreatedTicketBody;

    await request(server)
      .post(`/api/tickets/${createdBody.id}/attachments`)
      .set(authHeader(fixtureEmails.requester))
      .attach('file', Buffer.from('this is not a PDF payload'), {
        filename: 'mismatch.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
  });

  it('does not crash when a ticket search query contains an out-of-range number', async () => {
    // Ticket.number is a 32-bit Int; a search term whose number exceeds that range
    // must NOT be pushed into the numeric `number` filter (it would overflow and the
    // DB would 500). Regression for the ticket-search overflow bug.
    await request(server)
      .get('/api/tickets')
      .query({ q: '99999999999999' })
      .set(authHeader(fixtureEmails.admin))
      .expect(200);

    // Timestamp-like numbers (as appear in generated ticket subjects) must be safe too.
    await request(server)
      .get('/api/tickets')
      .query({ q: `Subject ${Date.now()}` })
      .set(authHeader(fixtureEmails.admin))
      .expect(200);
  });
});
