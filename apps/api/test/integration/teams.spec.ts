import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureUserIds, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TeamResponse = {
  id: string;
  name: string;
  assignmentStrategy: string;
};

type TeamMember = {
  id: string;
  role: string;
  user: { id: string };
};

type MembersResponse = {
  data: TeamMember[];
};

describe('Teams', () => {
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

  it('runs the full member lifecycle on an owner-created team', async () => {
    // Create a fresh team so member state is isolated from seeded teams.
    const createRes = await request(server)
      .post('/api/teams')
      .set(authHeader(fixtureEmails.owner))
      .send({ name: `Members Team ${Date.now()}` })
      .expect(201);
    const team = createRes.body as TeamResponse;
    expect(team.id).toBeDefined();

    // A brand-new team starts with no members.
    const emptyRes = await request(server)
      .get(`/api/teams/${team.id}/members`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    expect((emptyRes.body as MembersResponse).data).toHaveLength(0);

    // Add the agent (UserRole.AGENT) — default team role resolves to AGENT.
    const addRes = await request(server)
      .post(`/api/teams/${team.id}/members`)
      .set(authHeader(fixtureEmails.owner))
      .send({ userId: fixtureUserIds.agent, role: 'AGENT' })
      .expect(201);
    const added = addRes.body as TeamMember;
    expect(added.user.id).toBe(fixtureUserIds.agent);
    expect(added.role).toBe('AGENT');
    const memberId = added.id;

    // GET members reflects the new member.
    const listRes = await request(server)
      .get(`/api/teams/${team.id}/members`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const list = (listRes.body as MembersResponse).data;
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(memberId);

    // Update the member's team role (AGENT user -> LEAD is allowed; ADMIN is not).
    const updateRes = await request(server)
      .patch(`/api/teams/${team.id}/members/${memberId}`)
      .set(authHeader(fixtureEmails.owner))
      .send({ role: 'LEAD' })
      .expect(200);
    expect((updateRes.body as TeamMember).role).toBe('LEAD');

    // Remove the member.
    const removeRes = await request(server)
      .delete(`/api/teams/${team.id}/members/${memberId}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    expect((removeRes.body as { id: string }).id).toBe(memberId);

    const afterRemoveRes = await request(server)
      .get(`/api/teams/${team.id}/members`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    expect((afterRemoveRes.body as MembersResponse).data).toHaveLength(0);
  });

  it('updates a team (rename + assignmentStrategy) as the owner', async () => {
    const createRes = await request(server)
      .post('/api/teams')
      .set(authHeader(fixtureEmails.owner))
      .send({ name: `Update Team ${Date.now()}` })
      .expect(201);
    const team = createRes.body as TeamResponse;

    const renamed = `Renamed Team ${Date.now()}`;
    const updateRes = await request(server)
      .patch(`/api/teams/${team.id}`)
      .set(authHeader(fixtureEmails.owner))
      .send({ name: renamed, assignmentStrategy: 'ROUND_ROBIN' })
      .expect(200);
    const updated = updateRes.body as TeamResponse;
    expect(updated.name).toBe(renamed);
    expect(updated.assignmentStrategy).toBe('ROUND_ROBIN');
  });

  it('denies non-admins (lead, agent) on team update (403)', async () => {
    await request(server)
      .patch(`/api/teams/${fixtureTeamIds.it}`)
      .set(authHeader(fixtureEmails.lead))
      .send({ name: 'Lead Cannot Rename' })
      .expect(403);

    await request(server)
      .patch(`/api/teams/${fixtureTeamIds.it}`)
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Agent Cannot Rename' })
      .expect(403);
  });

  it('denies non-admins (lead, agent) on add member (403)', async () => {
    await request(server)
      .post(`/api/teams/${fixtureTeamIds.it}/members`)
      .set(authHeader(fixtureEmails.lead))
      .send({ userId: fixtureUserIds.requester, role: 'AGENT' })
      .expect(403);

    await request(server)
      .post(`/api/teams/${fixtureTeamIds.it}/members`)
      .set(authHeader(fixtureEmails.agent))
      .send({ userId: fixtureUserIds.requester, role: 'AGENT' })
      .expect(403);
  });
});
