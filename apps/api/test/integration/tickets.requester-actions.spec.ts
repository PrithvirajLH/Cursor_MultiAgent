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
  subject: string;
  closeReason?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
};

type EventsResponse = {
  data: Array<{
    type: string;
    payload: { from?: string; to?: string; closeReason?: string | null } | null;
  }>;
};

async function createTicket(server: SupertestApp, subject: string) {
  const created = await request(server)
    .post('/api/tickets')
    .set(authHeader(fixtureEmails.requester))
    .send({
      subject,
      description: 'Requester actions test ticket',
      priority: 'SEV3',
      channel: 'PORTAL',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);
  return created.body as TicketResponse;
}

/** NEW -> TRIAGED -> assign -> IN_PROGRESS -> RESOLVED, as csat.spec.ts does. */
async function createResolvedTicket(server: SupertestApp, subject: string) {
  const ticket = await createTicket(server, subject);
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

function transitionAs(
  server: SupertestApp,
  ticketId: string,
  email: string,
  status: string,
) {
  return request(server)
    .post(`/api/tickets/${ticketId}/transition`)
    .set(authHeader(email))
    .send({ status });
}

async function lastStatusEvent(server: SupertestApp, ticketId: string) {
  const res = await request(server)
    .get(`/api/tickets/${ticketId}/events`)
    .set(authHeader(fixtureEmails.owner))
    .expect(200);
  const events = (res.body as EventsResponse).data.filter(
    (e) => e.type === 'TICKET_STATUS_CHANGED',
  );
  return events[events.length - 1];
}

describe('Requester confirm / reopen / cancel (POST /api/tickets/:id/transition)', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
  });

  let confirmedTicketId: string;

  it('1: requester confirms a RESOLVED ticket (CLOSED, closeReason REQUESTER_CONFIRMED)', async () => {
    const ticket = await createResolvedTicket(server, `Confirm ${Date.now()}`);
    confirmedTicketId = ticket.id;
    const closed = await transitionAs(server, ticket.id, fixtureEmails.requester, 'CLOSED').expect(201);
    const closedBody = closed.body as TicketResponse;
    expect(closedBody.status).toBe('CLOSED');
    expect(closedBody.closeReason).toBe('REQUESTER_CONFIRMED');
    expect(typeof closedBody.closedAt).toBe('string');
    const event = await lastStatusEvent(server, ticket.id);
    expect(event?.payload).toMatchObject({ from: 'RESOLVED', to: 'CLOSED', closeReason: 'REQUESTER_CONFIRMED' });
  });

  it('2: requester reopens that CLOSED ticket (closeReason, resolvedAt, closedAt cleared)', async () => {
    const reopened = await transitionAs(server, confirmedTicketId, fixtureEmails.requester, 'REOPENED').expect(201);
    const reopenedBody = reopened.body as TicketResponse;
    expect(reopenedBody.status).toBe('REOPENED');
    expect(reopenedBody.closeReason).toBeNull();
    expect(reopenedBody.resolvedAt).toBeNull();
    expect(reopenedBody.closedAt).toBeNull();
    const event = await lastStatusEvent(server, confirmedTicketId);
    expect(event?.payload).toMatchObject({ from: 'CLOSED', to: 'REOPENED', closeReason: null });
  });

  it('3: requester reopens a RESOLVED ticket directly', async () => {
    const ticket = await createResolvedTicket(server, `Reopen ${Date.now()}`);
    const res = await transitionAs(server, ticket.id, fixtureEmails.requester, 'REOPENED').expect(201);
    expect((res.body as TicketResponse).status).toBe('REOPENED');
  });

  it('4: requester cancels a fresh NEW ticket (closeReason REQUESTER_CANCELLED)', async () => {
    const ticket = await createTicket(server, `Cancel ${Date.now()}`);
    const res = await transitionAs(server, ticket.id, fixtureEmails.requester, 'CLOSED').expect(201);
    const body = res.body as TicketResponse;
    expect(body.status).toBe('CLOSED');
    expect(body.closeReason).toBe('REQUESTER_CANCELLED');
    const event = await lastStatusEvent(server, ticket.id);
    expect(event?.payload?.closeReason).toBe('REQUESTER_CANCELLED');
  });

  it('5: requester cannot move to IN_PROGRESS, nor cancel once the ticket is ASSIGNED (403)', async () => {
    const ticket = await createTicket(server, `Forbidden ${Date.now()}`);
    await transitionAs(server, ticket.id, fixtureEmails.requester, 'IN_PROGRESS').expect(403);
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
    await transitionAs(server, ticket.id, fixtureEmails.requester, 'CLOSED').expect(403);
  });

  it('6: a different requester cannot confirm; status unchanged', async () => {
    const ticket = await createResolvedTicket(server, `Other ${Date.now()}`);
    await transitionAs(server, ticket.id, fixtureEmails.otherRequester, 'CLOSED').expect(403);
    const current = await request(server)
      .get(`/api/tickets/${ticket.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    expect((current.body as TicketResponse).status).toBe('RESOLVED');
    expect((current.body as TicketResponse).subject).toBe(ticket.subject);
  });

  it('7: an agent closing a RESOLVED ticket records AGENT_CLOSED', async () => {
    const ticket = await createResolvedTicket(server, `Agent close ${Date.now()}`);
    const res = await transitionAs(server, ticket.id, fixtureEmails.agent, 'CLOSED').expect(201);
    expect((res.body as TicketResponse).closeReason).toBe('AGENT_CLOSED');
  });

  it('8: an agent can now close a NEW ticket directly (AGENT_CLOSED)', async () => {
    const ticket = await createTicket(server, `Direct close ${Date.now()}`);
    const res = await transitionAs(server, ticket.id, fixtureEmails.agent, 'CLOSED').expect(201);
    const body = res.body as TicketResponse;
    expect(body.status).toBe('CLOSED');
    expect(body.closeReason).toBe('AGENT_CLOSED');
  });
});
