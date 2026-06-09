import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import {
  fixtureEmails,
  fixtureUserIds,
  fixtureTeamIds,
} from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

// Categories seeded by seedTest() (prisma/seed.ts).
const CATEGORY_ACCESS_ID = 'c1111111-1111-4111-8111-111111111111';

const createBody = {
  subject: 'Misc coverage ticket',
  description: 'Ticket created to exercise analytics + followers endpoints',
  priority: 'SEV3' as const,
  channel: 'PORTAL' as const,
  assignedTeamId: fixtureTeamIds.it,
};

type CreatedTicket = {
  id: string;
  requesterId: string;
  assigneeId: string | null;
  assignedTeamId: string | null;
  categoryId: string | null;
};

type CountsResponse = {
  assignedToMe: number;
  triage: number;
  open: number;
  unassigned: number;
  resolved: number;
  resolvedByMe: number;
  createdByMeOpen: number;
  createdByMeResolved: number;
  atRisk: number;
  overdue: number;
};

type ActivityResponse = {
  data: Array<{ date: string; open: number; resolved: number }>;
};

type StatusBreakdownResponse = {
  data: Array<{ status: string; count: number }>;
};

type MetricsResponse = {
  total: number;
  open: number;
  resolved: number;
  byPriority: Record<string, number>;
  byTeam: Array<{ teamId: string | null; total: number }>;
};

type Follower = {
  id: string;
  ticketId: string;
  userId: string;
  user?: { id: string; email: string } | null;
};

type FollowersResponse = { data: Follower[] };

