import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type AutomationRule = {
  id: string;
  name: string;
  trigger: string;
  teamId: string | null;
  priority: number;
  isActive: boolean;
};

type AutomationRulesListResponse = {
  data: AutomationRule[];
};

type AutomationExecutionsResponse = {
  data: unknown[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type TestRuleResponse = {
  matched: boolean;
  actionsThatWouldRun: unknown[];
  message: string;
};

type Ticket = {
  id: string;
  subject: string;
  status: string;
};

type TicketsListResponse = {
  data: Ticket[];
};

async function createOwnerRule(server: SupertestApp, name: string) {
  // Team-scoped rule (IT). Owner is allowed to manage any team's rules.
  const response = await request(server)
    .post('/api/automation-rules')
    .set(authHeader(fixtureEmails.owner))
    .send({
      name,
      description: 'Created by automation CRUD integration spec',
      trigger: 'STATUS_CHANGED',
      conditions: [{ field: 'status', operator: 'equals', value: 'ASSIGNED' }],
      actions: [{ type: 'add_internal_note', body: 'Matched by test rule.' }],
      teamId: fixtureTeamIds.it,
      isActive: true,
      priority: 1,
    })
    .expect(201);

  return response.body as AutomationRule;
}

describe('Automation rules CRUD + role gating', () => {
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

  it('lets owner create, list, get one, update, test, read executions, and delete a rule', async () => {
    // CREATE
    const created = await createOwnerRule(server, 'Auto note on assigned');
    expect(created.id).toBeTruthy();
    expect(created.teamId).toBe(fixtureTeamIds.it);
    expect(created.trigger).toBe('STATUS_CHANGED');
    expect(created.isActive).toBe(true);
    expect(created.priority).toBe(1);

    // GET list
    const listResponse = await request(server)
      .get('/api/automation-rules')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const listBody = listResponse.body as AutomationRulesListResponse;
    const listed = listBody.data.find((rule) => rule.id === created.id);
    expect(listed).toBeDefined();
    expect(listed?.name).toBe('Auto note on assigned');

    // GET /:id
    const getOneResponse = await request(server)
      .get(`/api/automation-rules/${created.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const fetched = getOneResponse.body as AutomationRule;
    expect(fetched.id).toBe(created.id);

    // PATCH — rename, toggle isActive off, bump priority.
    const updateResponse = await request(server)
      .patch(`/api/automation-rules/${created.id}`)
      .set(authHeader(fixtureEmails.owner))
      .send({ name: 'Renamed rule', isActive: false, priority: 7 })
      .expect(200);
    const updated = updateResponse.body as AutomationRule;
    expect(updated.name).toBe('Renamed rule');
    expect(updated.isActive).toBe(false);
    expect(updated.priority).toBe(7);

    // POST /:id/test — dry-run against the seeded ASSIGNED IT ticket.
    const ticketsResponse = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const ticketsBody = ticketsResponse.body as TicketsListResponse;
    const assignedItTicket = ticketsBody.data.find(
      (ticket) => ticket.subject === 'VPN access request',
    );
    expect(assignedItTicket).toBeDefined();

    const testResponse = await request(server)
      .post(`/api/automation-rules/${created.id}/test`)
      .set(authHeader(fixtureEmails.owner))
      .send({ ticketId: assignedItTicket!.id })
      .expect(201);
    const testBody = testResponse.body as TestRuleResponse;
    // Condition (status equals ASSIGNED) matches the seeded ticket, so the rule
    // would run and report its single add_internal_note action.
    expect(testBody.matched).toBe(true);
    expect(Array.isArray(testBody.actionsThatWouldRun)).toBe(true);
    expect(testBody.actionsThatWouldRun.length).toBe(1);
    expect(typeof testBody.message).toBe('string');

    // POST /:id/test with no ticketId — short-circuits to a guidance message.
    const emptyTestResponse = await request(server)
      .post(`/api/automation-rules/${created.id}/test`)
      .set(authHeader(fixtureEmails.owner))
      .send({})
      .expect(201);
    const emptyTestBody = emptyTestResponse.body as TestRuleResponse;
    expect(emptyTestBody.matched).toBe(false);
    expect(emptyTestBody.actionsThatWouldRun).toEqual([]);

    // GET /:id/executions — dry-run test does not persist executions, so empty.
    const executionsResponse = await request(server)
      .get(`/api/automation-rules/${created.id}/executions`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const executionsBody = executionsResponse.body as AutomationExecutionsResponse;
    expect(executionsBody.data).toEqual([]);
    expect(executionsBody.meta.total).toBe(0);

    // DELETE — then confirm gone (GET /:id → 404, absent from list).
    await request(server)
      .delete(`/api/automation-rules/${created.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    await request(server)
      .get(`/api/automation-rules/${created.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(404);

    const afterDeleteResponse = await request(server)
      .get('/api/automation-rules')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const afterDeleteBody =
      afterDeleteResponse.body as AutomationRulesListResponse;
    expect(
      afterDeleteBody.data.find((rule) => rule.id === created.id),
    ).toBeUndefined();
  });

  it('rejects every automation endpoint for non-admin personas with 403', async () => {
    // Seed a rule as owner so non-admins have a real target for read/mutate.
    const created = await createOwnerRule(server, 'Guarded rule');
    const ruleBody = {
      name: 'Should not persist',
      trigger: 'TICKET_CREATED',
      conditions: [{ field: 'priority', operator: 'equals', value: 'SEV1' }],
      actions: [{ type: 'notify_team_lead' }],
      teamId: fixtureTeamIds.it,
    };

    for (const persona of [fixtureEmails.agent, fixtureEmails.requester]) {
      // The whole controller is behind AdminGuard, so non-admins are blocked
      // before any handler runs — every verb returns 403.
      await request(server)
        .get('/api/automation-rules')
        .set(authHeader(persona))
        .expect(403);

      await request(server)
        .get(`/api/automation-rules/${created.id}`)
        .set(authHeader(persona))
        .expect(403);

      await request(server)
        .get(`/api/automation-rules/${created.id}/executions`)
        .set(authHeader(persona))
        .expect(403);

      await request(server)
        .post('/api/automation-rules')
        .set(authHeader(persona))
        .send(ruleBody)
        .expect(403);

      await request(server)
        .patch(`/api/automation-rules/${created.id}`)
        .set(authHeader(persona))
        .send({ isActive: false })
        .expect(403);

      await request(server)
        .delete(`/api/automation-rules/${created.id}`)
        .set(authHeader(persona))
        .expect(403);

      await request(server)
        .post(`/api/automation-rules/${created.id}/test`)
        .set(authHeader(persona))
        .send({})
        .expect(403);
    }

    // Rule must survive the rejected attempts.
    const getOneResponse = await request(server)
      .get(`/api/automation-rules/${created.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    expect((getOneResponse.body as AutomationRule).isActive).toBe(true);
  });
});
