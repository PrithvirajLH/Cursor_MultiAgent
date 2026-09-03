import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import {
  MessageType,
  NotificationType,
  TicketStatus,
} from '@prisma/client';
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

const inboundSecretHeader = { 'x-inbound-email-secret': 'test-inbound-secret' };

/**
 * Card 1.29 — the queue must know who owes the next move.
 *
 * A requester answered and the queue still said we were waiting on them, so the
 * ticket sat in "Awaiting reply > 24h" as though they had gone quiet and an
 * agent chased somebody who had already replied.
 */
describe('Awaiting reply — who owes the next move', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  let seq = 0;

  async function makeTicket(overrides: {
    status: TicketStatus;
    assigneeId?: string | null;
    requesterId?: string;
  }) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        requesterId: overrides.requesterId ?? fixtureUserIds.requester,
        subject: `1.29 fixture ${seq}`,
        description: 'Raised for the awaiting-reply tests.',
        assignedTeamId: fixtureTeamIds.it,
        assigneeId:
          overrides.assigneeId === undefined
            ? fixtureUserIds.agent
            : overrides.assigneeId,
        status: overrides.status,
        // displayId is built by TicketsService.create, not by the database, so
        // a fixture made straight through Prisma has none - and inbound
        // threading by subject then matches nothing, which quietly turns every
        // assertion below into a test of a brand-new ticket.
        displayId: `IS_20260903_${String(900 + seq).padStart(3, '0')}`,
      },
      select: { id: true, displayId: true, status: true },
    });
  }

  async function inboundReply(
    ticketDisplayId: string | null,
    options: {
      fromEmail?: string;
      automated?: Record<string, string>;
      body?: string;
    } = {},
  ) {
    seq += 1;
    const payload: Record<string, unknown> = {
      fromEmail: options.fromEmail ?? fixtureEmails.requester,
      fromName: 'Reply Sender',
      subject: `Re: ${ticketDisplayId} update`,
      body: options.body ?? 'Answering your question — here are the details.',
      messageId: `awaiting-${seq}-${Date.now()}@mail.example`,
      ...(options.automated ?? {}),
    };
    return request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send(payload);
  }

  const storedStatus = async (id: string) =>
    (
      await prisma.ticket.findUniqueOrThrow({
        where: { id },
        select: { status: true },
      })
    ).status;

  describe('Gap A — a genuine reply clears the wait', () => {
    it('moves WAITING_ON_REQUESTER to IN_PROGRESS', async () => {
      const ticket = await makeTicket({
        status: TicketStatus.WAITING_ON_REQUESTER,
      });
      const res = await inboundReply(ticket.displayId);
      expect(res.status).toBe(201);
      expect((res.body as { threaded: boolean }).threaded).toBe(true);
      // The STORED status, not a response field.
      expect(await storedStatus(ticket.id)).toBe(TicketStatus.IN_PROGRESS);
    });

    it('writes a status-history row, so it went through applyStatusTransitionInTx', async () => {
      // The whole reason not to write `status` directly: a raw update would
      // skip this row, the SLA pause accounting and the realtime emit, and
      // nothing would look wrong until somebody read an SLA report.
      const ticket = await makeTicket({
        status: TicketStatus.WAITING_ON_REQUESTER,
      });
      await inboundReply(ticket.displayId);
      const events = await prisma.ticketEvent.findMany({
        where: { ticketId: ticket.id, type: 'TICKET_STATUS_CHANGED' },
        select: { payload: true },
      });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        from: TicketStatus.WAITING_ON_REQUESTER,
        to: TicketStatus.IN_PROGRESS,
      });
    });

    it('resumes the SLA clock, pushing dueAt out by the time it sat parked', async () => {
      // §2 flags this as the thing that is NOT cosmetic. Asserted rather than
      // assumed: leaving a pause is what makes the resolution timer move again.
      const pausedAt = new Date(Date.now() - 60 * 60 * 1000);
      const dueAt = new Date(Date.now() + 60 * 60 * 1000);
      const ticket = await prisma.ticket.create({
        data: {
          requesterId: fixtureUserIds.requester,
          subject: '1.29 SLA resume fixture',
          description: 'Parked for an hour.',
          assignedTeamId: fixtureTeamIds.it,
          assigneeId: fixtureUserIds.agent,
          status: TicketStatus.WAITING_ON_REQUESTER,
          slaPausedAt: pausedAt,
          dueAt,
          displayId: 'IS_20260903_899',
        },
        select: { id: true, displayId: true },
      });
      const res = await inboundReply(ticket.displayId);
      expect((res.body as { threaded: boolean }).threaded).toBe(true);
      const after = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { status: true, slaPausedAt: true, dueAt: true },
      });
      expect(after.status).toBe(TicketStatus.IN_PROGRESS);
      expect(after.slaPausedAt).toBeNull();
      // Pushed out by roughly the hour it was paused.
      expect(after.dueAt!.getTime()).toBeGreaterThan(dueAt.getTime());
    });

    it('drops the ticket out of the "Awaiting reply" filter', async () => {
      const ticket = await makeTicket({
        status: TicketStatus.WAITING_ON_REQUESTER,
      });
      const matches = async () => {
        const res = await request(server)
          .get('/api/tickets')
          .query({ statuses: 'WAITING_ON_REQUESTER,WAITING_ON_VENDOR' })
          .set(authHeader(fixtureEmails.agent))
          .expect(200);
        return (res.body as { data: { id: string }[] }).data.map((t) => t.id);
      };
      expect(await matches()).toContain(ticket.id);
      await inboundReply(ticket.displayId);
      expect(await matches()).not.toContain(ticket.id);
    });
  });

  describe('Gap A — the guard', () => {
    it.each([
      ['Auto-Submitted', { autoSubmitted: 'auto-replied' }],
      ['X-Auto-Response-Suppress', { autoResponseSuppress: 'All' }],
      ['Precedence: bulk', { precedence: 'bulk' }],
      ['an empty Return-Path', { returnPath: '' }],
    ])('leaves the status alone for %s', async (_label, headers) => {
      // An out-of-office answering our acknowledgement is not the requester
      // answering our question. Flipping the queue on it would make the board
      // lie in the more dangerous direction, because it looks like progress.
      const ticket = await makeTicket({
        status: TicketStatus.WAITING_ON_REQUESTER,
      });
      const res = await inboundReply(ticket.displayId, { automated: headers });
      expect(res.status).toBe(201);
      // Assert it THREADED first. Without this the test passes when the reply
      // fails to thread and lands on a brand-new ticket, leaving the fixture
      // untouched for the wrong reason - which is exactly what happened on the
      // first run of this suite.
      expect((res.body as { threaded: boolean }).threaded).toBe(true);
      expect(await storedStatus(ticket.id)).toBe(
        TicketStatus.WAITING_ON_REQUESTER,
      );
    });
  });

  describe('Gap A — no over-reach', () => {
    it('leaves WAITING_ON_VENDOR alone', async () => {
      // A requester replying tells you nothing about the vendor.
      const ticket = await makeTicket({
        status: TicketStatus.WAITING_ON_VENDOR,
      });
      const res = await inboundReply(ticket.displayId);
      expect((res.body as { threaded: boolean }).threaded).toBe(true);
      expect(await storedStatus(ticket.id)).toBe(
        TicketStatus.WAITING_ON_VENDOR,
      );
    });

    it('still reopens a RESOLVED ticket', async () => {
      const ticket = await makeTicket({ status: TicketStatus.RESOLVED });
      await inboundReply(ticket.displayId);
      expect(await storedStatus(ticket.id)).toBe(TicketStatus.REOPENED);
    });

    it('still reopens a CLOSED ticket', async () => {
      const ticket = await makeTicket({ status: TicketStatus.CLOSED });
      await inboundReply(ticket.displayId);
      expect(await storedStatus(ticket.id)).toBe(TicketStatus.REOPENED);
    });

    it('does nothing to a ticket that was not waiting', async () => {
      const ticket = await makeTicket({ status: TicketStatus.IN_PROGRESS });
      const res = await inboundReply(ticket.displayId);
      expect((res.body as { threaded: boolean }).threaded).toBe(true);
      expect(await storedStatus(ticket.id)).toBe(TicketStatus.IN_PROGRESS);
    });
  });

  describe('Gap A — a looped-in third party (§4.4)', () => {
    it('clears the wait when somebody other than the requester answers', async () => {
      // DECISION: any human inbound reply clears it. The ball is with us
      // either way, and the alternative leaves a ticket parked in "Awaiting
      // reply" because the wrong person answered — which is the exact bug this
      // card exists to fix, just with an extra step. The inbound path already
      // treats every sender as a requester-shaped actor, so this is also what
      // the code does naturally rather than a special case bolted on.
      const ticket = await makeTicket({
        status: TicketStatus.WAITING_ON_REQUESTER,
      });
      await inboundReply(ticket.displayId, {
        fromEmail: `looped.in.${Date.now()}@example.com`,
      });
      expect(await storedStatus(ticket.id)).toBe(TicketStatus.IN_PROGRESS);
    });
  });

  describe('Gap A — an unassigned waiting ticket', () => {
    it('keeps the reply rather than losing it to an impossible transition', async () => {
      // NOT IN THE CARD, and it would have been a 5xx loop. IN_PROGRESS
      // requires an assignee and is the ONLY non-pause transition out of
      // WAITING_ON_REQUESTER, so an unassigned one has nowhere legal to go.
      // The state is reachable: normalizeStatusAfterTransfer demotes only
      // ASSIGNED and IN_PROGRESS when a team transfer clears the assignee, so
      // transferring a waiting ticket leaves it waiting AND unassigned.
      //
      // Attempting the transition throws BadRequestException before
      // addMessage runs, which releases the idempotency reservation and
      // returns 5xx — so the sender retries into the same state forever and
      // the requester's reply never lands. Skipping keeps the message.
      const ticket = await makeTicket({
        status: TicketStatus.WAITING_ON_REQUESTER,
        assigneeId: null,
      });
      const res = await inboundReply(ticket.displayId, {
        body: 'UNASSIGNED-PROBE this reply must still land.',
      });
      expect(res.status).toBe(201);
      expect(await storedStatus(ticket.id)).toBe(
        TicketStatus.WAITING_ON_REQUESTER,
      );
      const messages = await prisma.ticketMessage.findMany({
        where: { ticketId: ticket.id },
        select: { body: true },
      });
      expect(messages.some((m) => m.body.includes('UNASSIGNED-PROBE'))).toBe(
        true,
      );
      // Gap B still tells the truth here, which is the point of deriving it
      // from the last message rather than reading it off the status.
      const listed = await request(server)
        .get('/api/tickets')
        .set(authHeader(fixtureEmails.agent))
        .expect(200);
      const row = (
        listed.body as { data: { id: string; awaitingAgentReply: boolean }[] }
      ).data.find((t) => t.id === ticket.id);
      expect(row?.awaitingAgentReply).toBe(true);
    });
  });

  describe('Gap B — the list says who owes the next move', () => {
    async function awaitingFlag(ticketId: string): Promise<boolean | undefined> {
      const res = await request(server)
        .get('/api/tickets')
        .set(authHeader(fixtureEmails.agent))
        .expect(200);
      return (
        res.body as { data: { id: string; awaitingAgentReply: boolean }[] }
      ).data.find((t) => t.id === ticketId)?.awaitingAgentReply;
    }

    it('is false on a ticket with no messages at all', async () => {
      const ticket = await makeTicket({ status: TicketStatus.IN_PROGRESS });
      expect(await awaitingFlag(ticket.id)).toBe(false);
    });

    it('is true once the requester has spoken last', async () => {
      const ticket = await makeTicket({ status: TicketStatus.IN_PROGRESS });
      await inboundReply(ticket.displayId);
      expect(await awaitingFlag(ticket.id)).toBe(true);
    });

    it('is false again once an agent replies publicly', async () => {
      const ticket = await makeTicket({ status: TicketStatus.IN_PROGRESS });
      await inboundReply(ticket.displayId);
      expect(await awaitingFlag(ticket.id)).toBe(true);
      await request(server)
        .post(`/api/tickets/${ticket.id}/messages`)
        .set(authHeader(fixtureEmails.agent))
        .send({ body: 'Here is the answer.', type: 'PUBLIC' })
        .expect(201);
      expect(await awaitingFlag(ticket.id)).toBe(false);
    });

    it('stays true when the agent only writes an INTERNAL note', async () => {
      // An internal note is not a reply to the requester, so it must not clear
      // the marker — otherwise a private observation makes the queue forget
      // that somebody is still waiting on us.
      const ticket = await makeTicket({ status: TicketStatus.IN_PROGRESS });
      await inboundReply(ticket.displayId);
      await request(server)
        .post(`/api/tickets/${ticket.id}/messages`)
        .set(authHeader(fixtureEmails.agent))
        .send({ body: 'Checking with payroll first.', type: 'INTERNAL' })
        .expect(201);
      expect(await awaitingFlag(ticket.id)).toBe(true);
    });
  });

  describe('7a — a staff requester mentioned in an internal note', () => {
    it('is not notified about a note they cannot open', async () => {
      // Card 1.36 made canViewTicket true for a ticket's own requester and
      // stopped them reading its internal notes. The mention path filtered by
      // RANK only, so a staff requester passed both checks and was notified
      // about a message that would not be in the thread when they opened it.
      const ticket = await makeTicket({
        status: TicketStatus.IN_PROGRESS,
        requesterId: fixtureUserIds.lead,
      });
      await request(server)
        .post(`/api/tickets/${ticket.id}/messages`)
        .set(authHeader(fixtureEmails.admin))
        .send({
          body: `Internal: asking (user:${fixtureUserIds.lead}) and (user:${fixtureUserIds.agent}) to look.`,
          type: 'INTERNAL',
        })
        .expect(201);
      const notified = await prisma.notification.findMany({
        where: {
          ticketId: ticket.id,
          type: NotificationType.TICKET_MENTIONED,
        },
        select: { userId: true },
      });
      const ids = notified.map((n) => n.userId);
      expect(ids).not.toContain(fixtureUserIds.lead);
      // ...and a teammate mentioned in the same note still is.
      expect(ids).toContain(fixtureUserIds.agent);
    });

    it('still notifies the requester when the note is PUBLIC', async () => {
      const ticket = await makeTicket({
        status: TicketStatus.IN_PROGRESS,
        requesterId: fixtureUserIds.lead,
      });
      await request(server)
        .post(`/api/tickets/${ticket.id}/messages`)
        .set(authHeader(fixtureEmails.admin))
        .send({
          body: `Hello (user:${fixtureUserIds.lead}), any update?`,
          type: MessageType.PUBLIC,
        })
        .expect(201);
      const notified = await prisma.notification.findMany({
        where: {
          ticketId: ticket.id,
          type: NotificationType.TICKET_MENTIONED,
        },
        select: { userId: true },
      });
      expect(notified.map((n) => n.userId)).toContain(fixtureUserIds.lead);
    });
  });
});
