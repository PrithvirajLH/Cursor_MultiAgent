import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureUserIds, fixtureTeamIds } from '../utils/fixtures';
import { getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TicketResponse = {
  id: string;
  assignee?: { id: string } | null;
};

type NotificationItem = {
  id: string;
  type: string;
  isRead: boolean;
  userId: string;
  ticket?: { id: string } | null;
};

type NotificationsListResponse = {
  data: NotificationItem[];
  meta: {
    total: number;
    unreadCount: number;
  };
};

type UnreadCountResponse = {
  data: { count: number };
};

/**
 * Create a ticket on the IT team (assignedTeamId) and then assign it to the
 * agent as the owner. The owner can always assign, and the agent is a seeded
 * member of the IT team so the assignment succeeds. notifyTicketAssigned skips
 * self-notification, so the actor (owner) must differ from the assignee
 * (agent) for a TICKET_ASSIGNED in-app notification to be created.
 */
async function assignTicketToAgent(server: SupertestApp): Promise<string> {
  const created = await request(server)
    .post('/api/tickets')
    .set(authHeader(fixtureEmails.requester))
    .send({
      subject: `Notify ticket ${Date.now()}-${Math.random()}`,
      description: 'Triggering an assignment notification',
      priority: 'SEV3',
      channel: 'PORTAL',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);

  const ticket = created.body as TicketResponse;

  await request(server)
    .post(`/api/tickets/${ticket.id}/assign`)
    .set(authHeader(fixtureEmails.owner))
    .send({ assigneeId: fixtureUserIds.agent })
    .expect(201);

  return ticket.id;
}

describe('In-app notifications', () => {
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

  it('requires authentication', async () => {
    await request(server).get('/api/notifications').expect(401);
  });

  it('creates an assignment notification the assignee can list', async () => {
    const ticketId = await assignTicketToAgent(server);

    const listed = await request(server)
      .get('/api/notifications')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const body = listed.body as NotificationsListResponse;
    expect(Array.isArray(body.data)).toBe(true);

    const assignedNotification = body.data.find(
      (item) => item.ticket?.id === ticketId,
    );
    expect(assignedNotification).toBeTruthy();
    expect(assignedNotification?.type).toBe('TICKET_ASSIGNED');
    expect(assignedNotification?.isRead).toBe(false);
    expect(assignedNotification?.userId).toBe(fixtureUserIds.agent);
  });

  it('reports an unread count greater than zero for the assignee', async () => {
    const response = await request(server)
      .get('/api/notifications/unread-count')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const body = response.body as UnreadCountResponse;
    expect(body.data.count).toBeGreaterThan(0);
  });

  it('marks a single notification as read and decrements the unread count', async () => {
    const before = (
      await request(server)
        .get('/api/notifications/unread-count')
        .set(authHeader(fixtureEmails.agent))
        .expect(200)
    ).body as UnreadCountResponse;
    expect(before.data.count).toBeGreaterThan(0);

    const listed = (
      await request(server)
        .get('/api/notifications?unreadOnly=true')
        .set(authHeader(fixtureEmails.agent))
        .expect(200)
    ).body as NotificationsListResponse;
    const target = listed.data[0];
    expect(target).toBeTruthy();

    await request(server)
      .patch(`/api/notifications/${target.id}/read`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const after = (
      await request(server)
        .get('/api/notifications/unread-count')
        .set(authHeader(fixtureEmails.agent))
        .expect(200)
    ).body as UnreadCountResponse;
    expect(after.data.count).toBe(before.data.count - 1);
  });

  it('marks all notifications as read with read-all', async () => {
    // Generate a fresh notification so there is at least one unread item.
    await assignTicketToAgent(server);

    const before = (
      await request(server)
        .get('/api/notifications/unread-count')
        .set(authHeader(fixtureEmails.agent))
        .expect(200)
    ).body as UnreadCountResponse;
    expect(before.data.count).toBeGreaterThan(0);

    await request(server)
      .patch('/api/notifications/read-all')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const after = (
      await request(server)
        .get('/api/notifications/unread-count')
        .set(authHeader(fixtureEmails.agent))
        .expect(200)
    ).body as UnreadCountResponse;
    expect(after.data.count).toBe(0);
  });

  it('read-all succeeds (idempotently) on an already-empty unread set', async () => {
    // The previous test cleared all unread notifications for the agent.
    await request(server)
      .patch('/api/notifications/read-all')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const after = (
      await request(server)
        .get('/api/notifications/unread-count')
        .set(authHeader(fixtureEmails.agent))
        .expect(200)
    ).body as UnreadCountResponse;
    expect(after.data.count).toBe(0);
  });

  it('scopes notifications to their owning user', async () => {
    // UPDATED BY CARD 1.42. This asserted the lead's unread count was exactly
    // ZERO, on the premise that "the lead has never been assigned a ticket".
    // That premise is gone: the lead sits on the IT roster, and card 1.42's
    // new-ticket bell rings the whole assigned team - so the lead now
    // legitimately has notifications of their own.
    //
    // The thing under test is SCOPING, not emptiness, so the count is compared
    // against the lead's own rows instead of a hardcoded zero. That is a
    // stronger assertion: a leak would show up as a mismatch rather than
    // needing the lead to own nothing.
    //
    const leadList = (
      await request(server)
        .get('/api/notifications')
        .set(authHeader(fixtureEmails.lead))
        .expect(200)
    ).body as NotificationsListResponse;

    expect(
      leadList.data.every((item) => item.userId === fixtureUserIds.lead),
    ).toBe(true);
    expect(
      leadList.data.some((item) => item.userId === fixtureUserIds.agent),
    ).toBe(false);

    const leadCount = (
      await request(server)
        .get('/api/notifications/unread-count')
        .set(authHeader(fixtureEmails.lead))
        .expect(200)
    ).body as UnreadCountResponse;
    // The count is the lead's OWN unread rows and nobody else's. Compared
    // against the database rather than a hardcoded number, so it stays true
    // however many bells card 1.42's new-ticket notification adds.
    const ownUnread = await getPrisma().notification.count({
      where: { userId: fixtureUserIds.lead, isRead: false },
    });
    const everyoneElseUnread = await getPrisma().notification.count({
      where: { userId: { not: fixtureUserIds.lead }, isRead: false },
    });
    expect(leadCount.data.count).toBe(ownUnread);
    expect(leadCount.data.count).toBeLessThan(ownUnread + everyoneElseUnread + 1);
  });

  it('does not let a user mark another user notification as read', async () => {
    // Generate a fresh unread notification for the agent.
    await assignTicketToAgent(server);

    const agentList = (
      await request(server)
        .get('/api/notifications?unreadOnly=true')
        .set(authHeader(fixtureEmails.agent))
        .expect(200)
    ).body as NotificationsListResponse;
    const agentNotification = agentList.data[0];
    expect(agentNotification).toBeTruthy();

    // The lead attempts to mark the agent's notification as read. updateMany is
    // scoped by userId, so the request succeeds (200) but is a no-op.
    await request(server)
      .patch(`/api/notifications/${agentNotification.id}/read`)
      .set(authHeader(fixtureEmails.lead))
      .expect(200);

    const agentAfter = (
      await request(server)
        .get('/api/notifications/unread-count')
        .set(authHeader(fixtureEmails.agent))
        .expect(200)
    ).body as UnreadCountResponse;
    // Still unread because the lead cannot touch the agent's notification.
    expect(agentAfter.data.count).toBeGreaterThan(0);
  });
});
