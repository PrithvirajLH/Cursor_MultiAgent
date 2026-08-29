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

type IntakeResponse = {
  id: string;
  number: number;
  displayId: string | null;
  status: string;
  priority: string;
  channel: string;
  assignedTeam: { id: string; name: string; slug: string } | null;
  category: { id: string; name: string; slug: string } | null;
  requester: { id: string; email: string; displayName: string };
};
type EventsResponse = {
  data: Array<{ type: string; payload: Record<string, unknown> | null }>;
};
type TicketDetailResponse = {
  customFieldValues: Array<{
    customFieldId: string;
    value: string | null;
    customField?: { name: string };
  }>;
};

// Pinned by test/setup-tests.ts for the whole suite.
const INTAKE_SECRET = 'test-intake-secret';
// Legacy keyword routing matches on `subject + description`, so this token must
// appear only in the subjects of the cases that want the rule to fire.
const ROUTED_KEYWORD = 'intakeroute';
const INTAKE_EMAIL = 'pa.flow@csnhc.com';

function intakeBody(overrides: Record<string, unknown> = {}) {
  return {
    requesterEmail: INTAKE_EMAIL,
    requesterName: 'PA Flow',
    subject: `Intake ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`,
    description: 'Submitted by an integration test.',
    ...overrides,
  };
}

