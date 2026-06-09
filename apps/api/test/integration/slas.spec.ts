import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

// All four priorities, each with resolution > firstResponse and both >= 1, so the
// service's normalizeTargets() invariant passes (must include SEV1-SEV4, distinct,
// resolutionHours > firstResponseHours > 0).
const validTargets = [
  { priority: 'SEV1', firstResponseHours: 1, resolutionHours: 4 },
  { priority: 'SEV2', firstResponseHours: 4, resolutionHours: 24 },
  { priority: 'SEV3', firstResponseHours: 8, resolutionHours: 72 },
  { priority: 'SEV4', firstResponseHours: 24, resolutionHours: 168 },
];

type SlaListRow = {
  priority: string;
  firstResponseHours: number;
  resolutionHours: number;
  source: string;
};

type SlaPolicy = {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  enabled: boolean;
  businessHoursOnly: boolean;
  escalationEnabled: boolean;
  escalationAfterPercent: number;
  breachNotifyRoles: string[];
  appliedTeamIds: string[];
  targets: Array<{
    priority: string;
    firstResponseHours: number;
    resolutionHours: number;
  }>;
};

describe('SLA admin', () => {
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

  describe('GET /api/slas/settings (business-hours settings)', () => {
    it('returns settings for the owner (ensureSlaPageAccess)', async () => {
      const res = await request(server)
        .get('/api/slas/settings')
        .set(authHeader(fixtureEmails.owner))
        .expect(200);

      const body = res.body as {
        data: {
          timezone: string;
          schedule: Array<{ day: string }>;
          holidays: unknown[];
        };
      };
      expect(body.data.timezone).toBeTruthy();
      expect(Array.isArray(body.data.schedule)).toBe(true);
      expect(body.data.schedule).toHaveLength(7);
      expect(Array.isArray(body.data.holidays)).toBe(true);
    });
  });

  describe('GET /api/slas/policies (list policy configs)', () => {
    it('returns all policies for the owner', async () => {
      const res = await request(server)
        .get('/api/slas/policies')
        .set(authHeader(fixtureEmails.owner))
        .expect(200);

      const body = res.body as { data: SlaPolicy[] };
      expect(Array.isArray(body.data)).toBe(true);
      // Seed creates: default + IT + HR policies.
      expect(body.data.some((policy) => policy.isDefault)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(3);
    });

    it('returns scoped policies for a lead (default + team-assigned)', async () => {
      const res = await request(server)
        .get('/api/slas/policies')
        .set(authHeader(fixtureEmails.lead))
        .expect(200);

      const body = res.body as { data: SlaPolicy[] };
      expect(Array.isArray(body.data)).toBe(true);
      // Lead of IT sees the global default plus the IT-scoped policy only.
      expect(body.data.some((policy) => policy.isDefault)).toBe(true);
      for (const policy of body.data) {
        if (!policy.isDefault) {
          expect(policy.appliedTeamIds).toContain(fixtureTeamIds.it);
        }
      }
    });

    it('denies an agent (ensureSlaPageAccess -> 403)', async () => {
      await request(server)
        .get('/api/slas/policies')
        .set(authHeader(fixtureEmails.agent))
        .expect(403);
    });
  });

  describe('POST/PATCH/DELETE /api/slas/policies (owner CRUD)', () => {
    it('creates, updates, then deletes a policy config', async () => {
      // CREATE — owner scopes a brand-new (non-default) policy to the IT team.
      const createBody = {
        name: 'Owner Custom SLA',
        description: 'Created via integration spec.',
        isDefault: false,
        enabled: true,
        businessHoursOnly: true,
        escalationEnabled: true,
        escalationAfterPercent: 75,
        breachNotifyRoles: ['AGENT', 'LEAD'],
        appliedTeamIds: [fixtureTeamIds.it],
        targets: validTargets,
      };

      const created = await request(server)
        .post('/api/slas/policies')
        .set(authHeader(fixtureEmails.owner))
        .send(createBody)
        .expect(201);

      const createdPolicy = (created.body as { data: SlaPolicy }).data;
      expect(createdPolicy.id).toBeTruthy();
      expect(createdPolicy.name).toBe('Owner Custom SLA');
      expect(createdPolicy.escalationAfterPercent).toBe(75);
      expect(createdPolicy.appliedTeamIds).toContain(fixtureTeamIds.it);
      expect(createdPolicy.targets).toHaveLength(4);

      const policyId = createdPolicy.id;

      // PATCH — rename, bump escalation, swap notify roles, loosen targets.
      const patchBody = {
        name: 'Owner Custom SLA (revised)',
        escalationAfterPercent: 90,
        breachNotifyRoles: ['LEAD', 'MANAGER', 'OWNER'],
        targets: [
          { priority: 'SEV1', firstResponseHours: 2, resolutionHours: 6 },
          { priority: 'SEV2', firstResponseHours: 6, resolutionHours: 30 },
          { priority: 'SEV3', firstResponseHours: 10, resolutionHours: 80 },
          { priority: 'SEV4', firstResponseHours: 30, resolutionHours: 200 },
        ],
      };

      const patched = await request(server)
        .patch(`/api/slas/policies/${policyId}`)
        .set(authHeader(fixtureEmails.owner))
        .send(patchBody)
        .expect(200);

      const patchedPolicy = (patched.body as { data: SlaPolicy }).data;
      expect(patchedPolicy.id).toBe(policyId);
      expect(patchedPolicy.name).toBe('Owner Custom SLA (revised)');
      expect(patchedPolicy.escalationAfterPercent).toBe(90);
      expect(patchedPolicy.breachNotifyRoles).toEqual(
        expect.arrayContaining(['LEAD', 'MANAGER', 'OWNER']),
      );
      const sev1 = patchedPolicy.targets.find(
        (target) => target.priority === 'SEV1',
      );
      expect(sev1?.firstResponseHours).toBe(2);
      expect(sev1?.resolutionHours).toBe(6);

      // DELETE — owner removes the policy.
      const deleted = await request(server)
        .delete(`/api/slas/policies/${policyId}`)
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      expect((deleted.body as { id: string }).id).toBe(policyId);

      // PATCH on a now-deleted policy 404s (getPolicyById -> NotFound).
      await request(server)
        .patch(`/api/slas/policies/${policyId}`)
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'gone' })
        .expect(404);
    });

    it('denies an agent creating a policy (writeScope -> 403, valid body)', async () => {
      await request(server)
        .post('/api/slas/policies')
        .set(authHeader(fixtureEmails.agent))
        .send({
          name: 'Agent attempt',
          targets: validTargets,
        })
        .expect(403);
    });

    it('denies a requester creating a policy (writeScope -> 403, valid body)', async () => {
      await request(server)
        .post('/api/slas/policies')
        .set(authHeader(fixtureEmails.requester))
        .send({
          name: 'Requester attempt',
          targets: validTargets,
        })
        .expect(403);
    });
  });

  describe('PUT/GET/DELETE /api/slas/:teamId (legacy team SLA)', () => {
    it('owner sets, reads back, then resets a team SLA', async () => {
      const customPolicies = [
        { priority: 'SEV1', firstResponseHours: 3, resolutionHours: 9 },
        { priority: 'SEV2', firstResponseHours: 5, resolutionHours: 25 },
        { priority: 'SEV3', firstResponseHours: 9, resolutionHours: 90 },
        { priority: 'SEV4', firstResponseHours: 20, resolutionHours: 160 },
      ];

      // PUT — set the IT team SLA.
      const put = await request(server)
        .put(`/api/slas/${fixtureTeamIds.it}`)
        .set(authHeader(fixtureEmails.owner))
        .send({ policies: customPolicies })
        .expect(200);
      const putRows = (put.body as { data: SlaListRow[] }).data;
      const putSev1 = putRows.find((row) => row.priority === 'SEV1');
      expect(putSev1?.firstResponseHours).toBe(3);
      expect(putSev1?.resolutionHours).toBe(9);

      // GET ?teamId= — reflects the team SLA we just set.
      const get = await request(server)
        .get('/api/slas')
        .query({ teamId: fixtureTeamIds.it })
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      const getRows = (get.body as { data: SlaListRow[] }).data;
      expect(getRows).toHaveLength(4);
      const getSev2 = getRows.find((row) => row.priority === 'SEV2');
      expect(getSev2?.firstResponseHours).toBe(5);
      expect(getSev2?.resolutionHours).toBe(25);
      expect(getSev2?.source).toBe('team');

      // DELETE — reset removes the team assignment; falls back to default policy.
      const reset = await request(server)
        .delete(`/api/slas/${fixtureTeamIds.it}`)
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      const resetRows = (reset.body as { data: SlaListRow[] }).data;
      expect(resetRows).toHaveLength(4);
      // After reset, the IT team resolves to the global default policy.
      const resetSev1 = resetRows.find((row) => row.priority === 'SEV1');
      expect(resetSev1?.source).toBe('default');
      expect(resetSev1?.firstResponseHours).toBe(1);
    });

    it('requires a valid UUID teamId on GET /api/slas (validation -> 400)', async () => {
      await request(server)
        .get('/api/slas')
        .query({ teamId: 'not-a-uuid' })
        .set(authHeader(fixtureEmails.owner))
        .expect(400);
    });

    it('denies an agent setting a team SLA (ensureTeamAdminOrOwner -> 403, valid body)', async () => {
      await request(server)
        .put(`/api/slas/${fixtureTeamIds.it}`)
        .set(authHeader(fixtureEmails.agent))
        .send({
          policies: [
            { priority: 'SEV1', firstResponseHours: 1, resolutionHours: 4 },
            { priority: 'SEV2', firstResponseHours: 4, resolutionHours: 24 },
            { priority: 'SEV3', firstResponseHours: 8, resolutionHours: 72 },
            { priority: 'SEV4', firstResponseHours: 24, resolutionHours: 168 },
          ],
        })
        .expect(403);
    });

    it('denies a requester resetting a team SLA (ensureTeamAdminOrOwner -> 403)', async () => {
      await request(server)
        .delete(`/api/slas/${fixtureTeamIds.it}`)
        .set(authHeader(fixtureEmails.requester))
        .expect(403);
    });
  });

  describe('PATCH /api/slas/settings (business-hours settings)', () => {
    it('owner updates timezone, schedule, and holidays', async () => {
      const schedule = [
        { day: 'Monday', enabled: true, start: '08:00', end: '17:00' },
        { day: 'Tuesday', enabled: true, start: '08:00', end: '17:00' },
        { day: 'Wednesday', enabled: true, start: '08:00', end: '17:00' },
        { day: 'Thursday', enabled: true, start: '08:00', end: '17:00' },
        { day: 'Friday', enabled: true, start: '08:00', end: '16:00' },
        { day: 'Saturday', enabled: false, start: '10:00', end: '14:00' },
        { day: 'Sunday', enabled: false, start: '10:00', end: '14:00' },
      ];
      const holidays = [{ name: 'New Year', date: '2026-01-01' }];

      const res = await request(server)
        .patch('/api/slas/settings')
        .set(authHeader(fixtureEmails.owner))
        .send({ timezone: 'America/New_York', schedule, holidays })
        .expect(200);

      const body = res.body as {
        data: {
          timezone: string;
          schedule: Array<{ day: string; enabled: boolean; start: string }>;
          holidays: Array<{ name: string; date: string }>;
        };
      };
      expect(body.data.timezone).toBe('America/New_York');
      const monday = body.data.schedule.find((day) => day.day === 'Monday');
      expect(monday?.start).toBe('08:00');
      expect(monday?.enabled).toBe(true);
      expect(body.data.holidays).toEqual([
        { name: 'New Year', date: '2026-01-01' },
      ]);
    });

    it('denies an agent updating settings (ensureSlaPageWriteAccess -> 403, valid body)', async () => {
      await request(server)
        .patch('/api/slas/settings')
        .set(authHeader(fixtureEmails.agent))
        .send({ timezone: 'UTC' })
        .expect(403);
    });
  });
});
