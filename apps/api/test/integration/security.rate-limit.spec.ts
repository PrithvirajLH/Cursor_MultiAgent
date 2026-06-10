import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

describe('Security rate limiting', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let previousLimit: string | undefined;
  let previousTtl: string | undefined;

  beforeAll(async () => {
    previousLimit = process.env.RATE_LIMIT_LIMIT;
    previousTtl = process.env.RATE_LIMIT_TTL_MS;
    process.env.RATE_LIMIT_LIMIT = '2';
    process.env.RATE_LIMIT_TTL_MS = '60000';

    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    if (previousLimit == null) {
      delete process.env.RATE_LIMIT_LIMIT;
    } else {
      process.env.RATE_LIMIT_LIMIT = previousLimit;
    }

    if (previousTtl == null) {
      delete process.env.RATE_LIMIT_TTL_MS;
    } else {
      process.env.RATE_LIMIT_TTL_MS = previousTtl;
    }

    if (app) {
      await app.close();
    }
  });

  it('returns 429 when request volume exceeds configured limit', async () => {
    await request(server)
      .get('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    await request(server)
      .get('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    await request(server)
      .get('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .expect(429);
  });
});

describe('Route-specific throttling (RL-01)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    savedEnv.RATE_LIMIT_LIMIT = process.env.RATE_LIMIT_LIMIT;
    savedEnv.RATE_LIMIT_WEBHOOK_LIMIT = process.env.RATE_LIMIT_WEBHOOK_LIMIT;
    savedEnv.RATE_LIMIT_WEBHOOK_TTL_MS = process.env.RATE_LIMIT_WEBHOOK_TTL_MS;
    savedEnv.RATE_LIMIT_HIGH_WRITE_LIMIT =
      process.env.RATE_LIMIT_HIGH_WRITE_LIMIT;
    savedEnv.RATE_LIMIT_HIGH_WRITE_TTL_MS =
      process.env.RATE_LIMIT_HIGH_WRITE_TTL_MS;
    process.env.RATE_LIMIT_LIMIT = '1000';
    process.env.RATE_LIMIT_TTL_MS = '60000';
    process.env.RATE_LIMIT_WEBHOOK_LIMIT = '2';
    process.env.RATE_LIMIT_WEBHOOK_TTL_MS = '60000';
    process.env.RATE_LIMIT_HIGH_WRITE_LIMIT = '2';
    process.env.RATE_LIMIT_HIGH_WRITE_TTL_MS = '60000';

    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    if (savedEnv.RATE_LIMIT_LIMIT != null)
      process.env.RATE_LIMIT_LIMIT = savedEnv.RATE_LIMIT_LIMIT;
    else delete process.env.RATE_LIMIT_LIMIT;
    if (savedEnv.RATE_LIMIT_WEBHOOK_LIMIT != null)
      process.env.RATE_LIMIT_WEBHOOK_LIMIT = savedEnv.RATE_LIMIT_WEBHOOK_LIMIT;
    else delete process.env.RATE_LIMIT_WEBHOOK_LIMIT;
    if (savedEnv.RATE_LIMIT_WEBHOOK_TTL_MS != null)
      process.env.RATE_LIMIT_WEBHOOK_TTL_MS =
        savedEnv.RATE_LIMIT_WEBHOOK_TTL_MS;
    else delete process.env.RATE_LIMIT_WEBHOOK_TTL_MS;
    if (savedEnv.RATE_LIMIT_HIGH_WRITE_LIMIT != null)
      process.env.RATE_LIMIT_HIGH_WRITE_LIMIT =
        savedEnv.RATE_LIMIT_HIGH_WRITE_LIMIT;
    else delete process.env.RATE_LIMIT_HIGH_WRITE_LIMIT;
    if (savedEnv.RATE_LIMIT_HIGH_WRITE_TTL_MS != null)
      process.env.RATE_LIMIT_HIGH_WRITE_TTL_MS =
        savedEnv.RATE_LIMIT_HIGH_WRITE_TTL_MS;
    else delete process.env.RATE_LIMIT_HIGH_WRITE_TTL_MS;
    if (app) await app.close();
  });

  function webhookSecretHeader() {
    // Use the inbound-email webhook secret the app actually runs with (pinned in
    // test/setup-tests.ts). The previous value was a per-suite override that
    // ConfigService never picked up — the secret is snapshotted at app boot — so
    // it always 403'd before the throttle limit was reached.
    return { 'x-inbound-email-secret': 'test-inbound-secret' };
  }

  it('applies webhook limit to POST /tickets/inbound-email and returns 429 when exceeded', async () => {
    const body = {
      fromEmail: 'test@example.com',
      subject: 'Test',
      body: 'Body',
      messageId: 'msg-1',
    };
    await request(server)
      .post('/api/tickets/inbound-email')
      .set(webhookSecretHeader())
      .send(body)
      .expect(201);
    await request(server)
      .post('/api/tickets/inbound-email')
      .set(webhookSecretHeader())
      .send({ ...body, messageId: 'msg-2' })
      .expect(201);
    await request(server)
      .post('/api/tickets/inbound-email')
      .set(webhookSecretHeader())
      .send({ ...body, messageId: 'msg-3' })
      .expect(429);
  });

  it('applies highWrite limit to POST /tickets and returns 429 when exceeded', async () => {
    const body = { subject: 'Test', description: 'Description' };
    await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.agent))
      .send(body)
      .expect(201);
    await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.agent))
      .send({ ...body, subject: 'Test 2' })
      .expect(201);
    await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.agent))
      .send({ ...body, subject: 'Test 3' })
      .expect(429);
  });
});