describe('POST /api/tickets/intake (integration intake, card 1.19)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let assetTagFieldId = '';

  function postIntake(
    body: Record<string, unknown>,
    options: {
      secret?: string | null;
      key?: string | null;
      forwardedFor?: string;
    } = {},
  ) {
    const call = request(server).post('/api/tickets/intake');
    const secret =
      options.secret === undefined ? INTAKE_SECRET : options.secret;
    if (secret !== null) {
      call.set('x-intake-secret', secret);
    }
    const key =
      options.key === undefined ? `intake-${randomKey()}` : options.key;
    if (key !== null) {
      call.set('Idempotency-Key', key);
    }
    if (options.forwardedFor) {
      call.set('X-Forwarded-For', options.forwardedFor);
    }
    return call.send(body);
  }

  function randomKey() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    // An active rule that would send anything mentioning ROUTED_KEYWORD to IT.
    await request(server)
      .post('/api/routing-rules')
      .set(authHeader(fixtureEmails.owner))
      .send({
        name: 'Intake spec routing',
        keywords: [ROUTED_KEYWORD],
        teamId: fixtureTeamIds.it,
        priority: 1,
        isActive: true,
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  it('1: refuses a missing or wrong intake secret (403)', async () => {
    const missing = await postIntake(intakeBody(), { secret: null }).expect(
      403,
    );
    expect(JSON.stringify(missing.body)).toContain('Missing intake API secret');
    const wrong = await postIntake(intakeBody(), {
      secret: 'not-the-secret',
    }).expect(403);
    expect(JSON.stringify(wrong.body)).toContain('Invalid intake API secret');
    expect(await getPrisma().ticket.count({ where: { channel: 'API' } })).toBe(
      0,
    );
  });

  it('2: refuses a request without an Idempotency-Key (400)', async () => {
    const res = await postIntake(intakeBody(), { key: null }).expect(400);
    expect(JSON.stringify(res.body)).toContain(
      'Idempotency-Key header is required',
    );
  });

  it('3: an explicit department wins over an active routing rule', async () => {
    const body = intakeBody({
      subject: `${ROUTED_KEYWORD} printer jam on the 2nd floor`,
      department: 'hr',
      category: 'access-identity',
      priority: 'SEV2',
      tags: ['power-automate'],
      sourceRef: 'flow-run-3',
    });
    const res = await postIntake(body).expect(201);
    const created = res.body as IntakeResponse;
    expect(created.channel).toBe('API');
    expect(created.displayId).toBeTruthy();
    expect(created.number).toBeGreaterThan(0);
    expect(created.assignedTeam?.slug).toBe('hr');
    expect(created.category?.slug).toBe('access-identity');
    expect(created.priority).toBe('SEV2');
    expect(created.requester.email).toBe(INTAKE_EMAIL);
    const stored = await getPrisma().ticket.findUnique({
      where: { id: created.id },
      select: { assignedTeamId: true, channel: true },
    });
    expect(stored?.assignedTeamId).toBe(fixtureTeamIds.hr);
    expect(stored?.channel).toBe('API');
  });

  it('4: the same Idempotency-Key replays the first response instead of creating a second ticket', async () => {
    const key = `intake-replay-${randomKey()}`;
    const body = intakeBody({
      subject: `Replay probe ${randomKey()}`,
      department: 'hr',
    });
    const first = await postIntake(body, { key }).expect(201);
    const second = await postIntake(body, { key }).expect(201);
    const firstBody = first.body as IntakeResponse;
    const secondBody = second.body as IntakeResponse;
    expect(secondBody.id).toBe(firstBody.id);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(
      await getPrisma().ticket.count({ where: { subject: body.subject } }),
    ).toBe(1);
  });

  it('5: an unknown department is rejected with the list of valid slugs', async () => {
    const res = await postIntake(intakeBody({ department: 'nope' })).expect(
      400,
    );
    const message = (res.body as { message: string }).message;
    expect(message).toContain('Unknown department "nope"');
    expect(message).toContain('hr');
    expect(message).toContain('it-service-desk');
  });

  it('6: an unknown requester address creates one EMPLOYEE and reuses it next time', async () => {
    const email = `flow.newcomer.${Date.now()}@csnhc.com`;
    await postIntake(
      intakeBody({
        requesterEmail: email,
        requesterName: 'Flow Newcomer',
        department: 'hr',
      }),
    ).expect(201);
    const afterFirst = await getPrisma().user.findMany({ where: { email } });
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].role).toBe('EMPLOYEE');
    expect(afterFirst[0].displayName).toBe('Flow Newcomer');
    const second = await postIntake(
      intakeBody({ requesterEmail: email.toUpperCase(), department: 'hr' }),
    ).expect(201);
    expect(await getPrisma().user.count({ where: { email } })).toBe(1);
    expect((second.body as IntakeResponse).requester.id).toBe(afterFirst[0].id);
  });

  it('7: omitting the department leaves the routing rules in charge', async () => {
    const res = await postIntake(
      intakeBody({ subject: `${ROUTED_KEYWORD} vpn will not connect` }),
    ).expect(201);
    const created = res.body as IntakeResponse;
    expect(created.assignedTeam?.slug).toBe('it-service-desk');
    expect(created.channel).toBe('API');
  });

  it('8: rejects invalid bodies (empty subject, oversized subject, bad priority, too many tags)', async () => {
    await postIntake(intakeBody({ subject: '' })).expect(400);
    await postIntake(intakeBody({ subject: 'x'.repeat(201) })).expect(400);
    await postIntake(intakeBody({ priority: 'SEV9' })).expect(400);
    await postIntake(
      intakeBody({ tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`) }),
    ).expect(400);
    await postIntake(intakeBody({ requesterEmail: 'not-an-email' })).expect(
      400,
    );
    await postIntake(intakeBody({ department: 'Not A Slug' })).expect(400);
  });

  it('10: replays across connections — a fresh X-Forwarded-For port must not create a second ticket', async () => {
    // Azure App Service writes `X-Forwarded-For: ip:port` with a new source port
    // per TCP connection, so a network-derived idempotency scope changes between
    // a flow's retries. Regression test for card 1.20 defect A.
    const key = `intake-xff-${randomKey()}`;
    const body = intakeBody({
      subject: `Forwarded-for probe ${randomKey()}`,
      department: 'hr',
    });
    const first = await postIntake(body, {
      key,
      forwardedFor: '1.2.3.4:1111',
    }).expect(201);
    const second = await postIntake(body, {
      key,
      forwardedFor: '1.2.3.4:2222',
    }).expect(201);
    expect((second.body as IntakeResponse).id).toBe(
      (first.body as IntakeResponse).id,
    );
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(
      await getPrisma().ticket.count({ where: { subject: body.subject } }),
    ).toBe(1);
  });

  it('9: the timeline records how the ticket arrived', async () => {
    const res = await postIntake(
      intakeBody({ department: 'hr', sourceRef: 'flow-run-9' }),
    ).expect(201);
    const created = res.body as IntakeResponse;
    const events = await request(server)
      .get(`/api/tickets/${created.id}/events?take=50`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const intakeEvent = (events.body as EventsResponse).data.find(
      (event) => event.type === 'TICKET_CREATED_VIA_INTAKE',
    );
    expect(intakeEvent).toBeDefined();
    expect(intakeEvent?.payload).toMatchObject({
      sourceRef: 'flow-run-9',
      department: 'hr',
      byIntegration: true,
    });
  });

  it('11: a department with a required custom field refuses intake that omits it, naming both', async () => {
    // Created inside the case, not in beforeAll: earlier cases route to IT and
    // must not be affected by a required field appearing on that team.
    const created = await request(server)
      .post('/api/custom-fields')
      .set(authHeader(fixtureEmails.owner))
      .send({
        name: 'Asset Tag',
        fieldType: 'TEXT',
        isRequired: true,
        teamId: fixtureTeamIds.it,
      })
      .expect(201);
    assetTagFieldId = (created.body as { id: string }).id;
    const res = await postIntake(
      intakeBody({ department: 'it-service-desk' }),
    ).expect(400);
    const message = (res.body as { message: string }).message;
    expect(message).toContain('Department "it-service-desk" requires:');
    expect(message).toContain('Asset Tag');
  });

  it('12: the same intake succeeds when the field is supplied by name, in any case', async () => {
    const res = await postIntake(
      intakeBody({
        department: 'it-service-desk',
        customFields: { 'asset tag': 'LT-4471' },
      }),
    ).expect(201);
    const created = res.body as IntakeResponse;
    expect(created.assignedTeam?.slug).toBe('it-service-desk');
    const detail = await request(server)
      .get(`/api/tickets/${created.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const values = (detail.body as TicketDetailResponse).customFieldValues;
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customFieldId: assetTagFieldId,
          value: 'LT-4471',
        }),
      ]),
    );
  });

  it('13: an unknown field name is refused with the applicable names', async () => {
    const res = await postIntake(
      intakeBody({
        department: 'it-service-desk',
        customFields: { 'Asset Tag': 'LT-1', Nope: 'x' },
      }),
    ).expect(400);
    const message = (res.body as { message: string }).message;
    expect(message).toContain(
      'Unknown field "Nope" for department "it-service-desk"',
    );
    expect(message).toContain('Asset Tag');
  });

  it('14: the stored idempotency scope is a digest, never the raw secret', async () => {
    const rows = await getPrisma().idempotencyRequest.findMany({
      where: { route: '/api/tickets/intake' },
      select: { actorId: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.actorId).not.toContain(INTAKE_SECRET);
      expect(row.actorId).toMatch(/^anonymous:[0-9a-f]{24}$/);
    }
  });
});
