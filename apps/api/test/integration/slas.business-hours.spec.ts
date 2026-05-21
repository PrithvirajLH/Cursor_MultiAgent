import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

const compressedSchedule = [
  { day: 'Monday', enabled: true, start: '00:00', end: '00:30' },
  { day: 'Tuesday', enabled: true, start: '00:00', end: '00:30' },
  { day: 'Wednesday', enabled: true, start: '00:00', end: '00:30' },
  { day: 'Thursday', enabled: true, start: '00:00', end: '00:30' },
  { day: 'Friday', enabled: true, start: '00:00', end: '00:30' },
  { day: 'Saturday', enabled: true, start: '00:00', end: '00:30' },
  { day: 'Sunday', enabled: true, start: '00:00', end: '00:30' },
];

describe('SLA business-hours due-date calculation', () => {
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

  it('extends SLA due dates beyond raw wall-clock math when business hours are compressed', async () => {
    await request(server)
      .patch('/api/slas/settings')
      .set(authHeader(fixtureEmails.owner))
      .send({
        timezone: 'UTC',
        schedule: compressedSchedule,
        holidays: [],
      })
      .expect(200);

    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `Business hours SLA ${Date.now()}`,
        description: 'Validate due date math',
        priority: 'SEV2',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);

    const body = created.body as {
      createdAt: string;
      firstResponseDueAt?: string | null;
      dueAt?: string | null;
    };

    expect(body.firstResponseDueAt).toBeTruthy();
    expect(body.dueAt).toBeTruthy();

    const createdAt = new Date(body.createdAt);
    const firstResponseRaw = new Date(createdAt.getTime() + 4 * 60 * 60 * 1000);
    const resolutionRaw = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);

    expect(
      new Date(body.firstResponseDueAt as string).getTime(),
    ).toBeGreaterThan(firstResponseRaw.getTime());
    expect(new Date(body.dueAt as string).getTime()).toBeGreaterThan(
      resolutionRaw.getTime(),
    );
  });

  it('preserves SLA cycle anchor when recalculating with unchanged priority', async () => {
    await request(server)
      .patch('/api/slas/settings')
      .set(authHeader(fixtureEmails.owner))
      .send({
        timezone: 'UTC',
        schedule: compressedSchedule,
        holidays: [],
      })
      .expect(200);

    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `Business hours transfer ${Date.now()}`,
        description: 'Ensure transfer does not drift due dates',
        priority: 'SEV2',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);

    const createdBody = created.body as { id: string; dueAt: string };
    const beforeTransferDueAt = new Date(createdBody.dueAt).getTime();

    await request(server)
      .post('/api/tickets/bulk/priority')
      .set(authHeader(fixtureEmails.owner))
      .send({
        ticketIds: [createdBody.id],
        priority: 'SEV2',
      })
      .expect(201);

    const refreshed = await request(server)
      .get(`/api/tickets/${createdBody.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const refreshedBody = refreshed.body as { dueAt: string };
    const afterRecomputeDueAt = new Date(refreshedBody.dueAt).getTime();

    expect(Math.abs(afterRecomputeDueAt - beforeTransferDueAt)).toBeLessThan(
      60_000,
    );
  });
});
