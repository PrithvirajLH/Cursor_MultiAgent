import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TicketResponse = {
  id: string;
  firstResponseDueAt?: string | null;
  firstResponseAt?: string | null;
  dueAt?: string | null;
  slaPausedAt?: string | null;
};

async function createTicket(server: SupertestApp): Promise<TicketResponse> {
  const response = await request(server)
    .post('/api/tickets')
    .set(authHeader(fixtureEmails.requester))
    .send({
      subject: 'SLA test ticket',
      description: 'Track SLA timings',
      priority: 'SEV2',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);

  return response.body as TicketResponse;
}

describe('Ticket SLA behavior', () => {
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

  it('sets first response due date on create', async () => {
    const ticket = await createTicket(server);
    expect(ticket.firstResponseDueAt).toBeTruthy();
    expect(ticket.dueAt).toBeTruthy();
  });

  it('marks first response when agent replies publicly', async () => {
    const ticket = await createTicket(server);

    // The ticket is created against the IT team but, because that team uses the
    // QUEUE_ONLY assignment strategy, it lands unassigned. A team agent who is
    // not the assignee is a "peer agent" whose messages are forced to INTERNAL
    // (deliberate, unit-tested behavior in AccessControlService.isPeerAgent), so
    // a public first response only counts when the agent actually owns the
    // ticket. Self-assign first so this exercises the real first-response path.
    await request(server)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set(authHeader(fixtureEmails.agent))
      .send({})
      .expect(201);

    await request(server)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({ body: 'First response from agent', type: 'PUBLIC' })
      .expect(201);

    const detail = await request(server)
      .get(`/api/tickets/${ticket.id}`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const detailBody = detail.body as TicketResponse;
    expect(detailBody.firstResponseAt).toBeTruthy();
  });

  it('pauses and resumes SLA on waiting statuses', async () => {
    const ticket = await createTicket(server);

    await request(server)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set(authHeader(fixtureEmails.agent))
      .send({})
      .expect(201);

    await request(server)
      .post(`/api/tickets/${ticket.id}/transition`)
      .set(authHeader(fixtureEmails.agent))
      .send({ status: 'IN_PROGRESS' })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${ticket.id}/transition`)
      .set(authHeader(fixtureEmails.agent))
      .send({ status: 'WAITING_ON_REQUESTER' })
      .expect(201);

    let detail = await request(server)
      .get(`/api/tickets/${ticket.id}`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    let detailBody = detail.body as TicketResponse;
    expect(detailBody.slaPausedAt).toBeTruthy();
    const dueAtPaused = detailBody.dueAt;

    await request(server)
      .post(`/api/tickets/${ticket.id}/transition`)
      .set(authHeader(fixtureEmails.agent))
      .send({ status: 'IN_PROGRESS' })
      .expect(201);

    detail = await request(server)
      .get(`/api/tickets/${ticket.id}`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    detailBody = detail.body as TicketResponse;
    expect(detailBody.slaPausedAt).toBeNull();
    expect(detailBody.dueAt).not.toBe(dueAtPaused);
  });
});
