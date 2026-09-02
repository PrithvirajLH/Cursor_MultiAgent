import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type SnapshotResponse = {
  generatedAt: string;
  switches: { key: string; state: string; on: boolean }[] | null;
  dataIn: { key: string; configured: boolean }[] | null;
  jobs: {
    key: string;
    label: string;
    enabled: boolean;
    intervalMs: number | null;
    lastRunAt: string | null;
    lastRunOk: boolean | null;
    nextRunAt: string | null;
  }[];
  outbox: {
    pending: number;
    processing: number;
    sent: number;
    failed: number;
  } | null;
};
type RunResponse = {
  key: string;
  ran: boolean;
  skipped: string | null;
  summary: Record<string, unknown> | null;
  durationMs: number;
};

describe('Operations console (card 1.21)', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  it('1: an owner sees the four jobs, the switches and the intake paths', async () => {
    const res = await request(server)
      .get('/api/operations')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const body = res.body as SnapshotResponse;
    expect(body.generatedAt).toBeTruthy();
    expect(body.jobs.map((job) => job.key)).toEqual([
      'sla-breach',
      'retention',
      // Card 1.32 added the outbox sweeper as a fourth job.
      'email-outbox',
      'automation-scheduler',
    ]);
    // Card 1.32: outbox depth, numbers only.
    expect(Object.keys(body.outbox ?? {}).sort()).toEqual([
      'failed',
      'pending',
      'processing',
      'sent',
    ]);
    expect(body.switches?.map((row) => row.key)).toEqual(
      expect.arrayContaining([
        'retention',
        'automation-scheduler',
        'sla-worker',
      ]),
    );
    expect(body.dataIn?.map((row) => row.key)).toEqual([
      'inbound-email',
      'intake',
    ]);
  });

  it('2: the snapshot reports states only — no secrets or setting values', async () => {
    const res = await request(server)
      .get('/api/operations')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('test-intake-secret');
    expect(raw).not.toContain('test-inbound-secret');
    expect(raw).not.toContain('postgresql://');
  });

  it('3: a team admin is refused', async () => {
    await request(server)
      .get('/api/operations')
      .set(authHeader(fixtureEmails.admin))
      .expect(403);
  });

  it('4: an agent is refused', async () => {
    await request(server)
      .get('/api/operations')
      .set(authHeader(fixtureEmails.agent))
      .expect(403);
  });

  it('5: running retention as an owner deletes nothing while dry run is on', async () => {
    const before = await getPrisma().ticket.count();
    const res = await request(server)
      .post('/api/operations/jobs/retention/run')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const body = res.body as RunResponse;
    expect(body.key).toBe('retention');
    if (body.ran) {
      expect(body.summary).toMatchObject({ dryRun: true });
    } else {
      expect(body.skipped).toBe('locked');
    }
    expect(await getPrisma().ticket.count()).toBe(before);
  });

  it('6: a lead cannot run a job', async () => {
    await request(server)
      .post('/api/operations/jobs/retention/run')
      .set(authHeader(fixtureEmails.lead))
      .expect(403);
  });

  it('7: an unknown job key is refused, and the scheduler runs with nothing to do', async () => {
    const bad = await request(server)
      .post('/api/operations/jobs/nope/run')
      .set(authHeader(fixtureEmails.owner))
      .expect(400);
    expect((bad.body as { message: string }).message).toContain(
      'Unknown job "nope"',
    );

    const ok = await request(server)
      .post('/api/operations/jobs/automation-scheduler/run')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const body = ok.body as RunResponse;
    if (body.ran) {
      expect(body.summary).toMatchObject({ ticketsEnqueued: 0 });
    } else {
      expect(body.skipped).toBe('locked');
    }

    // The run is now visible on the snapshot without a restart.
    const after = await request(server)
      .get('/api/operations')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const scheduler = (after.body as SnapshotResponse).jobs.find(
      (job) => job.key === 'automation-scheduler',
    );
    expect(scheduler?.lastRunAt).toBeTruthy();
    expect(scheduler?.nextRunAt).toBeTruthy();
  });
});
