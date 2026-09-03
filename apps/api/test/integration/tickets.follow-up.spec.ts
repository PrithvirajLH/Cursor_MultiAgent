import { INestApplication } from '@nestjs/common';
import { NotificationType, TicketStatus } from '@prisma/client';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { AutomationSchedulerService } from '../../src/automation/automation-scheduler.service';
import {
  fixtureEmails,
  fixtureTeamIds,
  fixtureUserIds,
} from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

/**
 * Card 1.10 — "remind me Friday".
 *
 * The rule that matters most is that a reminder fires ONCE. Clearing the field
 * is the claim, so a second tick finds nothing left to take.
 */
describe('Ticket follow-up dates', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;
  let scheduler: AutomationSchedulerService;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    scheduler = app.get(AutomationSchedulerService);
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  let seq = 0;
  async function makeTicket(overrides: Record<string, unknown> = {}) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        requesterId: fixtureUserIds.requester,
        subject: `1.10 follow-up fixture ${seq}`,
        description: 'Fixture for follow-ups.',
        assignedTeamId: fixtureTeamIds.it,
        assigneeId: fixtureUserIds.agent,
        status: TicketStatus.WAITING_ON_VENDOR,
        ...overrides,
      },
      select: { id: true },
    });
  }

  const followUpNotifications = (ticketId: string) =>
    prisma.notification.findMany({
      where: { ticketId, type: NotificationType.FOLLOW_UP_DUE },
      select: { userId: true },
    });

  describe('setting it through the existing PATCH', () => {
    it('stores the date', async () => {
      const ticket = await makeTicket();
      const when = new Date(Date.now() + 86_400_000).toISOString();
      await request(server)
        .patch(`/api/tickets/${ticket.id}`)
        .set(authHeader(fixtureEmails.agent))
        .send({ followUpAt: when })
        .expect(200);
      const row = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { followUpAt: true },
      });
      expect(row.followUpAt?.toISOString()).toBe(when);
    });

    it('clears it with null', async () => {
      const ticket = await makeTicket({ followUpAt: new Date() });
      await request(server)
        .patch(`/api/tickets/${ticket.id}`)
        .set(authHeader(fixtureEmails.agent))
        .send({ followUpAt: null })
        .expect(200);
      const row = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { followUpAt: true },
      });
      expect(row.followUpAt).toBeNull();
    });

    it('is access-controlled like any other edit', async () => {
      // An EMPLOYEE with no relationship to the ticket cannot touch it.
      const ticket = await makeTicket();
      await request(server)
        .patch(`/api/tickets/${ticket.id}`)
        .set(authHeader(fixtureEmails.otherRequester))
        .send({ followUpAt: new Date().toISOString() })
        .expect(403);
    });

    it('refuses a requester setting one on their own ticket', async () => {
      // A follow-up is the assignee's reminder about work they are doing; a
      // requester has no use for one.
      const ticket = await makeTicket({ status: TicketStatus.NEW });
      await request(server)
        .patch(`/api/tickets/${ticket.id}`)
        .set(authHeader(fixtureEmails.requester))
        .send({ followUpAt: new Date().toISOString() })
        .expect(403);
    });

    it('rejects a date that is not a date', async () => {
      const ticket = await makeTicket();
      await request(server)
        .patch(`/api/tickets/${ticket.id}`)
        .set(authHeader(fixtureEmails.agent))
        .send({ followUpAt: 'next friday' })
        .expect(400);
    });
  });

  describe('the scheduler', () => {
    it('fires ONCE for a follow-up in the past, and clears the field', async () => {
      const ticket = await makeTicket({
        followUpAt: new Date(Date.now() - 60_000),
      });

      await scheduler.runOnce();
      expect(await followUpNotifications(ticket.id)).toHaveLength(1);
      const afterFirst = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { followUpAt: true },
      });
      expect(afterFirst.followUpAt).toBeNull();

      // The assertion the card exists for: clearing is the claim, so a second
      // tick must find nothing.
      await scheduler.runOnce();
      expect(await followUpNotifications(ticket.id)).toHaveLength(1);
    });

    it('sends it to the assignee', async () => {
      const ticket = await makeTicket({
        assigneeId: fixtureUserIds.lead,
        followUpAt: new Date(Date.now() - 60_000),
      });
      await scheduler.runOnce();
      const notified = await followUpNotifications(ticket.id);
      expect(notified.map((n) => n.userId)).toEqual([fixtureUserIds.lead]);
    });

    it('leaves a future follow-up alone', async () => {
      const later = new Date(Date.now() + 86_400_000);
      const ticket = await makeTicket({ followUpAt: later });
      await scheduler.runOnce();
      const row = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { followUpAt: true },
      });
      expect(row.followUpAt?.toISOString()).toBe(later.toISOString());
      expect(await followUpNotifications(ticket.id)).toHaveLength(0);
    });

    it('leaves a due follow-up on an UNASSIGNED ticket set, rather than losing it', async () => {
      // There is nobody to notify, and clearing it would throw the reminder
      // away silently. Left set, it keeps showing in the saved view until
      // somebody picks the ticket up.
      const ticket = await makeTicket({
        assigneeId: null,
        followUpAt: new Date(Date.now() - 60_000),
      });
      await scheduler.runOnce();
      const row = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { followUpAt: true },
      });
      expect(row.followUpAt).not.toBeNull();
      expect(await followUpNotifications(ticket.id)).toHaveLength(0);
    });
  });

  describe('the "Follow-ups due today" preset', () => {
    async function listFollowUps(email: string) {
      const res = await request(server)
        .get('/api/tickets')
        .query({ scope: 'followups', pageSize: 50 })
        .set(authHeader(email))
        .expect(200);
      return (res.body as { data: { id: string }[] }).data.map((t) => t.id);
    }

    it('returns the ones due today or already overdue, for this user', async () => {
      const overdue = await makeTicket({
        followUpAt: new Date(Date.now() - 3_600_000),
      });
      const laterToday = await makeTicket({
        followUpAt: new Date(new Date().setHours(23, 0, 0, 0)),
      });
      const nextWeek = await makeTicket({
        followUpAt: new Date(Date.now() + 7 * 86_400_000),
      });
      const none = await makeTicket();

      const ids = await listFollowUps(fixtureEmails.agent);
      expect(ids).toContain(overdue.id);
      expect(ids).toContain(laterToday.id);
      expect(ids).not.toContain(nextWeek.id);
      expect(ids).not.toContain(none.id);
    });

    it('does not show one person the follow-ups of another', async () => {
      const mine = await makeTicket({
        assigneeId: fixtureUserIds.lead,
        followUpAt: new Date(Date.now() - 3_600_000),
      });
      expect(await listFollowUps(fixtureEmails.agent)).not.toContain(mine.id);
      expect(await listFollowUps(fixtureEmails.lead)).toContain(mine.id);
    });
  });

  it('exposes followUpAt on the list payload, so the badge survives a reload', async () => {
    const when = new Date(Date.now() + 3_600_000);
    const ticket = await makeTicket({ followUpAt: when });
    const res = await request(server)
      .get('/api/tickets')
      .query({ pageSize: 50 })
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
    const row = (
      res.body as { data: { id: string; followUpAt?: string | null }[] }
    ).data.find((t) => t.id === ticket.id);
    expect(row?.followUpAt).toBe(when.toISOString());
  });
});
