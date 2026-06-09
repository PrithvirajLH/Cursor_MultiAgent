import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureUserIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

// Endpoints that must NOT be reachable by AGENT or EMPLOYEE (requester).
// - Guard-protected endpoints (AdminGuard / LeadOrAdminGuard) reject before the
//   ValidationPipe, so the body is irrelevant.
// - Service-enforced endpoints run the ValidationPipe first, so we send a VALID
//   body to ensure the request reaches the role check (otherwise a 400 would mask
//   the 403 we are asserting). This is the documented "validate-before-authz"
//   ordering for slas/routing/categories/custom-fields.
const adminOnlyEndpoints: Array<{
  name: string;
  method: HttpMethod;
  path: string;
  body?: Record<string, unknown>;
}> = [
  { name: 'read audit log', method: 'get', path: '/api/audit-log' },
  { name: 'list automation rules', method: 'get', path: '/api/automation-rules' },
  {
    name: 'create automation rule',
    method: 'post',
    path: '/api/automation-rules',
    body: {},
  },
  { name: 'read reports summary', method: 'get', path: '/api/reports/summary' },
  { name: 'read SLA policies', method: 'get', path: '/api/slas/policies' },
  { name: 'list admin agents', method: 'get', path: '/api/admin/agents' },
  { name: 'list admin tags', method: 'get', path: '/api/admin/tags' },
  {
    name: 'create category',
    method: 'post',
    path: '/api/categories',
    body: { name: 'Authz probe', slug: 'authz-probe-cat' },
  },
  {
    name: 'create team',
    method: 'post',
    path: '/api/teams',
    body: { name: 'Authz probe team' },
  },
];

describe('Authorization matrix', () => {
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

  describe('admin-only endpoints reject non-privileged roles', () => {
    for (const ep of adminOnlyEndpoints) {
      it(`denies AGENT: ${ep.name}`, async () => {
        const builder = request(server)
          [ep.method](ep.path)
          .set(authHeader(fixtureEmails.agent));
        const res = await (ep.body ? builder.send(ep.body) : builder);
        expect(res.status).toBe(403);
      });

      it(`denies EMPLOYEE: ${ep.name}`, async () => {
        const builder = request(server)
          [ep.method](ep.path)
          .set(authHeader(fixtureEmails.requester));
        const res = await (ep.body ? builder.send(ep.body) : builder);
        expect(res.status).toBe(403);
      });
    }
  });

  it('rejects updating a user role for non-owners', async () => {
    // Inline owner check in UsersController.updateRole; send a valid body so the
    // request reaches that check rather than failing validation first.
    await request(server)
      .patch(`/api/users/${fixtureUserIds.agent}/role`)
      .set(authHeader(fixtureEmails.agent))
      .send({ role: 'EMPLOYEE' })
      .expect(403);

    await request(server)
      .patch(`/api/users/${fixtureUserIds.agent}/role`)
      .set(authHeader(fixtureEmails.lead))
      .send({ role: 'EMPLOYEE' })
      .expect(403);
  });

  it('allows owners to reach the admin read surfaces', async () => {
    await request(server)
      .get('/api/audit-log')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    await request(server)
      .get('/api/automation-rules')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    await request(server)
      .get('/api/reports/summary')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
  });

  describe('owner lockout protection (updateRole)', () => {
    it('prevents an owner from demoting themselves', async () => {
      const res = await request(server)
        .patch(`/api/users/${fixtureUserIds.owner}/role`)
        .set(authHeader(fixtureEmails.owner))
        .send({ role: 'AGENT' });
      // Self-demotion is rejected (also the last-owner guard, since the fixture
      // seeds a single OWNER).
      expect(res.status).toBe(400);
    });

    it('still allows an owner to change a non-owner role', async () => {
      // Runs last: this mutation is wiped by the next spec's resetTestDb().
      await request(server)
        .patch(`/api/users/${fixtureUserIds.agent}/role`)
        .set(authHeader(fixtureEmails.owner))
        .send({ role: 'LEAD' })
        .expect(200);
    });
  });
});
