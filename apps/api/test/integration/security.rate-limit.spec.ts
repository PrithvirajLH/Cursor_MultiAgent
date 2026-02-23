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
