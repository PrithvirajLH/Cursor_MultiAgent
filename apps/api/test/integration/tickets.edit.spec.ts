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
  subject: string;
  description?: string | null;
  status: string;
};

type EditChange = { field: string; from: string; to: string };
type EventsResponse = {
  data: Array<{ type: string; payload: { changes?: EditChange[] } | null }>;
};

async function editedEvents(server: SupertestApp, ticketId: string) {
  const res = await request(server)
    .get(`/api/tickets/${ticketId}/events`)
    .set(authHeader(fixtureEmails.owner))
    .expect(200);
  return (res.body as EventsResponse).data.filter(
    (e) => e.type === 'TICKET_EDITED',
  );
}

describe('PATCH /api/tickets/:id (edit subject and description)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let ticketId: string;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: 'Re: Re: help',
        description: 'Original description',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    ticketId = (created.body as TicketResponse).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets the requester fix the subject of their own NEW ticket', async () => {
    const res = await request(server)
      .patch(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.requester))
      .send({ subject: '  Printer on floor 2 is jammed  ' })
      .expect(200);
    const body = res.body as TicketResponse;
    expect(body.id).toBe(ticketId);
    expect(body.subject).toBe('Printer on floor 2 is jammed');
    expect(body.description).toBe('Original description');
    const events = await editedEvents(server, ticketId);
    expect(events).toHaveLength(1);
    expect(events[0].payload?.changes).toEqual([
      { field: 'subject', from: 'Re: Re: help', to: 'Printer on floor 2 is jammed' },
    ]);
  });

  it('refuses the requester once an agent has moved the ticket past NEW (403)', async () => {
    await request(server)
      .post(`/api/tickets/${ticketId}/transition`)
      .set(authHeader(fixtureEmails.agent))
      .send({ status: 'TRIAGED' })
      .expect(201);
    await request(server)
      .patch(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.requester))
      .send({ subject: 'Too late for the requester' })
      .expect(403);
  });

  it('lets an agent edit the description and records one TICKET_EDITED event', async () => {
    const res = await request(server)
      .patch(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.agent))
      .send({ description: 'Paper tray 2 jams every second page.' })
      .expect(200);
    expect((res.body as TicketResponse).description).toBe(
      'Paper tray 2 jams every second page.',
    );
    const events = await editedEvents(server, ticketId);
    expect(events).toHaveLength(2);
    const latest = events.find((e) => e.payload?.changes?.[0]?.field === 'description');
    expect(latest?.payload?.changes).toEqual([
      {
        field: 'description',
        from: 'Original description',
        to: 'Paper tray 2 jams every second page.',
      },
    ]);
  });

  it('refuses a different requester and leaves the subject unchanged', async () => {
    const res = await request(server)
      .patch(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.otherRequester))
      .send({ subject: 'Hijacked' });
    expect([403, 404]).toContain(res.status);
    const current = await request(server)
      .get(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    expect((current.body as TicketResponse).subject).toBe(
      'Printer on floor 2 is jammed',
    );
  });

  it('rejects an empty body, a blank subject and an over-long subject (400)', async () => {
    await request(server)
      .patch(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.agent))
      .send({})
      .expect(400);
    await request(server)
      .patch(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.agent))
      .send({ subject: '' })
      .expect(400);
    await request(server)
      .patch(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.agent))
      .send({ subject: 'x'.repeat(201) })
      .expect(400);
    await request(server)
      .patch(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.agent))
      .send({ subject: '   ' })
      .expect(400);
  });

  it('treats an unchanged value as a no-op: 200 and no new event', async () => {
    const before = (await editedEvents(server, ticketId)).length;
    await request(server)
      .patch(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.agent))
      .send({ subject: 'Printer on floor 2 is jammed' })
      .expect(200);
    const after = (await editedEvents(server, ticketId)).length;
    expect(after).toBe(before);
  });
});
