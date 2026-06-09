import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type RoutingRule = {
  id: string;
  name: string;
  teamId: string;
  priority: number;
  isActive: boolean;
  keywords: string[];
};

type RoutingRulesListResponse = {
  data: RoutingRule[];
};

describe('Routing rules CRUD + role gating', () => {
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

  it('lets owner create, list, update, and delete a routing rule', async () => {
    // CREATE — owner targets a team (owner rules cannot carry an assignee).
    const createResponse = await request(server)
      .post('/api/routing-rules')
      .set(authHeader(fixtureEmails.owner))
      .send({
        name: 'Printer routing',
        keywords: ['printer'],
        teamId: fixtureTeamIds.it,
        priority: 1,
        isActive: true,
      })
      .expect(201);

    const created = createResponse.body as RoutingRule;
    expect(created.id).toBeTruthy();
    expect(created.teamId).toBe(fixtureTeamIds.it);
    expect(created.priority).toBe(1);
    expect(created.isActive).toBe(true);

    // GET — the new rule appears in the owner-visible list.
    const listResponse = await request(server)
      .get('/api/routing-rules')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const listBody = listResponse.body as RoutingRulesListResponse;
    const listed = listBody.data.find((rule) => rule.id === created.id);
    expect(listed).toBeDefined();
    expect(listed?.name).toBe('Printer routing');

    // PATCH — toggle isActive off and bump priority.
    const updateResponse = await request(server)
      .patch(`/api/routing-rules/${created.id}`)
      .set(authHeader(fixtureEmails.owner))
      .send({ isActive: false, priority: 5 })
      .expect(200);

    const updated = updateResponse.body as RoutingRule;
    expect(updated.id).toBe(created.id);
    expect(updated.isActive).toBe(false);
    expect(updated.priority).toBe(5);

    // DELETE — remove the rule, then confirm it is gone from the list.
    await request(server)
      .delete(`/api/routing-rules/${created.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const afterDeleteResponse = await request(server)
      .get('/api/routing-rules')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const afterDeleteBody = afterDeleteResponse.body as RoutingRulesListResponse;
    const stillThere = afterDeleteBody.data.find(
      (rule) => rule.id === created.id,
    );
    expect(stillThere).toBeUndefined();
  });

  it('rejects POST for non-admin personas (agent, requester) with 403', async () => {
    const body = {
      name: 'Should not persist',
      keywords: ['blocked'],
      teamId: fixtureTeamIds.it,
      priority: 1,
      isActive: true,
    };

    await request(server)
      .post('/api/routing-rules')
      .set(authHeader(fixtureEmails.agent))
      .send(body)
      .expect(403);

    await request(server)
      .post('/api/routing-rules')
      .set(authHeader(fixtureEmails.requester))
      .send(body)
      .expect(403);
  });

  it('rejects PATCH and DELETE for non-admin personas with 403', async () => {
    // Seed a rule as owner so agent/requester have a real target to attack.
    const createResponse = await request(server)
      .post('/api/routing-rules')
      .set(authHeader(fixtureEmails.owner))
      .send({
        name: 'Owner-managed rule',
        keywords: ['network'],
        teamId: fixtureTeamIds.it,
        priority: 2,
        isActive: true,
      })
      .expect(201);

    const ruleId = (createResponse.body as RoutingRule).id;

    await request(server)
      .patch(`/api/routing-rules/${ruleId}`)
      .set(authHeader(fixtureEmails.agent))
      .send({ isActive: false })
      .expect(403);

    await request(server)
      .patch(`/api/routing-rules/${ruleId}`)
      .set(authHeader(fixtureEmails.requester))
      .send({ isActive: false })
      .expect(403);

    await request(server)
      .delete(`/api/routing-rules/${ruleId}`)
      .set(authHeader(fixtureEmails.agent))
      .expect(403);

    await request(server)
      .delete(`/api/routing-rules/${ruleId}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(403);

    // Rule must survive the rejected attempts.
    const listResponse = await request(server)
      .get('/api/routing-rules')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const listBody = listResponse.body as RoutingRulesListResponse;
    const survivor = listBody.data.find((rule) => rule.id === ruleId);
    expect(survivor).toBeDefined();
    expect(survivor?.isActive).toBe(true);
  });

  it('rejects GET (list) for non-admin personas with 403', async () => {
    await request(server)
      .get('/api/routing-rules')
      .set(authHeader(fixtureEmails.agent))
      .expect(403);

    await request(server)
      .get('/api/routing-rules')
      .set(authHeader(fixtureEmails.requester))
      .expect(403);
  });
});
