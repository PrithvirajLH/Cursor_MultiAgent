import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type CannedResponse = {
  id: string;
  name: string;
  content: string;
  userId: string | null;
  teamId: string | null;
};

type CannedResponseListResponse = {
  data: CannedResponse[];
};

describe('Canned responses', () => {
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

  it('lets an agent create a canned response and lists it back', async () => {
    const created = await request(server)
      .post('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .send({
        name: 'Agent personal reply',
        content: 'Thanks for reaching out, we are on it.',
      })
      .expect(201);

    const body = created.body as CannedResponse;
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('Agent personal reply');
    expect(body.userId).toBe(fixtureUserIds.agent);
    // No teamId in payload -> not team-shared.
    expect(body.teamId).toBeNull();

    const listed = await request(server)
      .get('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const listBody = listed.body as CannedResponseListResponse;
    const found = listBody.data.find((item) => item.id === body.id);
    expect(found).toBeTruthy();
    expect(found?.name).toBe('Agent personal reply');
  });

  it('scopes the list to own + team-shared responses', async () => {
    // Agent (IT team) creates a team-shared response.
    const shared = await request(server)
      .post('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .send({
        name: 'IT team shared reply',
        content: 'Your VPN access is being provisioned.',
        teamId: fixtureTeamIds.it,
      })
      .expect(201);

    const sharedBody = shared.body as CannedResponse;
    expect(sharedBody.teamId).toBe(fixtureTeamIds.it);
    expect(sharedBody.userId).toBe(fixtureUserIds.agent);

    // Agent (private, no teamId) response.
    const personal = await request(server)
      .post('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .send({
        name: 'Agent private note',
        content: 'Private boilerplate for the agent only.',
      })
      .expect(201);
    const personalBody = personal.body as CannedResponse;

    // Lead is on the same IT team -> sees the team-shared one (teamId match)
    // but NOT the agent's private one (different userId, no team match).
    const leadList = await request(server)
      .get('/api/canned-responses')
      .set(authHeader(fixtureEmails.lead))
      .expect(200);
    const leadIds = (leadList.body as CannedResponseListResponse).data.map(
      (item) => item.id,
    );
    expect(leadIds).toContain(sharedBody.id);
    expect(leadIds).not.toContain(personalBody.id);

    // Owner has no team membership -> sees neither (no userId match, no team match).
    const ownerList = await request(server)
      .get('/api/canned-responses')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const ownerIds = (ownerList.body as CannedResponseListResponse).data.map(
      (item) => item.id,
    );
    expect(ownerIds).not.toContain(sharedBody.id);
    expect(ownerIds).not.toContain(personalBody.id);
  });

  it('lets an agent update their own canned response', async () => {
    const created = await request(server)
      .post('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Editable reply', content: 'Original content.' })
      .expect(201);
    const id = (created.body as CannedResponse).id;

    const updated = await request(server)
      .patch(`/api/canned-responses/${id}`)
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Edited reply', content: 'Updated content.' })
      .expect(200);

    const body = updated.body as CannedResponse;
    expect(body.id).toBe(id);
    expect(body.name).toBe('Edited reply');
    expect(body.content).toBe('Updated content.');
  });

  it('blocks another user from updating or deleting the agent response (IDOR guard, 403)', async () => {
    // Agent creates a team-shared response so the lead can SEE it but still
    // must not be able to mutate it (owner-only write).
    const created = await request(server)
      .post('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .send({
        name: 'Agent-owned shared reply',
        content: 'Only the agent may edit this.',
        teamId: fixtureTeamIds.it,
      })
      .expect(201);
    const id = (created.body as CannedResponse).id;

    await request(server)
      .patch(`/api/canned-responses/${id}`)
      .set(authHeader(fixtureEmails.lead))
      .send({ name: 'Hijacked name' })
      .expect(403);

    await request(server)
      .delete(`/api/canned-responses/${id}`)
      .set(authHeader(fixtureEmails.lead))
      .expect(403);

    // Confirm the record is untouched: the agent can still read the original.
    const list = await request(server)
      .get('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
    const found = (list.body as CannedResponseListResponse).data.find(
      (item) => item.id === id,
    );
    expect(found?.name).toBe('Agent-owned shared reply');
  });

  it('lets an agent delete their own canned response', async () => {
    const created = await request(server)
      .post('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Disposable reply', content: 'Will be deleted.' })
      .expect(201);
    const id = (created.body as CannedResponse).id;

    const deleted = await request(server)
      .delete(`/api/canned-responses/${id}`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
    expect((deleted.body as { deleted: boolean }).deleted).toBe(true);

    const list = await request(server)
      .get('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
    const ids = (list.body as CannedResponseListResponse).data.map(
      (item) => item.id,
    );
    expect(ids).not.toContain(id);
  });

  it('returns 404 when updating a non-existent canned response', async () => {
    await request(server)
      .patch('/api/canned-responses/99999999-9999-4999-8999-999999999999')
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Nope' })
      .expect(404);
  });

  it('rejects creation that is missing the required content field (validation)', async () => {
    await request(server)
      .post('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Missing content' })
      .expect(400);
  });

  it('rejects a name that exceeds the max length (validation)', async () => {
    await request(server)
      .post('/api/canned-responses')
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'x'.repeat(121), content: 'Valid content.' })
      .expect(400);
  });
});
