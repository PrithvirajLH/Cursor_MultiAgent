import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureUserIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type AgentListItem = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  isActive: boolean;
  openCount: number;
  resolvedCount: number;
};

type AgentProfileResponse = {
  user: {
    id: string;
    email: string;
    role: string;
  };
  counts: { open: number; resolved: number; reopened: number };
  recentTickets: unknown[];
};

describe('Agents admin analytics', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets the owner list agents with a sane shape', async () => {
    const res = await request(server)
      .get('/api/admin/agents')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const list = res.body as AgentListItem[];
    expect(Array.isArray(list)).toBe(true);
    // Seed creates AGENT, LEAD and TEAM_ADMIN support users.
    expect(list.length).toBeGreaterThanOrEqual(3);

    const agent = list.find((row) => row.id === fixtureUserIds.agent);
    expect(agent).toBeDefined();
    expect(agent?.email).toBe('agent@company.com');
    expect(agent?.role).toBe('AGENT');
    expect(typeof agent?.openCount).toBe('number');
    expect(typeof agent?.resolvedCount).toBe('number');

    // Plain EMPLOYEE requesters must not appear in the support-agent list.
    expect(list.some((row) => row.email === 'requester@company.com')).toBe(
      false,
    );
  });

  it("returns a single agent's profile detail by id for the owner", async () => {
    const res = await request(server)
      .get(`/api/admin/agents/${fixtureUserIds.agent}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const body = res.body as AgentProfileResponse;
    expect(body.user.id).toBe(fixtureUserIds.agent);
    expect(body.user.email).toBe('agent@company.com');
    expect(body.user.role).toBe('AGENT');
    expect(body.counts).toBeDefined();
    expect(Array.isArray(body.recentTickets)).toBe(true);
  });

  it('denies an agent from listing agents (403)', async () => {
    await request(server)
      .get('/api/admin/agents')
      .set(authHeader(fixtureEmails.agent))
      .expect(403);
  });

  it('denies a requester from viewing an agent profile (403)', async () => {
    await request(server)
      .get(`/api/admin/agents/${fixtureUserIds.agent}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(403);
  });
});
