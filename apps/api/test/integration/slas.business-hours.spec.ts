import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

const compressedSchedule = [
  { day: 'Monday', enabled: true, start: '00:00', end: '00:30' },
  { day: 'Tuesday', enabled: true, start: '00:00', end: '00:30' },
  { day: 'Wednesday', enabled: true, start: '00:00', end: '00:30' },
  { day: 'Thursday', enabled: true, start: '00:00', end: '00:30' },
  { day: 'Friday', enabled: true, start: '00:00', end: '00:30' },
  { day: 'Saturday', enabled: true, start: '00:00', end: '00:30' },
  { day: 'Sunday', enabled: true, start: '00:00', end: '00:30' },
];

/** A round-the-clock calendar, the case a nursing or on-call team needs. */
const alwaysOpenSchedule = [
  { day: 'Monday', enabled: true, start: '00:00', end: '23:59' },
  { day: 'Tuesday', enabled: true, start: '00:00', end: '23:59' },
  { day: 'Wednesday', enabled: true, start: '00:00', end: '23:59' },
  { day: 'Thursday', enabled: true, start: '00:00', end: '23:59' },
  { day: 'Friday', enabled: true, start: '00:00', end: '23:59' },
  { day: 'Saturday', enabled: true, start: '00:00', end: '23:59' },
  { day: 'Sunday', enabled: true, start: '00:00', end: '23:59' },
];

const ONE_HOUR_MS = 60 * 60 * 1000;

