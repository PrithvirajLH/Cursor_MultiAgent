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

type Availability = { isAvailable: boolean; awayUntil: string | null };
type MyOpen = { count: number; ticketIds: string[]; truncated: boolean };
type BulkResult = {
  data: {
    success: number;
    failed: number;
    succeededTicketIds: string[];
    errors: { ticketId: string; message: string }[];
  };
};

/**
 * Card 2.2 — the half of the card that is endpoints rather than assignment.
 * The picker itself is covered by `assignment.availability.spec.ts`.
 */
describe('availability, my open tickets and unassign (card 2.2)', () => {
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

  afterEach(async () => {
    await getPrisma().user.update({
      where: { id: fixtureUserIds.agent },
      data: { isAvailable: true, awayUntil: null },
    });
  });

  const getAvailability = async (email: string) => {
    const res = await request(server)
      .get('/api/users/me/availability')
      .set(authHeader(email))
      .expect(200);
    return res.body as Availability;
  };

  const setAvailability = async (
    email: string,
    payload: { isAvailable: boolean; awayUntil?: string | null },
    expected = 200,
  ) => {
    const res = await request(server)
      .patch('/api/users/me/availability')
      .set(authHeader(email))
      .send(payload)
      .expect(expected);
    return res.body as Availability;
  };

  it('starts available, with no return date', async () => {
    expect(await getAvailability(fixtureEmails.agent)).toEqual({
      isAvailable: true,
      awayUntil: null,
    });
  });

  it('stores away with a return date, and reads it back', async () => {
    const awayUntil = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
    const saved = await setAvailability(fixtureEmails.agent, {
      isAvailable: false,
      awayUntil,
    });
    expect(saved).toEqual({ isAvailable: false, awayUntil });
    expect(await getAvailability(fixtureEmails.agent)).toEqual({
      isAvailable: false,
      awayUntil,
    });
  });

  it('⚠️ only ever touches the caller — one agent going away leaves the other here', async () => {
    // The authorisation story: there is no user id in the route, so this is the
    // assertion that it cannot reach anybody else.
    await setAvailability(fixtureEmails.agent, {
      isAvailable: false,
      awayUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    expect(await getAvailability(fixtureEmails.lead)).toEqual({
      isAvailable: true,
      awayUntil: null,
    });
  });

  it('clears the return date when coming back', async () => {
    await setAvailability(fixtureEmails.agent, {
      isAvailable: false,
      awayUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
    });
    const back = await setAvailability(fixtureEmails.agent, {
      isAvailable: true,
    });
    expect(back).toEqual({ isAvailable: true, awayUntil: null });
  });

  it('⚠️ refuses a return date in the past rather than storing "already back"', async () => {
    await setAvailability(
      fixtureEmails.agent,
      {
        isAvailable: false,
        awayUntil: new Date(Date.now() - 60 * 60_000).toISOString(),
      },
      400,
    );
    // ...and nothing was written.
    expect(await getAvailability(fixtureEmails.agent)).toEqual({
      isAvailable: true,
      awayUntil: null,
    });
  });

  it('accepts away with no end date at all', async () => {
    const saved = await setAvailability(fixtureEmails.agent, {
      isAvailable: false,
    });
    expect(saved).toEqual({ isAvailable: false, awayUntil: null });
  });

  describe('my open tickets', () => {
    const seed = async (data: {
      subject: string;
      status: 'ASSIGNED' | 'RESOLVED';
      completedAt: Date | null;
      assigneeId: string | null;
    }) => {
      const res = await request(server)
        .post('/api/tickets')
        .set(authHeader(fixtureEmails.requester))
        .send({
          subject: data.subject,
          description: 'card 2.2 fixture',
          priority: 'SEV3',
          channel: 'PORTAL',
          assignedTeamId: fixtureTeamIds.it,
        })
        .expect(201);
      const id = (res.body as { id: string }).id;
      await getPrisma().ticket.update({
        where: { id },
        data: {
          status: data.status,
          completedAt: data.completedAt,
          assigneeId: data.assigneeId,
        },
      });
      return id;
    };

    const myOpen = async (email: string) => {
      const res = await request(server)
        .get('/api/tickets/my-open')
        .set(authHeader(email))
        .expect(200);
      return res.body as MyOpen;
    };

    beforeAll(async () => {
      // Anything the base fixture already left on the agent would make the
      // counts below unreadable.
      await getPrisma().ticket.updateMany({
        where: { assigneeId: fixtureUserIds.agent },
        data: { assigneeId: null },
      });
    });

    it('⚠️ counts unfinished tickets assigned to me, and excludes a finished one', async () => {
      const openA = await seed({
        subject: 'c22 mine open a',
        status: 'ASSIGNED',
        completedAt: null,
        assigneeId: fixtureUserIds.agent,
      });
      const openB = await seed({
        subject: 'c22 mine open b',
        status: 'ASSIGNED',
        completedAt: null,
        assigneeId: fixtureUserIds.agent,
      });
      await seed({
        subject: 'c22 mine resolved',
        status: 'RESOLVED',
        completedAt: new Date(),
        assigneeId: fixtureUserIds.agent,
      });
      await seed({
        subject: 'c22 someone else open',
        status: 'ASSIGNED',
        completedAt: null,
        assigneeId: fixtureUserIds.lead,
      });
      const mine = await myOpen(fixtureEmails.agent);
      expect(mine.count).toBe(2);
      expect([...mine.ticketIds].sort()).toEqual([openA, openB].sort());
      expect(mine.truncated).toBe(false);
    });

    it('⚠️ excludes a ticket stamped completedAt even though its STATUS still reads open', async () => {
      // THE DISCRIMINATING CASE for card 1.72. `statusGroup=open` on the list
      // endpoint is status-only and would count this one; `notFinishedFilter()`
      // does not. If this ever passes with a status-only filter, the card's
      // "do not write a fourth definition" instruction has been broken.
      const before = await myOpen(fixtureEmails.agent);
      const stamped = await seed({
        subject: 'c22 stamped but not resolved',
        status: 'ASSIGNED',
        completedAt: new Date(),
        assigneeId: fixtureUserIds.agent,
      });
      const after = await myOpen(fixtureEmails.agent);
      expect(after.count).toBe(before.count);
      expect(after.ticketIds).not.toContain(stamped);
    });

    it('⚠️ hands the queue back its tickets: unassigned, still on the team', async () => {
      const mine = await myOpen(fixtureEmails.agent);
      expect(mine.count).toBeGreaterThan(0);
      const res = await request(server)
        .post('/api/tickets/bulk/unassign')
        .set(authHeader(fixtureEmails.agent))
        .send({ ticketIds: mine.ticketIds })
        .expect(201);
      const body = res.body as BulkResult;
      expect(body.data.failed).toBe(0);
      expect(body.data.success).toBe(mine.ticketIds.length);

      const rows = await getPrisma().ticket.findMany({
        where: { id: { in: mine.ticketIds } },
        select: { id: true, assigneeId: true, assignedTeamId: true },
      });
      for (const row of rows) {
        expect(row.assigneeId).toBeNull();
        // ⚠️ Still routed to the team, or it falls out of every queue view.
        expect(row.assignedTeamId).toBe(fixtureTeamIds.it);
      }
      // ...and it is genuinely reachable in that queue.
      const queue = await request(server)
        .get(
          `/api/tickets?teamIds=${fixtureTeamIds.it}&scope=unassigned&pageSize=100`,
        )
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      const ids = (queue.body as { data: { id: string }[] }).data.map(
        (t) => t.id,
      );
      for (const id of mine.ticketIds) {
        expect(ids).toContain(id);
      }
      // The list is now empty, which is the point of the button.
      expect((await myOpen(fixtureEmails.agent)).count).toBe(0);
    });

    it('records one TICKET_UNASSIGNED event, and a second call is a no-op', async () => {
      const id = await seed({
        subject: 'c22 idempotent unassign',
        status: 'ASSIGNED',
        completedAt: null,
        assigneeId: fixtureUserIds.agent,
      });
      for (let i = 0; i < 2; i += 1) {
        const res = await request(server)
          .post('/api/tickets/bulk/unassign')
          .set(authHeader(fixtureEmails.agent))
          .send({ ticketIds: [id] })
          .expect(201);
        expect((res.body as BulkResult).data.failed).toBe(0);
      }
      const events = await getPrisma().ticketEvent.count({
        where: { ticketId: id, type: 'TICKET_UNASSIGNED' },
      });
      expect(events).toBe(1);
    });

    it('reports a ticket the caller may not assign as failed, without stopping the batch', async () => {
      const mine = await seed({
        subject: 'c22 agent own',
        status: 'ASSIGNED',
        completedAt: null,
        assigneeId: fixtureUserIds.agent,
      });
      const otherTeam = await seed({
        subject: 'c22 other team',
        status: 'ASSIGNED',
        completedAt: null,
        assigneeId: fixtureUserIds.lead,
      });
      await getPrisma().ticket.update({
        where: { id: otherTeam },
        data: { assignedTeamId: fixtureTeamIds.hr },
      });
      const res = await request(server)
        .post('/api/tickets/bulk/unassign')
        .set(authHeader(fixtureEmails.agent))
        .send({ ticketIds: [mine, otherTeam] })
        .expect(201);
      const body = res.body as BulkResult;
      expect(body.data.succeededTicketIds).toEqual([mine]);
      expect(body.data.failed).toBe(1);
      expect(body.data.errors[0].ticketId).toBe(otherTeam);
    });
  });
});
