import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import {
  fixtureEmails,
  fixtureTeamIds,
  fixtureUserIds,
} from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type CreatedRule = {
  id: string;
};

type CreatedTicket = {
  id: string;
  status: string;
  closedAt?: string | null;
  completedAt?: string | null;
};

type AutomationExecution = {
  ticketId: string;
  success: boolean;
  error?: string | null;
};

type AutomationExecutionsResponse = {
  data: AutomationExecution[];
};

type TicketEvent = {
  type: string;
  payload?: { to?: string };
};

type TicketEventsResponse = {
  data: TicketEvent[];
};

async function createTeamRule(
  server: SupertestApp,
  rule: {
    name: string;
    trigger: 'STATUS_CHANGED';
    conditions: Array<{ field: string; operator: 'equals'; value: string }>;
    actions: Array<{ type: 'set_status'; status: string }>;
  },
) {
  const response = await request(server)
    .post('/api/automation-rules')
    .set(authHeader(fixtureEmails.admin))
    .send({
      ...rule,
      teamId: fixtureTeamIds.it,
      isActive: true,
      priority: 1,
    })
    .expect(201);

  return response.body as CreatedRule;
}

async function createItTicket(server: SupertestApp, subject: string) {
  const response = await request(server)
    .post('/api/tickets')
    .set(authHeader(fixtureEmails.requester))
    .send({
      subject,
      description: 'Automation transition test ticket',
      priority: 'SEV3',
      channel: 'PORTAL',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);

  return response.body as CreatedTicket;
}

async function assignItTicketToAgent(server: SupertestApp, ticketId: string) {
  await request(server)
    .post(`/api/tickets/${ticketId}/assign`)
    .set(authHeader(fixtureEmails.admin))
    .send({ assigneeId: fixtureUserIds.agent })
    .expect(201);
}

async function waitForTicketStatus(
  server: SupertestApp,
  ticketId: string,
  status: string,
  timeoutMs = 5000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await request(server)
      .get(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.admin))
      .expect(200);
    const ticket = response.body as CreatedTicket;
    if (ticket.status === status) {
      return ticket;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  throw new Error(
    `Timed out waiting for ticket ${ticketId} to reach ${status}`,
  );
}

async function waitForExecution(
  server: SupertestApp,
  ruleId: string,
  ticketId: string,
  timeoutMs = 5000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await request(server)
      .get(`/api/automation-rules/${ruleId}/executions`)
      .set(authHeader(fixtureEmails.admin))
      .query({ page: 1, pageSize: 20 })
      .expect(200);

    const body = response.body as AutomationExecutionsResponse;
    const execution = body.data.find((item) => item.ticketId === ticketId);
    if (execution) {
      return execution;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  throw new Error(
    `Timed out waiting for automation execution for rule=${ruleId} ticket=${ticketId}`,
  );
}

describe('Automation set_status transitions', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    process.env.AUTOMATION_QUEUE_ENABLED = 'false';
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
  });

  it('applies transition side-effects when automation sets status', async () => {
    const rule = await createTeamRule(server, {
      name: `Auto close ${Date.now()}`,
      trigger: 'STATUS_CHANGED',
      conditions: [{ field: 'status', operator: 'equals', value: 'RESOLVED' }],
      actions: [{ type: 'set_status', status: 'CLOSED' }],
    });
    const created = await createItTicket(
      server,
      `Auto-close ticket ${Date.now()}`,
    );
    await assignItTicketToAgent(server, created.id);

    await request(server)
      .post(`/api/tickets/${created.id}/transition`)
      .set(authHeader(fixtureEmails.admin))
      .send({ status: 'RESOLVED' })
      .expect(201);

    const execution = await waitForExecution(server, rule.id, created.id);
    expect(execution.success).toBe(true);

    const closedTicket = await waitForTicketStatus(
      server,
      created.id,
      'CLOSED',
    );
    expect(closedTicket.closedAt).toBeTruthy();
    expect(closedTicket.completedAt).toBeTruthy();

    const eventsResponse = await request(server)
      .get(`/api/tickets/${created.id}/events`)
      .set(authHeader(fixtureEmails.admin))
      .expect(200);
    const eventsBody = eventsResponse.body as TicketEventsResponse;
    const closedEvent = eventsBody.data.find(
      (event) =>
        event.type === 'TICKET_STATUS_CHANGED' &&
        event.payload?.to === 'CLOSED',
    );
    expect(closedEvent).toBeTruthy();
  });

  it('respects transition validation and rejects invalid automation status changes', async () => {
    const rule = await createTeamRule(server, {
      name: `Auto invalid transition ${Date.now()}`,
      trigger: 'STATUS_CHANGED',
      conditions: [
        { field: 'status', operator: 'equals', value: 'IN_PROGRESS' },
      ],
      actions: [{ type: 'set_status', status: 'ASSIGNED' }],
    });
    const created = await createItTicket(
      server,
      `Auto-invalid-transition ${Date.now()}`,
    );
    await assignItTicketToAgent(server, created.id);

    await request(server)
      .post(`/api/tickets/${created.id}/transition`)
      .set(authHeader(fixtureEmails.admin))
      .send({ status: 'IN_PROGRESS' })
      .expect(201);

    const execution = await waitForExecution(server, rule.id, created.id);
    expect(execution.success).toBe(false);
    expect(execution.error ?? '').toContain('Invalid status transition');

    const response = await request(server)
      .get(`/api/tickets/${created.id}`)
      .set(authHeader(fixtureEmails.admin))
      .expect(200);
    const ticket = response.body as CreatedTicket;
    expect(ticket.status).toBe('IN_PROGRESS');
  });
});
