import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signHs256Token(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const content = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(content)
    .digest('base64url');
  return `${content}.${signature}`;
}

describe('Security authentication hardening', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let previousAllowInsecure: string | undefined;
  let previousJwtSecret: string | undefined;

  beforeAll(async () => {
    previousAllowInsecure = process.env.AUTH_ALLOW_INSECURE_HEADERS;
    previousJwtSecret = process.env.AUTH_JWT_SECRET;
    process.env.AUTH_ALLOW_INSECURE_HEADERS = 'false';
    process.env.AUTH_JWT_SECRET = 'integration-test-secret';

    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    if (previousAllowInsecure == null) {
      delete process.env.AUTH_ALLOW_INSECURE_HEADERS;
    } else {
      process.env.AUTH_ALLOW_INSECURE_HEADERS = previousAllowInsecure;
    }

    if (previousJwtSecret == null) {
      delete process.env.AUTH_JWT_SECRET;
    } else {
      process.env.AUTH_JWT_SECRET = previousJwtSecret;
    }

    if (app) {
      await app.close();
    }
  });

  it('rejects header-based identity when insecure mode is disabled', async () => {
    await request(server)
      .get('/api/users')
      .set(authHeader(fixtureEmails.owner))
      .expect(401);
  });

  it('accepts valid HS256 bearer token and resolves scoped user access', async () => {
    const token = signHs256Token(
      {
        email: fixtureEmails.owner,
        exp: Math.floor(Date.now() / 1000) + 60 * 5,
      },
      process.env.AUTH_JWT_SECRET ?? '',
    );

    await request(server)
      .get('/api/users')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
  });
});
