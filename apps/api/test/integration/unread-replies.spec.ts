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

/**
 * Card 1.138 — a row shouts when a reply nobody has read is waiting, and goes
 * quiet the moment the desk opens it.
 *
 * ⚠️ THIS REPLACED `awaitingAgentReply`, WHICH ANSWERED A DIFFERENT QUESTION.
 * That one meant "the requester spoke last" and stayed true after somebody had
 * read the reply - the owner's words were *"seen doesn't show up as reply
 * received"*.
 */
describe('unread replies on a ticket row (card 1.138)', () => {
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

  /** A ticket raised by `raisedBy`, assigned so a "public" reply really is. */
  async function ticketRaisedBy(raisedBy: string): Promise<string> {
    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(raisedBy))
      .send({
        subject: `card 1.138 ${Date.now()}-${Math.random()}`,
        description: 'unread reply fixture',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    const id = (created.body as { id: string }).id;
    await request(server)
      .post(`/api/tickets/${id}/assign`)
      .set(authHeader(fixtureEmails.owner))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);
    return id;
  }

  async function reply(
    ticketId: string,
    who: string,
    type: 'PUBLIC' | 'INTERNAL' = 'PUBLIC',
  ) {
    await request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(who))
      .send({ body: `a ${type} message`, type })
      .expect(201);
  }

  /** The unread count the queue would render for `viewer`. */
  async function unreadFor(ticketId: string, viewer: string): Promise<number> {
    const res = await request(server)
      .get('/api/tickets')
      .query({ pageSize: 100 })
      .set(authHeader(viewer))
      .expect(200);
    const rows = (res.body as { data: { id: string; unreadReplyCount?: number }[] })
      .data;
    const row = rows.find((item) => item.id === ticketId);
    expect(row).toBeDefined();
    return row?.unreadReplyCount ?? 0;
  }

  it('⚠️ a requester reply lights the row up, and opening it puts it out', async () => {
    // THE ASSERTION THIS CARD EXISTS FOR.
    const ticketId = await ticketRaisedBy(fixtureEmails.requester);
    expect(await unreadFor(ticketId, fixtureEmails.agent)).toBe(0);

    await reply(ticketId, fixtureEmails.requester);
    expect(await unreadFor(ticketId, fixtureEmails.agent)).toBe(1);

    await request(server)
      .post(`/api/tickets/${ticketId}/seen`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    expect(await unreadFor(ticketId, fixtureEmails.agent)).toBe(0);
  });

  it('counts each unread reply, and lights up again after one is read', async () => {
    const ticketId = await ticketRaisedBy(fixtureEmails.requester);
    await reply(ticketId, fixtureEmails.requester);
    await reply(ticketId, fixtureEmails.requester);
    expect(await unreadFor(ticketId, fixtureEmails.agent)).toBe(2);

    await request(server)
      .post(`/api/tickets/${ticketId}/seen`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
    expect(await unreadFor(ticketId, fixtureEmails.agent)).toBe(0);

    // They write again after we looked. It has to come back.
    await reply(ticketId, fixtureEmails.requester);
    expect(await unreadFor(ticketId, fixtureEmails.agent)).toBe(1);
  });

  it('⚠️ one person opening it clears it for the whole desk', async () => {
    // The owner chose per-ticket over per-person, so two agents do not both
    // chase one reply.
    const ticketId = await ticketRaisedBy(fixtureEmails.requester);
    await reply(ticketId, fixtureEmails.requester);
    expect(await unreadFor(ticketId, fixtureEmails.lead)).toBe(1);

    await request(server)
      .post(`/api/tickets/${ticketId}/seen`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    expect(await unreadFor(ticketId, fixtureEmails.lead)).toBe(0);
  });

  it("⚠️ the requester opening their OWN ticket does not clear it", async () => {
    // THE SECURITY-SHAPED ONE. If the sender of a reply could mark it read,
    // the queue would go quiet with nobody on the desk having looked - and the
    // portal calls this endpoint on every visit.
    const ticketId = await ticketRaisedBy(fixtureEmails.requester);
    await reply(ticketId, fixtureEmails.requester);

    await request(server)
      .post(`/api/tickets/${ticketId}/seen`)
      .set(authHeader(fixtureEmails.requester))
      .expect(200);

    expect(await unreadFor(ticketId, fixtureEmails.agent)).toBe(1);
  });

  it('the desk talking to itself does not count', async () => {
    // NON-VACUITY, three ways: a public reply from the agent, an internal note,
    // and an internal note from somebody else must all leave the row quiet.
    const ticketId = await ticketRaisedBy(fixtureEmails.requester);
    await reply(ticketId, fixtureEmails.agent);
    await reply(ticketId, fixtureEmails.agent, 'INTERNAL');
    await reply(ticketId, fixtureEmails.owner, 'INTERNAL');

    expect(await unreadFor(ticketId, fixtureEmails.agent)).toBe(0);
  });

  it('⚠️ a requester who is themselves staff still lights the row up', async () => {
    // RELATIONSHIP BEATS RANK, as card 1.83 settled it. `isStaffRole` is
    // `role !== EMPLOYEE`, so a LEAD raising a ticket about her own pay would
    // have her replies counted as the desk's own - and the one person waiting
    // on an answer would be invisible in the queue. Payroll is the only
    // department operationally taking tickets, so this is not hypothetical.
    const ticketId = await ticketRaisedBy(fixtureEmails.lead);
    await reply(ticketId, fixtureEmails.lead);

    expect(await unreadFor(ticketId, fixtureEmails.agent)).toBe(1);
  });

  it('refuses to clear a ticket the caller cannot see', async () => {
    // Otherwise this endpoint answers "does ticket X exist" to anyone holding
    // a token, and lets them silence a queue signal they cannot read.
    const ticketId = await ticketRaisedBy(fixtureEmails.requester);

    await request(server)
      .post(`/api/tickets/${ticketId}/seen`)
      .set(authHeader(fixtureEmails.otherRequester))
      .expect(404);
  });

  it('records who cleared it, so "why did this go quiet?" has an answer', async () => {
    const ticketId = await ticketRaisedBy(fixtureEmails.requester);
    await reply(ticketId, fixtureEmails.requester);
    await request(server)
      .post(`/api/tickets/${ticketId}/seen`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const row = await getPrisma().ticket.findUniqueOrThrow({
      where: { id: ticketId },
      select: { repliesSeenAt: true, repliesSeenById: true },
    });
    expect(row.repliesSeenAt).not.toBeNull();
    expect(row.repliesSeenById).toBe(fixtureUserIds.agent);
  });
});
