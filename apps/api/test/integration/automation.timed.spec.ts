import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { AutomationSchedulerService } from '../../src/automation/automation-scheduler.service';
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
  status: string;
  closeReason?: string | null;
};
type RuleResponse = { id: string };

const TWO_HOURS_AGO = () => new Date(Date.now() - 2 * 60 * 60 * 1000);

async function createTicket(server: SupertestApp, subject: string) {
  const res = await request(server)
    .post('/api/tickets')
    .set(authHeader(fixtureEmails.requester))
    .send({
      subject,
      description: 'Timed automation test ticket',
      priority: 'SEV3',
      channel: 'PORTAL',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);
  return res.body as TicketResponse;
}

async function driveTo(server: SupertestApp, id: string, statuses: string[]) {
  await request(server)
    .post(`/api/tickets/${id}/transition`)
    .set(authHeader(fixtureEmails.admin))
    .send({ status: 'TRIAGED' })
    .expect(201);
  await request(server)
    .post(`/api/tickets/${id}/assign`)
    .set(authHeader(fixtureEmails.admin))
    .send({ assigneeId: fixtureUserIds.agent })
    .expect(201);
  for (const status of statuses) {
    await request(server)
      .post(`/api/tickets/${id}/transition`)
      .set(authHeader(fixtureEmails.admin))
      .send({ status })
      .expect(201);
  }
}

async function createRule(server: SupertestApp, body: Record<string, unknown>) {
  const res = await request(server)
    .post('/api/automation-rules')
    .set(authHeader(fixtureEmails.owner))
    .send(body)
    .expect(201);
  return (res.body as RuleResponse).id;
}

/**
 * Back-date a timestamp column. Prisma accepts an explicit `updatedAt` /
 * `createdAt` in update data; the spec verifies the value stuck and falls back
 * to raw SQL if not, and reports which path was used.
 */
const backdatePath: string[] = [];
async function backdate(
  id: string,
  column: 'updatedAt' | 'createdAt',
  to: Date,
) {
  const prisma = getPrisma();
  await prisma.ticket.update({ where: { id }, data: { [column]: to } });
  const after = await prisma.ticket.findUnique({
    where: { id },
    select: { updatedAt: true, createdAt: true },
  });
  const stuck =
    after && Math.abs(after[column].getTime() - to.getTime()) < 1000;
  if (stuck) {
    backdatePath.push('prisma');
    return;
  }
  backdatePath.push('raw');
  await prisma.$executeRawUnsafe(
    `UPDATE "Ticket" SET "${column}" = $1 WHERE id = $2`,
    to,
    id,
  );
}

describe('Timed automations (TIME_IN_STATUS / UNASSIGNED_FOR)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let scheduler: AutomationSchedulerService;
  let autoCloseRuleId: string;
  let reminderRuleId: string;
  let unassignedRuleId: string;
  let hrRuleId: string;
  let autoClosedTicketId: string;
  let unassignedTicketId: string;

  const executions = (ruleId: string, ticketId: string) =>
    getPrisma().automationExecution.count({
      where: { ruleId, ticketId, success: true },
    });

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    scheduler = app.get(AutomationSchedulerService);
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
    console.log(
      `backdate path used: ${[...new Set(backdatePath)].join(',') || 'n/a'}`,
    );
  });

  it('1: a time rule without an hours threshold is rejected (400)', async () => {
    const res = await request(server)
      .post('/api/automation-rules')
      .set(authHeader(fixtureEmails.owner))
      .send({
        name: 'Bad time rule',
        trigger: 'TIME_IN_STATUS',
        conditions: [
          { field: 'status', operator: 'equals', value: 'RESOLVED' },
        ],
        actions: [{ type: 'set_status', status: 'CLOSED' }],
        isActive: true,
      })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('hours threshold');
    await request(server)
      .post('/api/automation-rules')
      .set(authHeader(fixtureEmails.owner))
      .send({
        name: 'Bad unassigned rule',
        trigger: 'UNASSIGNED_FOR',
        conditions: [{ field: 'priority', operator: 'equals', value: 'SEV1' }],
        actions: [{ type: 'notify_team_lead' }],
        isActive: true,
      })
      .expect(400);
  });

  it('2: auto-close — a RESOLVED ticket idle past the threshold is CLOSED with AUTO_CLOSED', async () => {
    autoCloseRuleId = await createRule(server, {
      name: 'Auto-close resolved after 1 hour',
      trigger: 'TIME_IN_STATUS',
      conditions: [
        { field: 'status', operator: 'equals', value: 'RESOLVED' },
        { field: 'hoursSinceActivity', operator: 'gte', value: 1 },
      ],
      actions: [{ type: 'set_status', status: 'CLOSED' }],
      isActive: true,
      teamId: fixtureTeamIds.it,
      priority: 1,
    });
    const ticket = await createTicket(server, `Auto-close ${Date.now()}`);
    autoClosedTicketId = ticket.id;
    await driveTo(server, ticket.id, ['IN_PROGRESS', 'RESOLVED']);
    await backdate(ticket.id, 'updatedAt', TWO_HOURS_AGO());

    const summary = await scheduler.runOnce();
    expect(summary).not.toBeNull();
    expect(summary?.ticketsEnqueued).toBeGreaterThanOrEqual(1);
    const after = await getPrisma().ticket.findUnique({
      where: { id: ticket.id },
    });
    expect(after?.status).toBe('CLOSED');
    expect(after?.closeReason).toBe('AUTO_CLOSED');
    expect(await executions(autoCloseRuleId, ticket.id)).toBe(1);
  });

  it('3: a second tick does not re-run the auto-close rule for that ticket', async () => {
    await scheduler.runOnce();
    expect(await executions(autoCloseRuleId, autoClosedTicketId)).toBe(1);
    const after = await getPrisma().ticket.findUnique({
      where: { id: autoClosedTicketId },
    });
    expect(after?.status).toBe('CLOSED');
  });

  it('4: reminder — a ticket waiting on the requester gets one in-app reminder, not two', async () => {
    reminderRuleId = await createRule(server, {
      name: 'Remind requester after 1 hour waiting',
      trigger: 'TIME_IN_STATUS',
      conditions: [
        { field: 'status', operator: 'equals', value: 'WAITING_ON_REQUESTER' },
        { field: 'hoursSinceActivity', operator: 'gte', value: 1 },
      ],
      actions: [{ type: 'notify_requester' }],
      isActive: true,
      teamId: fixtureTeamIds.it,
      priority: 2,
    });
    const ticket = await createTicket(server, `Reminder ${Date.now()}`);
    await driveTo(server, ticket.id, ['IN_PROGRESS', 'WAITING_ON_REQUESTER']);
    await backdate(ticket.id, 'updatedAt', TWO_HOURS_AGO());

    await scheduler.runOnce();
    const reminders = () =>
      getPrisma().notification.count({
        where: {
          ticketId: ticket.id,
          userId: fixtureUserIds.requester,
          type: 'TICKET_UPDATED',
        },
      });
    expect(await reminders()).toBe(1);
    expect(await executions(reminderRuleId, ticket.id)).toBe(1);
    await scheduler.runOnce();
    expect(await reminders()).toBe(1);
  });

  it('5: unassigned — leads are alerted for a ticket unassigned past the threshold, not for a fresh one', async () => {
    unassignedRuleId = await createRule(server, {
      name: 'Alert lead when unassigned 1 hour',
      trigger: 'UNASSIGNED_FOR',
      conditions: [{ field: 'hoursUnassigned', operator: 'gte', value: 1 }],
      actions: [{ type: 'notify_team_lead', body: 'Unassigned for an hour.' }],
      isActive: true,
      teamId: fixtureTeamIds.it,
      priority: 3,
    });
    const stale = await createTicket(server, `Unassigned stale ${Date.now()}`);
    unassignedTicketId = stale.id;
    await backdate(stale.id, 'createdAt', TWO_HOURS_AGO());
    const fresh = await createTicket(server, `Unassigned fresh ${Date.now()}`);

    await scheduler.runOnce();
    expect(await executions(unassignedRuleId, stale.id)).toBe(1);
    const leadAlerts = await getPrisma().notification.count({
      where: {
        ticketId: stale.id,
        userId: fixtureUserIds.lead,
        type: 'SLA_AT_RISK',
      },
    });
    expect(leadAlerts).toBe(1);
    expect(await executions(unassignedRuleId, fresh.id)).toBe(0);
  });

  it('6: a rule scoped to the HR team never fires for an IT ticket', async () => {
    hrRuleId = await createRule(server, {
      name: 'HR unassigned alert',
      trigger: 'UNASSIGNED_FOR',
      conditions: [{ field: 'hoursUnassigned', operator: 'gte', value: 1 }],
      actions: [{ type: 'notify_team_lead' }],
      isActive: true,
      teamId: fixtureTeamIds.hr,
      priority: 4,
    });
    await scheduler.runOnce();
    expect(await executions(hrRuleId, unassignedTicketId)).toBe(0);
  });

  it('7: a soft-deleted ticket is never a candidate', async () => {
    const doomed = await createTicket(
      server,
      `Unassigned deleted ${Date.now()}`,
    );
    await backdate(doomed.id, 'createdAt', TWO_HOURS_AGO());
    await request(server)
      .delete(`/api/tickets/${doomed.id}`)
      .set(authHeader(fixtureEmails.owner))
      .send({ reason: 'timed spec' })
      .expect(200);
    await scheduler.runOnce();
    expect(await executions(unassignedRuleId, doomed.id)).toBe(0);
  });
});
