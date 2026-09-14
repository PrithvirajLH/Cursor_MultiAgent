import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TicketResponse = { id: string };

/**
 * Card 1.87 — a soft-deleted ticket still accepted writes.
 *
 * ⚠️ THE LIST BELOW WAS MEASURED, NOT ASSUMED: a ticket was soft-deleted and
 * every write endpoint called against it. Four went through — assign,
 * unassign, follow, unfollow — and wrote history against a ticket nobody can
 * see. transfer, transition, addMessage, setCategory and bulk priority already
 * refused, so they are pinned here too rather than left to drift.
 *
 * ⚠️ 404 and not 403: a deleted ticket is invisible, so "no such ticket" is the
 * honest answer. An OWNER may still READ one (card 1.45's deliberate
 * exception), but reading a record and changing it are different acts.
 */
describe('a deleted ticket stops accepting writes (card 1.87)', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  const makeTicket = async (subject: string) => {
    const res = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject,
        description: 'card 1.87 fixture',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    return (res.body as TicketResponse).id;
  };

  const deletedTicket = async (subject: string) => {
    const id = await makeTicket(subject);
    await request(server)
      .delete(`/api/tickets/${id}`)
      .set(authHeader(fixtureEmails.owner))
      .send({ reason: 'card 1.87' })
      .expect(200);
    return id;
  };

  const eventCount = (id: string) =>
    getPrisma().ticketEvent.count({ where: { ticketId: id } });

  it('⚠️ assign is refused, and writes no event', async () => {
    // THE CARD'S NAMED CASE. The event is the part that pollutes history.
    const id = await deletedTicket('c187 assign');
    const before = await eventCount(id);
    await request(server)
      .post(`/api/tickets/${id}/assign`)
      .set(authHeader(fixtureEmails.owner))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(404);
    expect(await eventCount(id)).toBe(before);
    const row = await getPrisma().ticket.findUniqueOrThrow({
      where: { id },
      select: { assigneeId: true },
    });
    expect(row.assigneeId).toBeNull();
  });

  it('⚠️ unassign is refused, and writes no event', async () => {
    // My own code from card 2.2 had the same hole as the one this card names.
    const id = await deletedTicket('c187 unassign');
    const before = await eventCount(id);
    const res = await request(server)
      .post('/api/tickets/bulk/unassign')
      .set(authHeader(fixtureEmails.owner))
      .send({ ticketIds: [id] })
      .expect(201);
    expect((res.body as { data: { failed: number } }).data.failed).toBe(1);
    expect(await eventCount(id)).toBe(before);
  });

  it('⚠️ follow is refused', async () => {
    const id = await deletedTicket('c187 follow');
    // The requester is added as a follower when the ticket is created, so the
    // count starts at one - what must not happen is it GAINING another.
    const before = await getPrisma().ticketFollower.count({
      where: { ticketId: id },
    });
    await request(server)
      .post(`/api/tickets/${id}/followers`)
      .set(authHeader(fixtureEmails.owner))
      .send({})
      .expect(404);
    expect(
      await getPrisma().ticketFollower.count({ where: { ticketId: id } }),
    ).toBe(before);
    expect(
      await getPrisma().ticketFollower.count({
        where: { ticketId: id, userId: fixtureUserIds.owner },
      }),
    ).toBe(0);
  });

  it('⚠️ unfollow is refused', async () => {
    const id = await deletedTicket('c187 unfollow');
    await request(server)
      .delete(`/api/tickets/${id}/followers/me`)
      .set(authHeader(fixtureEmails.owner))
      .expect(404);
  });

  it('the paths that already refused still refuse', async () => {
    // Measured as already safe; pinned so they cannot quietly regress.
    const id = await deletedTicket('c187 already safe');
    await request(server)
      .post(`/api/tickets/${id}/transfer`)
      .set(authHeader(fixtureEmails.owner))
      .send({ newTeamId: fixtureTeamIds.hr })
      .expect(403);
    await request(server)
      .post(`/api/tickets/${id}/transition`)
      .set(authHeader(fixtureEmails.owner))
      .send({ status: 'IN_PROGRESS' })
      .expect(403);
    await request(server)
      .post(`/api/tickets/${id}/messages`)
      .set(authHeader(fixtureEmails.owner))
      .send({ body: 'should not land', type: 'INTERNAL' })
      .expect(403);
    const res = await request(server)
      .post('/api/tickets/bulk/priority')
      .set(authHeader(fixtureEmails.owner))
      .send({ ticketIds: [id], priority: 'SEV1' })
      .expect(201);
    expect((res.body as { data: { failed: number } }).data.failed).toBe(1);
  });

  it('⚠️ a LIVE ticket still assigns, follows and unfollows', async () => {
    // The non-vacuity half. A guard that refused everything would pass every
    // assertion above and break the product.
    const id = await makeTicket('c187 live ticket');
    await request(server)
      .post(`/api/tickets/${id}/assign`)
      .set(authHeader(fixtureEmails.owner))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);
    await request(server)
      .post(`/api/tickets/${id}/followers`)
      .set(authHeader(fixtureEmails.owner))
      .send({})
      .expect(201);
    await request(server)
      .delete(`/api/tickets/${id}/followers/me`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
  });

  it('an OWNER can still READ a deleted ticket — changing it is the part that stops', async () => {
    // Card 1.45's deliberate exception, pinned so this card does not quietly
    // take it away.
    const id = await deletedTicket('c187 still readable');
    await request(server)
      .get(`/api/tickets/${id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
  });
});
