import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type IssuedKey = { data: { id: string; key: string; name: string } };

/**
 * Card 2.6 — a machine can authenticate, and stop being able to.
 *
 * ⚠️ THE POINT OF RESOLVING A KEY TO A REAL `User` is that nothing downstream
 * has to know a machine is calling: `assertActive`, `roleFilter` and
 * `accessConditionSql` all run exactly as they do for a person. These tests
 * therefore check the ORDINARY endpoints answer, not some machine-only route.
 */
describe('issued API keys (card 2.6)', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  /** Mint a key as the owner, which is the only role allowed to. */
  const mint = async (
    name: string,
    serviceUserId = fixtureUserIds.agent,
    teamScope?: string,
  ) => {
    const res = await request(server)
      .post('/api/admin/api-keys')
      .set(authHeader(fixtureEmails.owner))
      .send({ name, serviceUserId, ...(teamScope ? { teamScope } : {}) })
      .expect(201);
    return (res.body as IssuedKey).data;
  };

  describe('minting', () => {
    it('⚠️ returns the key exactly once, and never again', async () => {
      // THE CARD'S CENTRAL RULE. If the admin screen could re-read it, the
      // database would be holding a live credential.
      const issued = await mint('once-only');
      expect(issued.key).toMatch(/^tk_/);

      const list = await request(server)
        .get('/api/admin/api-keys')
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      const body = JSON.stringify(list.body);
      expect(body).toContain('once-only');
      expect(body).not.toContain(issued.key);
    });

    it('⚠️ stores a hash, not the key', async () => {
      const issued = await mint('hashed-at-rest');
      const row = await getPrisma().apiKey.findUniqueOrThrow({
        where: { id: issued.id },
        select: { hashedKey: true },
      });
      expect(row.hashedKey).not.toBe(issued.key);
      expect(row.hashedKey).toHaveLength(64);
    });

    it('refuses to mint a key for an owner account', async () => {
      // A machine credential that can mint more machine credentials.
      await request(server)
        .post('/api/admin/api-keys')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'owner-key', serviceUserId: fixtureUserIds.owner })
        .expect(400);
    });

    it('⚠️ is owner-only', async () => {
      await request(server)
        .post('/api/admin/api-keys')
        .set(authHeader(fixtureEmails.admin))
        .send({ name: 'nope', serviceUserId: fixtureUserIds.agent })
        .expect(403);
      await request(server)
        .get('/api/admin/api-keys')
        .set(authHeader(fixtureEmails.agent))
        .expect(403);
    });
  });

  describe('using a key', () => {
    it('⚠️ authenticates an ordinary request as the service user', async () => {
      // The non-vacuity half of every refusal below: the key must actually work.
      const issued = await mint('working-key');
      const res = await request(server)
        .get('/api/tickets?pageSize=1')
        .set('x-api-key', issued.key)
        .expect(200);
      expect(res.body).toHaveProperty('data');
    });

    it('records lastUsedAt, so an admin can see what is live before revoking', async () => {
      const issued = await mint('used-key');
      await request(server)
        .get('/api/tickets?pageSize=1')
        .set('x-api-key', issued.key)
        .expect(200);
      const row = await getPrisma().apiKey.findUniqueOrThrow({
        where: { id: issued.id },
        select: { lastUsedAt: true },
      });
      expect(row.lastUsedAt).not.toBeNull();
    });

    it('refuses a key that was never issued', async () => {
      await request(server)
        .get('/api/tickets?pageSize=1')
        .set('x-api-key', 'tk_not_a_real_key')
        .expect(401);
    });
  });

  describe('⚠️ revocation', () => {
    it('⚠️ takes effect on the very next request, with no TTL to wait out', async () => {
      // THE CARD'S EXPLICIT REQUIREMENT, and the reason `resolve` caches
      // nothing. A key that works for another 30 seconds is not revoked.
      const issued = await mint('revoke-me');
      await request(server)
        .get('/api/tickets?pageSize=1')
        .set('x-api-key', issued.key)
        .expect(200);

      await request(server)
        .delete(`/api/admin/api-keys/${issued.id}`)
        .set(authHeader(fixtureEmails.owner))
        .expect(200);

      await request(server)
        .get('/api/tickets?pageSize=1')
        .set('x-api-key', issued.key)
        .expect(401);
    });
  });

  describe('team scope', () => {
    it('⚠️ narrows, and cannot widen', async () => {
      // The scope is intersected with the service user's real memberships, so a
      // key can only ever see less than the user it acts as.
      // ⚠️ ASSERTED ON WHAT THE GUARD RESOLVED, NOT ON LIST ROWS. The first
      // version read `assignedTeamId` off each ticket in the list response and
      // got `undefined` - that field is not part of the list item shape, so the
      // assertion was vacuous in the worst way: it would have passed for a key
      // with no scope at all.
      //
      // `GET /auth/me` answers with the identity the guard built, which is
      // exactly the thing team scope narrows.
      const scoped = await mint('scoped', fixtureUserIds.agent, fixtureTeamIds.it);
      const res = await request(server)
        .get('/api/auth/me')
        .set('x-api-key', scoped.key)
        .expect(200);
      const me = res.body as {
        teamId?: string | null;
        memberTeamIds?: string[];
        data?: { teamId?: string | null; memberTeamIds?: string[] };
      };
      const identity = me.data ?? me;
      expect(identity.teamId).toBe(fixtureTeamIds.it);
      // The scope narrows the membership list to exactly the scoped team.
      expect(identity.memberTeamIds).toEqual([fixtureTeamIds.it]);
    });

    it('refuses a scope the service user is not a member of', async () => {
      // Silently granting nothing would look like a broken key; this says why.
      await request(server)
        .post('/api/admin/api-keys')
        .set(authHeader(fixtureEmails.owner))
        .send({
          name: 'bad-scope',
          serviceUserId: fixtureUserIds.agent,
          teamScope: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
    });
  });
});
