import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TicketResponse = {
  id: string;
  status: string;
};

type CsatGetResponse = {
  data: {
    id: string;
    payload: { rating: number; comment: string | null } | null;
    createdAt: string;
  } | null;
};

/**
 * Drives a freshly created ticket from NEW to RESOLVED so CSAT preconditions
 * (ticket must be RESOLVED or CLOSED) are satisfied. Mirrors the transition
 * sequence used in tickets.lifecycle.spec.ts: TRIAGED -> assign -> IN_PROGRESS
 * -> RESOLVED. The admin persona (TEAM_ADMIN of IT) performs the agent-side
 * actions; the requester owns the ticket.
 */
async function createResolvedTicket(server: SupertestApp, subject: string) {
  const created = await request(server)
    .post('/api/tickets')
    .set(authHeader(fixtureEmails.requester))
    .send({
      subject,
      description: 'CSAT test ticket',
      priority: 'SEV3',
      channel: 'PORTAL',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);

  const ticket = created.body as TicketResponse;

  await request(server)
    .post(`/api/tickets/${ticket.id}/transition`)
    .set(authHeader(fixtureEmails.admin))
    .send({ status: 'TRIAGED' })
    .expect(201);

  await request(server)
    .post(`/api/tickets/${ticket.id}/assign`)
    .set(authHeader(fixtureEmails.admin))
    .send({ assigneeId: fixtureUserIds.agent })
    .expect(201);

  await request(server)
    .post(`/api/tickets/${ticket.id}/transition`)
    .set(authHeader(fixtureEmails.admin))
    .send({ status: 'IN_PROGRESS' })
    .expect(201);

  const resolved = await request(server)
    .post(`/api/tickets/${ticket.id}/transition`)
    .set(authHeader(fixtureEmails.admin))
    .send({ status: 'RESOLVED' })
    .expect(201);

  expect((resolved.body as TicketResponse).status).toBe('RESOLVED');
  return ticket;
}

describe('CSAT submission and retrieval', () => {
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

  it('lets the requester submit CSAT on a resolved ticket and reads it back', async () => {
    const ticket = await createResolvedTicket(server, `CSAT happy ${Date.now()}`);

    await request(server)
      .post('/api/csat')
      .set(authHeader(fixtureEmails.requester))
      .send({ ticketId: ticket.id, rating: 5, comment: 'Great work' })
      .expect(201);

    const fetched = await request(server)
      .get(`/api/csat/${ticket.id}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(200);

    const body = fetched.body as CsatGetResponse;
    expect(body.data).not.toBeNull();
    expect(body.data?.payload?.rating).toBe(5);
    expect(body.data?.payload?.comment).toBe('Great work');
  });

  it('rejects an out-of-range rating with 400 (DTO Min/Max 1..5)', async () => {
    const ticket = await createResolvedTicket(
      server,
      `CSAT bad score ${Date.now()}`,
    );

    await request(server)
      .post('/api/csat')
      .set(authHeader(fixtureEmails.requester))
      .send({ ticketId: ticket.id, rating: 9 })
      .expect(400);
  });

  it('forbids a non-requester from submitting CSAT (403)', async () => {
    const ticket = await createResolvedTicket(
      server,
      `CSAT wrong submitter ${Date.now()}`,
    );

    // otherRequester is a valid user but not the ticket's requester.
    await request(server)
      .post('/api/csat')
      .set(authHeader(fixtureEmails.otherRequester))
      .send({ ticketId: ticket.id, rating: 4 })
      .expect(403);
  });

  it('rejects CSAT on a ticket that is not resolved/closed (400)', async () => {
    // Seed ticket "VPN access request" is ASSIGNED (not RESOLVED/CLOSED) and
    // owned by the requester, so it exercises the status precondition only.
    const list = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.admin))
      .expect(200);

    const ticket = (
      list.body as { data: Array<{ id: string; subject: string; status: string }> }
    ).data.find((t) => t.subject === 'VPN access request');
    expect(ticket).toBeDefined();
    expect(ticket?.status).toBe('ASSIGNED');

    await request(server)
      .post('/api/csat')
      .set(authHeader(fixtureEmails.requester))
      .send({ ticketId: ticket!.id, rating: 4 })
      .expect(400);
  });

  it('prevents duplicate CSAT submissions for the same ticket (400)', async () => {
    const ticket = await createResolvedTicket(server, `CSAT dup ${Date.now()}`);

    await request(server)
      .post('/api/csat')
      .set(authHeader(fixtureEmails.requester))
      .send({ ticketId: ticket.id, rating: 3 })
      .expect(201);

    await request(server)
      .post('/api/csat')
      .set(authHeader(fixtureEmails.requester))
      .send({ ticketId: ticket.id, rating: 2 })
      .expect(400);
  });
});
