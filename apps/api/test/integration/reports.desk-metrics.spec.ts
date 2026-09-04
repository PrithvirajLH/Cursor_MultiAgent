import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
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
 * Card 1.17 — the three desk metrics the other 22 reports could not answer.
 *
 * The figures are the point, so these tests plant known data and assert exact
 * numbers rather than "an array came back". A KPI that is merely well-shaped
 * and quietly wrong is worse than a missing one: somebody will make a staffing
 * decision on it.
 *
 * The scoping tests matter as much as the arithmetic. Every report on this
 * controller runs through `scopeReportQuery`, which pins a LEAD to their own
 * team; an unscoped desk metric would show one team's leader another team's
 * performance.
 */
describe('Desk metrics reports (card 1.17)', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;

  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
  const range = {
    from: hoursAgo(24 * 7).toISOString(),
    to: new Date(now.getTime() + 3600_000).toISOString(),
  };

  let ticketSeq = 0;

  /** A ticket owned by a team, optionally already resolved. */
  async function plantTicket(opts: {
    teamId: string;
    resolvedAt?: Date;
    createdAt?: Date;
    deletedAt?: Date;
  }) {
    ticketSeq += 1;
    return prisma.ticket.create({
      data: {
        subject: `Desk metric fixture ${ticketSeq}`,
        description: 'Fixture',
        requesterId: fixtureUserIds.requester,
        assignedTeamId: opts.teamId,
        assigneeId: fixtureUserIds.agent,
        status: opts.resolvedAt ? 'RESOLVED' : 'IN_PROGRESS',
        resolvedAt: opts.resolvedAt ?? null,
        createdAt: opts.createdAt ?? hoursAgo(48),
        deletedAt: opts.deletedAt ?? null,
      },
      select: { id: true },
    });
  }

  async function message(
    ticketId: string,
    authorId: string,
    type: 'PUBLIC' | 'INTERNAL',
  ) {
    await prisma.ticketMessage.create({
      data: { ticketId, authorId, type, body: 'fixture' },
    });
  }

  async function event(
    ticketId: string,
    type: string,
    createdAt: Date,
    payload?: Prisma.InputJsonValue,
  ) {
    await prisma.ticketEvent.create({
      data: { ticketId, type, createdAt, payload: payload ?? {} },
    });
  }

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  describe('first-contact resolution', () => {
    const get = (email: string) =>
      request(server)
        .get('/api/reports/first-contact-resolution')
        .query(range)
        .set(authHeader(email));

    beforeAll(async () => {
      await prisma.ticket.deleteMany({});

      // 1. One desk reply. First contact.
      const one = await plantTicket({
        teamId: fixtureTeamIds.it,
        resolvedAt: hoursAgo(2),
      });
      await message(one.id, fixtureUserIds.agent, 'PUBLIC');

      // 2. Two desk replies. Not first contact.
      const two = await plantTicket({
        teamId: fixtureTeamIds.it,
        resolvedAt: hoursAgo(3),
      });
      await message(two.id, fixtureUserIds.agent, 'PUBLIC');
      await message(two.id, fixtureUserIds.lead, 'PUBLIC');

      // 3. One desk reply plus three from the REQUESTER, and two internal
      //    notes. Still first contact: neither is one of our answers.
      const noisy = await plantTicket({
        teamId: fixtureTeamIds.it,
        resolvedAt: hoursAgo(4),
      });
      await message(noisy.id, fixtureUserIds.agent, 'PUBLIC');
      await message(noisy.id, fixtureUserIds.requester, 'PUBLIC');
      await message(noisy.id, fixtureUserIds.requester, 'PUBLIC');
      await message(noisy.id, fixtureUserIds.requester, 'PUBLIC');
      await message(noisy.id, fixtureUserIds.agent, 'INTERNAL');
      await message(noisy.id, fixtureUserIds.lead, 'INTERNAL');

      // 4. Resolved with no reply at all - a duplicate closed on sight.
      //    <= 1 includes 0.
      await plantTicket({
        teamId: fixtureTeamIds.it,
        resolvedAt: hoursAgo(5),
      });

      // 5. Not resolved. Out of the denominator entirely.
      const open = await plantTicket({ teamId: fixtureTeamIds.it });
      await message(open.id, fixtureUserIds.agent, 'PUBLIC');

      // 6. Another team's, resolved with four replies. The scoping fixture.
      const hr = await plantTicket({
        teamId: fixtureTeamIds.hr,
        resolvedAt: hoursAgo(6),
      });
      await message(hr.id, fixtureUserIds.agent, 'PUBLIC');
      await message(hr.id, fixtureUserIds.agent, 'PUBLIC');
      await message(hr.id, fixtureUserIds.agent, 'PUBLIC');
      await message(hr.id, fixtureUserIds.agent, 'PUBLIC');

      // 7. Soft-deleted, resolved, four replies. Must not drag the figure down.
      const deleted = await plantTicket({
        teamId: fixtureTeamIds.it,
        resolvedAt: hoursAgo(7),
        deletedAt: hoursAgo(1),
      });
      await message(deleted.id, fixtureUserIds.agent, 'PUBLIC');
      await message(deleted.id, fixtureUserIds.agent, 'PUBLIC');
    });

    it('counts only the desk\'s own public replies', async () => {
      // OWNER sees every team: 5 resolved and undeleted (1, 2, 3, 4, 6), of
      // which 1, 3 and 4 had at most one desk reply.
      const res = await get(fixtureEmails.owner).expect(200);
      expect(res.body).toEqual({
        resolved: 5,
        firstContact: 3,
        percent: 60,
      });
    });

    it('scopes a LEAD to their own team', async () => {
      // The IT lead sees 1, 2, 3, 4 only - the HR ticket is not theirs. Four
      // resolved, three first contact.
      const res = await get(fixtureEmails.lead).expect(200);
      expect(res.body).toEqual({
        resolved: 4,
        firstContact: 3,
        percent: 75,
      });
    });

    it('refuses an AGENT and an EMPLOYEE', async () => {
      await get(fixtureEmails.agent).expect(403);
      await get(fixtureEmails.requester).expect(403);
    });
  });

  describe('reassignment count', () => {
    const get = (email: string) =>
      request(server)
        .get('/api/reports/reassignment-count')
        .query(range)
        .set(authHeader(email));

    beforeAll(async () => {
      await prisma.ticket.deleteMany({});

      // Assigned once. Zero reassignments - the healthy case.
      const clean = await plantTicket({ teamId: fixtureTeamIds.it });
      await event(clean.id, 'TICKET_ASSIGNED', hoursAgo(20));

      // Assigned three times. Two reassignments.
      const bounced = await plantTicket({ teamId: fixtureTeamIds.it });
      await event(bounced.id, 'TICKET_ASSIGNED', hoursAgo(20));
      await event(bounced.id, 'TICKET_ASSIGNED', hoursAgo(15));
      await event(bounced.id, 'TICKET_ASSIGNED', hoursAgo(10));

      // Never assigned. Still zero, not absent.
      await plantTicket({ teamId: fixtureTeamIds.it });

      // Other events must not be counted as assignments.
      const noisy = await plantTicket({ teamId: fixtureTeamIds.it });
      await event(noisy.id, 'TICKET_ASSIGNED', hoursAgo(20));
      await event(noisy.id, 'TICKET_STATUS_CHANGED', hoursAgo(19), {
        from: 'NEW',
        to: 'ASSIGNED',
      });
      await event(noisy.id, 'TICKET_TRANSFERRED', hoursAgo(18));

      // Another team's, bounced four times. Scoping fixture.
      const hr = await plantTicket({ teamId: fixtureTeamIds.hr });
      for (const h of [20, 18, 16, 14, 12]) {
        await event(hr.id, 'TICKET_ASSIGNED', hoursAgo(h));
      }
    });

    it('reports the distribution, with the first assignment not counted', async () => {
      const res = await get(fixtureEmails.lead).expect(200);
      // Three IT tickets at zero (clean, never-assigned, noisy) and one at two.
      expect(res.body.data).toEqual([
        { reassignments: 0, tickets: 3 },
        { reassignments: 2, tickets: 1 },
      ]);
      expect(res.body.tickets).toBe(4);
      expect(res.body.averagePerTicket).toBe(0.5);
    });

    it('scopes a LEAD to their own team', async () => {
      const lead = await get(fixtureEmails.lead).expect(200);
      const owner = await get(fixtureEmails.owner).expect(200);
      expect(lead.body.tickets).toBe(4);
      // The owner also sees the HR ticket, which sits at four reassignments.
      expect(owner.body.tickets).toBe(5);
      expect(
        (owner.body.data as { reassignments: number }[]).map(
          (row) => row.reassignments,
        ),
      ).toContain(4);
      expect(
        (lead.body.data as { reassignments: number }[]).map(
          (row) => row.reassignments,
        ),
      ).not.toContain(4);
    });
  });

  describe('time in each status', () => {
    const get = (email: string) =>
      request(server)
        .get('/api/reports/time-in-status')
        .query(range)
        .set(authHeader(email));

    beforeAll(async () => {
      await prisma.ticket.deleteMany({});

      // NEW -> TRIAGED at T-30, TRIAGED -> ASSIGNED at T-28 (2h in TRIAGED),
      // ASSIGNED -> RESOLVED at T-22 (6h in ASSIGNED). The RESOLVED interval
      // is still open and must not be measured.
      const a = await plantTicket({ teamId: fixtureTeamIds.it });
      await event(a.id, 'TICKET_STATUS_CHANGED', hoursAgo(30), {
        from: 'NEW',
        to: 'TRIAGED',
      });
      await event(a.id, 'TICKET_STATUS_CHANGED', hoursAgo(28), {
        from: 'TRIAGED',
        to: 'ASSIGNED',
      });
      await event(a.id, 'TICKET_STATUS_CHANGED', hoursAgo(22), {
        from: 'ASSIGNED',
        to: 'RESOLVED',
      });

      // A second ticket: 4h in TRIAGED, so the TRIAGED average is 3h.
      const b = await plantTicket({ teamId: fixtureTeamIds.it });
      await event(b.id, 'TICKET_STATUS_CHANGED', hoursAgo(30), {
        from: 'NEW',
        to: 'TRIAGED',
      });
      await event(b.id, 'TICKET_STATUS_CHANGED', hoursAgo(26), {
        from: 'TRIAGED',
        to: 'ASSIGNED',
      });

      // Another team's, 100h in TRIAGED. Scoping fixture.
      const hr = await plantTicket({ teamId: fixtureTeamIds.hr });
      await event(hr.id, 'TICKET_STATUS_CHANGED', hoursAgo(120), {
        from: 'NEW',
        to: 'TRIAGED',
      });
      await event(hr.id, 'TICKET_STATUS_CHANGED', hoursAgo(20), {
        from: 'TRIAGED',
        to: 'ASSIGNED',
      });
    });

    it('averages CLOSED intervals only, and ignores the one still running', async () => {
      const res = await get(fixtureEmails.lead).expect(200);
      const rows = res.body.data as {
        status: string;
        averageHours: number;
        intervals: number;
      }[];
      const byStatus = Object.fromEntries(rows.map((r) => [r.status, r]));
      // TRIAGED: 2h and 4h.
      expect(byStatus.TRIAGED).toEqual({
        status: 'TRIAGED',
        averageHours: 3,
        medianHours: 3,
        intervals: 2,
      });
      // ASSIGNED: one closed interval of 6h. The second ticket's ASSIGNED is
      // still open and contributes nothing.
      expect(byStatus.ASSIGNED).toEqual({
        status: 'ASSIGNED',
        averageHours: 6,
        medianHours: 6,
        intervals: 1,
      });
      // RESOLVED never closed, so it has no row at all rather than a zero.
      expect(byStatus.RESOLVED).toBeUndefined();
    });

    it('scopes a LEAD to their own team', async () => {
      const lead = await get(fixtureEmails.lead).expect(200);
      const owner = await get(fixtureEmails.owner).expect(200);
      const triagedFor = (body: {
        data: { status: string; averageHours: number }[];
      }) => body.data.find((row) => row.status === 'TRIAGED')?.averageHours;
      expect(triagedFor(lead.body)).toBe(3);
      // The owner's average is dragged up by the HR ticket's 100 hours.
      expect(triagedFor(owner.body)).toBeGreaterThan(30);
    });
  });

  describe('CSV export', () => {
    it.each([
      'first-contact-resolution',
      'reassignment-count',
      'time-in-status',
    ])('exports %s', async (report) => {
      const res = await request(server)
        .get(`/api/reports/${report}/export.csv`)
        .query(range)
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      const body = res.text ?? String(res.body);
      // A header row, not the "does not flatten" refusal.
      expect(body).not.toContain('does not flatten');
      expect(body.length).toBeGreaterThan(0);
    });
  });
});
