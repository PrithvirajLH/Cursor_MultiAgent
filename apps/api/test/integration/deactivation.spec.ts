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

/**
 * Cards 1.78 and 1.89 — "Deactivate" did not deactivate.
 *
 * `users.service.ts` set `isActive: false`, deleted the roster rows and nulled
 * `primaryTeamId`, and never touched authentication: the September audit
 * watched a deactivated agent answer `GET /auth/me` with a 200, list tickets
 * and create one. And because `addMember` never checked either, the account
 * could be put straight back on a roster and start receiving work again.
 *
 * ⚠️ THESE TWO SHIP TOGETHER. Fixing either alone leaves "Deactivate" not
 * deactivating.
 */
describe('deactivation actually deactivates (cards 1.78, 1.89)', () => {
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

  afterEach(async () => {
    // Put the desk back, whatever a test did to it.
    await getPrisma().user.updateMany({
      where: { id: fixtureUserIds.lead },
      data: { isActive: true, deactivatedAt: null },
    });
  });

  const deactivate = async (userId: string) =>
    request(server)
      .post(`/api/users/${userId}/deactivate`)
      .set(authHeader(fixtureEmails.owner))
      .expect(201);

  const reactivate = async (userId: string) =>
    request(server)
      .post(`/api/users/${userId}/reactivate`)
      .set(authHeader(fixtureEmails.owner))
      .expect(201);

  it('⚠️ a deactivated user is refused — the card’s whole point', async () => {
    // Before: they are a working account.
    await request(server)
      .get('/api/auth/me')
      .set(authHeader(fixtureEmails.lead))
      .expect(200);

    await deactivate(fixtureUserIds.lead);

    // After: the same credential, refused.
    await request(server)
      .get('/api/auth/me')
      .set(authHeader(fixtureEmails.lead))
      .expect(401);
  });

  it('⚠️ and refused everywhere, not just on /auth/me', async () => {
    // The audit watched a deactivated agent LIST and CREATE tickets. The guard
    // runs before all of it, so one check covers every route - asserted rather
    // than assumed.
    await deactivate(fixtureUserIds.lead);
    await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.lead))
      .expect(401);
    await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.lead))
      .send({
        subject: 'should never exist',
        description: 'raised by a deactivated account',
        priority: 'SEV3',
        channel: 'PORTAL',
      })
      .expect(401);
  });

  it('⚠️ an ACTIVE user of the same shape still gets through', async () => {
    // The non-vacuity half. A guard that refused everybody would pass both
    // assertions above and lock the whole desk out.
    await request(server)
      .get('/api/auth/me')
      .set(authHeader(fixtureEmails.lead))
      .expect(200);
    await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
  });

  it('reactivating restores access, so the control is reversible', async () => {
    await deactivate(fixtureUserIds.lead);
    await request(server)
      .get('/api/auth/me')
      .set(authHeader(fixtureEmails.lead))
      .expect(401);
    await reactivate(fixtureUserIds.lead);
    await request(server)
      .get('/api/auth/me')
      .set(authHeader(fixtureEmails.lead))
      .expect(200);
  });

  it('⚠️ a deactivated account cannot be put back on a roster (card 1.89)', async () => {
    // Deactivation deletes the roster rows; without this check anybody could
    // add the account straight back and auto-assignment would resume.
    await deactivate(fixtureUserIds.lead);
    const res = await request(server)
      .post(`/api/teams/${fixtureTeamIds.hr}/members`)
      .set(authHeader(fixtureEmails.owner))
      .send({ userId: fixtureUserIds.lead, role: 'AGENT' })
      .expect(400);
    // The message has to say WHY, or an admin is left guessing.
    expect(JSON.stringify(res.body)).toMatch(/deactivated/i);
    const membership = await getPrisma().teamMember.findFirst({
      where: { teamId: fixtureTeamIds.hr, userId: fixtureUserIds.lead },
    });
    expect(membership).toBeNull();
  });

  it('an ACTIVE user can still be added to a team', async () => {
    // The non-vacuity half of the refusal above.
    const res = await request(server)
      .post(`/api/teams/${fixtureTeamIds.hr}/members`)
      .set(authHeader(fixtureEmails.owner))
      .send({ userId: fixtureUserIds.lead, role: 'AGENT' })
      .expect(201);
    expect(res.body).toBeTruthy();
    await getPrisma().teamMember.deleteMany({
      where: { teamId: fixtureTeamIds.hr, userId: fixtureUserIds.lead },
    });
  });

  it('⚠️ deactivating does not resurrect the row by way of the provisioning path', async () => {
    // The token path refreshes the profile and records directory addresses.
    // Running that for a deactivated row would quietly maintain an account
    // somebody switched off, so the refusal comes before any write.
    await deactivate(fixtureUserIds.lead);
    await request(server)
      .get('/api/auth/me')
      .set(authHeader(fixtureEmails.lead))
      .expect(401);
    const row = await getPrisma().user.findUniqueOrThrow({
      where: { id: fixtureUserIds.lead },
      select: { isActive: true },
    });
    expect(row.isActive).toBe(false);
  });
});
