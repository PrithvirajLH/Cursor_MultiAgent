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
 * Card 1.96 — ticket detail handed back more than it needed to.
 *
 * ⚠️ IN PRISMA `include: { x: true }` RETURNS EVERY COLUMN OF x. So a requester
 * opening their own ticket received the assigned agent's `entraObjectId`,
 * `graphProfile`, `department`, `location` and availability, plus the team's
 * `isSensitive`, `confidenceThreshold`, `hiddenPresetIds` and
 * `assignmentStrategy`. None of it is rendered anywhere.
 *
 * ⚠️ THIS IS OVER-FETCHING, NOT AN AUTHORISATION HOLE. The requester may see
 * the ticket. The fix is asking for fewer columns, and these tests deliberately
 * assert on the SHAPE of the payload rather than on who can open it — turning
 * this into a permissions change is explicitly out of scope.
 */
describe('the ticket detail payload carries only what it renders (card 1.96)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let ticketId: string;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;

    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: 'card 1.96 fixture',
        description: 'over-fetching check',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    ticketId = (created.body as { id: string }).id;

    await request(server)
      .post(`/api/tickets/${ticketId}/assign`)
      .set(authHeader(fixtureEmails.owner))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);

    // Give the agent something worth leaking, so an assertion that the field is
    // absent cannot pass merely because the column was null.
    await getPrisma().user.update({
      where: { id: fixtureUserIds.agent },
      data: {
        entraObjectId: 'aaaaaaaa-1111-4111-8111-agentobjectid',
        department: 'Clinical Systems',
        location: 'Floor 3',
      },
    });
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  const fetchAsRequester = async () => {
    const res = await request(server)
      .get(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(200);
    return res.body as Record<string, unknown>;
  };

  it('⚠️ does not carry the assignee directory record', async () => {
    // THE REGRESSION ASSERTION. Restoring `assignee: true` puts all of this back.
    const body = await fetchAsRequester();
    const assignee = body.assignee as Record<string, unknown>;
    expect(assignee).toBeTruthy();
    expect(assignee.entraObjectId).toBeUndefined();
    expect(assignee.graphProfile).toBeUndefined();
    expect(assignee.department).toBeUndefined();
    expect(assignee.location).toBeUndefined();
    expect(assignee.isAvailable).toBeUndefined();
    expect(assignee.awayUntil).toBeUndefined();
    // And not smuggled anywhere else in the document either.
    expect(JSON.stringify(body)).not.toContain('agentobjectid');
    expect(JSON.stringify(body)).not.toContain('Clinical Systems');
  });

  it('⚠️ does not carry the team configuration', async () => {
    const body = await fetchAsRequester();
    const team = body.assignedTeam as Record<string, unknown>;
    expect(team).toBeTruthy();
    expect(team.isSensitive).toBeUndefined();
    expect(team.confidenceThreshold).toBeUndefined();
    expect(team.hiddenPresetIds).toBeUndefined();
    expect(team.assignmentStrategy).toBeUndefined();
  });

  it('⚠️ still carries everything the ticket page renders', async () => {
    // THE NON-VACUITY HALF, and the one that matters most here: narrowing a
    // payload is only safe if the screen still has what it draws. Measured from
    // the ticket detail components, not guessed.
    const body = await fetchAsRequester();
    const assignee = body.assignee as Record<string, unknown>;
    const team = body.assignedTeam as Record<string, unknown>;
    const requester = body.requester as Record<string, unknown>;

    expect(assignee.id).toBeTruthy();
    expect(assignee.displayName).toBeDefined();
    expect(assignee.email).toBeTruthy();

    expect(team.id).toBeTruthy();
    expect(team.name).toBeTruthy();

    // The header renders the requester's own avatar, department and location.
    expect(requester.id).toBeTruthy();
    expect(requester.email).toBeTruthy();
    expect(requester).toHaveProperty('displayName');
    expect(requester).toHaveProperty('department');
    expect(requester).toHaveProperty('graphProfile');
  });

  it('an agent opening the same ticket sees the same narrowed shape', async () => {
    // The narrowing is a property of the query, not of who asked - so nobody
    // gets the wide version back by having a bigger role.
    const res = await request(server)
      .get(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const assignee = (res.body as { assignee: Record<string, unknown> }).assignee;
    expect(assignee.entraObjectId).toBeUndefined();
    expect(assignee.graphProfile).toBeUndefined();
  });
});
