import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type CreatedTicketResponse = {
  id: string;
};

type TicketListResponse = {
  data: Array<{ id: string; subject: string }>;
};

describe('Idempotency for mutating APIs', () => {
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

  it('replays the first successful POST /tickets response for the same Idempotency-Key', async () => {
    const idempotencyKey = `ticket-create-${Date.now()}`;
    const payload = {
      subject: `Idempotent create ${Date.now()}`,
      description: 'Idempotency test',
      priority: 'SEV3',
      channel: 'PORTAL',
      assignedTeamId: fixtureTeamIds.it,
    };

    const first = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    const second = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    const firstBody = first.body as CreatedTicketResponse;
    const secondBody = second.body as CreatedTicketResponse;
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(secondBody.id).toBe(firstBody.id);

    const list = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.admin))
      .expect(200);

    const listBody = list.body as TicketListResponse;
    const matches = listBody.data.filter(
      (ticket) => ticket.subject === payload.subject,
    );
    expect(matches).toHaveLength(1);
  });

  it('rejects reusing the same key with a different payload', async () => {
    const idempotencyKey = `ticket-create-mismatch-${Date.now()}`;

    await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .set('Idempotency-Key', idempotencyKey)
      .send({
        subject: `Idempotency mismatch A ${Date.now()}`,
        description: 'First payload',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);

    await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .set('Idempotency-Key', idempotencyKey)
      .send({
        subject: `Idempotency mismatch B ${Date.now()}`,
        description: 'Different payload',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(409);
  });
});