describe('Tickets misc', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let ticketId: string;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;

    // Create a ticket as the agent. With no requesterId in the body the agent
    // becomes the requester; assignedTeamId pins it to IT and (since the seed
    // team uses no round-robin) it stays unassigned, so the agent retains write
    // access (assignee is null and the agent is on the IT team).
    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.agent))
      .send(createBody)
      .expect(201);

    const body = created.body as CreatedTicket;
    expect(typeof body.id).toBe('string');
    expect(body.requesterId).toBe(fixtureUserIds.agent);
    expect(body.assignedTeamId).toBe(fixtureTeamIds.it);
    expect(body.assigneeId).toBeNull();
    ticketId = body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/tickets/counts', () => {
    it('returns the full count-bucket shape for the caller', async () => {
      const res = await request(server)
        .get('/api/tickets/counts')
        .set(authHeader(fixtureEmails.agent))
        .expect(200);

      const body = res.body as CountsResponse;
      const keys: (keyof CountsResponse)[] = [
        'assignedToMe',
        'triage',
        'open',
        'unassigned',
        'resolved',
        'resolvedByMe',
        'createdByMeOpen',
        'createdByMeResolved',
        'atRisk',
        'overdue',
      ];
      for (const key of keys) {
        expect(typeof body[key]).toBe('number');
        expect(body[key]).toBeGreaterThanOrEqual(0);
      }

      // The agent created an open, unassigned IT ticket: it should land in the
      // open/unassigned buckets and in their createdByMeOpen bucket.
      expect(body.open).toBeGreaterThanOrEqual(1);
      expect(body.unassigned).toBeGreaterThanOrEqual(1);
      expect(body.createdByMeOpen).toBeGreaterThanOrEqual(1);
      // AGENT triage badge mirrors their personal assigned queue, not team triage.
      expect(body.triage).toBe(body.assignedToMe);
    });

    it('scopes counts per caller (employee sees only their own created tickets)', async () => {
      const res = await request(server)
        .get('/api/tickets/counts')
        .set(authHeader(fixtureEmails.requester))
        .expect(200);

      const body = res.body as CountsResponse;
      // The requester authored seed tickets but none assigned to them.
      expect(body.assignedToMe).toBe(0);
      expect(body.createdByMeOpen).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/tickets/activity', () => {
    it('returns a daily open/resolved series over the default window', async () => {
      const res = await request(server)
        .get('/api/tickets/activity')
        .set(authHeader(fixtureEmails.agent))
        .expect(200);

      const body = res.body as ActivityResponse;
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
      for (const point of body.data) {
        expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(typeof point.open).toBe('number');
        expect(typeof point.resolved).toBe('number');
      }
      // Today's bucket should include the just-created ticket.
      const today = new Date().toISOString().slice(0, 10);
      const totalOpened = body.data.reduce((sum, p) => sum + p.open, 0);
      expect(totalOpened).toBeGreaterThanOrEqual(1);
      expect(body.data.some((p) => p.date === today)).toBe(true);
    });

    it('honors the scope=assigned param + an explicit date range', async () => {
      const from = '2020-01-01';
      const to = '2020-01-07';
      const res = await request(server)
        .get('/api/tickets/activity')
        .query({ scope: 'assigned', from, to })
        .set(authHeader(fixtureEmails.agent))
        .expect(200);

      const body = res.body as ActivityResponse;
      // 7-day inclusive window => 7 daily buckets, all empty in the past.
      expect(body.data).toHaveLength(7);
      expect(body.data.every((p) => p.open === 0 && p.resolved === 0)).toBe(
        true,
      );
    });
  });

  describe('GET /api/tickets/status-breakdown', () => {
    it('returns counts grouped by status', async () => {
      const res = await request(server)
        .get('/api/tickets/status-breakdown')
        .set(authHeader(fixtureEmails.agent))
        .expect(200);

      const body = res.body as StatusBreakdownResponse;
      expect(Array.isArray(body.data)).toBe(true);
      for (const row of body.data) {
        expect(typeof row.status).toBe('string');
        expect(typeof row.count).toBe('number');
      }
      // The agent's new NEW ticket should be represented.
      const newBucket = body.data.find((r) => r.status === 'NEW');
      expect(newBucket).toBeDefined();
      expect(newBucket?.count).toBeGreaterThanOrEqual(1);
    });

    it('accepts the dateField param (updatedAt)', async () => {
      const res = await request(server)
        .get('/api/tickets/status-breakdown')
        .query({ dateField: 'updatedAt' })
        .set(authHeader(fixtureEmails.agent))
        .expect(200);

      const body = res.body as StatusBreakdownResponse;
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('GET /api/tickets/metrics', () => {
    it('returns totals plus byPriority and byTeam breakdowns', async () => {
      const res = await request(server)
        .get('/api/tickets/metrics')
        .set(authHeader(fixtureEmails.owner))
        .expect(200);

      const body = res.body as MetricsResponse;
      expect(typeof body.total).toBe('number');
      expect(typeof body.open).toBe('number');
      expect(typeof body.resolved).toBe('number');
      expect(body.total).toBe(body.open + body.resolved);

      // byPriority is a fully-populated record across all severities.
      for (const sev of ['SEV1', 'SEV2', 'SEV3', 'SEV4']) {
        expect(typeof body.byPriority[sev]).toBe('number');
      }

      expect(Array.isArray(body.byTeam)).toBe(true);
      for (const row of body.byTeam) {
        expect(typeof row.total).toBe('number');
      }
      const itRow = body.byTeam.find((r) => r.teamId === fixtureTeamIds.it);
      expect(itRow).toBeDefined();
      expect(itRow?.total).toBeGreaterThanOrEqual(1);
    });

    it('scopes metric totals to the caller (employee sees fewer than owner)', async () => {
      const ownerRes = await request(server)
        .get('/api/tickets/metrics')
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      const employeeRes = await request(server)
        .get('/api/tickets/metrics')
        .set(authHeader(fixtureEmails.requester))
        .expect(200);

      const ownerBody = ownerRes.body as MetricsResponse;
      const employeeBody = employeeRes.body as MetricsResponse;
      expect(employeeBody.total).toBeLessThan(ownerBody.total);
    });
  });

  describe('POST /api/tickets/:id/typing', () => {
    it('acks a typing signal for a user with write access', async () => {
      const res = await request(server)
        .post(`/api/tickets/${ticketId}/typing`)
        .set(authHeader(fixtureEmails.agent))
        .send({ isTyping: true })
        .expect(201);

      expect(res.body).toEqual({ ok: true });

      await request(server)
        .post(`/api/tickets/${ticketId}/typing`)
        .set(authHeader(fixtureEmails.agent))
        .send({ isTyping: false })
        .expect(201);
    });

    it('rejects a non-boolean isTyping payload (400)', async () => {
      await request(server)
        .post(`/api/tickets/${ticketId}/typing`)
        .set(authHeader(fixtureEmails.agent))
        .send({ isTyping: 'yes' })
        .expect(400);
    });

    it('denies typing for a user without write access (403)', async () => {
      // otherRequester is an EMPLOYEE who is not the requester of this ticket.
      await request(server)
        .post(`/api/tickets/${ticketId}/typing`)
        .set(authHeader(fixtureEmails.otherRequester))
        .send({ isTyping: true })
        .expect(403);
    });
  });

  describe('POST /api/tickets/:id/category', () => {
    it('sets a category on the ticket', async () => {
      const res = await request(server)
        .post(`/api/tickets/${ticketId}/category`)
        .set(authHeader(fixtureEmails.agent))
        .send({ categoryId: CATEGORY_ACCESS_ID })
        .expect(201);

      const body = res.body as CreatedTicket;
      expect(body.categoryId).toBe(CATEGORY_ACCESS_ID);
    });

    it('clears the category when categoryId is null', async () => {
      const res = await request(server)
        .post(`/api/tickets/${ticketId}/category`)
        .set(authHeader(fixtureEmails.agent))
        .send({ categoryId: null })
        .expect(201);

      const body = res.body as CreatedTicket;
      expect(body.categoryId).toBeNull();
    });

    it('rejects an unknown categoryId (400)', async () => {
      await request(server)
        .post(`/api/tickets/${ticketId}/category`)
        .set(authHeader(fixtureEmails.agent))
        .send({ categoryId: 'c9999999-9999-4999-8999-999999999999' })
        .expect(400);
    });

    it('forbids an EMPLOYEE (requester) from changing the category (403)', async () => {
      // requester owns seed tickets; setCategory rejects EMPLOYEE role outright.
      const list = await request(server)
        .get('/api/tickets')
        .set(authHeader(fixtureEmails.requester))
        .expect(200);
      const ownTicket = (
        list.body as { data: Array<{ id: string; subject: string }> }
      ).data.find((t) => t.subject === 'VPN access request');
      expect(ownTicket).toBeDefined();

      await request(server)
        .post(`/api/tickets/${ownTicket!.id}/category`)
        .set(authHeader(fixtureEmails.requester))
        .send({ categoryId: CATEGORY_ACCESS_ID })
        .expect(403);
    });
  });

  describe('followers: GET/POST/DELETE /api/tickets/:id/followers', () => {
    it('starts with the creator as the sole follower', async () => {
      // The ticket creator is auto-added as a follower on creation
      // (tickets.service create() upserts a TicketFollower for requesterId).
      // This ticket was created by the agent in beforeAll, so the baseline
      // follower list is exactly the agent.
      const res = await request(server)
        .get(`/api/tickets/${ticketId}/followers`)
        .set(authHeader(fixtureEmails.agent))
        .expect(200);

      const body = res.body as FollowersResponse;
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].userId).toBe(fixtureUserIds.agent);
    });

    it('following as self is idempotent and keeps the creator on the list', async () => {
      // The agent is already the auto-follower; following again upserts, so the
      // list stays exactly the agent.
      const res = await request(server)
        .post(`/api/tickets/${ticketId}/followers`)
        .set(authHeader(fixtureEmails.agent))
        .send({})
        .expect(201);

      const body = res.body as FollowersResponse;
      const agentRow = body.data.find((f) => f.userId === fixtureUserIds.agent);
      expect(agentRow).toBeDefined();
      expect(agentRow?.ticketId).toBe(ticketId);
      expect(agentRow?.user?.email).toBe(fixtureEmails.agent);
      // No additional users were added by the self-follow.
      expect(body.data.map((f) => f.userId)).toEqual([fixtureUserIds.agent]);
    });

    it('lets a privileged role (lead) add another user as follower', async () => {
      // Adds the lead alongside the existing creator follower; both present.
      const res = await request(server)
        .post(`/api/tickets/${ticketId}/followers`)
        .set(authHeader(fixtureEmails.lead))
        .send({ userId: fixtureUserIds.lead })
        .expect(201);

      const body = res.body as FollowersResponse;
      const userIds = body.data.map((f) => f.userId);
      expect(userIds).toContain(fixtureUserIds.agent);
      expect(userIds).toContain(fixtureUserIds.lead);
    });

    it('GET reflects the current followers', async () => {
      const res = await request(server)
        .get(`/api/tickets/${ticketId}/followers`)
        .set(authHeader(fixtureEmails.agent))
        .expect(200);

      const body = res.body as FollowersResponse;
      const userIds = body.data.map((f) => f.userId);
      expect(userIds).toEqual(
        expect.arrayContaining([fixtureUserIds.agent, fixtureUserIds.lead]),
      );
    });

    it('forbids following for another user without a managing role (403)', async () => {
      await request(server)
        .post(`/api/tickets/${ticketId}/followers`)
        .set(authHeader(fixtureEmails.agent))
        .send({ userId: fixtureUserIds.lead })
        .expect(403);
    });

    it('denies an unrelated employee from following an inaccessible ticket (403)', async () => {
      // otherRequester cannot view this IT ticket they did not create.
      await request(server)
        .post(`/api/tickets/${ticketId}/followers`)
        .set(authHeader(fixtureEmails.otherRequester))
        .send({})
        .expect(403);
    });

    it('removes a follower via DELETE and returns the removed userId', async () => {
      const res = await request(server)
        .delete(`/api/tickets/${ticketId}/followers/${fixtureUserIds.agent}`)
        .set(authHeader(fixtureEmails.agent))
        .expect(200);

      expect(res.body).toEqual({ id: fixtureUserIds.agent });

      const after = await request(server)
        .get(`/api/tickets/${ticketId}/followers`)
        .set(authHeader(fixtureEmails.agent))
        .expect(200);
      const body = after.body as FollowersResponse;
      const userIds = body.data.map((f) => f.userId);
      expect(userIds).not.toContain(fixtureUserIds.agent);
      expect(userIds).toContain(fixtureUserIds.lead);
    });

    it('forbids removing another user without a managing role (403)', async () => {
      // Agent (not a manager) tries to remove the lead follower.
      await request(server)
        .delete(`/api/tickets/${ticketId}/followers/${fixtureUserIds.lead}`)
        .set(authHeader(fixtureEmails.agent))
        .expect(403);
    });
  });
});
