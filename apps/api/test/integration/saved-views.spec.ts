import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureUserIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type SavedView = {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  userId: string | null;
  teamId: string | null;
  isDefault: boolean;
};

type SavedViewListResponse = {
  data: SavedView[];
};

async function listViews(
  server: SupertestApp,
  email: string,
): Promise<SavedView[]> {
  const res = await request(server)
    .get('/api/saved-views')
    .set(authHeader(email))
    .expect(200);
  return (res.body as SavedViewListResponse).data;
}

describe('Saved views', () => {
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

  it('creates a saved view and lists it back', async () => {
    const created = await request(server)
      .post('/api/saved-views')
      .set(authHeader(fixtureEmails.agent))
      .send({
        name: 'My open tickets',
        filters: { status: 'OPEN', assignee: 'me' },
      })
      .expect(201);

    const body = created.body as SavedView;
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('My open tickets');
    expect(body.userId).toBe(fixtureUserIds.agent);
    expect(body.isDefault).toBe(false);
    expect(body.filters).toEqual({ status: 'OPEN', assignee: 'me' });

    const views = await listViews(server, fixtureEmails.agent);
    const found = views.find((view) => view.id === body.id);
    expect(found).toBeTruthy();
    expect(found?.filters).toEqual({ status: 'OPEN', assignee: 'me' });
  });

  it('unsets the previous default when a second default is created (BUG-15)', async () => {
    // First default.
    const first = await request(server)
      .post('/api/saved-views')
      .set(authHeader(fixtureEmails.lead))
      .send({
        name: 'Lead default A',
        filters: { status: 'NEW' },
        isDefault: true,
      })
      .expect(201);
    const firstBody = first.body as SavedView;
    expect(firstBody.isDefault).toBe(true);

    // Second default for the SAME user must demote the first.
    const second = await request(server)
      .post('/api/saved-views')
      .set(authHeader(fixtureEmails.lead))
      .send({
        name: 'Lead default B',
        filters: { status: 'TRIAGED' },
        isDefault: true,
      })
      .expect(201);
    const secondBody = second.body as SavedView;
    expect(secondBody.isDefault).toBe(true);

    const views = await listViews(server, fixtureEmails.lead);
    const refreshedFirst = views.find((view) => view.id === firstBody.id);
    const refreshedSecond = views.find((view) => view.id === secondBody.id);

    // Exactly one default at a time: first is demoted, second remains default.
    expect(refreshedFirst?.isDefault).toBe(false);
    expect(refreshedSecond?.isDefault).toBe(true);
    expect(views.filter((view) => view.isDefault)).toHaveLength(1);

    // List is ordered isDefault desc, then name asc -> the default is first.
    expect(views[0].id).toBe(secondBody.id);
  });

  it('demotes a sibling default when an existing view is updated to default (BUG-15)', async () => {
    const a = await request(server)
      .post('/api/saved-views')
      .set(authHeader(fixtureEmails.admin))
      .send({ name: 'Admin A', filters: { q: 'a' }, isDefault: true })
      .expect(201);
    const b = await request(server)
      .post('/api/saved-views')
      .set(authHeader(fixtureEmails.admin))
      .send({ name: 'Admin B', filters: { q: 'b' } })
      .expect(201);

    const aId = (a.body as SavedView).id;
    const bId = (b.body as SavedView).id;

    // Promote B to default via PATCH; A must be demoted.
    const updated = await request(server)
      .patch(`/api/saved-views/${bId}`)
      .set(authHeader(fixtureEmails.admin))
      .send({ isDefault: true })
      .expect(200);
    expect((updated.body as SavedView).isDefault).toBe(true);

    const views = await listViews(server, fixtureEmails.admin);
    expect(views.find((view) => view.id === aId)?.isDefault).toBe(false);
    expect(views.find((view) => view.id === bId)?.isDefault).toBe(true);
    expect(views.filter((view) => view.isDefault)).toHaveLength(1);
  });

  it('updates name and filters of an owned view', async () => {
    const created = await request(server)
      .post('/api/saved-views')
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Editable view', filters: { status: 'NEW' } })
      .expect(201);
    const id = (created.body as SavedView).id;

    const updated = await request(server)
      .patch(`/api/saved-views/${id}`)
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Renamed view', filters: { status: 'CLOSED' } })
      .expect(200);

    const body = updated.body as SavedView;
    expect(body.name).toBe('Renamed view');
    expect(body.filters).toEqual({ status: 'CLOSED' });
  });

  it('deletes an owned view', async () => {
    const created = await request(server)
      .post('/api/saved-views')
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Disposable view', filters: { status: 'NEW' } })
      .expect(201);
    const id = (created.body as SavedView).id;

    const deleted = await request(server)
      .delete(`/api/saved-views/${id}`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
    expect((deleted.body as { deleted: boolean }).deleted).toBe(true);

    const views = await listViews(server, fixtureEmails.agent);
    expect(views.map((view) => view.id)).not.toContain(id);
  });

  it('scopes views per user: another user cannot see, edit, or delete them', async () => {
    // Agent creates a PRIVATE view (no teamId -> stored as null).
    const created = await request(server)
      .post('/api/saved-views')
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Agent private view', filters: { mine: true } })
      .expect(201);
    const body = created.body as SavedView;
    expect(body.teamId).toBeNull();
    const id = body.id;

    // Owner (no team) does not see the agent's private view.
    const ownerViews = await listViews(server, fixtureEmails.owner);
    expect(ownerViews.map((view) => view.id)).not.toContain(id);

    // Owner cannot edit it (ForbiddenException -> 403).
    await request(server)
      .patch(`/api/saved-views/${id}`)
      .set(authHeader(fixtureEmails.owner))
      .send({ name: 'Hijacked' })
      .expect(403);

    // Owner cannot delete it (403).
    await request(server)
      .delete(`/api/saved-views/${id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(403);

    // The agent's view is still intact.
    const agentViews = await listViews(server, fixtureEmails.agent);
    expect(
      agentViews.find((view) => view.id === id)?.name,
    ).toBe('Agent private view');
  });

  it('returns 404 when updating a non-existent saved view', async () => {
    await request(server)
      .patch('/api/saved-views/99999999-9999-4999-8999-999999999999')
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Nope' })
      .expect(404);
  });

  it('rejects creation without the required filters object (validation)', async () => {
    await request(server)
      .post('/api/saved-views')
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'No filters' })
      .expect(400);
  });
});
