import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type KbCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  _count?: { articles: number };
};

type KbArticle = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  isInternal: boolean;
  viewCount: number;
  categoryId: string | null;
  category: { id: string; name: string; slug: string } | null;
  author: { id: string; displayName: string; email: string } | null;
};

type ListResponse<T> = { data: T[] };

describe('KB', () => {
  let app: INestApplication;
  let server: SupertestApp;

  // Unique slugs so the suite is robust against any pre-seeded KB rows.
  const stamp = Date.now();
  const categorySlug = `kb-it-howto-${stamp}`;
  const publishedSlug = `kb-published-${stamp}`;
  const internalSlug = `kb-internal-${stamp}`;
  const draftSlug = `kb-draft-${stamp}`;

  let categoryId: string;
  let publishedArticleId: string;
  let internalArticleId: string;
  let draftArticleId: string;
  let updatedPublishedSlug: string;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Categories: create ─────────────────────────────────────────────────────

  it('rejects category creation by a non-admin (EMPLOYEE) with 403', async () => {
    await request(server)
      .post('/api/kb/categories')
      .set(authHeader(fixtureEmails.requester))
      .send({ name: 'Should not exist', slug: `nope-${stamp}` })
      .expect(403);
  });

  it('rejects category creation by an AGENT with 403', async () => {
    await request(server)
      .post('/api/kb/categories')
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Should not exist', slug: `nope-agent-${stamp}` })
      .expect(403);
  });

  it('lets a TEAM_ADMIN create a category', async () => {
    const res = await request(server)
      .post('/api/kb/categories')
      .set(authHeader(fixtureEmails.admin))
      .send({
        name: 'IT How-To',
        slug: categorySlug,
        description: 'How-to guides for IT',
        sortOrder: 1,
        isActive: true,
      })
      .expect(201);

    const body = res.body as KbCategory;
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('IT How-To');
    expect(body.slug).toBe(categorySlug);
    expect(body.description).toBe('How-to guides for IT');
    expect(body.sortOrder).toBe(1);
    expect(body.isActive).toBe(true);

    categoryId = body.id;
  });

  // ─── Articles: create ───────────────────────────────────────────────────────

  it('rejects article creation by a non-admin (EMPLOYEE) with 403', async () => {
    await request(server)
      .post('/api/kb/articles')
      .set(authHeader(fixtureEmails.requester))
      .send({ title: 'Nope', content: 'Nope', categoryId })
      .expect(403);
  });

  it('lets an OWNER create a published article in the category', async () => {
    const res = await request(server)
      .post('/api/kb/articles')
      .set(authHeader(fixtureEmails.owner))
      .send({
        title: 'Reset your VPN password',
        slug: publishedSlug,
        summary: 'Steps to reset the VPN password',
        content: 'Open the portal and click reset.',
        status: 'PUBLISHED',
        isInternal: false,
        categoryId,
      })
      .expect(201);

    const body = res.body as KbArticle;
    expect(body.id).toBeTruthy();
    expect(body.slug).toBe(publishedSlug);
    expect(body.status).toBe('PUBLISHED');
    expect(body.isInternal).toBe(false);
    expect(body.categoryId).toBe(categoryId);
    expect(body.category?.id).toBe(categoryId);
    // Authored by the owner persona.
    expect(body.author?.email).toBe(fixtureEmails.owner);

    publishedArticleId = body.id;
  });

  it('lets a TEAM_ADMIN create an internal published article', async () => {
    const res = await request(server)
      .post('/api/kb/articles')
      .set(authHeader(fixtureEmails.admin))
      .send({
        title: 'Internal runbook',
        slug: internalSlug,
        content: 'Agents only.',
        status: 'PUBLISHED',
        isInternal: true,
        categoryId,
      })
      .expect(201);

    const body = res.body as KbArticle;
    expect(body.isInternal).toBe(true);
    expect(body.status).toBe('PUBLISHED');
    internalArticleId = body.id;
  });

  it('lets a TEAM_ADMIN create a draft article (defaults to DRAFT)', async () => {
    const res = await request(server)
      .post('/api/kb/articles')
      .set(authHeader(fixtureEmails.admin))
      .send({
        title: 'Work in progress',
        slug: draftSlug,
        content: 'Not done yet.',
        categoryId,
      })
      .expect(201);

    const body = res.body as KbArticle;
    expect(body.status).toBe('DRAFT');
    draftArticleId = body.id;
  });

  it('returns 404 when creating an article in a non-existent category', async () => {
    await request(server)
      .post('/api/kb/articles')
      .set(authHeader(fixtureEmails.owner))
      .send({
        title: 'Orphan',
        content: 'No category',
        categoryId: '00000000-0000-4000-8000-000000000000',
      })
      .expect(404);
  });

  // ─── Articles: list (role-based visibility) ─────────────────────────────────

  it('shows only the published, non-internal article to an EMPLOYEE', async () => {
    const res = await request(server)
      .get('/api/kb/articles')
      .query({ categoryId })
      .set(authHeader(fixtureEmails.requester))
      .expect(200);

    const body = res.body as ListResponse<KbArticle>;
    const ids = body.data.map((a) => a.id);
    expect(ids).toContain(publishedArticleId);
    expect(ids).not.toContain(internalArticleId); // internal hidden
    expect(ids).not.toContain(draftArticleId); // draft hidden
  });

  it('shows published internal articles to an AGENT but hides drafts', async () => {
    const res = await request(server)
      .get('/api/kb/articles')
      .query({ categoryId })
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const body = res.body as ListResponse<KbArticle>;
    const ids = body.data.map((a) => a.id);
    expect(ids).toContain(publishedArticleId);
    expect(ids).toContain(internalArticleId); // internal visible to agents
    expect(ids).not.toContain(draftArticleId); // draft still hidden
  });

  it('shows drafts to an authoring role (TEAM_ADMIN)', async () => {
    const res = await request(server)
      .get('/api/kb/articles')
      .query({ categoryId })
      .set(authHeader(fixtureEmails.admin))
      .expect(200);

    const body = res.body as ListResponse<KbArticle>;
    const ids = body.data.map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        publishedArticleId,
        internalArticleId,
        draftArticleId,
      ]),
    );
  });

  it('supports full-text search via the q filter', async () => {
    const res = await request(server)
      .get('/api/kb/articles')
      .query({ categoryId, q: 'VPN' })
      .set(authHeader(fixtureEmails.requester))
      .expect(200);

    const body = res.body as ListResponse<KbArticle>;
    const ids = body.data.map((a) => a.id);
    expect(ids).toContain(publishedArticleId);
    expect(ids).not.toContain(internalArticleId);
  });

  // ─── Articles: get by slug ──────────────────────────────────────────────────

  it('returns the published article by slug with a related array', async () => {
    const res = await request(server)
      .get(`/api/kb/articles/${publishedSlug}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(200);

    const body = res.body as KbArticle & { related: unknown[] };
    expect(body.id).toBe(publishedArticleId);
    expect(body.slug).toBe(publishedSlug);
    expect(Array.isArray(body.related)).toBe(true);
  });

  it('hides an internal article from an EMPLOYEE (404 by slug)', async () => {
    await request(server)
      .get(`/api/kb/articles/${internalSlug}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(404);
  });

  it('lets an AGENT read an internal published article by slug', async () => {
    const res = await request(server)
      .get(`/api/kb/articles/${internalSlug}`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const body = res.body as KbArticle;
    expect(body.id).toBe(internalArticleId);
  });

  it('returns 404 for an unknown slug', async () => {
    await request(server)
      .get(`/api/kb/articles/does-not-exist-${stamp}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(404);
  });

  // ─── Articles: update ───────────────────────────────────────────────────────

  it('rejects article update by a non-admin (AGENT) with 403', async () => {
    await request(server)
      .patch(`/api/kb/articles/${publishedArticleId}`)
      .set(authHeader(fixtureEmails.agent))
      .send({ title: 'Hacked' })
      .expect(403);
  });

  it('lets an OWNER update an article (title, summary, slug)', async () => {
    updatedPublishedSlug = `${publishedSlug}-v2`;
    const res = await request(server)
      .patch(`/api/kb/articles/${publishedArticleId}`)
      .set(authHeader(fixtureEmails.owner))
      .send({
        title: 'Reset your VPN password (updated)',
        summary: 'Updated steps',
        slug: updatedPublishedSlug,
      })
      .expect(200);

    const body = res.body as KbArticle;
    expect(body.id).toBe(publishedArticleId);
    expect(body.title).toBe('Reset your VPN password (updated)');
    expect(body.summary).toBe('Updated steps');
    expect(body.slug).toBe(updatedPublishedSlug);
  });

  it('returns 404 when updating a non-existent article', async () => {
    await request(server)
      .patch('/api/kb/articles/00000000-0000-4000-8000-000000000000')
      .set(authHeader(fixtureEmails.owner))
      .send({ title: 'Nope' })
      .expect(404);
  });

  // ─── Categories: list / update / delete ─────────────────────────────────────

  it('lists categories with article counts (envelope + _count)', async () => {
    const res = await request(server)
      .get('/api/kb/categories')
      .set(authHeader(fixtureEmails.requester))
      .expect(200);

    const body = res.body as ListResponse<KbCategory>;
    const mine = body.data.find((c) => c.id === categoryId);
    expect(mine).toBeTruthy();
    expect(typeof mine?._count?.articles).toBe('number');
  });

  it('rejects category update by a non-admin (EMPLOYEE) with 403', async () => {
    await request(server)
      .patch(`/api/kb/categories/${categoryId}`)
      .set(authHeader(fixtureEmails.requester))
      .send({ name: 'Nope' })
      .expect(403);
  });

  it('lets a TEAM_ADMIN update a category', async () => {
    const res = await request(server)
      .patch(`/api/kb/categories/${categoryId}`)
      .set(authHeader(fixtureEmails.admin))
      .send({ name: 'IT How-To (renamed)', sortOrder: 5 })
      .expect(200);

    const body = res.body as KbCategory;
    expect(body.id).toBe(categoryId);
    expect(body.name).toBe('IT How-To (renamed)');
    expect(body.sortOrder).toBe(5);
  });

  it('returns 404 when updating a non-existent category', async () => {
    await request(server)
      .patch('/api/kb/categories/00000000-0000-4000-8000-000000000000')
      .set(authHeader(fixtureEmails.owner))
      .send({ name: 'Nope' })
      .expect(404);
  });

  // ─── Articles: delete ───────────────────────────────────────────────────────

  it('rejects article deletion by a non-admin (AGENT) with 403', async () => {
    await request(server)
      .delete(`/api/kb/articles/${draftArticleId}`)
      .set(authHeader(fixtureEmails.agent))
      .expect(403);
  });

  it('lets an OWNER delete an article (returns { id })', async () => {
    const res = await request(server)
      .delete(`/api/kb/articles/${draftArticleId}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    expect((res.body as { id: string }).id).toBe(draftArticleId);

    // Confirm it is gone: authoring role would otherwise see it.
    const list = await request(server)
      .get('/api/kb/articles')
      .query({ categoryId })
      .set(authHeader(fixtureEmails.admin))
      .expect(200);
    const ids = (list.body as ListResponse<KbArticle>).data.map((a) => a.id);
    expect(ids).not.toContain(draftArticleId);
  });

  it('returns 404 when deleting a non-existent article', async () => {
    await request(server)
      .delete('/api/kb/articles/00000000-0000-4000-8000-000000000000')
      .set(authHeader(fixtureEmails.owner))
      .expect(404);
  });

  // ─── Categories: delete ─────────────────────────────────────────────────────

  it('rejects category deletion by a non-admin (AGENT) with 403', async () => {
    await request(server)
      .delete(`/api/kb/categories/${categoryId}`)
      .set(authHeader(fixtureEmails.agent))
      .expect(403);
  });

  it('lets a TEAM_ADMIN delete a category (returns { id })', async () => {
    const res = await request(server)
      .delete(`/api/kb/categories/${categoryId}`)
      .set(authHeader(fixtureEmails.admin))
      .expect(200);

    expect((res.body as { id: string }).id).toBe(categoryId);

    // Remaining articles keep existing (FK set null) and are still readable.
    const list = await request(server)
      .get('/api/kb/categories')
      .set(authHeader(fixtureEmails.admin))
      .expect(200);
    const ids = (list.body as ListResponse<KbCategory>).data.map((c) => c.id);
    expect(ids).not.toContain(categoryId);
  });

  it('returns 404 when deleting a non-existent category', async () => {
    await request(server)
      .delete('/api/kb/categories/00000000-0000-4000-8000-000000000000')
      .set(authHeader(fixtureEmails.owner))
      .expect(404);
  });
});
