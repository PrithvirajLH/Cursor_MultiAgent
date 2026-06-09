import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TagSummary = {
  id: string;
  name: string;
  color: string | null;
  ticketCount?: number;
};

type CreatedTag = {
  id: string;
  name: string;
  color: string | null;
};

type TicketResponse = {
  id: string;
  subject?: string;
  tags?: { id: string; name: string; color: string | null }[];
};

/** Create a fresh IT-assigned ticket as the given actor (defaults to admin). */
async function createTicket(
  server: SupertestApp,
  actorEmail: string = fixtureEmails.admin,
): Promise<TicketResponse> {
  const response = await request(server)
    .post('/api/tickets')
    .set(authHeader(actorEmail))
    .send({
      subject: `Tag target ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: 'Ticket used to exercise tagging endpoints.',
      priority: 'SEV3',
      channel: 'PORTAL',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);
  return response.body as TicketResponse;
}

/** Fetch a single ticket so we can read its current tag list. */
async function getTicket(
  server: SupertestApp,
  ticketId: string,
  actorEmail: string = fixtureEmails.admin,
): Promise<TicketResponse> {
  const response = await request(server)
    .get(`/api/tickets/${ticketId}`)
    .set(authHeader(actorEmail))
    .expect(200);
  return response.body as TicketResponse;
}

describe('Tags', () => {
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

  describe('admin tag creation (POST /api/admin/tags)', () => {
    it('lets the owner create a standalone tag (normalized + 201)', async () => {
      const response = await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: '  Network-VPN  ' })
        .expect(201);

      const tag = response.body as CreatedTag;
      // normalize() trims + lowercases + collapses whitespace.
      expect(tag.name).toBe('network-vpn');
      expect(typeof tag.id).toBe('string');
      expect(tag.id.length).toBeGreaterThan(0);
    });

    it('is idempotent — re-creating the same name returns the same tag', async () => {
      const first = await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'duplicate-me' })
        .expect(201);
      const second = await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'DUPLICATE-ME' })
        .expect(201);

      expect((second.body as CreatedTag).id).toBe((first.body as CreatedTag).id);
    });

    it('rejects an invalid tag name with 400', async () => {
      await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: '   ' })
        .expect(400);
    });

    it('denies a requester (EMPLOYEE) with 403', async () => {
      await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.requester))
        .send({ name: 'requester-attempt' })
        .expect(403);
    });

    it('denies an agent with 403', async () => {
      await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.agent))
        .send({ name: 'agent-attempt' })
        .expect(403);
    });

    it('denies a TEAM_ADMIN with 403 (create is OWNER-only)', async () => {
      // The route is mounted under /admin but the service gate is OWNER-only,
      // so even a TEAM_ADMIN is rejected here.
      await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.admin))
        .send({ name: 'team-admin-attempt' })
        .expect(403);
    });
  });

  describe('autocomplete (GET /api/tags)', () => {
    it('returns a created tag when queried by prefix (any authenticated user)', async () => {
      await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'autocomplete-hit' })
        .expect(201);

      const response = await request(server)
        .get('/api/tags')
        .query({ q: 'autocomplete' })
        .set(authHeader(fixtureEmails.requester))
        .expect(200);

      const tags = response.body as TagSummary[];
      expect(Array.isArray(tags)).toBe(true);
      const match = tags.find((t) => t.name === 'autocomplete-hit');
      expect(match).toBeDefined();
      expect(match).toMatchObject({ ticketCount: 0 });
    });

    it('returns results for an agent as well (no role gate)', async () => {
      await request(server)
        .get('/api/tags')
        .query({ q: 'autocomplete' })
        .set(authHeader(fixtureEmails.agent))
        .expect(200);
    });
  });

  describe('ticket tagging (POST/DELETE /api/tickets/:id/tags)', () => {
    it('adds a tag to a ticket, the ticket reflects it, then removes it', async () => {
      const ticket = await createTicket(server, fixtureEmails.admin);

      // Add — creates the tag on the fly and attaches it.
      const addResponse = await request(server)
        .post(`/api/tickets/${ticket.id}/tags`)
        .set(authHeader(fixtureEmails.admin))
        .send({ name: 'on-a-ticket' })
        .expect(201);
      const added = addResponse.body as CreatedTag;
      expect(added.name).toBe('on-a-ticket');

      // The ticket detail now carries the tag.
      const withTag = await getTicket(server, ticket.id);
      expect(withTag.tags?.some((t) => t.name === 'on-a-ticket')).toBe(true);

      // Remove — idempotent, returns { ok: true }.
      const removeResponse = await request(server)
        .delete(`/api/tickets/${ticket.id}/tags/${added.id}`)
        .set(authHeader(fixtureEmails.admin))
        .expect(200);
      expect(removeResponse.body).toMatchObject({ ok: true });

      const withoutTag = await getTicket(server, ticket.id);
      expect(withoutTag.tags?.some((t) => t.name === 'on-a-ticket')).toBe(false);
    });

    it('removing an already-absent tag is idempotent (200)', async () => {
      const ticket = await createTicket(server, fixtureEmails.admin);
      const created = await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'never-attached' })
        .expect(201);
      const tagId = (created.body as CreatedTag).id;

      await request(server)
        .delete(`/api/tickets/${ticket.id}/tags/${tagId}`)
        .set(authHeader(fixtureEmails.admin))
        .expect(200);
    });

    it('denies tagging a ticket the actor cannot write (403)', async () => {
      // Ticket assigned to IT; other.requester is an unrelated EMPLOYEE.
      const ticket = await createTicket(server, fixtureEmails.admin);
      await request(server)
        .post(`/api/tickets/${ticket.id}/tags`)
        .set(authHeader(fixtureEmails.otherRequester))
        .send({ name: 'forbidden-tag' })
        .expect(403);
    });

    it('returns 404 when tagging a non-existent ticket', async () => {
      await request(server)
        .post('/api/tickets/99999999-9999-4999-8999-999999999999/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'ghost-tag' })
        .expect(404);
    });
  });

  describe('admin rename (POST /api/admin/tags/:id/rename)', () => {
    it('lets the owner rename a tag', async () => {
      const created = await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'rename-source' })
        .expect(201);
      const tagId = (created.body as CreatedTag).id;

      const renamed = await request(server)
        .post(`/api/admin/tags/${tagId}/rename`)
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'rename-target' })
        .expect(201);

      expect((renamed.body as TagSummary).name).toBe('rename-target');
      expect((renamed.body as TagSummary).id).toBe(tagId);
    });

    it('returns 409 when renaming onto an existing tag name', async () => {
      const a = await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'collide-a' })
        .expect(201);
      await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'collide-b' })
        .expect(201);

      await request(server)
        .post(`/api/admin/tags/${(a.body as CreatedTag).id}/rename`)
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'collide-b' })
        .expect(409);
    });

    it('denies a TEAM_ADMIN (rename is OWNER-only) with 403', async () => {
      const created = await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'rename-guard' })
        .expect(201);

      await request(server)
        .post(`/api/admin/tags/${(created.body as CreatedTag).id}/rename`)
        .set(authHeader(fixtureEmails.admin))
        .send({ name: 'rename-guard-2' })
        .expect(403);
    });
  });

  describe('admin merge (POST /api/admin/tags/merge)', () => {
    it('merges two tags into one and re-points ticket usage', async () => {
      // Two standalone tags.
      const from = await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'merge-from' })
        .expect(201);
      const into = await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'merge-into' })
        .expect(201);
      const fromId = (from.body as CreatedTag).id;
      const intoId = (into.body as CreatedTag).id;

      // Attach the source tag to a ticket so the merge has a row to move.
      const ticket = await createTicket(server, fixtureEmails.admin);
      await request(server)
        .post(`/api/tickets/${ticket.id}/tags`)
        .set(authHeader(fixtureEmails.admin))
        .send({ name: 'merge-from' })
        .expect(201);

      const mergeResponse = await request(server)
        .post('/api/admin/tags/merge')
        .set(authHeader(fixtureEmails.owner))
        .send({ fromIds: [fromId], intoId })
        .expect(201);
      expect(mergeResponse.body).toMatchObject({
        ok: true,
        movedRows: 1,
        deletedTags: 1,
      });

      // The source tag is gone; the ticket now carries the target tag.
      const afterMerge = await getTicket(server, ticket.id);
      expect(afterMerge.tags?.some((t) => t.name === 'merge-from')).toBe(false);
      expect(afterMerge.tags?.some((t) => t.name === 'merge-into')).toBe(true);
    });

    it('rejects merging a tag into itself with 400', async () => {
      const tag = await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'merge-self' })
        .expect(201);
      const id = (tag.body as CreatedTag).id;

      await request(server)
        .post('/api/admin/tags/merge')
        .set(authHeader(fixtureEmails.owner))
        .send({ fromIds: [id], intoId: id })
        .expect(400);
    });

    it('denies a non-owner (merge is OWNER-only) with 403', async () => {
      const tag = await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'merge-guard' })
        .expect(201);
      const id = (tag.body as CreatedTag).id;

      await request(server)
        .post('/api/admin/tags/merge')
        .set(authHeader(fixtureEmails.agent))
        .send({ fromIds: [id], intoId: id })
        .expect(403);
    });
  });

  describe('admin delete (DELETE /api/admin/tags/:id)', () => {
    it('lets the owner delete an unused tag', async () => {
      const tag = await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'delete-me' })
        .expect(201);
      const id = (tag.body as CreatedTag).id;

      const deleteResponse = await request(server)
        .delete(`/api/admin/tags/${id}`)
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      expect(deleteResponse.body).toMatchObject({ ok: true });

      // No longer surfaced by autocomplete.
      const after = await request(server)
        .get('/api/tags')
        .query({ q: 'delete-me' })
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      expect((after.body as TagSummary[]).some((t) => t.name === 'delete-me')).toBe(
        false,
      );
    });

    it('refuses to delete a tag still attached to a ticket (400)', async () => {
      const tag = await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'in-use' })
        .expect(201);
      const id = (tag.body as CreatedTag).id;

      const ticket = await createTicket(server, fixtureEmails.admin);
      await request(server)
        .post(`/api/tickets/${ticket.id}/tags`)
        .set(authHeader(fixtureEmails.admin))
        .send({ name: 'in-use' })
        .expect(201);

      await request(server)
        .delete(`/api/admin/tags/${id}`)
        .set(authHeader(fixtureEmails.owner))
        .expect(400);
    });

    it('denies a TEAM_ADMIN (delete is OWNER-only) with 403', async () => {
      const tag = await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: 'delete-guard' })
        .expect(201);

      await request(server)
        .delete(`/api/admin/tags/${(tag.body as CreatedTag).id}`)
        .set(authHeader(fixtureEmails.admin))
        .expect(403);
    });
  });

  describe('admin listing (GET /api/admin/tags)', () => {
    it('lists tags for the owner', async () => {
      const marker = `list-marker-${Date.now()}`;
      await request(server)
        .post('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .send({ name: marker })
        .expect(201);

      const response = await request(server)
        .get('/api/admin/tags')
        .set(authHeader(fixtureEmails.owner))
        .expect(200);

      const tags = response.body as TagSummary[];
      expect(Array.isArray(tags)).toBe(true);
      expect(tags.some((t) => t.name === marker)).toBe(true);
    });

    it('allows a TEAM_ADMIN to list (scoped to their team)', async () => {
      // listAllForAdmin permits OWNER + TEAM_ADMIN; TEAM_ADMIN sees only tags
      // used on their primary team's tickets, so the result may be empty but
      // the request must succeed.
      const response = await request(server)
        .get('/api/admin/tags')
        .set(authHeader(fixtureEmails.admin))
        .expect(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('denies an agent with 403', async () => {
      await request(server)
        .get('/api/admin/tags')
        .set(authHeader(fixtureEmails.agent))
        .expect(403);
    });

    it('denies a requester with 403', async () => {
      await request(server)
        .get('/api/admin/tags')
        .set(authHeader(fixtureEmails.requester))
        .expect(403);
    });
  });
});
