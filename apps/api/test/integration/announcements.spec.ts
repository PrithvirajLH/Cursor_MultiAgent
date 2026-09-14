import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type ActiveAnnouncement = {
  id: string;
  title: string;
  severity: string;
  endsAt: string | null;
};

const HR_AGENT_EMAIL = 'hr.agent@company.com';
const HR_AGENT_ID = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';

/**
 * Card 2.7 — announcements.
 *
 * ⚠️ THE SECURITY ASSERTION OF THIS CARD is that a TEAM announcement never
 * reaches another team. It is asserted here against the HTTP response, not
 * against the filter object, because the failure everyone fears is a payload
 * that carries every team's announcements and hides some in the component.
 */
describe('announcements (card 2.7)', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    // The fixture puts nobody on HR, and "somebody on another team" is the
    // whole point of this suite.
    await getPrisma().user.create({
      data: {
        id: HR_AGENT_ID,
        email: HR_AGENT_EMAIL,
        displayName: 'HR Agent',
        role: 'AGENT',
        primaryTeamId: fixtureTeamIds.hr,
        teamMemberships: {
          create: [{ teamId: fixtureTeamIds.hr, role: 'AGENT' }],
        },
      },
    });
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  afterEach(async () => {
    await getPrisma().announcement.deleteMany({});
  });

  const post = async (
    email: string,
    body: Record<string, unknown>,
    expected = 201,
  ) => {
    const res = await request(server)
      .post('/api/announcements')
      .set(authHeader(email))
      .send(body)
      .expect(expected);
    return res.body as { id: string };
  };

  const active = async (email: string) => {
    const res = await request(server)
      .get('/api/announcements/active')
      .set(authHeader(email))
      .expect(200);
    return res.body as ActiveAnnouncement[];
  };

  const titles = async (email: string) =>
    (await active(email)).map((row) => row.title);

  describe('who can see what', () => {
    it('⚠️ a TEAM announcement does NOT reach a member of another team', async () => {
      // THE ONE THAT MATTERS. Payroll's outage is Payroll's business.
      await post(fixtureEmails.owner, {
        title: 'IT only notice',
        body: 'Printer room is closed',
        audience: 'TEAM',
        teamId: fixtureTeamIds.it,
      });
      expect(await titles(fixtureEmails.agent)).toContain('IT only notice');
      expect(await titles(HR_AGENT_EMAIL)).not.toContain('IT only notice');
    });

    it('⚠️ and it is absent from the PAYLOAD, not merely hidden', async () => {
      // A client-side filter would pass the test above if it were written
      // against rendered output. This one reads the raw response body.
      await post(fixtureEmails.owner, {
        title: 'IT secret',
        body: 'internal only',
        audience: 'TEAM',
        teamId: fixtureTeamIds.it,
      });
      const raw = await request(server)
        .get('/api/announcements/active')
        .set(authHeader(HR_AGENT_EMAIL))
        .expect(200);
      expect(JSON.stringify(raw.body)).not.toContain('IT secret');
      expect(JSON.stringify(raw.body)).not.toContain(fixtureTeamIds.it);
    });

    it('an ALL announcement reaches everybody, including a requester with no team', async () => {
      // The non-vacuity half: a filter that hid everything would pass the two
      // assertions above and be useless.
      await post(fixtureEmails.owner, {
        title: 'Everyone sees this',
        body: 'All-hands notice',
        audience: 'ALL',
      });
      expect(await titles(fixtureEmails.agent)).toContain('Everyone sees this');
      expect(await titles(HR_AGENT_EMAIL)).toContain('Everyone sees this');
      expect(await titles(fixtureEmails.requester)).toContain(
        'Everyone sees this',
      );
    });

    it('a requester with no team sees ALL and nothing else', async () => {
      await post(fixtureEmails.owner, {
        title: 'Global',
        body: 'x',
        audience: 'ALL',
      });
      await post(fixtureEmails.owner, {
        title: 'IT only',
        body: 'x',
        audience: 'TEAM',
        teamId: fixtureTeamIds.it,
      });
      expect(await titles(fixtureEmails.requester)).toEqual(['Global']);
    });

    it('⚠️ /active is NOT public — it refuses an unauthenticated caller', async () => {
      // An outage notice names internal systems. Making this @Public() would
      // put that on the open internet.
      await request(server).get('/api/announcements/active').expect(401);
    });
  });

  describe('the window', () => {
    it('⚠️ one whose endsAt has passed disappears with no action taken', async () => {
      const id = (
        await post(fixtureEmails.owner, {
          title: 'Short lived',
          body: 'x',
          audience: 'ALL',
          startsAt: new Date(Date.now() - 60 * 60_000).toISOString(),
          endsAt: new Date(Date.now() + 60_000).toISOString(),
        })
      ).id;
      expect(await titles(fixtureEmails.agent)).toContain('Short lived');
      // Move the end into the past: no job runs, no redeploy, it is simply gone.
      await getPrisma().announcement.update({
        where: { id },
        data: { endsAt: new Date(Date.now() - 1_000) },
      });
      expect(await titles(fixtureEmails.agent)).not.toContain('Short lived');
    });

    it('one whose startsAt is in the future does not appear early', async () => {
      await post(fixtureEmails.owner, {
        title: 'Scheduled',
        body: 'x',
        audience: 'ALL',
        startsAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      });
      expect(await titles(fixtureEmails.agent)).not.toContain('Scheduled');
    });

    it('⚠️ endsAt null stays visible indefinitely', async () => {
      // "Until I say otherwise" is a real answer for an outage nobody can put a
      // time on, which is why the column is nullable.
      await post(fixtureEmails.owner, {
        title: 'Open ended',
        body: 'x',
        audience: 'ALL',
        endsAt: null,
      });
      const rows = await active(fixtureEmails.agent);
      expect(rows.map((r) => r.title)).toContain('Open ended');
      expect(rows.find((r) => r.title === 'Open ended')?.endsAt).toBeNull();
    });

    it('refuses a window that closes before it opens', async () => {
      await post(
        fixtureEmails.owner,
        {
          title: 'Impossible',
          body: 'x',
          audience: 'ALL',
          startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          endsAt: new Date(Date.now() + 60_000).toISOString(),
        },
        400,
      );
    });

    it('the loudest one is first', async () => {
      await post(fixtureEmails.owner, {
        title: 'Quiet',
        body: 'x',
        audience: 'ALL',
        severity: 'INFO',
      });
      await post(fixtureEmails.owner, {
        title: 'Loud',
        body: 'x',
        audience: 'ALL',
        severity: 'OUTAGE',
      });
      await post(fixtureEmails.owner, {
        title: 'Middling',
        body: 'x',
        audience: 'ALL',
        severity: 'WARNING',
      });
      expect(await titles(fixtureEmails.agent)).toEqual([
        'Loud',
        'Middling',
        'Quiet',
      ]);
    });
  });

  describe('who can post what', () => {
    it('⚠️ a TEAM_ADMIN cannot announce to EVERYBODY', async () => {
      // Otherwise one team's administrator puts a banner on every screen in the
      // organisation.
      await post(
        fixtureEmails.admin,
        { title: 'Everyone', body: 'x', audience: 'ALL' },
        403,
      );
    });

    it('⚠️ a TEAM_ADMIN cannot announce to ANOTHER team', async () => {
      await post(
        fixtureEmails.admin,
        {
          title: 'Not my team',
          body: 'x',
          audience: 'TEAM',
          teamId: fixtureTeamIds.hr,
        },
        403,
      );
    });

    it('a TEAM_ADMIN CAN announce to their own team', async () => {
      // The non-vacuity half of the two refusals above.
      await post(fixtureEmails.admin, {
        title: 'My team',
        body: 'x',
        audience: 'TEAM',
        teamId: fixtureTeamIds.it,
      });
      expect(await titles(fixtureEmails.agent)).toContain('My team');
    });

    it('an ordinary agent cannot post at all', async () => {
      await post(
        fixtureEmails.agent,
        { title: 'Nope', body: 'x', audience: 'ALL' },
        403,
      );
    });

    it('a TEAM announcement needs a team', async () => {
      await post(
        fixtureEmails.owner,
        { title: 'Which team?', body: 'x', audience: 'TEAM' },
        400,
      );
    });

    it('⚠️ a TEAM_ADMIN cannot edit another team’s announcement', async () => {
      const id = (
        await post(fixtureEmails.owner, {
          title: 'HR notice',
          body: 'x',
          audience: 'TEAM',
          teamId: fixtureTeamIds.hr,
        })
      ).id;
      await request(server)
        .patch(`/api/announcements/${id}`)
        .set(authHeader(fixtureEmails.admin))
        .send({ title: 'Hijacked' })
        .expect(403);
    });

    it('a TEAM_ADMIN cannot edit a global announcement either', async () => {
      const id = (
        await post(fixtureEmails.owner, {
          title: 'Global notice',
          body: 'x',
          audience: 'ALL',
        })
      ).id;
      await request(server)
        .patch(`/api/announcements/${id}`)
        .set(authHeader(fixtureEmails.admin))
        .send({ title: 'Hijacked' })
        .expect(403);
    });

    it('ending one early is a PATCH, and it leaves the record behind', async () => {
      const id = (
        await post(fixtureEmails.owner, {
          title: 'Ends early',
          body: 'x',
          audience: 'ALL',
        })
      ).id;
      await request(server)
        .patch(`/api/announcements/${id}`)
        .set(authHeader(fixtureEmails.owner))
        .send({ endsAt: new Date(Date.now() + 1_000).toISOString() })
        .expect(200);
      await getPrisma().announcement.update({
        where: { id },
        data: { endsAt: new Date(Date.now() - 1_000) },
      });
      expect(await titles(fixtureEmails.agent)).not.toContain('Ends early');
      // Still on the admin list, which is the point of ending rather than deleting.
      const listed = await request(server)
        .get('/api/announcements')
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      expect(JSON.stringify(listed.body)).toContain('Ends early');
    });

    it('the admin list shows a TEAM_ADMIN their own team and the global ones, not another team', async () => {
      await post(fixtureEmails.owner, {
        title: 'Global row',
        body: 'x',
        audience: 'ALL',
      });
      await post(fixtureEmails.owner, {
        title: 'IT row',
        body: 'x',
        audience: 'TEAM',
        teamId: fixtureTeamIds.it,
      });
      await post(fixtureEmails.owner, {
        title: 'HR row',
        body: 'x',
        audience: 'TEAM',
        teamId: fixtureTeamIds.hr,
      });
      const res = await request(server)
        .get('/api/announcements')
        .set(authHeader(fixtureEmails.admin))
        .expect(200);
      const body = JSON.stringify(res.body);
      expect(body).toContain('Global row');
      expect(body).toContain('IT row');
      expect(body).not.toContain('HR row');
    });

    it('refuses a linked ticket that does not exist', async () => {
      await post(
        fixtureEmails.owner,
        {
          title: 'Dangling',
          body: 'x',
          audience: 'ALL',
          linkedTicketId: '7fe5d219-4b3c-4a2f-9f3a-1c2d3e4f5a6b',
        },
        400,
      );
    });
  });
});
