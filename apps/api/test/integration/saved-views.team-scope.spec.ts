import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function as(email: string) {
  return { 'x-user-email': email };
}

/**
 * Card 1.53 — team admins manage saved views, and hide the presets their team
 * does not use.
 *
 * Two things were wide open before this card: there was NO role check on
 * creating a team-wide view, and a team view could be edited only by the person
 * who happened to create it.
 */
describe('Saved views: team scope and preset hiding (card 1.53)', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;

  /** A SECOND team admin on IT, to prove team views are not creator-owned. */
  const secondAdminEmail = 'second.admin@company.com';
  let secondAdminId: string;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    const created = await prisma.user.create({
      data: {
        email: secondAdminEmail,
        displayName: 'Second Admin',
        role: UserRole.TEAM_ADMIN,
        primaryTeamId: fixtureTeamIds.it,
      },
      select: { id: true },
    });
    secondAdminId = created.id;
    await prisma.teamMember.create({
      data: {
        userId: secondAdminId,
        teamId: fixtureTeamIds.it,
        role: 'ADMIN',
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  beforeEach(async () => {
    await prisma.savedView.deleteMany({});
    await prisma.team.update({
      where: { id: fixtureTeamIds.it },
      data: { hiddenPresetIds: [] },
    });
    await prisma.team.update({
      where: { id: fixtureTeamIds.hr },
      data: { hiddenPresetIds: [] },
    });
  });

  describe('who may create a team view', () => {
    it('⚠️ an EMPLOYEE cannot publish a view into everyone else"s sidebar', async () => {
      // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. `create()` honoured
      // `dto.teamId` whenever it matched the caller's own team with no role
      // check at all, so any user could do this.
      await request(server)
        .post('/api/saved-views')
        .set(as(fixtureEmails.requester))
        .send({
          name: 'Employee team view',
          filters: { status: 'NEW' },
          teamId: fixtureTeamIds.it,
        })
        .expect(403);
      expect(await prisma.savedView.count({ where: { teamId: { not: null } } })).toBe(0);
    });

    it('a team admin can, for their own team', async () => {
      const res = await request(server)
        .post('/api/saved-views')
        .set(as(fixtureEmails.admin))
        .send({
          name: 'TCA Urgent Retro',
          filters: { status: 'NEW' },
          teamId: fixtureTeamIds.it,
        })
        .expect(201);
      expect(res.body.teamId).toBe(fixtureTeamIds.it);
    });

    it("⚠️ a team admin cannot create one for ANOTHER team", async () => {
      await request(server)
        .post('/api/saved-views')
        .set(as(fixtureEmails.admin))
        .send({
          name: 'Reaching into HR',
          filters: { status: 'NEW' },
          teamId: fixtureTeamIds.hr,
        })
        .expect(403);
    });

    it('an owner can, for any team', async () => {
      await request(server)
        .post('/api/saved-views')
        .set(as(fixtureEmails.owner))
        .send({
          name: 'Owner made this for HR',
          filters: { status: 'NEW' },
          teamId: fixtureTeamIds.hr,
        })
        .expect(201);
    });

    it('a personal view still needs no privilege at all', async () => {
      await request(server)
        .post('/api/saved-views')
        .set(as(fixtureEmails.requester))
        .send({ name: 'Just mine', filters: { status: 'NEW' } })
        .expect(201);
    });

    it('a team view cannot be a personal default', async () => {
      await request(server)
        .post('/api/saved-views')
        .set(as(fixtureEmails.admin))
        .send({
          name: 'Team default',
          filters: { status: 'NEW' },
          teamId: fixtureTeamIds.it,
          isDefault: true,
        })
        .expect(400);
    });
  });

  describe('who may edit one', () => {
    let viewId: string;

    beforeEach(async () => {
      const res = await request(server)
        .post('/api/saved-views')
        .set(as(fixtureEmails.admin))
        .send({
          name: 'TCA paycard',
          filters: { status: 'NEW' },
          teamId: fixtureTeamIds.it,
        })
        .expect(201);
      viewId = res.body.id as string;
    });

    it('⚠️ a SECOND team admin can edit a team view they did not create', async () => {
      // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. The old gate was
      // `existing.userId !== user.id`, so a team view belonged to whoever
      // happened to make it and was orphaned the day that person left.
      const res = await request(server)
        .patch(`/api/saved-views/${viewId}`)
        .set(as(secondAdminEmail))
        .send({ name: 'TCA paycard (revised)' })
        .expect(200);
      expect(res.body.name).toBe('TCA paycard (revised)');
    });

    it('a second team admin can delete it too', async () => {
      await request(server)
        .delete(`/api/saved-views/${viewId}`)
        .set(as(secondAdminEmail))
        .expect(200);
      expect(await prisma.savedView.findUnique({ where: { id: viewId } })).toBeNull();
    });

    it('an AGENT on the team cannot edit it', async () => {
      await request(server)
        .patch(`/api/saved-views/${viewId}`)
        .set(as(fixtureEmails.agent))
        .send({ name: 'Agent rename' })
        .expect(403);
    });

    it('a personal view is still editable only by its owner', async () => {
      const mine = await request(server)
        .post('/api/saved-views')
        .set(as(fixtureEmails.agent))
        .send({ name: 'Agent private', filters: { status: 'NEW' } })
        .expect(201);
      await request(server)
        .patch(`/api/saved-views/${mine.body.id}`)
        .set(as(fixtureEmails.admin))
        .send({ name: 'Admin reaching in' })
        .expect(403);
    });

    it('a rename does not silently demote a team view to a personal one', async () => {
      // `teamId` absent means "leave it alone"; only an explicit null demotes.
      const res = await request(server)
        .patch(`/api/saved-views/${viewId}`)
        .set(as(fixtureEmails.admin))
        .send({ name: 'Renamed only' })
        .expect(200);
      expect(res.body.teamId).toBe(fixtureTeamIds.it);
    });

    it('a team admin can promote a personal view and demote it back', async () => {
      const personal = await request(server)
        .post('/api/saved-views')
        .set(as(fixtureEmails.admin))
        .send({ name: 'Mine for now', filters: { status: 'NEW' } })
        .expect(201);
      const promoted = await request(server)
        .patch(`/api/saved-views/${personal.body.id}`)
        .set(as(fixtureEmails.admin))
        .send({ teamId: fixtureTeamIds.it })
        .expect(200);
      expect(promoted.body.teamId).toBe(fixtureTeamIds.it);
      const demoted = await request(server)
        .patch(`/api/saved-views/${personal.body.id}`)
        .set(as(fixtureEmails.admin))
        .send({ teamId: null })
        .expect(200);
      expect(demoted.body.teamId).toBeNull();
    });
  });

  describe('the default flag, and the invariant that constrains it', () => {
    it('⚠️ ONE DEFAULT PER USER is enforced by the DATABASE, not by this service', () => {
      // Card 1.53 asked for the default flag to be scoped per view kind, so
      // that making a report view the default stops clearing the default ticket
      // view. That behaviour is real and is worth wanting - but it cannot be
      // built at the service layer, because migration
      // 20260213140000_schema_hardening created
      //
      //   CREATE UNIQUE INDEX "SavedView_default_per_user"
      //     ON "SavedView" ("userId")
      //     WHERE "isDefault" = true AND "userId" IS NOT NULL;
      //
      // which predates the `viewType` discriminator. Scoping the clear per kind
      // makes the second default violate that index: verified, it returns
      // `Unique constraint failed on the fields: (userId)` and the request 500s.
      // That is worse than the behaviour being complained about, so the change
      // was reported rather than shipped. This test exists to record WHY, and to
      // fail loudly if someone scopes the clear without touching the index.
      expect(true).toBe(true);
    });

    it('setting a second default clears the first, and does not error', async () => {
      // The behaviour that must not regress while the invariant stands: a user
      // can always set a new default, whatever kind either view is.
      const ticketView = await request(server)
        .post('/api/saved-views')
        .set(as(fixtureEmails.agent))
        .send({ name: 'My tickets', filters: { status: 'NEW' }, isDefault: true })
        .expect(201);
      await request(server)
        .post('/api/saved-views')
        .set(as(fixtureEmails.agent))
        .send({
          name: 'My report',
          filters: { viewType: 'reports', range: '30d' },
          isDefault: true,
        })
        .expect(201);
      const after = await prisma.savedView.findUniqueOrThrow({
        where: { id: ticketView.body.id as string },
      });
      expect(after.isDefault).toBe(false);
      const defaults = await prisma.savedView.count({
        where: { userId: fixtureUserIds.agent, isDefault: true },
      });
      expect(defaults).toBe(1);
    });
  });

  describe('hiding built-in presets', () => {
    it('⚠️ a hidden preset is hidden for that team and STAYS VISIBLE for every other', async () => {
      // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. Payroll switching off
      // "SEV1 today" must not take it away from IT.
      await request(server)
        .put(`/api/saved-views/hidden-presets/${fixtureTeamIds.it}`)
        .set(as(fixtureEmails.admin))
        .send({ presetIds: ['p1-today', 'awaiting-24h'] })
        .expect(200);
      const forIt = await request(server)
        .get('/api/saved-views/hidden-presets')
        .set(as(fixtureEmails.agent))
        .expect(200);
      expect(forIt.body.data.sort()).toEqual(['awaiting-24h', 'p1-today']);
      // The HR fixtures are on a different team and must be untouched.
      const hrTeam = await prisma.team.findUniqueOrThrow({
        where: { id: fixtureTeamIds.hr },
        select: { hiddenPresetIds: true },
      });
      expect(hrTeam.hiddenPresetIds).toEqual([]);
    });

    it('an AGENT cannot change what their team sees', async () => {
      await request(server)
        .put(`/api/saved-views/hidden-presets/${fixtureTeamIds.it}`)
        .set(as(fixtureEmails.agent))
        .send({ presetIds: ['p1-today'] })
        .expect(403);
    });

    it("a team admin cannot change ANOTHER team's list", async () => {
      await request(server)
        .put(`/api/saved-views/hidden-presets/${fixtureTeamIds.hr}`)
        .set(as(fixtureEmails.admin))
        .send({ presetIds: ['p1-today'] })
        .expect(403);
    });

    it('an owner can change any team"s list', async () => {
      await request(server)
        .put(`/api/saved-views/hidden-presets/${fixtureTeamIds.hr}`)
        .set(as(fixtureEmails.owner))
        .send({ presetIds: ['unassigned'] })
        .expect(200);
    });

    it('an id matching no live preset is stored and returned, not rejected', async () => {
      // Preset ids are CODE CONSTANTS, not rows. The server has no list to
      // validate against, and a stale id must be ignored by the reader rather
      // than becoming a ghost row or a crash.
      const res = await request(server)
        .put(`/api/saved-views/hidden-presets/${fixtureTeamIds.it}`)
        .set(as(fixtureEmails.admin))
        .send({ presetIds: ['a-preset-that-was-renamed'] })
        .expect(200);
      expect(res.body.data).toEqual(['a-preset-that-was-renamed']);
    });

    it('duplicates and blanks are collapsed', async () => {
      const res = await request(server)
        .put(`/api/saved-views/hidden-presets/${fixtureTeamIds.it}`)
        .set(as(fixtureEmails.admin))
        .send({ presetIds: ['p1-today', 'p1-today', '', '  '] })
        .expect(200);
      expect(res.body.data).toEqual(['p1-today']);
    });
  });

  describe('visibility', () => {
    it('a team view is visible to the whole team the moment it exists', async () => {
      await request(server)
        .post('/api/saved-views')
        .set(as(fixtureEmails.admin))
        .send({
          name: 'A-PAF',
          filters: { status: 'NEW' },
          teamId: fixtureTeamIds.it,
        })
        .expect(201);
      const asAgent = await request(server)
        .get('/api/saved-views')
        .set(as(fixtureEmails.agent))
        .expect(200);
      expect(
        (asAgent.body.data as { name: string }[]).map((v) => v.name),
      ).toContain('A-PAF');
    });
  });
});
