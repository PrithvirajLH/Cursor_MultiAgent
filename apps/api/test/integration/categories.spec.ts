import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type CategoryResponse = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
};

type TicketResponse = {
  id: string;
  categoryId?: string | null;
  category?: { id: string } | null;
};

describe('Categories', () => {
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

  it('lets an owner create a category', async () => {
    const stamp = Date.now();
    const response = await request(server)
      .post('/api/categories')
      .set(authHeader(fixtureEmails.owner))
      .send({
        name: `Owner Category ${stamp}`,
        slug: `owner-category-${stamp}`,
      })
      .expect(201);

    const body = response.body as CategoryResponse;
    expect(body.id).toBeTruthy();
    expect(body.name).toBe(`Owner Category ${stamp}`);
    expect(body.isActive).toBe(true);
  });

  it('lets an owner rename a category via PATCH', async () => {
    const stamp = Date.now();
    const created = (
      await request(server)
        .post('/api/categories')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: `Renamable ${stamp}`, slug: `renamable-${stamp}` })
        .expect(201)
    ).body as CategoryResponse;

    const renamed = (
      await request(server)
        .patch(`/api/categories/${created.id}`)
        .set(authHeader(fixtureEmails.owner))
        .send({ name: `Renamed ${stamp}` })
        .expect(200)
    ).body as CategoryResponse;

    expect(renamed.id).toBe(created.id);
    expect(renamed.name).toBe(`Renamed ${stamp}`);
  });

  it('returns 404 when updating a category that does not exist', async () => {
    await request(server)
      .patch('/api/categories/99999999-9999-4999-8999-999999999999')
      .set(authHeader(fixtureEmails.owner))
      .send({ name: 'Nope' })
      .expect(404);
  });

  it('refuses to delete a referenced category (400 "Deactivate it instead")', async () => {
    const stamp = Date.now();
    const category = (
      await request(server)
        .post('/api/categories')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: `Referenced ${stamp}`, slug: `referenced-${stamp}` })
        .expect(201)
    ).body as CategoryResponse;

    const ticket = (
      await request(server)
        .post('/api/tickets')
        .set(authHeader(fixtureEmails.requester))
        .send({
          subject: `Categorized ticket ${stamp}`,
          description: 'References a category',
          priority: 'SEV3',
          channel: 'PORTAL',
          assignedTeamId: fixtureTeamIds.it,
          categoryId: category.id,
        })
        .expect(201)
    ).body as TicketResponse;
    expect(ticket.category?.id).toBe(category.id);

    // Since the soft-delete card, a category that any ticket (or custom field)
    // references cannot be deleted: the service answers 400 and points at
    // deactivation, and Ticket.category is ON DELETE RESTRICT at the database
    // as a backstop. Nothing is silently un-classified any more.
    const refused = await request(server)
      .delete(`/api/categories/${category.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(400);
    expect((refused.body as { message: string }).message).toContain(
      'Deactivate it instead',
    );

    // The ticket keeps its category.
    const fetched = (
      await request(server)
        .get(`/api/tickets/${ticket.id}`)
        .set(authHeader(fixtureEmails.owner))
        .expect(200)
    ).body as TicketResponse;
    expect(fetched.id).toBe(ticket.id);
    expect(fetched.category?.id).toBe(category.id);
  });

  it('deletes an unreferenced category', async () => {
    const stamp = Date.now();
    const category = (
      await request(server)
        .post('/api/categories')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: `Disposable ${stamp}`, slug: `disposable-${stamp}` })
        .expect(201)
    ).body as CategoryResponse;

    await request(server)
      .delete(`/api/categories/${category.id}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const listed = (
      await request(server)
        .get('/api/categories?includeInactive=true')
        .set(authHeader(fixtureEmails.owner))
        .expect(200)
    ).body as { data: CategoryResponse[] };
    expect(listed.data.some((item) => item.id === category.id)).toBe(false);
  });

  it('returns 404 when deleting a category that does not exist', async () => {
    await request(server)
      .delete('/api/categories/99999999-9999-4999-8999-999999999999')
      .set(authHeader(fixtureEmails.owner))
      .expect(404);
  });

  it('forbids a non-owner from creating a category', async () => {
    const stamp = Date.now();
    await request(server)
      .post('/api/categories')
      .set(authHeader(fixtureEmails.admin))
      .send({ name: `Admin Category ${stamp}`, slug: `admin-category-${stamp}` })
      .expect(403);

    await request(server)
      .post('/api/categories')
      .set(authHeader(fixtureEmails.agent))
      .send({ name: `Agent Category ${stamp}`, slug: `agent-category-${stamp}` })
      .expect(403);
  });

  it('forbids a non-owner from deleting a category', async () => {
    const stamp = Date.now();
    const category = (
      await request(server)
        .post('/api/categories')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: `Protected ${stamp}`, slug: `protected-${stamp}` })
        .expect(201)
    ).body as CategoryResponse;

    await request(server)
      .delete(`/api/categories/${category.id}`)
      .set(authHeader(fixtureEmails.admin))
      .expect(403);

    await request(server)
      .delete(`/api/categories/${category.id}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(403);
  });
});
