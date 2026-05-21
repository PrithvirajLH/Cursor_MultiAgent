import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import {
  fixtureEmails,
  fixtureTeamIds,
  fixtureUserIds,
} from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TicketListItem = {
  id: string;
  subject: string;
  assignedTeam?: { id: string } | null;
  assignee?: { email?: string | null } | null;
  status?: string | null;
};

type TicketListResponse = {
  data: TicketListItem[];
};

type TicketEvent = {
  type: string;
  payload?: { to?: string; toTeamId?: string };
  createdBy?: { email?: string | null } | null;
};

type TicketEventsResponse = {
  data: TicketEvent[];
};

type TicketResponse = {
  id: string;
  status?: string | null;
  assignee?: { email?: string | null } | null;
  assignedTeam?: { id: string } | null;
};

async function createTicket(
  server: SupertestApp,
  subject: string,
): Promise<TicketResponse> {
  const response = await request(server)
    .post('/api/tickets')
    .set(authHeader(fixtureEmails.requester))
    .send({
      subject,
      description: 'Workflow validation ticket',
      priority: 'SEV3',
      channel: 'PORTAL',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);
  return response.body as TicketResponse;
}

async function getTicketBySubject(
  server: SupertestApp,
  subject: string,
): Promise<TicketListItem> {
  const response = await request(server)
    .get('/api/tickets')
    .set(authHeader(fixtureEmails.admin))
    .expect(200);

  const body = response.body as TicketListResponse;
  const ticket = body.data.find((item) => item.subject === subject);
  if (!ticket) {
    throw new Error(`Missing fixture ticket: ${subject}`);
  }
  return ticket;
}

describe('Ticket workflows', () => {
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

  it('rejects transition to ASSIGNED when no assignee is set', async () => {
    const ticket = await getTicketBySubject(server, 'Laptop provisioning');

    await request(server)
      .post(`/api/tickets/${ticket.id}/transition`)
      .set(authHeader(fixtureEmails.agent))
      .send({ status: 'ASSIGNED' })
      .expect(400);
  });

  it('rejects direct NEW -> RESOLVED/CLOSED transitions', async () => {
    const ticket = await getTicketBySubject(server, 'Laptop provisioning');

    await request(server)
      .post(`/api/tickets/${ticket.id}/transition`)
      .set(authHeader(fixtureEmails.agent))
      .send({ status: 'RESOLVED' })
      .expect(403);

    await request(server)
      .post(`/api/tickets/${ticket.id}/transition`)
      .set(authHeader(fixtureEmails.agent))
      .send({ status: 'CLOSED' })
      .expect(403);
  });

  it('rejects REOPENED -> IN_PROGRESS when no assignee is present', async () => {
    const created = await createTicket(
      server,
      `Workflow assignee gate ${Date.now()}`,
    );

    await request(server)
      .post(`/api/tickets/${created.id}/transition`)
      .set(authHeader(fixtureEmails.owner))
      .send({ status: 'TRIAGED' })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${created.id}/assign`)
      .set(authHeader(fixtureEmails.owner))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${created.id}/transition`)
      .set(authHeader(fixtureEmails.owner))
      .send({ status: 'RESOLVED' })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${created.id}/transition`)
      .set(authHeader(fixtureEmails.owner))
      .send({ status: 'CLOSED' })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${created.id}/transition`)
      .set(authHeader(fixtureEmails.owner))
      .send({ status: 'REOPENED' })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${created.id}/transfer`)
      .set(authHeader(fixtureEmails.owner))
      .send({ newTeamId: fixtureTeamIds.hr })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${created.id}/transition`)
      .set(authHeader(fixtureEmails.owner))
      .send({ status: 'IN_PROGRESS' })
      .expect(400);
  });

  it('agent self-assign sets status to ASSIGNED and logs history', async () => {
    const ticket = await getTicketBySubject(server, 'Laptop provisioning');

    const response = await request(server)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set(authHeader(fixtureEmails.agent))
      .send({})
      .expect(201);

    const assignBody = response.body as TicketResponse;
    expect(assignBody.assignee?.email).toBe(fixtureEmails.agent);
    expect(assignBody.status).toBe('ASSIGNED');

    const events = await request(server)
      .get(`/api/tickets/${ticket.id}/events`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const eventsBody = events.body as TicketEventsResponse;
    const assignedEvent = eventsBody.data.find(
      (event) => event.type === 'TICKET_ASSIGNED',
    );
    const statusEvent = eventsBody.data.find((event) => {
      return (
        event.type === 'TICKET_STATUS_CHANGED' &&
        event.payload?.to === 'ASSIGNED'
      );
    });

    expect(assignedEvent).toBeTruthy();
    expect(statusEvent).toBeTruthy();
  });

  it('agent transition logs status change history', async () => {
    const ticket = await getTicketBySubject(server, 'VPN access request');

    const response = await request(server)
      .post(`/api/tickets/${ticket.id}/transition`)
      .set(authHeader(fixtureEmails.agent))
      .send({ status: 'IN_PROGRESS' })
      .expect(201);

    const transitionBody = response.body as TicketResponse;
    expect(transitionBody.status).toBe('IN_PROGRESS');

    const events = await request(server)
      .get(`/api/tickets/${ticket.id}/events`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const eventsBody = events.body as TicketEventsResponse;
    const statusEvent = eventsBody.data.find(
      (event) =>
        event.type === 'TICKET_STATUS_CHANGED' &&
        event.payload?.to === 'IN_PROGRESS',
    );

    expect(statusEvent).toBeTruthy();
    expect(statusEvent?.createdBy?.email).toBe(fixtureEmails.agent);
  });

  it('transfer validates assignee belongs to target team', async () => {
    const ticket = await getTicketBySubject(server, 'VPN access request');

    await request(server)
      .post(`/api/tickets/${ticket.id}/transfer`)
      .set(authHeader(fixtureEmails.admin))
      .send({ newTeamId: fixtureTeamIds.hr, assigneeId: fixtureUserIds.agent })
      .expect(400);
  });

  it('assign rejects assignee outside ticket team membership', async () => {
    const ticket = await getTicketBySubject(server, 'VPN access request');

    await request(server)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set(authHeader(fixtureEmails.admin))
      .send({ assigneeId: fixtureUserIds.otherRequester })
      .expect(400);
  });

  it('admin transfer clears assignee, normalizes status, and logs transfer event', async () => {
    const ticket = await getTicketBySubject(server, 'VPN access request');

    const response = await request(server)
      .post(`/api/tickets/${ticket.id}/transfer`)
      .set(authHeader(fixtureEmails.admin))
      .send({ newTeamId: fixtureTeamIds.hr })
      .expect(201);

    const transferBody = response.body as TicketResponse;
    expect(transferBody.assignedTeam?.id).toBe(fixtureTeamIds.hr);
    expect(transferBody.assignee).toBeNull();
    expect(transferBody.status).toBe('TRIAGED');

    const events = await request(server)
      .get(`/api/tickets/${ticket.id}/events`)
      .set(authHeader(fixtureEmails.admin))
      .expect(200);

    const eventsBody = events.body as TicketEventsResponse;
    const transferEvent = eventsBody.data.find(
      (event) =>
        event.type === 'TICKET_TRANSFERRED' &&
        event.payload?.toTeamId === fixtureTeamIds.hr,
    );
    const statusEvent = eventsBody.data.find(
      (event) =>
        event.type === 'TICKET_STATUS_CHANGED' &&
        event.payload?.to === 'TRIAGED',
    );

    expect(transferEvent).toBeTruthy();
    expect(statusEvent).toBeTruthy();
  });
});
