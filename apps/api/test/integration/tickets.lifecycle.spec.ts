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
};

type TicketListResponse = {
  data: TicketListItem[];
};

type TicketResponse = {
  id: string;
  status: string;
  subject?: string;
  assignedTeam?: { id: string } | null;
};

type TicketMessage = {
  body: string;
  type: string;
};

type TicketEvent = {
  type: string;
  payload?: { to?: string } | null;
};

type TicketMessagesResponse = {
  data: TicketMessage[];
  nextCursor: string | null;
};

type TicketEventsResponse = {
  data: TicketEvent[];
  nextCursor: string | null;
};

async function getTicketBySubject(server: SupertestApp, subject: string) {
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

async function createTicket(server: SupertestApp, subject: string) {
  const response = await request(server)
    .post('/api/tickets')
    .set(authHeader(fixtureEmails.requester))
    .send({
      subject,
      description: 'Lifecycle test ticket',
      priority: 'P3',
      channel: 'PORTAL',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);

  return response.body as TicketResponse;
}

describe('Ticket lifecycle and rules', () => {
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

  it('blocks employees from assign/transition/transfer actions', async () => {
    const ticket = await getTicketBySubject(server, 'Laptop provisioning');

    await request(server)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set(authHeader(fixtureEmails.requester))
      .send({})
      .expect(403);

    await request(server)
      .post(`/api/tickets/${ticket.id}/transition`)
      .set(authHeader(fixtureEmails.requester))
      .send({ status: 'IN_PROGRESS' })
      .expect(403);

    await request(server)
      .post(`/api/tickets/${ticket.id}/transfer`)
      .set(authHeader(fixtureEmails.requester))
      .send({ newTeamId: fixtureTeamIds.hr })
      .expect(403);
  });

  it('supports full lifecycle transitions and logs status events', async () => {
    const created = await createTicket(server, `Lifecycle ${Date.now()}`);
    const sequence = [
      'TRIAGED',
      'ASSIGNED',
      'IN_PROGRESS',
      'RESOLVED',
      'CLOSED',
      'REOPENED',
    ];
    const transitionSequence = ['TRIAGED'];

    for (const status of transitionSequence) {
      const response = await request(server)
        .post(`/api/tickets/${created.id}/transition`)
        .set(authHeader(fixtureEmails.admin))
        .send({ status })
        .expect(201);
      const body = response.body as TicketResponse;
      expect(body.status).toBe(status);
    }
    await request(server)
      .post(`/api/tickets/${created.id}/assign`)
      .set(authHeader(fixtureEmails.admin))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);
    for (const status of ['IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED']) {
      const response = await request(server)
        .post(`/api/tickets/${created.id}/transition`)
        .set(authHeader(fixtureEmails.admin))
        .send({ status })
        .expect(201);
      const body = response.body as TicketResponse;
      expect(body.status).toBe(status);
    }

    const events = await request(server)
      .get(`/api/tickets/${created.id}/events`)
      .set(authHeader(fixtureEmails.admin))
      .expect(200);

    const detailBody = events.body as TicketEventsResponse;
    const statusEvents = detailBody.data.filter(
      (event) => event.type === 'TICKET_STATUS_CHANGED',
    );
    for (const status of sequence) {
      const hasStatus = statusEvents.some(
        (event) => event.payload?.to === status,
      );
      expect(hasStatus).toBe(true);
    }
  });

  it('enforces internal notes visibility and permissions', async () => {
    const ticket = await createTicket(server, `Notes ${Date.now()}`);

    await request(server)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set(authHeader(fixtureEmails.requester))
      .send({ body: 'Internal note by requester', type: 'INTERNAL' })
      .expect(403);

    await request(server)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({ body: 'Internal note by agent', type: 'INTERNAL' })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({ body: 'Public reply by agent', type: 'PUBLIC' })
      .expect(201);

    const requesterView = await request(server)
      .get(`/api/tickets/${ticket.id}/messages`)
      .set(authHeader(fixtureEmails.requester))
      .expect(200);

    const requesterBody = requesterView.body as TicketMessagesResponse;
    const internalVisible = requesterBody.data.some(
      (message) => message.type === 'INTERNAL',
    );
    const publicVisible = requesterBody.data.some(
      (message) => message.type === 'PUBLIC',
    );

    expect(internalVisible).toBe(false);
    expect(publicVisible).toBe(true);
  });

  it('routes ticket based on keyword rules', async () => {
    await request(server)
      .post('/api/routing-rules')
      .set(authHeader(fixtureEmails.owner))
      .send({
        name: 'Printer routing',
        keywords: ['printer'],
        teamId: fixtureTeamIds.it,
        priority: 1,
        isActive: true,
      })
      .expect(201);

    const response = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `Printer issue ${Date.now()}`,
        description: 'Printer is jammed.',
        priority: 'P3',
        channel: 'PORTAL',
      })
      .expect(201);

    const body = response.body as TicketResponse;
    expect(body.assignedTeam?.id).toBe(fixtureTeamIds.it);
  });
});
