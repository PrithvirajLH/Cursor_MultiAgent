import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { RetentionService } from '../../src/retention/retention.service';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TicketResponse = { id: string };
type RetentionRunPayload = { dryRun: boolean; softDeletedTicketsPurged: number };

const FORTY_DAYS_MS = 40 * 86_400_000;

async function createTicket(server: SupertestApp, subject: string) {
  const created = await request(server)
    .post('/api/tickets')
    .set(authHeader(fixtureEmails.requester))
    .send({
      subject,
      description: 'Retention test ticket',
      priority: 'SEV3',
      channel: 'PORTAL',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);
  return created.body as TicketResponse;
}

describe('Retention job', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let svc: RetentionService;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    svc = app.get(RetentionService);
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  it('is off and in dry run by default', () => {
    const policy = svc.getPolicy();
    expect(policy.enabled).toBe(false);
    expect(policy.dryRun).toBe(true);
    expect(policy.closedTicketDays).toBeNull();
    expect(policy.adminAuditDays).toBeNull();
  });

  it('counts but does not delete in dry run, then purges when dry run is off', async () => {
    const prisma = getPrisma();
    const stamp = Date.now();
    const doomed = await createTicket(server, `Retention doomed ${stamp}`);
    const survivor = await createTicket(server, `Retention survivor ${stamp}`);

    await request(server)
      .delete(`/api/tickets/${doomed.id}`)
      .set(authHeader(fixtureEmails.owner))
      .send({ reason: 'retention spec' })
      .expect(200);
    // Back-date the deletion past the 30-day soft-delete window.
    await prisma.ticket.update({
      where: { id: doomed.id },
      data: { deletedAt: new Date(stamp - FORTY_DAYS_MS) },
    });

    const dry = await svc.runOnce();
    expect(dry).not.toBeNull();
    expect(dry?.dryRun).toBe(true);
    expect(dry?.softDeletedTicketsPurged).toBe(1);
    expect(await prisma.ticket.findUnique({ where: { id: doomed.id } })).not.toBeNull();

    svc.setPolicyForTests({ dryRun: false });
    try {
      const real = await svc.runOnce();
      expect(real?.dryRun).toBe(false);
      expect(real?.softDeletedTicketsPurged).toBe(1);
    } finally {
      svc.setPolicyForTests({ dryRun: true });
    }

    expect(await prisma.ticket.findUnique({ where: { id: doomed.id } })).toBeNull();
    expect(await prisma.ticket.findUnique({ where: { id: survivor.id } })).not.toBeNull();

    const audit = await prisma.adminAuditEvent.findFirst({
      where: { type: 'RETENTION_RUN' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    const payload = audit?.payload as RetentionRunPayload;
    expect(payload.dryRun).toBe(false);
    expect(payload.softDeletedTicketsPurged).toBe(1);
    expect(audit?.actorEmail).toBe('system');
  });
});
