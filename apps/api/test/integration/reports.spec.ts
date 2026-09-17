import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

/**
 * Coverage for the Reports controller. Previously only /summary was exercised
 * (in security.authorization.spec). The whole controller is guarded by
 * LeadOrAdminGuard, so OWNER + LEAD (LEAD of IT in the test seed) reach every
 * endpoint while AGENT/EMPLOYEE get a 403.
 *
 * Every report query param is @IsOptional with a safe default (30-day range,
 * createdAt date field, etc.), so no endpoint REQUIRES a param to return 200 —
 * the bare GET is a valid request. We still supply a recent date range +
 * teamId on a representative subset to prove valid params produce 200 (not 400)
 * and to assert the shape with data present.
 */

// A recent, well-formed range well within the 365-day cap.
const TO = new Date();
const FROM = new Date(TO.getTime() - 14 * 24 * 60 * 60 * 1000);
const recentRange = {
  from: FROM.toISOString(),
  to: TO.toISOString(),
};

type AssertBody = (body: unknown) => void;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const hasArrayData: AssertBody = (body) => {
  expect(isObj(body)).toBe(true);
  expect(Array.isArray((body as Record<string, unknown>).data)).toBe(true);
};

const hasObjectData: AssertBody = (body) => {
  expect(isObj(body)).toBe(true);
  expect(isObj((body as Record<string, unknown>).data)).toBe(true);
};

/**
 * Every GET endpoint on the controller. `query` carries optional params that
 * are still valid (so the endpoint must return 200, not 400). `assert` checks a
 * meaningful top-level shape derived from each service method's return value.
 */
