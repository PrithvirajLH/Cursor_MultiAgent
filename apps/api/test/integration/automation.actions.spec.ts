import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { RuleEngineService } from '../../src/automation/rule-engine.service';
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

type TicketResponse = {
  id: string;
  displayId: string | null;
  subject: string;
  status: string;
  categoryId: string | null;
  tags?: { name: string }[];
};
type RuleResponse = { id: string };
type FollowersResponse = { data: { userId: string }[] };

// Test-seed categories (prisma/seed.ts seedTest).
const ACCESS_IDENTITY_CATEGORY_ID = 'c1111111-1111-4111-8111-111111111111';
const EXECUTION_TIMEOUT_MS = 10_000;

/**
 * Rules fire on TICKET_CREATED, which the API enqueues fire-and-forget after
 * the POST returns, so every case waits for the AutomationExecution row.
 */
async function waitForExecution(ruleId: string, ticketId: string) {
  const start = Date.now();
  while (Date.now() - start < EXECUTION_TIMEOUT_MS) {
    const row = await getPrisma().automationExecution.findFirst({
      where: { ruleId, ticketId },
    });
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`rule ${ruleId} did not run for ticket ${ticketId}`);
}

describe('Automation actions: tags, category, follower, email (card 1.4)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let priority = 10;

  async function createRule(
    token: string,
    actions: Record<string, unknown>[],
    trigger: string = 'TICKET_CREATED',
  ): Promise<string> {
    priority += 1;
    const res = await request(server)
      .post('/api/automation-rules')
      .set(authHeader(fixtureEmails.owner))
      .send({
        name: `1.4 ${token}`,
        trigger,
        conditions: [{ field: 'subject', operator: 'contains', value: token }],
        actions,
        teamId: fixtureTeamIds.it,
        isActive: true,
        priority,
      })
      .expect(201);
    return (res.body as RuleResponse).id;
  }

  async function createTicket(subject: string): Promise<TicketResponse> {
    const res = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject,
        description: 'Automation actions spec ticket',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    return res.body as TicketResponse;
  }

  async function getTicket(id: string): Promise<TicketResponse> {
    const res = await request(server)
      .get(`/api/tickets/${id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    return res.body as TicketResponse;
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

  it('1: add_tag attaches normalised tags as MANUAL, created by the rule owner, with a TAGS_CHANGED event', async () => {
    const ruleId = await createRule('ACT1', [
      { type: 'add_tag', tags: ['VPN', ' Remote Access '] },
    ]);
    const ticket = await createTicket('ACT1 vpn is broken');
    const execution = await waitForExecution(ruleId, ticket.id);
    expect(execution.success).toBe(true);
    const after = await getTicket(ticket.id);
    const names = (after.tags ?? []).map((tag) => tag.name).sort();
    expect(names).toEqual(['remote access', 'vpn']);
    const rows = await getPrisma().ticketTag.findMany({
      where: { ticketId: ticket.id },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.source === 'MANUAL')).toBe(true);
    expect(rows.every((row) => row.createdById === fixtureUserIds.owner)).toBe(
      true,
    );
    const event = await getPrisma().ticketEvent.findFirst({
      where: { ticketId: ticket.id, type: 'TAGS_CHANGED' },
    });
    const payload = event?.payload as {
      added: string[];
      removed: string[];
      byAutomation: boolean;
    };
    expect([...payload.added].sort()).toEqual(['remote access', 'vpn']);
    expect(payload.removed).toEqual([]);
    expect(payload.byAutomation).toBe(true);
  });

  it('2: remove_tag removes a present tag; a second run is a no-op', async () => {
    const ruleId = await createRule(
      'ACT2',
      [{ type: 'remove_tag', tags: ['Obsolete'] }],
      'STATUS_CHANGED',
    );
    const ticket = await createTicket('ACT2 tagged ticket');
    await request(server)
      .post(`/api/tickets/${ticket.id}/tags`)
      .set(authHeader(fixtureEmails.owner))
      .send({ name: 'obsolete' })
      .expect(201);
    expect((await getTicket(ticket.id)).tags?.map((t) => t.name)).toEqual([
      'obsolete',
    ]);
    const engine = app.get(RuleEngineService);
    const first = await engine.runForTicket(ticket.id, 'STATUS_CHANGED');
    expect(first).toEqual({ executed: 1, errors: [] });
    expect((await getTicket(ticket.id)).tags ?? []).toEqual([]);
    const events = () =>
      getPrisma().ticketEvent.count({
        where: { ticketId: ticket.id, type: 'TAGS_CHANGED' },
      });
    expect(await events()).toBe(1);
    const second = await engine.runForTicket(ticket.id, 'STATUS_CHANGED');
    expect(second).toEqual({ executed: 1, errors: [] });
    expect(await events()).toBe(1);
    expect(
      await getPrisma().automationExecution.count({ where: { ruleId } }),
    ).toBe(2);
  });

  it('3: set_category sets an active category with a byAutomation event; an unknown category is rejected at save time', async () => {
    const ruleId = await createRule('ACT3', [
      { type: 'set_category', categoryId: ACCESS_IDENTITY_CATEGORY_ID },
    ]);
    const ticket = await createTicket('ACT3 needs a category');
    expect(ticket.categoryId).toBeNull();
    const execution = await waitForExecution(ruleId, ticket.id);
    expect(execution.success).toBe(true);
    expect((await getTicket(ticket.id)).categoryId).toBe(
      ACCESS_IDENTITY_CATEGORY_ID,
    );
    const event = await getPrisma().ticketEvent.findFirst({
      where: { ticketId: ticket.id, type: 'TICKET_CATEGORY_CHANGED' },
    });
    expect(event?.payload).toMatchObject({
      from: null,
      to: ACCESS_IDENTITY_CATEGORY_ID,
      byAutomation: true,
    });
    const rejected = await request(server)
      .post('/api/automation-rules')
      .set(authHeader(fixtureEmails.owner))
      .send({
        name: '1.4 bad category',
        trigger: 'TICKET_CREATED',
        conditions: [
          { field: 'subject', operator: 'contains', value: 'never' },
        ],
        actions: [
          {
            type: 'set_category',
            categoryId: '9f9f9f9f-9f9f-4f9f-8f9f-9f9f9f9f9f9f',
          },
        ],
        teamId: fixtureTeamIds.it,
        isActive: true,
      })
      .expect(400);
    expect(JSON.stringify(rejected.body)).toContain('category not found');
  });

  it('4: add_follower adds the requester; target assignee on an unassigned ticket changes nothing and does not fail', async () => {
    const ruleId = await createRule('ACT4', [
      { type: 'add_follower', target: 'requester' },
    ]);
    const ticket = await createTicket('ACT4 follow me');
    expect((await waitForExecution(ruleId, ticket.id)).success).toBe(true);
    const followers = await request(server)
      .get(`/api/tickets/${ticket.id}/followers`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const followerIds = (followers.body as FollowersResponse).data.map(
      (row) => row.userId,
    );
    expect(followerIds).toContain(fixtureUserIds.requester);

    // Distinct token: first-match semantics would let an 'ACT4…' subject hit the rule above.
    const assigneeRuleId = await createRule('FOLLOWASSIGNEE', [
      { type: 'add_follower', target: 'assignee' },
    ]);
    const unassigned = await createTicket('FOLLOWASSIGNEE nobody assigned');
    const before = await getPrisma().ticketFollower.count({
      where: { ticketId: unassigned.id },
    });
    const execution = await waitForExecution(assigneeRuleId, unassigned.id);
    expect(execution.success).toBe(true);
    expect(execution.error).toBeNull();
    expect(
      await getPrisma().ticketFollower.count({
        where: { ticketId: unassigned.id },
      }),
    ).toBe(before);
  });

  it('5: send_email queues one AUTOMATION_EMAIL outbox row for the requester with placeholders filled; address is required for to=address', async () => {
    const ruleId = await createRule('ACT5', [
      {
        type: 'send_email',
        to: 'requester',
        subject: 'Re: {{ticket.displayId}} — {{ticket.subject}}',
        body: 'Hello {{requester.displayName}}, we are on it.',
      },
    ]);
    const ticket = await createTicket('ACT5 email me');
    expect((await waitForExecution(ruleId, ticket.id)).success).toBe(true);
    const rows = await getPrisma().notificationOutbox.findMany({
      where: { ticketId: ticket.id, eventType: 'AUTOMATION_EMAIL' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].toEmail).toBe(fixtureEmails.requester);
    expect(rows[0].toUserId).toBe(fixtureUserIds.requester);
    expect(rows[0].subject).toBe(`Re: ${ticket.displayId} — ${ticket.subject}`);
    expect(rows[0].body).toContain('Hello Requestor One');
    expect(JSON.stringify(rows[0].payload)).toContain(ruleId);

    const rejected = await request(server)
      .post('/api/automation-rules')
      .set(authHeader(fixtureEmails.owner))
      .send({
        name: '1.4 email without address',
        trigger: 'TICKET_CREATED',
        conditions: [
          { field: 'subject', operator: 'contains', value: 'never' },
        ],
        actions: [
          { type: 'send_email', to: 'address', subject: 'x', body: 'y' },
        ],
        teamId: fixtureTeamIds.it,
        isActive: true,
      })
      .expect(400);
    expect(JSON.stringify(rejected.body)).toContain('address is required');
  });

  it('6: a rule whose later action fails sends no email from an earlier send_email (post-commit ordering)', async () => {
    // assign_user with a user outside the ticket team throws inside the transaction at run time.
    const ruleId = await createRule('ACT6', [
      {
        type: 'send_email',
        to: 'requester',
        subject: 'Should never be sent',
        body: 'nope',
      },
      { type: 'assign_user', userId: fixtureUserIds.otherRequester },
    ]);
    const ticket = await createTicket('ACT6 doomed rule');
    const execution = await waitForExecution(ruleId, ticket.id);
    expect(execution.success).toBe(false);
    expect(execution.error).toContain(
      'Assignee must belong to the ticket team',
    );
    const rows = await getPrisma().notificationOutbox.count({
      // Scoped to the rule's own email by card 1.42: a portal ticket now also
      // produces a TICKET_CREATED acknowledgement to its requester, so an
      // unscoped count of this ticket's outbox rows is no longer zero. What
      // this test is about is unchanged - a failed later action must leave no
      // email from an earlier send_email.
      where: { ticketId: ticket.id, eventType: 'AUTOMATION_EMAIL' },
    });
    expect(rows).toBe(0);
  });
});
