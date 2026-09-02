import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
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

type TicketResponse = { id: string; displayId?: string | null };

/**
 * The agent name as it was queued, read off the outbox row's event payload.
 *
 * Asserting here rather than on a composed header keeps the suite away from a
 * real send: nothing in these tests opens a socket. The header itself is
 * covered end to end in email.service.spec.ts.
 */
function queuedAgentName(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  const event = (payload as { event?: unknown }).event;
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return undefined;
  }
  const name = (event as { agentDisplayName?: unknown }).agentDisplayName;
  return typeof name === 'string' ? name : undefined;
}

describe('Outbound From identity', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let prisma: PrismaService;
  let ownerDisplayName: string;

  async function createTicket(teamId: string): Promise<TicketResponse> {
    const response = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `From identity ${Date.now()}-${Math.random()}`,
        description: 'Which name signs the reply?',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: teamId,
      })
      .expect(201);
    return response.body as TicketResponse;
  }

  async function replyAsOwner(ticketId: string): Promise<void> {
    await request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.owner))
      .send({ body: 'Looking into this now.', type: 'PUBLIC' })
      .expect(201);
  }

  const messageRows = (ticketId: string) =>
    prisma.notificationOutbox.findMany({
      where: { ticketId, eventType: 'MESSAGE_ADDED' },
    });

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    prisma = app.get(PrismaService);
    const owner = await prisma.user.findUnique({
      where: { email: fixtureEmails.owner },
      select: { displayName: true },
    });
    ownerDisplayName = owner?.displayName ?? '';
    expect(ownerDisplayName).not.toBe('');
  });

  afterAll(async () => {
    await app.close();
  });

  it('names the person who replied on an ordinary team', async () => {
    const ticket = await createTicket(fixtureTeamIds.it);
    await replyAsOwner(ticket.id);
    const rows = await messageRows(ticket.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(queuedAgentName(row.payload)).toBe(ownerDisplayName);
    }
  });

  it('stays anonymous on a team in EMAIL_GENERIC_IDENTITY_TEAMS', async () => {
    // `hr` is in the default list (hr,payroll) because of termination work, so
    // this exercises the real default rather than a test-only override.
    const ticket = await createTicket(fixtureTeamIds.hr);
    await replyAsOwner(ticket.id);
    const rows = await messageRows(ticket.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(queuedAgentName(row.payload)).toBeUndefined();
    }
  });

  it('leaves every system-raised notification anonymous', async () => {
    const ticket = await createTicket(fixtureTeamIds.it);
    // Assignment is worker- and system-raised: a person acted, but the message
    // is not theirs, so the desk signs it. Deliberately not a status
    // transition - auto-assign may already have moved the ticket, which makes
    // the transition invalid and the test flaky rather than wrong.
    await request(server)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set(authHeader(fixtureEmails.lead))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);
    const rows = await prisma.notificationOutbox.findMany({
      where: { ticketId: ticket.id, eventType: { not: 'MESSAGE_ADDED' } },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(queuedAgentName(row.payload)).toBeUndefined();
    }
  });

  it('queues no email at all for an internal note', async () => {
    // REPLACES a card 1.31 test that asserted an internal note carried the
    // writer's name. Card 1.33 section 4.0b removed the email entirely: staff
    // read the note in the ticket and get the in-app notification, and an
    // internal note that queued email is what used to move the thread pointer
    // so a requester's next email referenced a note they never received.
    const ticket = await createTicket(fixtureTeamIds.it);
    await request(server)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set(authHeader(fixtureEmails.lead))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);
    await request(server)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set(authHeader(fixtureEmails.owner))
      .send({ body: 'Internal: checking with the vendor.', type: 'INTERNAL' })
      .expect(201);
    expect(await messageRows(ticket.id)).toHaveLength(0);
  });
});
