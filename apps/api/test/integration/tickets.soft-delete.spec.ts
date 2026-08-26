import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { INestApplication } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TicketResponse = {
  id: string;
  displayId?: string | null;
  deletedAt?: string | null;
  allowedTransitions?: string[];
};
type ListResponse = { data: TicketResponse[] };
type CountsResponse = { open: number };
type StatusReport = { data: Array<{ status: string; count: number }> };
type EventsResponse = { data: Array<{ type: string }> };

function sumCounts(report: StatusReport): number {
  return report.data.reduce((total, row) => total + row.count, 0);
}

describe('Ticket soft delete / restore', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let cache: Cache;
  let ticketId: string;
  let leadOpenBefore: number;
  let leadReportBefore: number;

  /** Counts are cached per user (PERF-02); drop the LEAD's entry so a read is fresh. */
  async function leadOpenCount(): Promise<number> {
    await cache.del(`tickets:counts:${fixtureUserIds.lead}`);
    const res = await request(server)
      .get('/api/tickets/counts')
      .set(authHeader(fixtureEmails.lead))
      .expect(200);
    return (res.body as CountsResponse).open;
  }

  async function leadReportTotal(): Promise<number> {
    const res = await request(server)
      .get('/api/reports/tickets-by-status')
      .set(authHeader(fixtureEmails.lead))
      .expect(200);
    return sumCounts(res.body as StatusReport);
  }

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    cache = app.get<Cache>(CACHE_MANAGER);
    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `Soft delete ${Date.now()}`,
        description: 'A ticket that will be deleted and restored',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    ticketId = (created.body as TicketResponse).id;
    leadOpenBefore = await leadOpenCount();
    leadReportBefore = await leadReportTotal();
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses an AGENT (403)', async () => {
    await request(server)
      .delete(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.agent))
      .send({})
      .expect(403);
  });

  it('lets the TEAM_ADMIN of the assigned team delete it (200 with deletedAt)', async () => {
    const res = await request(server)
      .delete(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.admin))
      .send({ reason: 'duplicate' })
      .expect(200);
    const body = res.body as TicketResponse;
    expect(body.id).toBe(ticketId);
    expect(typeof body.deletedAt).toBe('string');
  });

  it('hides the deleted ticket from non-owners (404) but shows it to OWNER', async () => {
    await request(server)
      .get(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.agent))
      .expect(404);
    await request(server)
      .get(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(404);
    const res = await request(server)
      .get(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const body = res.body as TicketResponse;
    expect(typeof body.deletedAt).toBe('string');
    expect(body.allowedTransitions).toEqual([]);
  });

  it('drops out of the LEAD list, counts and status report', async () => {
    const list = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.lead))
      .expect(200);
    const ids = (list.body as ListResponse).data.map((t) => t.id);
    expect(ids).not.toContain(ticketId);
    expect(await leadOpenCount()).toBe(leadOpenBefore - 1);
    expect(await leadReportTotal()).toBe(leadReportBefore - 1);
  });

  it('exposes deleted tickets only to OWNER via includeDeleted', async () => {
    await request(server)
      .get('/api/tickets')
      .query({ includeDeleted: 'true' })
      .set(authHeader(fixtureEmails.lead))
      .expect(403);
    const res = await request(server)
      .get('/api/tickets')
      .query({ includeDeleted: 'true', pageSize: 100 })
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const ids = (res.body as ListResponse).data.map((t) => t.id);
    expect(ids).toContain(ticketId);
  });

  it('blocks messages: hidden from the requester (404), refused for OWNER (403)', async () => {
    await request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.requester))
      .send({ body: 'Is anyone there?' })
      .expect(404);
    await request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.owner))
      .send({ body: 'Owner note' })
      .expect(403);
  });

  it('lets OWNER read the history of a deleted ticket; non-owners get 404', async () => {
    await request(server)
      .get(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    await request(server)
      .get(`/api/tickets/${ticketId}/events`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    await request(server)
      .get(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.requester))
      .expect(404);
    await request(server)
      .get(`/api/tickets/${ticketId}/events`)
      .set(authHeader(fixtureEmails.agent))
      .expect(404);
  });

  it('lets only OWNER restore, after which the AGENT can read it again', async () => {
    await request(server)
      .post(`/api/tickets/${ticketId}/restore`)
      .set(authHeader(fixtureEmails.admin))
      .expect(403);
    const res = await request(server)
      .post(`/api/tickets/${ticketId}/restore`)
      .set(authHeader(fixtureEmails.owner))
      .expect(201);
    expect((res.body as TicketResponse).deletedAt).toBeNull();
    await request(server)
      .get(`/api/tickets/${ticketId}`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
    expect(await leadOpenCount()).toBe(leadOpenBefore);
  });

  it('records both actions in the ticket events and the admin audit log', async () => {
    const events = await request(server)
      .get(`/api/tickets/${ticketId}/events`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const types = (events.body as EventsResponse).data.map((e) => e.type);
    expect(types).toContain('TICKET_DELETED');
    expect(types).toContain('TICKET_RESTORED');
    const audit = await request(server)
      .get('/api/audit-log')
      .query({ pageSize: 100 })
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const serialized = JSON.stringify(audit.body);
    expect(serialized).toContain('TICKET_DELETED');
    expect(serialized).toContain('TICKET_RESTORED');
  });
});