describe('SLA business-hours due-date calculation', () => {
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

  it('extends SLA due dates beyond raw wall-clock math when business hours are compressed', async () => {
    await request(server)
      .patch('/api/slas/settings')
      .set(authHeader(fixtureEmails.owner))
      .send({
        timezone: 'UTC',
        schedule: compressedSchedule,
        holidays: [],
      })
      .expect(200);

    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `Business hours SLA ${Date.now()}`,
        description: 'Validate due date math',
        priority: 'SEV2',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);

    const body = created.body as {
      createdAt: string;
      firstResponseDueAt?: string | null;
      dueAt?: string | null;
    };

    expect(body.firstResponseDueAt).toBeTruthy();
    expect(body.dueAt).toBeTruthy();

    const createdAt = new Date(body.createdAt);
    const firstResponseRaw = new Date(createdAt.getTime() + 4 * 60 * 60 * 1000);
    const resolutionRaw = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);

    expect(
      new Date(body.firstResponseDueAt as string).getTime(),
    ).toBeGreaterThan(firstResponseRaw.getTime());
    expect(new Date(body.dueAt as string).getTime()).toBeGreaterThan(
      resolutionRaw.getTime(),
    );
  });

  it('preserves SLA cycle anchor when recalculating with unchanged priority', async () => {
    await request(server)
      .patch('/api/slas/settings')
      .set(authHeader(fixtureEmails.owner))
      .send({
        timezone: 'UTC',
        schedule: compressedSchedule,
        holidays: [],
      })
      .expect(200);

    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `Business hours transfer ${Date.now()}`,
        description: 'Ensure transfer does not drift due dates',
        priority: 'SEV2',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);

    const createdBody = created.body as { id: string; dueAt: string };
    const beforeTransferDueAt = new Date(createdBody.dueAt).getTime();

    await request(server)
      .post('/api/tickets/bulk/priority')
      .set(authHeader(fixtureEmails.owner))
      .send({
        ticketIds: [createdBody.id],
        priority: 'SEV2',
      })
      .expect(201);

    const refreshed = await request(server)
      .get(`/api/tickets/${createdBody.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const refreshedBody = refreshed.body as { dueAt: string };
    const afterRecomputeDueAt = new Date(refreshedBody.dueAt).getTime();

    expect(Math.abs(afterRecomputeDueAt - beforeTransferDueAt)).toBeLessThan(
      60_000,
    );
  });

  describe('per-department calendars', () => {
    /** Set the organisation default, which every team without one inherits. */
    async function setGlobalCalendar(schedule: unknown[]) {
      await request(server)
        .patch('/api/slas/settings')
        .set(authHeader(fixtureEmails.owner))
        .send({ timezone: 'UTC', schedule, holidays: [] })
        .expect(200);
    }

    async function setTeamCalendar(teamId: string, schedule: unknown[]) {
      await request(server)
        .patch(`/api/slas/settings?teamId=${teamId}`)
        .set(authHeader(fixtureEmails.owner))
        .send({ timezone: 'UTC', schedule, holidays: [] })
        .expect(200);
    }

    async function createSev2On(teamId: string) {
      const created = await request(server)
        .post('/api/tickets')
        .set(authHeader(fixtureEmails.requester))
        .send({
          subject: `Per-department calendar ${Date.now()}-${teamId}`,
          description: 'Validate per-team due date math',
          priority: 'SEV2',
          channel: 'PORTAL',
          assignedTeamId: teamId,
        })
        .expect(201);
      return created.body as { createdAt: string; dueAt: string };
    }

    it("uses the team's own calendar and the default for a team without one", async () => {
      // Default is 30 minutes a day; IT runs 24/7. A SEV2 resolves in 24h.
      await setGlobalCalendar(compressedSchedule);
      await setTeamCalendar(fixtureTeamIds.it, alwaysOpenSchedule);
      const onOwnCalendar = await createSev2On(fixtureTeamIds.it);
      const onInheritedCalendar = await createSev2On(fixtureTeamIds.hr);
      const ownElapsedHours =
        (new Date(onOwnCalendar.dueAt).getTime() -
          new Date(onOwnCalendar.createdAt).getTime()) /
        ONE_HOUR_MS;
      const inheritedElapsedHours =
        (new Date(onInheritedCalendar.dueAt).getTime() -
          new Date(onInheritedCalendar.createdAt).getTime()) /
        ONE_HOUR_MS;
      // 24 business hours on a round-the-clock calendar is ~24 wall-clock hours.
      expect(ownElapsedHours).toBeGreaterThan(23.9);
      expect(ownElapsedHours).toBeLessThan(25);
      // The same 24 hours at 30 minutes a day is nearly seven weeks out.
      expect(inheritedElapsedHours).toBeGreaterThan(24 * 30);
    });

    it('reports whether a calendar is owned or inherited', async () => {
      await setGlobalCalendar(compressedSchedule);
      await setTeamCalendar(fixtureTeamIds.it, alwaysOpenSchedule);
      const owned = await request(server)
        .get(`/api/slas/settings?teamId=${fixtureTeamIds.it}`)
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      const inherited = await request(server)
        .get(`/api/slas/settings?teamId=${fixtureTeamIds.hr}`)
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      const ownedBody = owned.body as {
        data: { teamId: string | null; inherited: boolean };
      };
      const inheritedBody = inherited.body as {
        data: { teamId: string | null; inherited: boolean };
      };
      expect(ownedBody.data.teamId).toBe(fixtureTeamIds.it);
      expect(ownedBody.data.inherited).toBe(false);
      expect(inheritedBody.data.teamId).toBe(fixtureTeamIds.hr);
      expect(inheritedBody.data.inherited).toBe(true);
    });

    it('still serves the organisation default when no teamId is given', async () => {
      await setGlobalCalendar(compressedSchedule);
      const res = await request(server)
        .get('/api/slas/settings')
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      const body = res.body as {
        data: {
          teamId: string | null;
          inherited: boolean;
          schedule: unknown[];
        };
      };
      expect(body.data.teamId).toBeNull();
      expect(body.data.inherited).toBe(false);
      expect(body.data.schedule).toHaveLength(7);
    });

    it('lets a lead read their own team calendar but not another team’s', async () => {
      // The fixture lead belongs to IT.
      await request(server)
        .get(`/api/slas/settings?teamId=${fixtureTeamIds.it}`)
        .set(authHeader(fixtureEmails.lead))
        .expect(200);
      await request(server)
        .get(`/api/slas/settings?teamId=${fixtureTeamIds.hr}`)
        .set(authHeader(fixtureEmails.lead))
        .expect(403);
    });

    it('denies a lead writing any team calendar', async () => {
      await request(server)
        .patch(`/api/slas/settings?teamId=${fixtureTeamIds.it}`)
        .set(authHeader(fixtureEmails.lead))
        .send({ timezone: 'UTC' })
        .expect(403);
    });

    it('denies an agent reading or writing a team calendar', async () => {
      await request(server)
        .get(`/api/slas/settings?teamId=${fixtureTeamIds.it}`)
        .set(authHeader(fixtureEmails.agent))
        .expect(403);
      await request(server)
        .patch(`/api/slas/settings?teamId=${fixtureTeamIds.it}`)
        .set(authHeader(fixtureEmails.agent))
        .send({ timezone: 'UTC' })
        .expect(403);
    });

    it('scopes a team admin to their own team calendar', async () => {
      // The fixture team admin administers IT.
      await request(server)
        .patch(`/api/slas/settings?teamId=${fixtureTeamIds.it}`)
        .set(authHeader(fixtureEmails.admin))
        .send({ timezone: 'UTC', schedule: alwaysOpenSchedule, holidays: [] })
        .expect(200);
      await request(server)
        .patch(`/api/slas/settings?teamId=${fixtureTeamIds.hr}`)
        .set(authHeader(fixtureEmails.admin))
        .send({ timezone: 'UTC', schedule: alwaysOpenSchedule, holidays: [] })
        .expect(403);
    });

    it('rejects a calendar request for a team that does not exist', async () => {
      await request(server)
        .get('/api/slas/settings?teamId=99999999-9999-4999-8999-999999999999')
        .set(authHeader(fixtureEmails.owner))
        .expect(404);
    });

    it('defaults a team admin with no teamId to their own team', async () => {
      await setGlobalCalendar(compressedSchedule);
      // No teamId given: this must edit IT's calendar, not the default that
      // every other department inherits.
      const written = await request(server)
        .patch('/api/slas/settings')
        .set(authHeader(fixtureEmails.admin))
        .send({ timezone: 'UTC', schedule: alwaysOpenSchedule, holidays: [] })
        .expect(200);
      const writtenBody = written.body as {
        data: { teamId: string | null; inherited: boolean };
      };
      expect(writtenBody.data.teamId).toBe(fixtureTeamIds.it);
      expect(writtenBody.data.inherited).toBe(false);
      // The organisation default is untouched, so HR still inherits 30 minutes.
      const organisationDefault = await request(server)
        .get('/api/slas/settings')
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      const defaultBody = organisationDefault.body as {
        data: { teamId: string | null; schedule: Array<{ end: string }> };
      };
      expect(defaultBody.data.teamId).toBeNull();
      expect(defaultBody.data.schedule[0].end).toBe('00:30');
    });

    it('defaults a lead with no teamId to their own team', async () => {
      const res = await request(server)
        .get('/api/slas/settings')
        .set(authHeader(fixtureEmails.lead))
        .expect(200);
      const body = res.body as { data: { teamId: string | null } };
      expect(body.data.teamId).toBe(fixtureTeamIds.it);
    });

    it('still defaults an owner with no teamId to the organisation calendar', async () => {
      const res = await request(server)
        .get('/api/slas/settings')
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      const body = res.body as { data: { teamId: string | null } };
      expect(body.data.teamId).toBeNull();
    });
  });
});
