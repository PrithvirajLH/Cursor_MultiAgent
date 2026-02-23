import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type ListEnvelope<T> = {
  data: T[];
};

type TicketResponse = {
  id: string;
  status: string;
};

type BulkResultEnvelope = {
  data: {
    success: number;
    failed: number;
    errors: Array<{ ticketId: string; message: string }>;
  };
  success?: unknown;
};

type UnreadCountEnvelope = {
  data: {
    count: number;
  };
  count?: unknown;
};

describe('API contract envelopes', () => {
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

  it('returns envelope for canned responses list', async () => {
    const response = await request(server)
      .get('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const body = response.body as ListEnvelope<unknown>;
    expect(Array.isArray(body.data)).toBe(true);
    expect(Array.isArray(response.body)).toBe(false);
  });

  it('returns envelope for saved views list', async () => {
    const response = await request(server)
      .get('/api/saved-views')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const body = response.body as ListEnvelope<unknown>;
    expect(Array.isArray(body.data)).toBe(true);
    expect(Array.isArray(response.body)).toBe(false);
  });

  it('returns envelope for bulk ticket operations', async () => {
    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.admin))
      .send({
        subject: `Contract envelope ${Date.now()}`,
        description: 'Verifies bulk response envelope',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);

    const createdBody = created.body as TicketResponse;
    expect(createdBody.id).toBeTruthy();

    const response = await request(server)
      .post('/api/tickets/bulk/status')
      .set(authHeader(fixtureEmails.admin))
      .send({
        ticketIds: [createdBody.id],
        status: createdBody.status,
      })
      .expect(201);

    const body = response.body as BulkResultEnvelope;
    expect(body.data.success).toBe(1);
    expect(body.data.failed).toBe(0);
    expect(Array.isArray(body.data.errors)).toBe(true);
    expect(body.success).toBeUndefined();
  });

  it('returns envelope for notifications unread count', async () => {
    const response = await request(server)
      .get('/api/notifications/unread-count')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const body = response.body as UnreadCountEnvelope;
    expect(typeof body.data.count).toBe('number');
    expect(body.count).toBeUndefined();
  });
});