const endpoints: Array<{
  name: string;
  path: string;
  query?: Record<string, string>;
  assert: AssertBody;
}> = [
  {
    // getSummary -> { ticketVolume, slaCompliance, resolutionTime,
    //   ticketsByPriority, ticketsByStatus, agentPerformance }
    name: 'summary',
    path: '/api/reports/summary',
    query: recentRange,
    assert: (body) => {
      expect(isObj(body)).toBe(true);
      const b = body as Record<string, unknown>;
      for (const key of [
        'ticketVolume',
        'slaCompliance',
        'resolutionTime',
        'ticketsByPriority',
        'ticketsByStatus',
        'agentPerformance',
      ]) {
        expect(b[key]).toBeDefined();
      }
    },
  },
  {
    // getTagAnalytics -> { topTags[], mttrByTag[], perTeam[] }
    name: 'tag-analytics',
    path: '/api/reports/tag-analytics',
    query: { days: '30' },
    assert: (body) => {
      expect(isObj(body)).toBe(true);
      const b = body as Record<string, unknown>;
      expect(Array.isArray(b.topTags)).toBe(true);
      expect(Array.isArray(b.mttrByTag)).toBe(true);
      expect(Array.isArray(b.perTeam)).toBe(true);
    },
  },
  {
    // getTicketVolume -> { data: [{ date, count }] }
    name: 'ticket-volume',
    path: '/api/reports/ticket-volume',
    query: recentRange,
    assert: hasArrayData,
  },
  {
    // getSlaCompliance -> { data: { met, breached, total, ... } }
    name: 'sla-compliance',
    path: '/api/reports/sla-compliance',
    query: recentRange,
    assert: (body) => {
      hasObjectData(body);
      const data = (body as Record<string, unknown>).data as Record<
        string,
        unknown
      >;
      for (const key of ['met', 'breached', 'total']) {
        expect(typeof data[key]).toBe('number');
      }
    },
  },
  {
    // getSlaComplianceByPriority -> { data: [{ priority, met, breached, total }] }
    name: 'sla-compliance-by-priority',
    path: '/api/reports/sla-compliance-by-priority',
    query: recentRange,
    assert: (body) => {
      hasArrayData(body);
      // Service always emits one row per priority (SEV1..SEV4).
      const data = (body as Record<string, unknown>).data as unknown[];
      expect(data.length).toBe(4);
    },
  },
  {
    // getSlaComplianceByTeam -> { data: [{ teamId, teamName, compliance, ... }] }
    name: 'sla-compliance-by-team',
    path: '/api/reports/sla-compliance-by-team',
    query: recentRange,
    assert: hasArrayData,
  },
  {
    // getResolutionTime -> { data: [{ label, avgHours, count }] }
    name: 'resolution-time',
    path: '/api/reports/resolution-time',
    query: { ...recentRange, groupBy: 'team' },
    assert: hasArrayData,
  },
  {
    // getTicketsByStatus -> { data: [{ status, count }] }
    name: 'tickets-by-status',
    path: '/api/reports/tickets-by-status',
    query: recentRange,
    assert: hasArrayData,
  },
  {
    // getTicketsByPriority -> { data: [{ priority, count }] }
    name: 'tickets-by-priority',
    path: '/api/reports/tickets-by-priority',
    query: recentRange,
    assert: hasArrayData,
  },
  {
    // getAgentPerformance -> { data: [{ userId, name, ticketsResolved, ... }] }
    name: 'agent-performance',
    path: '/api/reports/agent-performance',
    query: recentRange,
    assert: hasArrayData,
  },
  {
    // getAgentWorkload -> { data: [{ userId, assignedOpen, inProgress }] }
    name: 'agent-workload',
    path: '/api/reports/agent-workload',
    assert: hasArrayData,
  },
  {
    // getTicketsByAge -> { data: [{ bucket, count }] } (fixed 5 buckets)
    name: 'tickets-by-age',
    path: '/api/reports/tickets-by-age',
    query: recentRange,
    assert: (body) => {
      hasArrayData(body);
      const data = (body as Record<string, unknown>).data as unknown[];
      expect(data.length).toBe(5);
    },
  },
  {
    // getReopenRate -> { data: [{ date, count }] }
    name: 'reopen-rate',
    path: '/api/reports/reopen-rate',
    query: recentRange,
    assert: hasArrayData,
  },
  {
    // getCsatTrend -> { data: [{ date, average, count }], summary: { ... } }
    name: 'csat-trend',
    path: '/api/reports/csat-trend',
    query: recentRange,
    assert: (body) => {
      hasArrayData(body);
      expect(isObj((body as Record<string, unknown>).summary)).toBe(true);
    },
  },
  {
    // getCsatDrivers -> { data: [{ label, count, percent }], total }
    name: 'csat-drivers',
    path: '/api/reports/csat-drivers',
    query: recentRange,
    assert: (body) => {
      hasArrayData(body);
      expect(typeof (body as Record<string, unknown>).total).toBe('number');
    },
  },
  {
    // getCsatLowTags -> { data: [{ tag, count }] }
    name: 'csat-low-tags',
    path: '/api/reports/csat-low-tags',
    query: recentRange,
    assert: hasArrayData,
  },
  {
    // getSlaBreaches -> { data: [{ ticketId, ticket, stage, breachSeconds }] }
    name: 'sla-breaches',
    path: '/api/reports/sla-breaches',
    query: recentRange,
    assert: hasArrayData,
  },
  {
    // getChannelBreakdown -> { data: [{ channel, label, count, percent }], total }
    name: 'channel-breakdown',
    path: '/api/reports/channel-breakdown',
    query: recentRange,
    assert: (body) => {
      hasArrayData(body);
      expect(typeof (body as Record<string, unknown>).total).toBe('number');
    },
  },
  {
    // getTicketsByCategory -> { data: [{ id, name, count }] }
    name: 'tickets-by-category',
    path: '/api/reports/tickets-by-category',
    query: recentRange,
    assert: hasArrayData,
  },
  {
    // getTeamSummary -> { data: [{ id, name, open, resolved, total }] }
    name: 'team-summary',
    path: '/api/reports/team-summary',
    query: recentRange,
    assert: hasArrayData,
  },
  {
    // getTransfers -> { data: { total, series: [{ date, count }] } }
    name: 'transfers',
    path: '/api/reports/transfers',
    query: recentRange,
    assert: (body) => {
      hasObjectData(body);
      const data = (body as Record<string, unknown>).data as Record<
        string,
        unknown
      >;
      expect(typeof data.total).toBe('number');
      expect(Array.isArray(data.series)).toBe(true);
    },
  },
];

