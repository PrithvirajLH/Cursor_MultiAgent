import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureUserIds, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type DeactivationPreview = {
  email: string;
  displayName: string;
  isActive: boolean;
  ticketsOpen: number;
  teams: string[];
};

type UserListItem = {
  id: string;
  email: string;
  isActive: boolean;
  primaryTeamId: string | null;
};

type UserListResponse = {
  data: UserListItem[];
  meta: { total: number };
};

async function fetchAgentRow(server: SupertestApp): Promise<UserListItem | undefined> {
  // status=all so deactivated users still appear (default filter hides inactive).
  const res = await request(server)
    .get('/api/users')
    .query({ status: 'all', pageSize: 100 })
    .set(authHeader(fixtureEmails.owner))
    .expect(200);
  const body = res.body as UserListResponse;
  return body.data.find((row) => row.id === fixtureUserIds.agent);
}

describe('Users lifecycle', () => {
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

  it('returns a sane deactivation preview for the agent (owner)', async () => {
    const res = await request(server)
      .get(`/api/users/${fixtureUserIds.agent}/deactivation-preview`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const preview = res.body as DeactivationPreview;
    expect(preview.email).toBe('agent@company.com');
    expect(preview.isActive).toBe(true);
    expect(typeof preview.ticketsOpen).toBe('number');
    expect(preview.ticketsOpen).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(preview.teams)).toBe(true);
    // Seed places the agent on the IT Service Desk team.
    expect(preview.teams).toContain('IT Service Desk');
  });

  it('deactivates then reactivates the agent, flipping isActive (owner)', async () => {
    const before = await fetchAgentRow(server);
    expect(before?.isActive).toBe(true);

    const deactivated = await request(server)
      .post(`/api/users/${fixtureUserIds.agent}/deactivate`)
      .set(authHeader(fixtureEmails.owner))
      .expect(201);
    expect((deactivated.body as { ok: boolean }).ok).toBe(true);

    const afterDeactivate = await fetchAgentRow(server);
    expect(afterDeactivate?.isActive).toBe(false);

    const reactivated = await request(server)
      .post(`/api/users/${fixtureUserIds.agent}/reactivate`)
      .set(authHeader(fixtureEmails.owner))
      .expect(201);
    expect((reactivated.body as { ok: boolean }).ok).toBe(true);

    const afterReactivate = await fetchAgentRow(server);
    // Restored to active so the agent is not left deactivated for later assertions
    // (per-spec DB reset is also a backstop).
    expect(afterReactivate?.isActive).toBe(true);
  });

  it('forbids the owner from deactivating themselves (400)', async () => {
    await request(server)
      .post(`/api/users/${fixtureUserIds.owner}/deactivate`)
      .set(authHeader(fixtureEmails.owner))
      .expect(400);
  });

  it('sets the agent primary team to IT (owner)', async () => {
    const res = await request(server)
      .patch(`/api/users/${fixtureUserIds.agent}/primary-team`)
      .set(authHeader(fixtureEmails.owner))
      .send({ primaryTeamId: fixtureTeamIds.it })
      .expect(200);

    const body = res.body as { id: string; primaryTeamId: string | null };
    expect(body.id).toBe(fixtureUserIds.agent);
    expect(body.primaryTeamId).toBe(fixtureTeamIds.it);

    const row = await fetchAgentRow(server);
    expect(row?.primaryTeamId).toBe(fixtureTeamIds.it);
  });

  it('denies non-owners (lead, agent) on deactivate (403)', async () => {
    await request(server)
      .post(`/api/users/${fixtureUserIds.agent}/deactivate`)
      .set(authHeader(fixtureEmails.lead))
      .expect(403);

    await request(server)
      .post(`/api/users/${fixtureUserIds.requester}/deactivate`)
      .set(authHeader(fixtureEmails.agent))
      .expect(403);
  });

  it('denies non-owners (lead, agent) on primary-team (403)', async () => {
    await request(server)
      .patch(`/api/users/${fixtureUserIds.agent}/primary-team`)
      .set(authHeader(fixtureEmails.lead))
      .send({ primaryTeamId: fixtureTeamIds.it })
      .expect(403);

    await request(server)
      .patch(`/api/users/${fixtureUserIds.agent}/primary-team`)
      .set(authHeader(fixtureEmails.agent))
      .send({ primaryTeamId: fixtureTeamIds.it })
      .expect(403);
  });
});
