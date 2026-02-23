import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type UsersListResponse = {
  data: Array<{ id: string; email: string }>;
};

type CategoryResponse = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
};

type CategoriesListResponse = {
  data: CategoryResponse[];
};

describe('Security scoping', () => {
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

  it('blocks employees from listing users', async () => {
    await request(server)
      .get('/api/users')
      .set(authHeader(fixtureEmails.requester))
      .expect(403);
  });

  it('scopes team-admin user listing to their team', async () => {
    const response = await request(server)
      .get('/api/users')
      .set(authHeader(fixtureEmails.admin))
      .expect(200);

    const body = response.body as UsersListResponse;
    const emails = new Set(body.data.map((user) => user.email));

    expect(emails.has(fixtureEmails.admin)).toBe(true);
    expect(emails.has(fixtureEmails.agent)).toBe(true);
    expect(emails.has(fixtureEmails.lead)).toBe(true);

    expect(emails.has(fixtureEmails.requester)).toBe(false);
    expect(emails.has(fixtureEmails.otherRequester)).toBe(false);
    expect(emails.has(fixtureEmails.owner)).toBe(false);
  });

  it('allows owners to list all users', async () => {
    const response = await request(server)
      .get('/api/users')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const body = response.body as UsersListResponse;
    const emails = new Set(body.data.map((user) => user.email));

    expect(emails.has(fixtureEmails.requester)).toBe(true);
    expect(emails.has(fixtureEmails.admin)).toBe(true);
    expect(emails.has(fixtureEmails.owner)).toBe(true);
  });

  it('allows includeInactive categories only for owners', async () => {
    const slug = `inactive-${Date.now()}`;
    const created = await request(server)
      .post('/api/categories')
      .set(authHeader(fixtureEmails.owner))
      .send({
        name: `Inactive ${Date.now()}`,
        slug,
        isActive: false,
      })
      .expect(201);

    const createdBody = created.body as CategoryResponse;

    await request(server)
      .get('/api/categories?includeInactive=true')
      .set(authHeader(fixtureEmails.admin))
      .expect(403);

    const ownerResponse = await request(server)
      .get('/api/categories?includeInactive=true')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const ownerBody = ownerResponse.body as CategoriesListResponse;
    const found = ownerBody.data.find(
      (category) => category.id === createdBody.id,
    );
    expect(found).toBeTruthy();
    expect(found?.isActive).toBe(false);
  });
});
