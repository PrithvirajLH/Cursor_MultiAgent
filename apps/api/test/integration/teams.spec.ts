import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureUserIds, fixtureTeamIds } from '../utils/fixtures';
import { getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TeamResponse = {
  id: string;
  name: string;
  assignmentStrategy: string;
};

type TeamMember = {
  id: string;
  role: string;
  user: { id: string };
};

type MembersResponse = {
  data: TeamMember[];
};

describe('Teams', () => {
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

  it('runs the full member lifecycle on an owner-created team', async () => {
    // Create a fresh team so member state is isolated from seeded teams.
    const createRes = await request(server)
      .post('/api/teams')
      .set(authHeader(fixtureEmails.owner))
      .send({ name: `Members Team ${Date.now()}` })
      .expect(201);
    const team = createRes.body as TeamResponse;
    expect(team.id).toBeDefined();

    // A brand-new team starts with no members.
    const emptyRes = await request(server)
      .get(`/api/teams/${team.id}/members`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    expect((emptyRes.body as MembersResponse).data).toHaveLength(0);

    // Add the agent (UserRole.AGENT) — default team role resolves to AGENT.
    const addRes = await request(server)
      .post(`/api/teams/${team.id}/members`)
      .set(authHeader(fixtureEmails.owner))
      .send({ userId: fixtureUserIds.agent, role: 'AGENT' })
      .expect(201);
    const added = addRes.body as TeamMember;
    expect(added.user.id).toBe(fixtureUserIds.agent);
    expect(added.role).toBe('AGENT');
    const memberId = added.id;

    // GET members reflects the new member.
    const listRes = await request(server)
      .get(`/api/teams/${team.id}/members`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const list = (listRes.body as MembersResponse).data;
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(memberId);

    // Update the member's team role (AGENT user -> LEAD is allowed; ADMIN is not).
    const updateRes = await request(server)
      .patch(`/api/teams/${team.id}/members/${memberId}`)
      .set(authHeader(fixtureEmails.owner))
      .send({ role: 'LEAD' })
      .expect(200);
    expect((updateRes.body as TeamMember).role).toBe('LEAD');

    // Remove the member.
    const removeRes = await request(server)
      .delete(`/api/teams/${team.id}/members/${memberId}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    expect((removeRes.body as { id: string }).id).toBe(memberId);

    const afterRemoveRes = await request(server)
      .get(`/api/teams/${team.id}/members`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    expect((afterRemoveRes.body as MembersResponse).data).toHaveLength(0);
  });

  it('updates a team (rename + assignmentStrategy) as the owner', async () => {
    const createRes = await request(server)
      .post('/api/teams')
      .set(authHeader(fixtureEmails.owner))
      .send({ name: `Update Team ${Date.now()}` })
      .expect(201);
    const team = createRes.body as TeamResponse;

    const renamed = `Renamed Team ${Date.now()}`;
    const updateRes = await request(server)
      .patch(`/api/teams/${team.id}`)
      .set(authHeader(fixtureEmails.owner))
      .send({ name: renamed, assignmentStrategy: 'ROUND_ROBIN' })
      .expect(200);
    const updated = updateRes.body as TeamResponse;
    expect(updated.name).toBe(renamed);
    expect(updated.assignmentStrategy).toBe('ROUND_ROBIN');
  });

  it('denies non-admins (lead, agent) on team update (403)', async () => {
    await request(server)
      .patch(`/api/teams/${fixtureTeamIds.it}`)
      .set(authHeader(fixtureEmails.lead))
      .send({ name: 'Lead Cannot Rename' })
      .expect(403);

    await request(server)
      .patch(`/api/teams/${fixtureTeamIds.it}`)
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Agent Cannot Rename' })
      .expect(403);
  });

  it('denies non-admins (lead, agent) on add member (403)', async () => {
    await request(server)
      .post(`/api/teams/${fixtureTeamIds.it}/members`)
      .set(authHeader(fixtureEmails.lead))
      .send({ userId: fixtureUserIds.requester, role: 'AGENT' })
      .expect(403);

    await request(server)
      .post(`/api/teams/${fixtureTeamIds.it}/members`)
      .set(authHeader(fixtureEmails.agent))
      .send({ userId: fixtureUserIds.requester, role: 'AGENT' })
      .expect(403);
  });

  /**
   * Card 1.126 — the owner held TEAM_ADMIN, removed their own account from
   * Payroll, and then could not get back in. They named the missing rule
   * themselves: *"team admin cannot remove another team admin or himself"*.
   *
   * ⚠️ `removeMember` HAD NO GUARD AT ALL beyond "may you manage this team".
   * The fixtures give the shape this needs: `admin@company.com` is a
   * TEAM_ADMIN whose `primaryTeamId` is the IT team, and the IT team already
   * holds an agent, a lead and that admin.
   */
  describe('who may remove a team member (card 1.126)', () => {
    const SECOND_ADMIN_ID = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a';
    const SPARE_AGENT_ID = '9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b';
    // ⚠️ A REAL UUID, BECAUSE `fixtureUserIds.owner` IS NOT ONE. It reads
    // 'oooooooo-oooo-4ooo-8ooo-oooooooooooo' and the letter `o` is not hex, so
    // `@IsUUID()` on AddTeamMemberDto rejects the request with 400 before any
    // team code runs. A test that sent it would "pass" against validation and
    // prove nothing about the rule it names.
    const SECOND_OWNER_ID = '9c9c9c9c-9c9c-4c9c-8c9c-9c9c9c9c9c9c';
    let secondAdminMemberId: string;
    let spareAgentMemberId: string;
    let seededAdminMemberId: string;

    beforeAll(async () => {
      const prisma = getPrisma();
      await prisma.user.createMany({
        data: [
          {
            id: SECOND_ADMIN_ID,
            email: 'second.admin@company.com',
            displayName: 'Second Admin',
            role: 'TEAM_ADMIN',
            primaryTeamId: fixtureTeamIds.it,
          },
          {
            id: SPARE_AGENT_ID,
            email: 'spare.agent@company.com',
            displayName: 'Spare Agent',
            role: 'AGENT',
          },
          {
            id: SECOND_OWNER_ID,
            email: 'second.owner@company.com',
            displayName: 'Second Owner',
            role: 'OWNER',
          },
        ],
        skipDuplicates: true,
      });
      const secondAdmin = await prisma.teamMember.create({
        data: {
          teamId: fixtureTeamIds.it,
          userId: SECOND_ADMIN_ID,
          role: 'ADMIN',
        },
      });
      secondAdminMemberId = secondAdmin.id;
      const spareAgent = await prisma.teamMember.create({
        data: {
          teamId: fixtureTeamIds.it,
          userId: SPARE_AGENT_ID,
          role: 'AGENT',
        },
      });
      spareAgentMemberId = spareAgent.id;
      const seeded = await prisma.teamMember.findFirstOrThrow({
        where: { teamId: fixtureTeamIds.it, userId: fixtureUserIds.admin },
        select: { id: true },
      });
      seededAdminMemberId = seeded.id;
    });

    it('⚠️ refuses a team admin removing THEMSELVES, and says how to get out', async () => {
      // The exact thing the owner did in production.
      const res = await request(server)
        .delete(`/api/teams/${fixtureTeamIds.it}/members/${seededAdminMemberId}`)
        .set(authHeader(fixtureEmails.admin))
        .expect(400);

      // ⚠️ THE MESSAGE IS PART OF THE FIX. Commit `2fed472` exists because a
      // correct refusal reached the screen as "Unable to assign ticket".
      const body = res.body as { message?: string };
      expect(body.message).toContain('cannot remove yourself');
      expect(body.message).toContain('owner');

      // And it really is still there.
      const still = await getPrisma().teamMember.count({
        where: { id: seededAdminMemberId },
      });
      expect(still).toBe(1);
    });

    it('⚠️ refuses a team admin removing ANOTHER team admin', async () => {
      const res = await request(server)
        .delete(`/api/teams/${fixtureTeamIds.it}/members/${secondAdminMemberId}`)
        .set(authHeader(fixtureEmails.admin))
        .expect(403);

      const body = res.body as { message?: string };
      expect(body.message).toContain('another team admin');
      expect(body.message).toContain('owner');
    });

    it('a team admin CAN still remove an ordinary agent', async () => {
      // ⚠️ NON-VACUITY. A guard that refuses everything passes both tests
      // above and breaks team administration entirely.
      await request(server)
        .delete(`/api/teams/${fixtureTeamIds.it}/members/${spareAgentMemberId}`)
        .set(authHeader(fixtureEmails.admin))
        .expect(200);

      const gone = await getPrisma().teamMember.count({
        where: { id: spareAgentMemberId },
      });
      expect(gone).toBe(0);
    });

    it('⚠️ an OWNER can remove a team admin - which is the way out the message promises', async () => {
      // ⚠️ THE ONE MOST LIKELY TO BREAK, and the reason the refusals are worth
      // anything: if an owner could not do this either, a team admin who
      // removed themselves would be stuck forever.
      await request(server)
        .delete(`/api/teams/${fixtureTeamIds.it}/members/${secondAdminMemberId}`)
        .set(authHeader(fixtureEmails.owner))
        .expect(200);

      const gone = await getPrisma().teamMember.count({
        where: { id: secondAdminMemberId },
      });
      expect(gone).toBe(0);
    });

    it('⚠️ adding an OWNER to a team explains itself instead of dead-ending (card 1.126 §1b)', async () => {
      // The rule is unchanged and deliberate - an OWNER holds no TeamMember row
      // because they already reach every team. What changed is that the refusal
      // now says so; it used to end the conversation with nothing to act on.
      const res = await request(server)
        .post(`/api/teams/${fixtureTeamIds.it}/members`)
        .set(authHeader(fixtureEmails.owner))
        .send({ userId: SECOND_OWNER_ID, role: 'AGENT' })
        .expect(403);

      const body = res.body as { message?: string };
      expect(body.message).toContain('already have access to every team');
      expect(body.message).toContain('team admin, lead or agent');
    });

    it('⚠️ and an OWNER can remove the admin who could not remove themselves', async () => {
      await request(server)
        .delete(`/api/teams/${fixtureTeamIds.it}/members/${seededAdminMemberId}`)
        .set(authHeader(fixtureEmails.owner))
        .expect(200);

      const gone = await getPrisma().teamMember.count({
        where: { id: seededAdminMemberId },
      });
      expect(gone).toBe(0);
    });
  });
});
