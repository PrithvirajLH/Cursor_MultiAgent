import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SlaBreachService } from '../../src/slas/sla-breach.service';
import { SlaEngineService } from '../../src/slas/sla-engine.service';
import { SlasModule } from '../../src/slas/slas.module';
import { TicketRealtimeService } from '../../src/tickets/ticket-realtime.service';

const HOUR_MS = 60 * 60 * 1000;

type TicketResponse = { id: string };

type BreachRunner = { enabled: boolean };

function authHeader(email: string) {
  return { 'x-user-email': email };
}

async function createTicket(server: SupertestApp): Promise<TicketResponse> {
  const response = await request(server)
    .post('/api/tickets')
    .set(authHeader(fixtureEmails.requester))
    .send({
      subject: `SLA realtime test ${Date.now()}`,
      description: 'Announce the breach',
      priority: 'SEV2',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);
  return response.body as TicketResponse;
}

/**
 * The worker's own instance of TicketRealtimeService, not the one in
 * TicketsModule: SlasModule provides its own to avoid a module cycle, so
 * app.get() could hand back either.
 */
function workerRealtime(app: INestApplication): TicketRealtimeService {
  return app.select(SlasModule).get(TicketRealtimeService);
}

describe('SLA worker realtime announcements', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let prisma: PrismaService;
  let slaEngine: SlaEngineService;
  let slaBreach: SlaBreachService;

  beforeAll(async () => {
    process.env.NOTIFICATIONS_QUEUE_ENABLED = 'false';
    process.env.SLA_BREACH_WORKER_ENABLED = 'false';
    process.env.SLA_AT_RISK_ENABLED = 'false';
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    prisma = app.get(PrismaService);
    slaEngine = app.get(SlaEngineService);
    slaBreach = app.get(SlaBreachService);
    (slaBreach as unknown as BreachRunner).enabled = true;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('announces the ticket it breached, and nothing else', async () => {
    const ticket = await createTicket(server);
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        firstResponseDueAt: new Date(Date.now() - HOUR_MS),
        dueAt: new Date(Date.now() + 6 * HOUR_MS),
      },
    });
    await slaEngine.syncFromTicket(ticket.id);
    // Spied rather than observed on a socket: realtime is disabled in tests, so
    // this asserts the worker asks to publish, which is the part it owns.
    const emit = jest
      .spyOn(workerRealtime(app), 'emitTicketRealtimeEvent')
      .mockResolvedValue(undefined);

    await slaBreach.runOnce();

    const calls = emit.mock.calls.filter(
      ([params]) => params.ticketId === ticket.id,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toEqual({
      ticketId: ticket.id,
      reason: 'sla_changed',
      actorId: null,
    });
    const instance = await prisma.slaInstance.findUnique({
      where: { ticketId: ticket.id },
    });
    expect(instance?.firstResponseBreachedAt).toBeTruthy();
    emit.mockRestore();
  });

  it('says nothing on a tick with nothing to change', async () => {
    // Everything breachable was already marked by the run above, so this tick
    // inspects instances and changes none of them.
    const emit = jest
      .spyOn(workerRealtime(app), 'emitTicketRealtimeEvent')
      .mockResolvedValue(undefined);

    await slaBreach.runOnce();

    expect(emit).not.toHaveBeenCalled();
    emit.mockRestore();
  });

  it('still marks the breach when publishing throws', async () => {
    const ticket = await createTicket(server);
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        firstResponseDueAt: new Date(Date.now() - HOUR_MS),
        dueAt: new Date(Date.now() + 6 * HOUR_MS),
      },
    });
    await slaEngine.syncFromTicket(ticket.id);
    const emit = jest
      .spyOn(workerRealtime(app), 'emitTicketRealtimeEvent')
      .mockRejectedValue(new Error('web pubsub is down'));

    const summary = await slaBreach.runOnce();

    expect(summary?.ok).toBe(true);
    const instance = await prisma.slaInstance.findUnique({
      where: { ticketId: ticket.id },
    });
    expect(instance?.firstResponseBreachedAt).toBeTruthy();
    const events = await prisma.ticketEvent.count({
      where: { ticketId: ticket.id, type: 'SLA_BREACHED' },
    });
    expect(events).toBe(1);
    emit.mockRestore();
  });
});
