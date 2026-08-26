import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

type ReadyBody = {
  status: string;
  db: string;
  redis: { emailQueue: string; automationQueue: string };
  smtp: string;
  webPubSub: string;
  blobStorage: string;
  attachmentScanner: string;
  aiPipeline: string;
  slaWorker: {
    enabled: boolean;
    lastRunAt: string | null;
    lastRunOk: boolean | null;
  };
};

type LivenessBody = { status: string; timestamp: string };

describe('GET /api/health/ready', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers without authentication and reports the test environment truthfully', async () => {
    const res = await request(server).get('/api/health/ready').expect(200);
    const body = res.body as ReadyBody;
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(body.redis.emailQueue).toBe('disabled');
    expect(body.redis.automationQueue).toBe('disabled');
    expect(body.smtp).toBe('missing');
    expect(body.webPubSub).toBe('disabled');
    expect(body.blobStorage).toBe('local-disk');
    expect(body.attachmentScanner).toBe('configured');
    expect(body.aiPipeline).toBe('disabled');
    expect(body.slaWorker).toEqual({
      enabled: false,
      lastRunAt: null,
      lastRunOk: null,
    });
  });

  it('leaves the liveness probe unchanged', async () => {
    const res = await request(server).get('/api/health').expect(200);
    const body = res.body as LivenessBody;
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
  });
});
