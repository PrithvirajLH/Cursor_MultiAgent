import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureUserIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TeamResponse = {
  id: string;
  name: string;
};

type TicketResponse = {
  id: string;
  assignee?: { id: string } | null;
  status?: string | null;
};

describe('Round-robin assignment', () => {
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

  it('assigns tickets in round-robin order for configured teams', async () => {
    const teamResponse = await request(server)
      .post('/api/teams')
      .set(authHeader(fixtureEmails.owner))
      .send({ name: `RR Team ${Date.now()}` })
      .expect(201);

    const team = teamResponse.body as TeamResponse;

    await request(server)
      .post(`/api/teams/${team.id}/members`)
      .set(authHeader(fixtureEmails.owner))
      .send({ userId: fixtureUserIds.agent, role: 'AGENT' })
      .expect(201);

    await request(server)
      .post(`/api/teams/${team.id}/members`)
      .set(authHeader(fixtureEmails.owner))
      .send({ userId: fixtureUserIds.lead, role: 'LEAD' })
      .expect(201);

    await request(server)
      .patch(`/api/teams/${team.id}`)
      .set(authHeader(fixtureEmails.owner))
      .send({ assignmentStrategy: 'ROUND_ROBIN' })
      .expect(200);

    const first = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `RR Ticket A ${Date.now()}`,
        description: 'Round robin A',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: team.id,
      })
      .expect(201);

    const second = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `RR Ticket B ${Date.now()}`,
        description: 'Round robin B',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: team.id,
      })
      .expect(201);

    const third = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `RR Ticket C ${Date.now()}`,
        description: 'Round robin C',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: team.id,
      })
      .expect(201);

    const firstBody = first.body as TicketResponse;
    const secondBody = second.body as TicketResponse;
    const thirdBody = third.body as TicketResponse;

    expect(firstBody.assignee?.id).toBe(fixtureUserIds.agent);
    expect(secondBody.assignee?.id).toBe(fixtureUserIds.lead);
    expect(thirdBody.assignee?.id).toBe(fixtureUserIds.agent);
    expect(firstBody.status).toBe('ASSIGNED');
    expect(secondBody.status).toBe('ASSIGNED');
    expect(thirdBody.status).toBe('ASSIGNED');
  });
});
