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
 * Card 2.2 — auto-assignment was sending tickets to people on leave.
 *
 * The picker (`tickets.service.ts`) locks the team row `FOR UPDATE`, reads its
 * members in `createdAt` order and hands the ticket to whoever follows
 * `lastAssignedUserId`. Nothing in that asked whether the person was there.
 *
 * ⚠️ THE BEHAVIOUR CHANGE THIS CARD INTRODUCES is that the member list can now
 * be empty. A team whose every member is away auto-assigns nobody, and the
 * ticket stays unassigned — deliberately. An unassigned ticket sits in the
 * team's queue where somebody sees it; one assigned to somebody on leave is
 * invisible until they come back. The team routing must survive, or the ticket
 * falls out of every queue view, and that is asserted below.
 */
describe('auto-assignment skips people who are away (card 2.2)', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    // The picker only runs for ROUND_ROBIN teams.
    await getPrisma().team.update({
      where: { id: fixtureTeamIds.it },
      data: { assignmentStrategy: 'ROUND_ROBIN', lastAssignedUserId: null },
    });
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  /** Everyone on the IT team, so a test can set availability precisely. */
  const itMembers = async () =>
    getPrisma().teamMember.findMany({
      where: { teamId: fixtureTeamIds.it },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });

  const setAvailability = async (
    userIds: string[],
    data: { isAvailable: boolean; awayUntil?: Date | null },
  ) => {
    await getPrisma().user.updateMany({
      where: { id: { in: userIds } },
      data: { awayUntil: null, ...data },
    });
  };

  const createTicket = async (subject: string) => {
    const response = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject,
        description: 'card 2.2 fixture',
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

  it('⚠️ never auto-assigns to someone who is away', async () => {
    // THE CARD'S WHOLE POINT. Everyone away but one person; every ticket must
    // land on that one person however many times the pointer advances.
    const members = await itMembers();
    expect(members.length).toBeGreaterThan(1);
    const [present, ...away] = members.map((m) => m.userId);
    await setAvailability([present], { isAvailable: true });
    await setAvailability(away, { isAvailable: false });

    for (let i = 0; i < 3; i += 1) {
      const ticket = await createTicket(`c22 away skip ${i}`);
      expect(ticket.assignee?.id).toBe(present);
    }
  });

  it('⚠️ still auto-assigns to someone who is here', async () => {
    // THE NON-VACUITY HALF. A filter that excluded everybody would pass the
    // test above and be useless - every ticket would simply be unassigned.
    const members = await itMembers();
    await setAvailability(
      members.map((m) => m.userId),
      { isAvailable: true },
    );
    const ticket = await createTicket('c22 everyone present');
    expect(ticket.assignee?.id).toBeTruthy();
    expect(members.map((m) => m.userId)).toContain(ticket.assignee?.id);
  });

  it('⚠️ leaves the ticket unassigned but STILL ROUTED TO THE TEAM when everyone is away', async () => {
    // The behaviour change, pinned. Losing the team as well would drop the
    // ticket out of every queue view - it would be assigned to nobody and
    // visible to nobody, which is strictly worse than the bug being fixed.
    const members = await itMembers();
    await setAvailability(
      members.map((m) => m.userId),
      { isAvailable: false },
    );
    const ticket = await createTicket('c22 whole team away');
    expect(ticket.assignee).toBeNull();
    expect(ticket.assignedTeam?.id).toBe(fixtureTeamIds.it);

    // ...and it is genuinely reachable in the team's queue, not merely stamped
    // with a team id.
    const queue = await request(server)
      .get(`/api/tickets?teamIds=${fixtureTeamIds.it}&scope=unassigned&pageSize=50`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const ids = (queue.body as { data: { id: string }[] }).data.map((t) => t.id);
    expect(ids).toContain(ticket.id);
  });

  it('⚠️ treats a past awayUntil as back, without waiting for the job', async () => {
    // Correctness must not depend on a worker having run. If the scheduler is
    // wedged, somebody whose return date has passed still gets work.
    const members = await itMembers();
    const [first, ...rest] = members.map((m) => m.userId);
    await setAvailability(rest, { isAvailable: false });
    await setAvailability([first], {
      isAvailable: false,
      awayUntil: new Date(Date.now() - 60 * 60_000),
    });
    const ticket = await createTicket('c22 return date passed');
    expect(ticket.assignee?.id).toBe(first);
  });

  it('does not treat a FUTURE awayUntil as back', async () => {
    // The discriminating half of the rule above.
    const members = await itMembers();
    await setAvailability(
      members.map((m) => m.userId),
      { isAvailable: false, awayUntil: new Date(Date.now() + 24 * 60 * 60_000) },
    );
    const ticket = await createTicket('c22 still away');
    expect(ticket.assignee).toBeNull();
  });

  it('⚠️ two tickets arriving together do not both take the same slot', async () => {
    // The `FOR UPDATE` behaviour, which the availability filter had to be added
    // INSIDE rather than alongside. If the member read moved out of the lock
    // this is what would start failing, intermittently.
    const members = await itMembers();
    await setAvailability(
      members.map((m) => m.userId),
      { isAvailable: true },
    );
    await getPrisma().team.update({
      where: { id: fixtureTeamIds.it },
      data: { lastAssignedUserId: null },
    });
    const [a, b] = await Promise.all([
      createTicket('c22 concurrent a'),
      createTicket('c22 concurrent b'),
    ]);
    expect(a.assignee?.id).toBeTruthy();
    expect(b.assignee?.id).toBeTruthy();
    expect(a.assignee?.id).not.toBe(b.assignee?.id);
  });
});
