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
 * Card 2.1 — least-loaded assignment.
 *
 * Round robin hands the next ticket to the next member whatever they are
 * already holding, so one agent can sit on forty open tickets while another
 * sits on four. LEAST_LOADED picks by load instead, and breaks ties with the
 * same round-robin pointer so a level team still rotates.
 *
 * ⚠️ EVERY TEST HERE IS BUILT SO ROUND ROBIN AND LEAST LOADED DISAGREE. A
 * fixture where both would choose the same person proves nothing about which
 * one ran.
 */
describe('least-loaded assignment (card 2.1)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let memberIds: string[] = [];

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    // The seed creates the three memberships in one statement, so their
    // createdAt values can be identical and the picker's ordering undefined.
    // Space them out: this suite asserts WHO is chosen, so the order the picker
    // sees has to be the order this test believes in.
    const rows = await getPrisma().teamMember.findMany({
      where: { teamId: fixtureTeamIds.it },
      orderBy: { id: 'asc' },
      select: { id: true, userId: true },
    });
    for (let i = 0; i < rows.length; i += 1) {
      await getPrisma().teamMember.update({
        where: { id: rows[i].id },
        data: { createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)) },
      });
    }
    memberIds = rows.map((row) => row.userId);
    expect(memberIds.length).toBe(3);
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  /** Wipe every load on the IT team and lay down an exact one per member. */
  const setLoads = async (loads: Record<string, number>) => {
    await getPrisma().ticket.updateMany({
      where: { assigneeId: { in: memberIds } },
      data: { assigneeId: null },
    });
    for (const [userId, count] of Object.entries(loads)) {
      for (let i = 0; i < count; i += 1) {
        await getPrisma().ticket.create({
          data: {
            subject: `c21 load ${userId} ${i}`,
            description: 'card 2.1 fixture',
            requesterId: fixtureUserIds.requester,
            assignedTeamId: fixtureTeamIds.it,
            assigneeId: userId,
            status: 'ASSIGNED',
          },
        });
      }
    }
  };

  const setTeam = async (
    strategy: 'QUEUE_ONLY' | 'ROUND_ROBIN' | 'LEAST_LOADED',
    lastAssignedUserId: string | null,
  ) => {
    await getPrisma().team.update({
      where: { id: fixtureTeamIds.it },
      data: { assignmentStrategy: strategy, lastAssignedUserId },
    });
  };

  const createTicket = async (subject: string) => {
    const response = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject,
        description: 'card 2.1 fixture',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    return response.body as {
      id: string;
      assignee: { id: string } | null;
      assignedTeam: { id: string } | null;
    };
  };

  const pointer = async () => {
    const team = await getPrisma().team.findUniqueOrThrow({
      where: { id: fixtureTeamIds.it },
      select: { lastAssignedUserId: true },
    });
    return team.lastAssignedUserId;
  };

  it('⚠️ gives the ticket to the lightest member, where round robin would not', async () => {
    const [m0, m1, m2] = memberIds;
    // Pointer on m0, so round robin would take m1 - who is the one drowning.
    await setTeam('LEAST_LOADED', m0);
    await setLoads({ [m0]: 3, [m1]: 9, [m2]: 0 });
    const ticket = await createTicket('c21 lightest wins');
    expect(ticket.assignee?.id).toBe(m2);
    expect(ticket.assignee?.id).not.toBe(m1);
  });

  it('⚠️ skips somebody who is away even when they are the emptiest', async () => {
    // Cards 2.2 and 2.1 composed, which is why they ship in this order.
    // The pointer sits on m1, so round robin would take m0, and "just pick the
    // first member" would take m0 too. Only a real load comparison picks m1.
    const [m0, m1, m2] = memberIds;
    await setTeam('LEAST_LOADED', m1);
    await setLoads({ [m0]: 9, [m1]: 3, [m2]: 0 });
    await getPrisma().user.update({
      where: { id: m2 },
      data: { isAvailable: false, awayUntil: null },
    });
    try {
      const ticket = await createTicket('c21 emptiest is away');
      expect(ticket.assignee?.id).toBe(m1);
      expect(ticket.assignee?.id).not.toBe(m2);
    } finally {
      await getPrisma().user.update({
        where: { id: m2 },
        data: { isAvailable: true, awayUntil: null },
      });
    }
  });

  it('⚠️ breaks a tie with the pointer, and the pointer advances', async () => {
    const [m0, m1, m2] = memberIds;
    await setTeam('LEAST_LOADED', m0);
    await setLoads({ [m0]: 2, [m1]: 2, [m2]: 2 });
    const first = await createTicket('c21 level team a');
    expect(first.assignee?.id).toBe(m1);
    expect(await pointer()).toBe(m1);
    // The new ticket lands on m1, so m1 is now heaviest and the next one goes
    // to the next lightest rather than continuing the rotation blindly.
    await setLoads({ [m0]: 2, [m1]: 2, [m2]: 2 });
    await setTeam('LEAST_LOADED', m1);
    const second = await createTicket('c21 level team b');
    expect(second.assignee?.id).toBe(m2);
    expect(await pointer()).toBe(m2);
  });

  it('⚠️ ROUND_ROBIN is untouched: rotation wins, load is ignored', async () => {
    // Two of the three strategies are existing behaviour and must not move.
    const [m0, m1, m2] = memberIds;
    await setTeam('ROUND_ROBIN', m0);
    await setLoads({ [m0]: 0, [m1]: 9, [m2]: 0 });
    const ticket = await createTicket('c21 round robin unchanged');
    expect(ticket.assignee?.id).toBe(m1);
    expect(await pointer()).toBe(m1);
  });

  it('⚠️ QUEUE_ONLY is untouched: nobody is auto-assigned', async () => {
    const [m0, m1, m2] = memberIds;
    await setTeam('QUEUE_ONLY', m0);
    await setLoads({ [m0]: 5, [m1]: 0, [m2]: 0 });
    const ticket = await createTicket('c21 queue only unchanged');
    expect(ticket.assignee).toBeNull();
    expect(ticket.assignedTeam?.id).toBe(fixtureTeamIds.it);
    // ...and the pointer did not move either.
    expect(await pointer()).toBe(m0);
  });

  it('leaves the ticket unassigned when the whole team is away, whatever the strategy', async () => {
    await setTeam('LEAST_LOADED', null);
    await setLoads({});
    await getPrisma().user.updateMany({
      where: { id: { in: memberIds } },
      data: { isAvailable: false, awayUntil: null },
    });
    try {
      const ticket = await createTicket('c21 nobody here');
      expect(ticket.assignee).toBeNull();
      expect(ticket.assignedTeam?.id).toBe(fixtureTeamIds.it);
    } finally {
      await getPrisma().user.updateMany({
        where: { id: { in: memberIds } },
        data: { isAvailable: true, awayUntil: null },
      });
    }
  });

  it('⚠️ does not count a FINISHED ticket as load', async () => {
    // The third card in a row that could have invented a new "open". A
    // status-only count would see m2 as the heaviest here and pick somebody
    // else; notFinishedFilter() reads the stamp as well.
    const [m0, m1, m2] = memberIds;
    await setTeam('LEAST_LOADED', m1);
    await setLoads({ [m0]: 4, [m1]: 4, [m2]: 0 });
    for (let i = 0; i < 6; i += 1) {
      await getPrisma().ticket.create({
        data: {
          subject: `c21 finished ${i}`,
          description: 'card 2.1 fixture',
          requesterId: fixtureUserIds.requester,
          assignedTeamId: fixtureTeamIds.it,
          assigneeId: m2,
          status: 'ASSIGNED',
          completedAt: new Date(),
        },
      });
    }
    const ticket = await createTicket('c21 finished work is not load');
    expect(ticket.assignee?.id).toBe(m2);
  });

  it('⚠️ the second of two simultaneous tickets sees the first one land', async () => {
    // THE REASON THE COUNT IS TAKEN INSIDE THE `FOR UPDATE` TRANSACTION. The
    // loads are 5 / 1 / 0, so the first ticket goes to m2 and takes them to 1.
    // The second must then see m2 at 1 - a tie with m1, which the pointer
    // (now m2) breaks in m1's favour. A count read outside the lock would still
    // show m2 at 0 and both tickets would pile onto the same person, which is
    // the exact failure this strategy exists to prevent.
    const [m0, m1, m2] = memberIds;
    await setTeam('LEAST_LOADED', m0);
    await setLoads({ [m0]: 5, [m1]: 1, [m2]: 0 });
    const [a, b] = await Promise.all([
      createTicket('c21 concurrent a'),
      createTicket('c21 concurrent b'),
    ]);
    expect(a.assignee?.id).toBeTruthy();
    expect(b.assignee?.id).toBeTruthy();
    expect(a.assignee?.id).not.toBe(b.assignee?.id);
    expect([a.assignee?.id, b.assignee?.id].sort()).toEqual([m1, m2].sort());
  });
});
