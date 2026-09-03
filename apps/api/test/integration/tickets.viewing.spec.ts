import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { RealtimeService } from '../../src/realtime/realtime.service';
import {
  fixtureEmails,
  fixtureTeamIds,
  fixtureUserIds,
} from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

/**
 * Card 1.9 — "someone is already on this".
 *
 * THE AUDIENCE IS A SECURITY BOUNDARY, not a convenience. `ticket.viewing`
 * reuses the `ticket.typing` audience exactly: the set of people who may be
 * told that a ticket is being read is precisely the set who may open it. A
 * broader one would tell somebody a ticket exists, and who is reading it, when
 * they cannot see the ticket itself - which is cards 1.36 and 1.38 in another
 * form. The negative assertion below is the one that matters.
 */
describe('Ticket viewing presence', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;
  let published: { event: string; payload: unknown; audience: unknown }[] = [];

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;

    // Capture what would go out, so the audience can be asserted directly
    // rather than inferred.
    const realtime = app.get(RealtimeService);
    jest.spyOn(realtime, 'isEnabled').mockReturnValue(true);
    for (const method of ['publishTicketViewing', 'publishTicketTyping'] as const) {
      jest
        .spyOn(realtime, method)
        .mockImplementation(async (payload: unknown, audience: unknown) => {
          published.push({ event: method, payload, audience });
        });
    }
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await disconnectPrisma();
  });

  beforeEach(() => {
    published = [];
  });

  let seq = 0;
  async function makeTicket(overrides: Record<string, unknown> = {}) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        requesterId: fixtureUserIds.requester,
        subject: `1.9 viewing fixture ${seq}`,
        description: 'Fixture for presence.',
        assignedTeamId: fixtureTeamIds.it,
        assigneeId: fixtureUserIds.agent,
        ...overrides,
      },
      select: { id: true },
    });
  }

  const audienceOf = () => {
    const last = published[published.length - 1];
    return (last?.audience as { userIds: string[] })?.userIds ?? [];
  };

  it('publishes to the SAME audience as typing, for the same ticket', async () => {
    const ticket = await makeTicket();

    await request(server)
      .post(`/api/tickets/${ticket.id}/typing`)
      .set(authHeader(fixtureEmails.agent))
      .send({ isTyping: true })
      .expect(201);
    const typingAudience = [...audienceOf()].sort();

    published = [];
    await request(server)
      .post(`/api/tickets/${ticket.id}/viewing`)
      .set(authHeader(fixtureEmails.agent))
      .send({ isViewing: true })
      .expect(201);
    const viewingAudience = [...audienceOf()].sort();

    expect(viewingAudience.length).toBeGreaterThan(0);
    expect(viewingAudience).toEqual(typingAudience);
  });

  it('NEVER reaches somebody who cannot see the ticket', async () => {
    // The assertion this card exists for. otherRequester is an EMPLOYEE with no
    // relationship to the ticket and no team scope, so card 1.36's rules keep
    // them out - and so must this.
    const ticket = await makeTicket();
    await request(server)
      .post(`/api/tickets/${ticket.id}/viewing`)
      .set(authHeader(fixtureEmails.agent))
      .send({ isViewing: true })
      .expect(201);

    expect(audienceOf()).not.toContain(fixtureUserIds.otherRequester);
    // ...and positively, it does reach somebody who can.
    expect(audienceOf()).toContain(fixtureUserIds.requester);
  });

  it('refuses the announcement from somebody who cannot see the ticket', async () => {
    const ticket = await makeTicket();
    await request(server)
      .post(`/api/tickets/${ticket.id}/viewing`)
      .set(authHeader(fixtureEmails.otherRequester))
      .send({ isViewing: false })
      .expect(403);
    expect(published).toHaveLength(0);
  });

  it('lets a peer agent announce, which is the whole point', async () => {
    // Assigned to somebody else on the same team: this agent cannot WRITE the
    // ticket, and is exactly the person whose presence prevents a collision.
    // A canWriteTicket gate would have excluded them.
    const ticket = await makeTicket({ assigneeId: fixtureUserIds.lead });
    await request(server)
      .post(`/api/tickets/${ticket.id}/viewing`)
      .set(authHeader(fixtureEmails.agent))
      .send({ isViewing: true })
      .expect(201);
    expect(published).toHaveLength(1);
  });

  it('carries the actor and the flag through to the payload', async () => {
    const ticket = await makeTicket();
    await request(server)
      .post(`/api/tickets/${ticket.id}/viewing`)
      .set(authHeader(fixtureEmails.agent))
      .send({ isViewing: false })
      .expect(201);
    expect(published[0].payload).toMatchObject({
      ticketId: ticket.id,
      actorId: fixtureUserIds.agent,
      isViewing: false,
    });
  });

  it('404s for a ticket that does not exist, and publishes nothing', async () => {
    await request(server)
      .post('/api/tickets/11111111-2222-4333-8444-555555555555/viewing')
      .set(authHeader(fixtureEmails.agent))
      .send({ isViewing: true })
      .expect(404);
    expect(published).toHaveLength(0);
  });

  it('rejects a payload that is not a boolean', async () => {
    const ticket = await makeTicket();
    await request(server)
      .post(`/api/tickets/${ticket.id}/viewing`)
      .set(authHeader(fixtureEmails.agent))
      .send({ isViewing: 'yes' })
      .expect(400);
  });
});
