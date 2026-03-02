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
import { PrismaService } from '../../src/prisma/prisma.service';
import { SlaBreachService } from '../../src/slas/sla-breach.service';
import { SlaEngineService } from '../../src/slas/sla-engine.service';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TicketResponse = {
  id: string;
  firstResponseDueAt?: string | null;
  dueAt?: string | null;
};

type BreachRunner = {
  enabled: boolean;
  checkBreaches: () => Promise<void>;
};

async function createTicket(server: SupertestApp) {
  const response = await request(server)
    .post('/api/tickets')
    .set(authHeader(fixtureEmails.requester))
    .send({
      subject: `SLA instance test ${Date.now()}`,
      description: 'Track SLA instance creation',
      priority: 'P2',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);

  return response.body as TicketResponse;
}

describe('SLA instances and breaches', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let prisma: PrismaService;
  let slaEngine: SlaEngineService;
  let slaBreach: SlaBreachService;

  beforeAll(async () => {
    process.env.NOTIFICATIONS_QUEUE_ENABLED = 'false';
    process.env.SLA_BREACH_WORKER_ENABLED = 'false';
    process.env.SLA_ON_CALL_EMAILS = 'oncall@company.com';
    process.env.SLA_PRIORITY_BUMP_ENABLED = 'true';
    process.env.SLA_AT_RISK_THRESHOLD_MINUTES = '120';
    process.env.SLA_AT_RISK_ENABLED = 'true';

    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    prisma = app.get(PrismaService);
    slaEngine = app.get(SlaEngineService);
    slaBreach = app.get(SlaBreachService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates SLA instance with policy and due dates', async () => {
    const ticket = await createTicket(server);

    const instance = await prisma.slaInstance.findUnique({
      where: { ticketId: ticket.id },
    });

    expect(instance).toBeTruthy();

    const assignment = await prisma.slaPolicyAssignment.findUnique({
      where: { teamId: fixtureTeamIds.it },
      include: {
        policy: {
          include: { targets: true },
        },
      },
    });

    const p2Target = assignment?.policy.targets.find(
      (target) => target.priority === 'P2',
    );
    expect(p2Target).toBeTruthy();
    expect(instance?.policyConfigId).toBe(assignment?.policyConfigId ?? null);
    expect(instance?.firstResponseDueAt?.toISOString()).toBe(
      ticket.firstResponseDueAt,
    );
    expect(instance?.resolutionDueAt?.toISOString()).toBe(ticket.dueAt);
  });

  it('updates SLA instance when first response is added', async () => {
    const ticket = await createTicket(server);

    await request(server)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({ body: 'First response from agent', type: 'PUBLIC' })
      .expect(201);

    const instance = await prisma.slaInstance.findUnique({
      where: { ticketId: ticket.id },
    });

    expect(instance?.firstResponseBreachedAt).toBeNull();
    expect(instance?.nextDueAt?.toISOString()).toBe(
      instance?.resolutionDueAt?.toISOString(),
    );
  });

  it('pauses SLA instance on waiting status and resumes on active status', async () => {
    const ticket = await createTicket(server);

    await request(server)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set(authHeader(fixtureEmails.agent))
      .send({})
      .expect(201);

    await request(server)
      .post(`/api/tickets/${ticket.id}/transition`)
      .set(authHeader(fixtureEmails.agent))
      .send({ status: 'WAITING_ON_REQUESTER' })
      .expect(201);

    let instance = await prisma.slaInstance.findUnique({
      where: { ticketId: ticket.id },
    });

    expect(instance?.pausedAt).toBeTruthy();
    expect(instance?.nextDueAt).toBeNull();

    await request(server)
      .post(`/api/tickets/${ticket.id}/transition`)
      .set(authHeader(fixtureEmails.agent))
      .send({ status: 'IN_PROGRESS' })
      .expect(201);

    instance = await prisma.slaInstance.findUnique({
      where: { ticketId: ticket.id },
    });

    expect(instance?.pausedAt).toBeNull();
    expect(instance?.nextDueAt?.toISOString()).toBe(
      instance?.firstResponseDueAt?.toISOString(),
    );
  });

  it('breach worker records breach, escalations, and priority bump', async () => {
    const ticket = await createTicket(server);

    const past = new Date(Date.now() - 60 * 60 * 1000);
    const future = new Date(Date.now() + 6 * 60 * 60 * 1000);

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { firstResponseDueAt: past, dueAt: future },
    });

    await slaEngine.syncFromTicket(ticket.id);

    const breachRunner = slaBreach as unknown as BreachRunner;
    breachRunner.enabled = true;
    await breachRunner.checkBreaches();

    const instance = await prisma.slaInstance.findUnique({
      where: { ticketId: ticket.id },
    });

    expect(instance?.firstResponseBreachedAt).toBeTruthy();

    const breachEvents = await prisma.ticketEvent.findMany({
      where: { ticketId: ticket.id, type: 'SLA_BREACHED' },
    });
    expect(breachEvents.length).toBe(1);

    const priorityBumps = await prisma.ticketEvent.findMany({
      where: { ticketId: ticket.id, type: 'PRIORITY_BUMPED' },
    });
    expect(priorityBumps.length).toBe(1);

    const updatedTicket = await prisma.ticket.findUnique({
      where: { id: ticket.id },
    });
    expect(updatedTicket?.priority).toBe('P1');

    const outbox = await prisma.notificationOutbox.findMany({
      where: { ticketId: ticket.id, eventType: 'SLA_BREACHED' },
    });
    const emails = outbox.map((entry) => entry.toEmail);
    expect(emails).toEqual(
      expect.arrayContaining([fixtureEmails.lead, 'oncall@company.com']),
    );
  });

  it('sends SLA at-risk notification before breach', async () => {
    const ticket = await createTicket(server);

    const now = new Date();
    const atRiskDue = new Date(now.getTime() + 45 * 60 * 1000);
    const resolutionDue = new Date(now.getTime() + 6 * 60 * 60 * 1000);

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { firstResponseDueAt: atRiskDue, dueAt: resolutionDue },
    });

    await slaEngine.syncFromTicket(ticket.id);

    const breachRunner = slaBreach as unknown as BreachRunner;
    breachRunner.enabled = true;
    await breachRunner.checkBreaches();

    const instance = await prisma.slaInstance.findUnique({
      where: { ticketId: ticket.id },
    });

    expect(instance?.firstResponseAtRiskNotifiedAt).toBeTruthy();
    expect(instance?.firstResponseBreachedAt).toBeNull();

    const atRiskEvents = await prisma.ticketEvent.findMany({
      where: { ticketId: ticket.id, type: 'SLA_AT_RISK' },
    });
    expect(atRiskEvents.length).toBe(1);

    const inApp = await prisma.notification.findMany({
      where: {
        ticketId: ticket.id,
        type: 'SLA_AT_RISK',
        userId: fixtureUserIds.lead,
      },
    });
    expect(inApp.length).toBe(1);
  });
});
