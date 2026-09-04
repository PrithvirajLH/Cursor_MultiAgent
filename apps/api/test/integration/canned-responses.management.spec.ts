import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import {
  fixtureEmails,
  fixtureTeamIds,
  fixtureUserIds,
} from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

/**
 * Card 1.7b — who may set a template up, and whose it is.
 *
 * Card 1.7 built the macro engine but left no way to create one and no way to
 * maintain a shared one. The two rules that matter here:
 *
 *   1. A TEAM template belongs to the TEAM, not only to whoever typed it. It
 *      used to freeze the moment its author left - and since 1.7 a template
 *      changes ticket state, so a stale one is not merely cosmetic.
 *   2. A PRIVATE template stays private. A lead has no business in an agent's
 *      unfinished drafts, and asking for one answers 404 rather than 403 - a
 *      403 would confirm the id is real.
 */
describe('Template management', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  let seq = 0;
  const unique = () => {
    seq += 1;
    return `${Date.now()}${seq}`;
  };

  const save = (body: Record<string, unknown>, email: string) =>
    request(server)
      .post('/api/canned-responses')
      .set(authHeader(email))
      .send(body);

  const edit = (id: string, body: Record<string, unknown>, email: string) =>
    request(server)
      .patch(`/api/canned-responses/${id}`)
      .set(authHeader(email))
      .send(body);

  const remove = (id: string, email: string) =>
    request(server)
      .delete(`/api/canned-responses/${id}`)
      .set(authHeader(email));

  /** A template owned by the AGENT, either private or shared with IT. */
  async function plant(teamId: string | null) {
    return prisma.cannedResponse.create({
      data: {
        name: `mgmt ${unique()}`,
        content: 'Original content.',
        userId: fixtureUserIds.agent,
        teamId,
      },
      select: { id: true },
    });
  }

  describe('who may create one (§3a)', () => {
    it('refuses an EMPLOYEE', async () => {
      const res = await save(
        { name: `emp ${unique()}`, content: 'Nope.' },
        fixtureEmails.requester,
      );
      expect(res.status).toBe(403);
      expect(
        await prisma.cannedResponse.count({
          where: { userId: fixtureUserIds.requester },
        }),
      ).toBe(0);
    });

    it.each([
      ['an AGENT', fixtureEmails.agent],
      ['a LEAD', fixtureEmails.lead],
      ['a TEAM_ADMIN', fixtureEmails.admin],
      ['an OWNER', fixtureEmails.owner],
    ])('allows %s', async (_label, email) => {
      const res = await save(
        { name: `ok ${unique()}`, content: 'Fine.' },
        email,
      );
      expect(res.status).toBe(201);
    });
  });

  describe('sharing with a team (§3b)', () => {
    it("accepts the caller's own team", async () => {
      const res = await save(
        {
          name: `own team ${unique()}`,
          content: 'Shared.',
          teamId: fixtureTeamIds.it,
        },
        fixtureEmails.agent,
      );
      expect(res.status).toBe(201);
      expect((res.body as { teamId: string | null }).teamId).toBe(
        fixtureTeamIds.it,
      );
    });

    it('REFUSES another team, rather than quietly making it private', async () => {
      // The behaviour this card exists to change. It used to answer 201 with
      // teamId null, so "share this with HR" appeared to work and produced a
      // template only its author could ever see.
      const before = await prisma.cannedResponse.count();
      const res = await save(
        {
          name: `foreign ${unique()}`,
          content: 'Should not exist.',
          teamId: fixtureTeamIds.hr,
        },
        fixtureEmails.agent,
      );
      expect(res.status).toBe(400);
      expect(await prisma.cannedResponse.count()).toBe(before);
    });

    it('refuses a team when the caller is on no team at all', async () => {
      // The OWNER has no team membership in the fixtures.
      const res = await save(
        {
          name: `teamless ${unique()}`,
          content: 'Should not exist.',
          teamId: fixtureTeamIds.it,
        },
        fixtureEmails.owner,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('maintaining a TEAM template (§3c)', () => {
    it('lets the author edit it', async () => {
      const tpl = await plant(fixtureTeamIds.it);
      const res = await edit(
        tpl.id,
        { content: 'Author edited.' },
        fixtureEmails.agent,
      );
      expect(res.status).toBe(200);
    });

    it.each([
      ['a LEAD of that team', fixtureEmails.lead],
      ['a TEAM_ADMIN of that team', fixtureEmails.admin],
    ])('lets %s edit it', async (_label, email) => {
      const tpl = await plant(fixtureTeamIds.it);
      const res = await edit(tpl.id, { content: 'Lead edited.' }, email);
      expect(res.status).toBe(200);
      const after = await prisma.cannedResponse.findUniqueOrThrow({
        where: { id: tpl.id },
        select: { content: true, userId: true },
      });
      expect(after.content).toBe('Lead edited.');
      // Editing does not steal it - the author is unchanged.
      expect(after.userId).toBe(fixtureUserIds.agent);
    });

    it('lets a LEAD of that team delete it', async () => {
      const tpl = await plant(fixtureTeamIds.it);
      expect((await remove(tpl.id, fixtureEmails.lead)).status).toBe(200);
      expect(
        await prisma.cannedResponse.count({ where: { id: tpl.id } }),
      ).toBe(0);
    });

    it('refuses a plain AGENT who is not the author', async () => {
      // They can SEE it - it is their team's - so this is the one case that is
      // legitimately 403 rather than 404.
      const tpl = await prisma.cannedResponse.create({
        data: {
          name: `someone elses ${unique()}`,
          content: 'Not yours.',
          userId: fixtureUserIds.lead,
          teamId: fixtureTeamIds.it,
        },
        select: { id: true },
      });
      const res = await edit(
        tpl.id,
        { content: 'Should not stick.' },
        fixtureEmails.agent,
      );
      expect(res.status).toBe(403);
      const after = await prisma.cannedResponse.findUniqueOrThrow({
        where: { id: tpl.id },
        select: { content: true },
      });
      expect(after.content).toBe('Not yours.');
    });
  });

  describe('a PRIVATE template stays private (§3c)', () => {
    it('is invisible to a LEAD of the same team, as a 404', async () => {
      // Not 403: a lead has no business knowing an agent has unfinished drafts,
      // and a 403 would confirm the id is real. Same rule card 1.7 set.
      const tpl = await plant(null);
      const res = await edit(
        tpl.id,
        { content: 'Lead should not reach this.' },
        fixtureEmails.lead,
      );
      expect(res.status).toBe(404);
      const after = await prisma.cannedResponse.findUniqueOrThrow({
        where: { id: tpl.id },
        select: { content: true },
      });
      expect(after.content).toBe('Original content.');
    });

    it('cannot be deleted by that LEAD either', async () => {
      const tpl = await plant(null);
      expect((await remove(tpl.id, fixtureEmails.lead)).status).toBe(404);
      expect(
        await prisma.cannedResponse.count({ where: { id: tpl.id } }),
      ).toBe(1);
    });

    it('is still the author\'s to edit', async () => {
      const tpl = await plant(null);
      expect(
        (await edit(tpl.id, { content: 'Mine.' }, fixtureEmails.agent)).status,
      ).toBe(200);
    });

    it('does not appear in a LEAD\'s list at all', async () => {
      const tpl = await plant(null);
      const res = await request(server)
        .get('/api/canned-responses')
        .set(authHeader(fixtureEmails.lead))
        .expect(200);
      const ids = (res.body as { data: { id: string }[] }).data.map((r) => r.id);
      expect(ids).not.toContain(tpl.id);
    });
  });

  describe('a LEAD of a DIFFERENT team', () => {
    it('cannot touch the other team\'s shared template', async () => {
      const tpl = await plant(fixtureTeamIds.it);
      // The HR requester is no lead; build a lead who belongs to HR instead.
      const hrLead = await prisma.user.create({
        data: {
          email: `hr.lead.${unique()}@company.com`,
          displayName: 'HR Lead',
          role: 'LEAD',
        },
        select: { id: true, email: true },
      });
      await prisma.teamMember.create({
        data: { teamId: fixtureTeamIds.hr, userId: hrLead.id, role: 'LEAD' },
      });
      const res = await edit(
        tpl.id,
        { content: 'Wrong team.' },
        hrLead.email,
      );
      expect(res.status).toBe(404);
      const after = await prisma.cannedResponse.findUniqueOrThrow({
        where: { id: tpl.id },
        select: { content: true },
      });
      expect(after.content).toBe('Original content.');
    });
  });

  describe('moving a template between private and shared', () => {
    it('lets the AUTHOR share a private one', async () => {
      const tpl = await plant(null);
      const res = await edit(
        tpl.id,
        { teamId: fixtureTeamIds.it },
        fixtureEmails.agent,
      );
      expect(res.status).toBe(200);
      expect(
        (
          await prisma.cannedResponse.findUniqueOrThrow({
            where: { id: tpl.id },
            select: { teamId: true },
          })
        ).teamId,
      ).toBe(fixtureTeamIds.it);
    });

    it('lets the AUTHOR make a shared one private again', async () => {
      const tpl = await plant(fixtureTeamIds.it);
      const res = await edit(tpl.id, { teamId: null }, fixtureEmails.agent);
      expect(res.status).toBe(200);
      expect(
        (
          await prisma.cannedResponse.findUniqueOrThrow({
            where: { id: tpl.id },
            select: { teamId: true },
          })
        ).teamId,
      ).toBeNull();
    });

    it('leaves the sharing alone when teamId is omitted', async () => {
      // The third meaning of the field, and the one an ordinary content edit
      // relies on: omitted must not be read as "make it private".
      const tpl = await plant(fixtureTeamIds.it);
      await edit(tpl.id, { content: 'Just the wording.' }, fixtureEmails.agent);
      expect(
        (
          await prisma.cannedResponse.findUniqueOrThrow({
            where: { id: tpl.id },
            select: { teamId: true },
          })
        ).teamId,
      ).toBe(fixtureTeamIds.it);
    });

    it('refuses a LEAD who tries to unshare a template they did not write', async () => {
      // A lead may MAINTAIN their team's shared template - that is the whole
      // point of the previous section - but un-sharing it would hide it from
      // the team, and that decision belongs to its author.
      const tpl = await plant(fixtureTeamIds.it);
      const res = await edit(tpl.id, { teamId: null }, fixtureEmails.lead);
      expect(res.status).toBe(403);
      expect(
        (
          await prisma.cannedResponse.findUniqueOrThrow({
            where: { id: tpl.id },
            select: { teamId: true },
          })
        ).teamId,
      ).toBe(fixtureTeamIds.it);
    });

    it('still refuses a team the author is not in', async () => {
      const tpl = await plant(null);
      const res = await edit(
        tpl.id,
        { teamId: fixtureTeamIds.hr },
        fixtureEmails.agent,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('the allowlist still holds on edit', () => {
    it('refuses to save send_email through a PATCH', async () => {
      // The save-time gate has to cover both routes, not just create.
      const tpl = await plant(fixtureTeamIds.it);
      const res = await edit(
        tpl.id,
        {
          actions: [
            { type: 'send_email', to: 'requester', subject: 's', body: 'b' },
          ],
        },
        fixtureEmails.agent,
      );
      expect(res.status).toBe(400);
      const after = await prisma.cannedResponse.findUniqueOrThrow({
        where: { id: tpl.id },
        select: { actions: true },
      });
      expect(after.actions).toEqual([]);
    });
  });
});