// Endpoints to spot-check for LEAD reachability + AGENT denial. Covers the two
// query DTOs (ReportQueryDto + ResolutionTimeQueryDto), the `days` handler, a
// raw-SQL aggregate, and a Prisma groupBy path.
const representative = [
  '/api/reports/summary',
  '/api/reports/tag-analytics',
  '/api/reports/sla-compliance',
  '/api/reports/resolution-time',
  '/api/reports/tickets-by-status',
  '/api/reports/transfers',
];

describe('Reports', () => {
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

  describe('OWNER reaches every report endpoint (200 + sane body)', () => {
    for (const ep of endpoints) {
      it(`GET ${ep.path} -> 200`, async () => {
        const res = await request(server)
          .get(ep.path)
          .query(ep.query ?? {})
          .set(authHeader(fixtureEmails.owner));
        expect(res.status).toBe(200);
        ep.assert(res.body);
      });
    }
  });

  describe('team-scoped endpoints accept a valid teamId for OWNER', () => {
    // ⚠️ THIS COMMENT WAS INVERTED BY CARD 1.81 RATHER THAN DELETED, so the
    // change stays visible. It used to read "OWNER is platform-wide and the
    // service DELETES teamId from the query" - which was true, and was the bug:
    // an owner picked HR and got platform-wide numbers under an HR heading.
    // The owner's filter is now honoured; see the describe block at the end of
    // this file. It must still be a well-formed UUID or the ValidationPipe
    // rejects it with 400 before the service is reached.
    const teamScoped = [
      '/api/reports/sla-compliance-by-team',
      '/api/reports/team-summary',
      '/api/reports/ticket-volume',
    ];
    for (const path of teamScoped) {
      it(`GET ${path}?teamId -> 200`, async () => {
        await request(server)
          .get(path)
          .query({ ...recentRange, teamId: fixtureTeamIds.it })
          .set(authHeader(fixtureEmails.owner))
          .expect(200);
      });
    }
  });

  describe('LEAD (LEAD of IT) reaches representative endpoints', () => {
    for (const path of representative) {
      it(`GET ${path} -> 200`, async () => {
        await request(server)
          .get(path)
          .query(recentRange)
          .set(authHeader(fixtureEmails.lead))
          .expect(200);
      });
    }
  });

  describe('AGENT is denied every report endpoint (403)', () => {
    for (const ep of endpoints) {
      it(`GET ${ep.path} -> 403`, async () => {
        await request(server)
          .get(ep.path)
          .query(ep.query ?? {})
          .set(authHeader(fixtureEmails.agent))
          .expect(403);
      });
    }
  });

  describe('EMPLOYEE (requester) is denied representative endpoints (403)', () => {
    for (const path of representative) {
      it(`GET ${path} -> 403`, async () => {
        await request(server)
          .get(path)
          .query(recentRange)
          .set(authHeader(fixtureEmails.requester))
          .expect(403);
      });
    }
  });

  /**
   * Card 1.81 — an owner picks a team on the Reports page and gets that team's
   * numbers.
   *
   * ⚠️ DECIDED BY THE OWNER 2026-09-16: honour the filter. Hiding the control
   * for owners was the alternative and was declined.
   *
   * ⚠️ THE EXPORT IS THE HALF THAT MATTERS MOST. A wrong number on screen is
   * seen by the person who ran it; a CSV labelled HR full of platform-wide rows
   * leaves the building.
   */
  describe("an OWNER's team filter is honoured (card 1.81)", () => {
    // ⚠️ NOT `recentRange`. Its `to` is captured when this MODULE loads, which
    // is before the fixtures below are created - so tickets raised in
    // `beforeAll` fall outside the window and every assertion here came back
    // an empty array. Two of these tests then passed VACUOUSLY. Leaving `to`
    // off makes the range end at request time instead.
    const range = { from: FROM.toISOString() };
    type TeamSummaryRow = { id: string; name: string; total: number };
    const teamRows = (body: unknown): TeamSummaryRow[] =>
      ((body as { data?: TeamSummaryRow[] }).data ?? []).filter(
        (row) => row.id !== 'unassigned',
      );

    beforeAll(async () => {
      // Deterministic data on TWO teams, so "narrowed" is observable rather
      // than inferred from whatever the seed happens to hold.
      const raise = (assignedTeamId: string, subject: string) =>
        request(server)
          .post('/api/tickets')
          .set(authHeader(fixtureEmails.requester))
          .send({
            subject,
            description: 'card 1.81 fixture',
            priority: 'SEV3',
            channel: 'PORTAL',
            assignedTeamId,
          })
          .expect(201);
      await raise(fixtureTeamIds.it, 'card 1.81 IT one');
      await raise(fixtureTeamIds.it, 'card 1.81 IT two');
      await raise(fixtureTeamIds.hr, 'card 1.81 HR one');
    });

    it('⚠️ picking a team returns THAT team, not the platform', async () => {
      // THE ASSERTION THIS CARD EXISTS FOR.
      const res = await request(server)
        .get('/api/reports/team-summary')
        .query({ ...range, teamId: fixtureTeamIds.hr })
        .set(authHeader(fixtureEmails.owner))
        .expect(200);

      const rows = teamRows(res.body);
      expect(rows.map((row) => row.id)).toEqual([fixtureTeamIds.hr]);
    });

    it('⚠️ and with no team it is still platform-wide', async () => {
      // NON-VACUITY, and the one most likely to break: a fix that always
      // narrows would pass the test above and silently shrink every owner
      // report that has no filter on it.
      const res = await request(server)
        .get('/api/reports/team-summary')
        .query(range)
        .set(authHeader(fixtureEmails.owner))
        .expect(200);

      const ids = teamRows(res.body).map((row) => row.id);
      expect(ids).toContain(fixtureTeamIds.it);
      expect(ids).toContain(fixtureTeamIds.hr);
    });

    it('⚠️ a LEAD still cannot widen their scope by naming another team', async () => {
      // THE SECURITY TEST. The LEAD and TEAM_ADMIN branches pin teamId FROM THE
      // USER, overwriting whatever was asked for, and that is the real boundary
      // in `scopeReportQuery`. Card 1.81 changed only the OWNER branch.
      const res = await request(server)
        .get('/api/reports/team-summary')
        .query({ ...range, teamId: fixtureTeamIds.hr })
        .set(authHeader(fixtureEmails.lead))
        .expect(200);

      const ids = teamRows(res.body).map((row) => row.id);
      expect(ids).not.toContain(fixtureTeamIds.hr);
      expect(ids.every((id) => id === fixtureTeamIds.it)).toBe(true);
    });

    it('refuses a team that does not exist instead of reporting nothing', async () => {
      // An empty report reads exactly like "no tickets this month", which is a
      // worse answer than an error.
      await request(server)
        .get('/api/reports/team-summary')
        .query({
          ...recentRange,
          teamId: '00000000-0000-4000-8000-000000000000',
        })
        .set(authHeader(fixtureEmails.owner))
        .expect(404);
    });

    it('⚠️ the export carries the same scope as the screen', async () => {
      const res = await request(server)
        .get('/api/reports/team-summary/export.csv')
        .query({ ...range, teamId: fixtureTeamIds.hr })
        .set(authHeader(fixtureEmails.owner))
        .expect(200);

      const csv = res.text;
      expect(csv).toContain('HR');
      // The IT team's rows must not be in a file labelled HR.
      expect(csv).not.toContain('IT Service Desk');
    });
  });
});
