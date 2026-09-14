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

type RestorableResponse = {
  isActive: boolean;
  teams: {
    teamId: string;
    teamName: string;
    role: string;
    stillExists: boolean;
    alreadyAMember: boolean;
  }[];
};
type RestoreResponse = {
  restored: { teamId: string }[];
  skipped: { teamId: string; reason: string }[];
};

/**
 * Card 1.98 — reactivation gave somebody their login back, not their job.
 *
 * Deactivation deletes the `TeamMember` rows and nulls `primaryTeamId`;
 * `reactivate` wrote `{ isActive: true, deactivatedAt: null }` and nothing
 * else. So a reactivated agent signed in to an empty queue, on no team, with
 * nothing anywhere recording which teams they had been on.
 *
 * ⚠️ Pre-existing, but cards 1.78 and 1.89 are why it matters: before them a
 * "deactivated" person kept working, so nobody ever exercised the way back.
 */
describe('reactivation puts somebody back to work (card 1.98)', () => {
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
    // Put the lead back exactly as the fixture had them.
    await getPrisma().user.update({
      where: { id: fixtureUserIds.lead },
      data: { isActive: true, deactivatedAt: null, primaryTeamId: fixtureTeamIds.it },
    });
    await getPrisma().teamMember.deleteMany({
      where: { userId: fixtureUserIds.lead },
    });
    await getPrisma().teamMember.create({
      data: { teamId: fixtureTeamIds.it, userId: fixtureUserIds.lead, role: 'LEAD' },
    });
    await getPrisma().adminAuditEvent.deleteMany({
      where: { type: { in: ['USER_DEACTIVATED', 'USER_TEAMS_RESTORED'] } },
    });
  });

  /** The lead starts on IT; put them on HR as well, so there are two. */
  const putOnTwoTeams = async () => {
    await getPrisma().teamMember.upsert({
      where: {
        teamId_userId: { teamId: fixtureTeamIds.hr, userId: fixtureUserIds.lead },
      },
      update: {},
      create: {
        teamId: fixtureTeamIds.hr,
        userId: fixtureUserIds.lead,
        role: 'AGENT',
      },
    });
  };

  const deactivate = () =>
    request(server)
      .post(`/api/users/${fixtureUserIds.lead}/deactivate`)
      .set(authHeader(fixtureEmails.owner))
      .expect(201);

  const reactivate = () =>
    request(server)
      .post(`/api/users/${fixtureUserIds.lead}/reactivate`)
      .set(authHeader(fixtureEmails.owner))
      .expect(201);

  const restorable = async () => {
    const res = await request(server)
      .get(`/api/users/${fixtureUserIds.lead}/restorable-teams`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    return res.body as RestorableResponse;
  };

  const restore = async (expected = 201) => {
    const res = await request(server)
      .post(`/api/users/${fixtureUserIds.lead}/restore-teams`)
      .set(authHeader(fixtureEmails.owner))
      .send({})
      .expect(expected);
    return res.body as RestoreResponse;
  };

  const teamIds = async () =>
    (
      await getPrisma().teamMember.findMany({
        where: { userId: fixtureUserIds.lead },
        select: { teamId: true },
      })
    )
      .map((row) => row.teamId)
      .sort();

  it('⚠️ deactivate a member of TWO teams, reactivate, restore → they can WORK', async () => {
    // THE WHOLE CARD. Not "they can sign in" - they can see their queue again.
    await putOnTwoTeams();
    expect(await teamIds()).toEqual(
      [fixtureTeamIds.it, fixtureTeamIds.hr].sort(),
    );

    await deactivate();
    expect(await teamIds()).toEqual([]);

    await reactivate();
    await restore();

    expect(await teamIds()).toEqual(
      [fixtureTeamIds.it, fixtureTeamIds.hr].sort(),
    );
    // And the proof that it is work and not just a login: the team queue is
    // visible to them again.
    await request(server)
      .get(`/api/tickets?teamIds=${fixtureTeamIds.it}&pageSize=5`)
      .set(authHeader(fixtureEmails.lead))
      .expect(200);
  });

  it('restores the role they had, not a default one', async () => {
    await putOnTwoTeams();
    await deactivate();
    await reactivate();
    await restore();
    const rows = await getPrisma().teamMember.findMany({
      where: { userId: fixtureUserIds.lead },
      select: { teamId: true, role: true },
    });
    const byTeam = Object.fromEntries(rows.map((r) => [r.teamId, r.role]));
    expect(byTeam[fixtureTeamIds.it]).toBe('LEAD');
    expect(byTeam[fixtureTeamIds.hr]).toBe('AGENT');
  });

  it('restores the primary team, so they land on their own queue', async () => {
    await putOnTwoTeams();
    await deactivate();
    expect(
      (
        await getPrisma().user.findUniqueOrThrow({
          where: { id: fixtureUserIds.lead },
          select: { primaryTeamId: true },
        })
      ).primaryTeamId,
    ).toBeNull();
    await reactivate();
    await restore();
    expect(
      (
        await getPrisma().user.findUniqueOrThrow({
          where: { id: fixtureUserIds.lead },
          select: { primaryTeamId: true },
        })
      ).primaryTeamId,
    ).toBe(fixtureTeamIds.it);
  });

  it('⚠️ reactivating WITHOUT restoring leaves them on no team', async () => {
    // The two steps are genuinely separate: somebody deactivated for cause is
    // not silently re-rostered.
    await putOnTwoTeams();
    await deactivate();
    await reactivate();
    expect(await teamIds()).toEqual([]);
  });

  it('refuses to restore onto a still-deactivated account', async () => {
    // The same rule card 1.89 enforces for adding anybody to a team.
    await putOnTwoTeams();
    await deactivate();
    const res = await request(server)
      .post(`/api/users/${fixtureUserIds.lead}/restore-teams`)
      .set(authHeader(fixtureEmails.owner))
      .send({})
      .expect(400);
    expect(JSON.stringify(res.body)).toMatch(/reactivate/i);
  });

  it('⚠️ skips a team that no longer exists rather than throwing', async () => {
    // One deleted team must not block the rest of the restore.
    const doomed = await getPrisma().team.create({
      data: { name: `c198 doomed ${Date.now()}`, slug: `c198-${Date.now()}` },
      select: { id: true },
    });
    await getPrisma().teamMember.create({
      data: { teamId: doomed.id, userId: fixtureUserIds.lead, role: 'AGENT' },
    });
    await deactivate();
    await getPrisma().team.delete({ where: { id: doomed.id } });
    await reactivate();
    const result = await restore();
    expect(result.restored.map((r) => r.teamId)).toContain(fixtureTeamIds.it);
    expect(result.skipped.map((r) => r.teamId)).toContain(doomed.id);
    expect(result.skipped[0].reason).toMatch(/no longer exists/i);
  });

  it('shows the owner what is on offer before they decide', async () => {
    await putOnTwoTeams();
    await deactivate();
    await reactivate();
    const preview = await restorable();
    expect(preview.isActive).toBe(true);
    expect(preview.teams.map((t) => t.teamId).sort()).toEqual(
      [fixtureTeamIds.it, fixtureTeamIds.hr].sort(),
    );
    expect(preview.teams.every((t) => t.stillExists)).toBe(true);
    expect(preview.teams.every((t) => !t.alreadyAMember)).toBe(true);
  });

  it('says "nothing recorded" for somebody deactivated before this card', async () => {
    // Their event carries only counts. That is the truth, not an error.
    await putOnTwoTeams();
    await deactivate();
    await getPrisma().adminAuditEvent.deleteMany({
      where: { type: 'USER_DEACTIVATED' },
    });
    await reactivate();
    expect((await restorable()).teams).toEqual([]);
    expect((await restore()).restored).toEqual([]);
  });

  it('only an owner may look or restore', async () => {
    await request(server)
      .get(`/api/users/${fixtureUserIds.lead}/restorable-teams`)
      .set(authHeader(fixtureEmails.admin))
      .expect(403);
    await request(server)
      .post(`/api/users/${fixtureUserIds.lead}/restore-teams`)
      .set(authHeader(fixtureEmails.admin))
      .send({})
      .expect(403);
  });
});
