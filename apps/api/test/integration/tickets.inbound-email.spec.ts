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

const inboundSecretHeader = { 'x-inbound-email-secret': 'test-inbound-secret' };

type TicketResponse = {
  id: string;
  subject?: string | null;
  displayId?: string | null;
  status?: string | null;
  channel?: string | null;
  requester?: { email?: string | null } | null;
};

type InboundEmailResponse = {
  threaded: boolean;
  ticket: TicketResponse;
};

type TicketMessagesResponse = {
  data: Array<{ body: string }>;
};

type TicketListResponse = {
  data: Array<{ subject: string }>;
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
      description: 'Inbound email threading test ticket',
      priority: 'P3',
      channel: 'PORTAL',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);
  return response.body as TicketResponse;
}

describe('Inbound email ingestion', () => {
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

  it('rejects inbound ingestion when webhook secret is missing or invalid', async () => {
    const messageId = `missing-secret-${Date.now()}@mail.example`;
    const payload = {
      fromEmail: `missing.secret.${Date.now()}@example.com`,
      fromName: 'Missing Secret',
      subject: 'Inbound auth check',
      body: 'Please create a ticket from this email.',
      messageId,
    };

    await request(server)
      .post('/api/tickets/inbound-email')
      .send(payload)
      .expect(403);

    await request(server)
      .post('/api/tickets/inbound-email')
      .set('x-inbound-email-secret', 'wrong-secret')
      .send(payload)
      .expect(403);
  });

  it('creates a new EMAIL ticket when no display id is present', async () => {
    const inboundEmail = `new.inbound.${Date.now()}@example.com`;
    const subject = `Inbound create ${Date.now()}`;

    const response = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: inboundEmail,
        fromName: 'Inbound Requester',
        subject,
        body: 'My workstation cannot connect to VPN.',
        messageId: `create-${Date.now()}@mail.example`,
      })
      .expect(201);

    const body = response.body as InboundEmailResponse;
    expect(body.threaded).toBe(false);
    expect(body.ticket.subject).toBe(subject);
    expect(body.ticket.channel).toBe('EMAIL');
    expect(body.ticket.requester?.email).toBe(inboundEmail.toLowerCase());
  });

  it('threads by display id and reopens a closed ticket', async () => {
    const created = await createTicket(server, `Inbound thread ${Date.now()}`);
    expect(created.displayId).toBeTruthy();

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

    const inboundBody = `Follow-up ${Date.now()}: issue persists`;
    const threadedResponse = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: fixtureEmails.requester,
        fromName: 'Existing Requester',
        subject: `Re: ${created.displayId} update`,
        body: inboundBody,
        messageId: `thread-${Date.now()}@mail.example`,
      })
      .expect(201);

    const threaded = threadedResponse.body as InboundEmailResponse;
    expect(threaded.threaded).toBe(true);
    expect(threaded.ticket.id).toBe(created.id);
    expect(threaded.ticket.status).toBe('REOPENED');

    const messagesResponse = await request(server)
      .get(`/api/tickets/${created.id}/messages`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const messagesBody = messagesResponse.body as TicketMessagesResponse;
    expect(
      messagesBody.data.some((message) => message.body === inboundBody),
    ).toBe(true);
  });

  it('deduplicates webhook retries by messageId', async () => {
    const fromEmail = `retry.${Date.now()}@example.com`;
    const messageId = `retry-${Date.now()}@mail.example`;
    const subject = `Inbound retry ${Date.now()}`;
    const payload = {
      fromEmail,
      fromName: 'Retry Requester',
      subject,
      body: 'Please help with printer access.',
      messageId,
    };

    const first = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send(payload)
      .expect(201);

    const second = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send(payload)
      .expect(201);

    const firstBody = first.body as InboundEmailResponse;
    const secondBody = second.body as InboundEmailResponse;
    expect(secondBody.ticket.id).toBe(firstBody.ticket.id);
    expect(secondBody.threaded).toBe(firstBody.threaded);

    const list = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const listBody = list.body as TicketListResponse;
    const matches = listBody.data.filter((item) => item.subject === subject);
    expect(matches).toHaveLength(1);
  });
});
