import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
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
 * Card 1.11 — removing a message that should not have been sent.
 *
 * The test that matters most here is the one asserting the original body is
 * GONE, not moved. The card's design preserved it in a TicketEvent; this
 * implementation deliberately does not, because a healthcare desk redacts
 * precisely when something landed where it should not be, and copying that
 * text into an audit row relocates the PHI into a row with weaker read rules
 * than the message it came from. The audit records that a redaction happened -
 * who, when, which message, whether it had already been emailed - and not the
 * content.
 */
describe('Message redaction (card 1.11)', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;

  let seq = 0;
  const unique = () => {
    seq += 1;
    return `${Date.now()}${seq}`;
  };

  const SECRET = 'Patient 12345 has a diagnosis of something private';

  async function plantTicket(teamId: string | null = fixtureTeamIds.it) {
    return prisma.ticket.create({
      data: {
        subject: `Redaction fixture ${unique()}`,
        description: 'Fixture',
        requesterId: fixtureUserIds.requester,
        assignedTeamId: teamId,
        assigneeId: teamId === fixtureTeamIds.it ? fixtureUserIds.agent : null,
        status: 'IN_PROGRESS',
      },
      select: { id: true },
    });
  }

  async function plantMessage(
    ticketId: string,
    opts: {
      authorId?: string;
      type?: 'PUBLIC' | 'INTERNAL';
      minutesAgo?: number;
      body?: string;
    } = {},
  ) {
    return prisma.ticketMessage.create({
      data: {
        ticketId,
        authorId: opts.authorId ?? fixtureUserIds.agent,
        type: opts.type ?? 'INTERNAL',
        body: opts.body ?? SECRET,
        createdAt: new Date(Date.now() - (opts.minutesAgo ?? 0) * 60_000),
      },
      select: { id: true },
    });
  }

  const redact = (ticketId: string, messageId: string, email: string) =>
    request(server)
      .delete(`/api/tickets/${ticketId}/messages/${messageId}`)
      .set(authHeader(email));

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  describe('who may remove one', () => {
    it('lets the author, inside the window', async () => {
      const ticket = await plantTicket();
      const msg = await plantMessage(ticket.id, { minutesAgo: 2 });
      const res = await redact(ticket.id, msg.id, fixtureEmails.agent);
      expect(res.status).toBe(200);
      const after = await prisma.ticketMessage.findUniqueOrThrow({
        where: { id: msg.id },
        select: { body: true, redactedAt: true, redactedById: true },
      });
      expect(after.body).toMatch(/^\[message removed by .+\]$/);
      expect(after.redactedAt).not.toBeNull();
      expect(after.redactedById).toBe(fixtureUserIds.agent);
    });

    it('refuses the author once the window has passed', async () => {
      const ticket = await plantTicket();
      const msg = await plantMessage(ticket.id, { minutesAgo: 60 });
      const res = await redact(ticket.id, msg.id, fixtureEmails.agent);
      expect(res.status).toBe(403);
      // And it says what to do instead, rather than just "forbidden".
      expect(String(res.body.message)).toContain('lead');
      expect(
        (
          await prisma.ticketMessage.findUniqueOrThrow({
            where: { id: msg.id },
            select: { body: true },
          })
        ).body,
      ).toBe(SECRET);
    });

    it('lets a LEAD remove somebody else\'s, at any age', async () => {
      const ticket = await plantTicket();
      const msg = await plantMessage(ticket.id, { minutesAgo: 60 * 24 * 30 });
      const res = await redact(ticket.id, msg.id, fixtureEmails.lead);
      expect(res.status).toBe(200);
    });

    it('refuses a peer AGENT who did not write it', async () => {
      const ticket = await plantTicket();
      const msg = await plantMessage(ticket.id, {
        authorId: fixtureUserIds.lead,
        minutesAgo: 1,
      });
      const res = await redact(ticket.id, msg.id, fixtureEmails.agent);
      expect(res.status).toBe(403);
    });

    it('⚠️ refuses a LEAD of ANOTHER team - seniority is not a way past the boundary', async () => {
      const ticket = await plantTicket(fixtureTeamIds.hr);
      const msg = await plantMessage(ticket.id, {
        authorId: fixtureUserIds.lead,
        minutesAgo: 1,
      });
      // The IT lead cannot even see this ticket, so it is 404, not 403 - the
      // same rule the rest of the ticket API follows.
      const res = await redact(ticket.id, msg.id, fixtureEmails.lead);
      expect(res.status).toBe(404);
      expect(
        (
          await prisma.ticketMessage.findUniqueOrThrow({
            where: { id: msg.id },
            select: { body: true },
          })
        ).body,
      ).toBe(SECRET);
    });

    it('refuses a second removal rather than writing a second event', async () => {
      const ticket = await plantTicket();
      const msg = await plantMessage(ticket.id, { minutesAgo: 1 });
      await redact(ticket.id, msg.id, fixtureEmails.agent).expect(200);
      const res = await redact(ticket.id, msg.id, fixtureEmails.lead);
      expect(res.status).toBe(400);
      expect(
        await prisma.ticketEvent.count({
          where: { ticketId: ticket.id, type: 'TICKET_MESSAGE_REDACTED' },
        }),
      ).toBe(1);
    });

    it('404s for a message on a different ticket', async () => {
      const a = await plantTicket();
      const b = await plantTicket();
      const msg = await plantMessage(b.id, { minutesAgo: 1 });
      const res = await redact(a.id, msg.id, fixtureEmails.lead);
      expect(res.status).toBe(404);
    });
  });

  describe('⚠️ the original does not survive anywhere', () => {
    it('is not in the message, the event payload, or any event at all', async () => {
      const ticket = await plantTicket();
      const msg = await plantMessage(ticket.id, { minutesAgo: 1 });
      await redact(ticket.id, msg.id, fixtureEmails.lead).expect(200);

      const after = await prisma.ticketMessage.findUniqueOrThrow({
        where: { id: msg.id },
        select: { body: true },
      });
      expect(after.body).not.toContain('12345');

      // The audit event exists and names what happened, but carries no body.
      const events = await prisma.ticketEvent.findMany({
        where: { ticketId: ticket.id, type: 'TICKET_MESSAGE_REDACTED' },
        select: { payload: true, createdById: true },
      });
      expect(events).toHaveLength(1);
      const payload = events[0].payload as Record<string, unknown>;
      expect(payload.messageId).toBe(msg.id);
      expect(payload.messageType).toBe('INTERNAL');
      expect(payload.authorId).toBe(fixtureUserIds.agent);
      expect(events[0].createdById).toBe(fixtureUserIds.lead);
      expect(JSON.stringify(payload)).not.toContain('12345');

      // And nowhere else in the events table either - this is the assertion
      // that would fail if somebody "improved" this by preserving the text.
      const allEvents = await prisma.ticketEvent.findMany({
        where: { ticketId: ticket.id },
        select: { payload: true },
      });
      expect(JSON.stringify(allEvents)).not.toContain('12345');
    });

    it('is gone from the conversation the API serves', async () => {
      const ticket = await plantTicket();
      const msg = await plantMessage(ticket.id, {
        type: 'PUBLIC',
        minutesAgo: 1,
      });
      await redact(ticket.id, msg.id, fixtureEmails.lead).expect(200);
      const res = await request(server)
        .get(`/api/tickets/${ticket.id}/messages`)
        .set(authHeader(fixtureEmails.lead))
        .expect(200);
      expect(JSON.stringify(res.body)).not.toContain('12345');
      const row = (res.body.data as { id: string; redactedAt: string | null }[]).find(
        (m) => m.id === msg.id,
      );
      expect(row?.redactedAt).toBeTruthy();
    });
  });

  describe('visibility is unchanged', () => {
    it('a redacted INTERNAL note stays invisible to the requester', async () => {
      // Card 1.36: a redacted message must not become MORE visible than the
      // original was. `type` is not touched, so this holds by construction -
      // and this test is what would catch it if someone changed that.
      const ticket = await plantTicket();
      const msg = await plantMessage(ticket.id, {
        type: 'INTERNAL',
        minutesAgo: 1,
      });
      await redact(ticket.id, msg.id, fixtureEmails.lead).expect(200);
      const res = await request(server)
        .get(`/api/tickets/${ticket.id}/messages`)
        .set(authHeader(fixtureEmails.requester))
        .expect(200);
      const ids = (res.body.data as { id: string }[]).map((m) => m.id);
      expect(ids).not.toContain(msg.id);
    });
  });

  describe('the email that already went', () => {
    it('says so for a PUBLIC message that was really sent', async () => {
      const ticket = await plantTicket();
      const msg = await plantMessage(ticket.id, {
        type: 'PUBLIC',
        minutesAgo: 1,
      });
      // A SENT outbox row carrying this message id, exactly the shape
      // messageDeliveryLabels reads.
      await prisma.notificationOutbox.create({
        data: {
          // The eventType the real send uses (notifications.service.ts:937);
          // messageDeliveryLabels filters on it, so a made-up name here would
          // have tested nothing.
          eventType: 'MESSAGE_ADDED',
          toEmail: 'requester@company.com',
          ticketId: ticket.id,
          subject: 'Re: fixture',
          body: 'fixture',
          status: 'SENT',
          payload: { event: { messageId: msg.id }, email: { cc: [] } },
        },
      });
      const res = await redact(ticket.id, msg.id, fixtureEmails.lead).expect(
        200,
      );
      expect(res.body.alreadyEmailed).toBe(true);
      const event = await prisma.ticketEvent.findFirstOrThrow({
        where: { ticketId: ticket.id, type: 'TICKET_MESSAGE_REDACTED' },
        select: { payload: true },
      });
      expect((event.payload as { alreadyEmailed: boolean }).alreadyEmailed).toBe(
        true,
      );
    });

    it('says nothing of the sort for an INTERNAL note', async () => {
      // Card 1.42 emails no internal notes, so there is no caveat to make.
      const ticket = await plantTicket();
      const msg = await plantMessage(ticket.id, {
        type: 'INTERNAL',
        minutesAgo: 1,
      });
      const res = await redact(ticket.id, msg.id, fixtureEmails.lead).expect(
        200,
      );
      expect(res.body.alreadyEmailed).toBe(false);
    });

    it('does not claim an email went when the send FAILED', async () => {
      const ticket = await plantTicket();
      const msg = await plantMessage(ticket.id, {
        type: 'PUBLIC',
        minutesAgo: 1,
      });
      await prisma.notificationOutbox.create({
        data: {
          eventType: 'MESSAGE_ADDED',
          toEmail: 'requester@company.com',
          ticketId: ticket.id,
          subject: 'Re: fixture',
          body: 'fixture',
          status: 'FAILED',
          payload: { event: { messageId: msg.id }, email: { cc: [] } },
        },
      });
      const res = await redact(ticket.id, msg.id, fixtureEmails.lead).expect(
        200,
      );
      expect(res.body.alreadyEmailed).toBe(false);
    });
  });
});
