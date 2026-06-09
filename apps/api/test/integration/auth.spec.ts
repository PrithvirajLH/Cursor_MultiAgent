import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type MeResponse = {
  data: {
    id: string;
    email: string;
    displayName: string;
    role: string;
  };
};

type ProfileResponse = {
  data: {
    id: string;
    email: string;
    displayName: string;
    department: string | null;
    location: string | null;
  } | null;
};

describe('Auth me and profile', () => {
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

  it('returns the current user for the requester persona', async () => {
    const res = await request(server)
      .get('/api/auth/me')
      .set(authHeader(fixtureEmails.requester))
      .expect(200);

    const body = res.body as MeResponse;
    expect(body.data.email).toBe('requester@company.com');
    expect(body.data.role).toBe('EMPLOYEE');
  });

  it('returns the current user for the owner persona', async () => {
    const res = await request(server)
      .get('/api/auth/me')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const body = res.body as MeResponse;
    expect(body.data.email).toBe('owner@company.com');
    expect(body.data.role).toBe('OWNER');
  });

  it('rejects requests with no auth credentials (401)', async () => {
    await request(server).get('/api/auth/me').expect(401);
  });

  it('updates displayName via PATCH /profile and reflects it in GET /me', async () => {
    const newName = `Renamed Agent ${Date.now()}`;

    const patched = await request(server)
      .patch('/api/auth/profile')
      .set(authHeader(fixtureEmails.agent))
      .send({ graphProfile: { displayName: newName, department: 'Platform' } })
      .expect(200);

    const patchedBody = patched.body as ProfileResponse;
    expect(patchedBody.data?.displayName).toBe(newName);
    expect(patchedBody.data?.department).toBe('Platform');

    const me = await request(server)
      .get('/api/auth/me')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const meBody = me.body as MeResponse;
    expect(meBody.data.displayName).toBe(newName);
    expect(meBody.data.email).toBe('agent@company.com');
  });

  it('returns current profile unchanged when PATCH /profile has no graphProfile', async () => {
    const res = await request(server)
      .patch('/api/auth/profile')
      .set(authHeader(fixtureEmails.lead))
      .send({})
      .expect(200);

    const body = res.body as ProfileResponse;
    expect(body.data?.email).toBe('lead@company.com');
  });
});
