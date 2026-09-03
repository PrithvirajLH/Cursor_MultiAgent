import { INestApplication } from '@nestjs/common';
import { MessageType, TicketStatus } from '@prisma/client';
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

const inboundSecretHeader = { 'x-inbound-email-secret': 'test-inbound-secret' };

function authHeader(email: string) {
  return { 'x-user-email': email };
}

/**
 * Card 1.40 — a looped-in person's reply was refused and lost.
 *
 * Cards 1.33 and 1.28 built the outbound half of "people looping in should stay
 * within the ticket": a public reply goes to the requester with everyone else on
 * Cc. So the system was inviting people into a conversation it would then refuse
 * to hear from — 403, nothing stored, nobody told.
 *
 * Every assertion here checks the RESPONSE CODE and the ROW COUNT before the
 * status. Card 1.29's own test asserted only the stored status and passed on the
 * bug it existed to catch.
 */
describe('A looped-in reply', () => {
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
  const unique = () => {
    seq += 1;
    return `${Date.now()}${seq}`;
  };

  async function makeTicket(overrides: Record<string, unknown> = {}) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        requesterId: fixtureUserIds.requester,
        subject: `1.40 fixture ${seq}`,
        description: 'Fixture for looped-in replies.',
        assignedTeamId: fixtureTeamIds.it,
        assigneeId: fixtureUserIds.agent,
        displayId: `IS_20260903_${String(700 + seq).padStart(3, '0')}`,
        ...overrides,
      },
      select: { id: true, displayId: true },
    });
  }

  function inbound(
    displayId: string | null,
    fromEmail: string,
    extra: Record<string, unknown> = {},
  ) {
    return request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail,
        fromName: 'Looped In',
        subject: `Re: ${displayId} checking`,
        body: 'THE LOOPED IN REPLY.',
        messageId: `looped-${unique()}@mail.example`,
        ...extra,
      });
  }

  const messagesOf = (ticketId: string) =>
    prisma.ticketMessage.findMany({
      where: { ticketId },
      select: { body: true, type: true, authorId: true },
    });

  describe('somebody we actually emailed', () => {
    it('lands a FOLLOWER reply on the ticket, attributed to them', async () => {
      const ticket = await makeTicket();
      const follower = await prisma.user.create({
        data: {
          email: `cc.colleague.${unique()}@company.com`,
          displayName: 'CC Colleague',
          role: 'EMPLOYEE',
        },
      });
      await prisma.ticketFollower.create({
        data: { ticketId: ticket.id, userId: follower.id },
      });

      const res = await inbound(ticket.displayId, follower.email);
      expect(res.status).toBe(201);
      expect((res.body as { threaded: boolean }).threaded).toBe(true);

      const messages = await messagesOf(ticket.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].body).toContain('THE LOOPED IN REPLY.');
      expect(messages[0].type).toBe(MessageType.PUBLIC);
      expect(messages[0].authorId).toBe(follower.id);
    });

    it('lands the ASSIGNEE replying by email', async () => {
      const ticket = await makeTicket();
      const res = await inbound(ticket.displayId, fixtureEmails.agent);
      expect(res.status).toBe(201);
      expect(await messagesOf(ticket.id)).toHaveLength(1);
    });

    it('still lands the REQUESTER, unchanged from before this card', async () => {
      const ticket = await makeTicket();
      const res = await inbound(ticket.displayId, fixtureEmails.requester);
      expect(res.status).toBe(201);
      const messages = await messagesOf(ticket.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].authorId).toBe(fixtureUserIds.requester);
    });

    it('makes the replier a follower, so they get the rest of the thread', async () => {
      const ticket = await makeTicket();
      const follower = await prisma.user.create({
        data: {
          email: `promoted.${unique()}@company.com`,
          displayName: 'Promoted',
          role: 'EMPLOYEE',
        },
      });
      await prisma.ticketFollower.create({
        data: { ticketId: ticket.id, userId: follower.id },
      });
      await inbound(ticket.displayId, follower.email);
      expect(
        await prisma.ticketFollower.count({
          where: { ticketId: ticket.id, userId: follower.id },
        }),
      ).toBe(1);
    });

    it('does NOT give them sight of internal notes', async () => {
      // Card 1.36's read filter governs this and is untouched.
      const ticket = await makeTicket();
      const follower = await prisma.user.create({
        data: {
          email: `nosy.${unique()}@company.com`,
          displayName: 'Nosy Colleague',
          role: 'EMPLOYEE',
        },
      });
      await prisma.ticketFollower.create({
        data: { ticketId: ticket.id, userId: follower.id },
      });
      await prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          authorId: fixtureUserIds.admin,
          body: 'INTERNAL-ONLY do not show this to the colleague.',
          type: MessageType.INTERNAL,
        },
      });
      await inbound(ticket.displayId, follower.email);

      // Replying by email does not widen what they can READ. Card 1.36's
      // filter gives an EMPLOYEE only the tickets they requested, and being a
      // follower does not change that - so a looped-in colleague cannot open
      // the ticket at all, let alone its internal notes. That rule is
      // untouched here, and it is stronger than the card's requirement.
      await request(server)
        .get(`/api/tickets/${ticket.id}/messages`)
        .set(authHeader(follower.email))
        .expect(403);

      // And their own message went in PUBLIC, not internal.
      const stored = await messagesOf(ticket.id);
      const theirs = stored.filter((m) => m.authorId === follower.id);
      expect(theirs).toHaveLength(1);
      expect(theirs[0].type).toBe(MessageType.PUBLIC);
      // The internal note is still there, and still theirs to not see.
      expect(
        stored.some((m) => m.type === MessageType.INTERNAL),
      ).toBe(true);
    });
  });

  describe('somebody in no relationship to the ticket', () => {
    it('is refused: no message stored, but an event recorded (§4.3)', async () => {
      const ticket = await makeTicket();
      const stranger = `stranger.${unique()}@example.com`;

      const res = await inbound(ticket.displayId, stranger);
      // 201, not an error: the mail HAS been handled, and a failure code would
      // only make the sender's server retry forever.
      expect(res.status).toBe(201);

      // The row count is the assertion that matters.
      expect(await messagesOf(ticket.id)).toHaveLength(0);

      const events = await prisma.ticketEvent.findMany({
        where: {
          ticketId: ticket.id,
          type: 'INBOUND_REPLY_FROM_UNKNOWN_SENDER',
        },
        select: { payload: true },
      });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ fromEmail: stranger });
      // The BODY is never stored.
      expect(JSON.stringify(events[0].payload)).not.toContain(
        'THE LOOPED IN REPLY.',
      );
    });

    it('is not made a follower by trying', async () => {
      const ticket = await makeTicket();
      const stranger = `stranger.${unique()}@example.com`;
      await inbound(ticket.displayId, stranger);
      const user = await prisma.user.findUnique({
        where: { email: stranger.toLowerCase() },
        select: { id: true },
      });
      expect(user).not.toBeNull();
      expect(
        await prisma.ticketFollower.count({
          where: { ticketId: ticket.id, userId: user!.id },
        }),
      ).toBe(0);
    });

    it('knowing the reply address is not enough — the SENDER is what is matched', async () => {
      // §4.2: the token in the address is a bearer token every participant can
      // forward. It says which ticket, never who may write.
      const ticket = await makeTicket();
      const forwarded = `forwarded.${unique()}@example.com`;
      const res = await inbound(ticket.displayId, forwarded);
      expect(res.status).toBe(201);
      expect(await messagesOf(ticket.id)).toHaveLength(0);
    });
  });

  describe('what card 1.29 established stays established', () => {
    it('a follower reply clears WAITING_ON_REQUESTER, message first', async () => {
      const ticket = await makeTicket({
        status: TicketStatus.WAITING_ON_REQUESTER,
      });
      const follower = await prisma.user.create({
        data: {
          email: `waiting.${unique()}@company.com`,
          displayName: 'Waiting Colleague',
          role: 'EMPLOYEE',
        },
      });
      await prisma.ticketFollower.create({
        data: { ticketId: ticket.id, userId: follower.id },
      });

      const res = await inbound(ticket.displayId, follower.email);
      expect(res.status).toBe(201);
      // Message first, then status: a status derived from a message must not
      // outlive the message.
      expect(await messagesOf(ticket.id)).toHaveLength(1);
      const after = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { status: true },
      });
      expect(after.status).toBe(TicketStatus.IN_PROGRESS);
    });

    it("a stranger's reply moves no status at all", async () => {
      const ticket = await makeTicket({
        status: TicketStatus.WAITING_ON_REQUESTER,
      });
      await inbound(ticket.displayId, `stranger.${unique()}@example.com`);
      expect(await messagesOf(ticket.id)).toHaveLength(0);
      const after = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { status: true },
      });
      expect(after.status).toBe(TicketStatus.WAITING_ON_REQUESTER);
    });

    it("a follower's out-of-office still does not move the status", async () => {
      const ticket = await makeTicket({
        status: TicketStatus.WAITING_ON_REQUESTER,
      });
      const follower = await prisma.user.create({
        data: {
          email: `ooo.${unique()}@company.com`,
          displayName: 'Out Of Office',
          role: 'EMPLOYEE',
        },
      });
      await prisma.ticketFollower.create({
        data: { ticketId: ticket.id, userId: follower.id },
      });

      const res = await inbound(ticket.displayId, follower.email, {
        autoSubmitted: 'auto-replied',
      });
      expect(res.status).toBe(201);
      // The message is still recorded - an agent should see the bounce arrived.
      expect(await messagesOf(ticket.id)).toHaveLength(1);
      const after = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { status: true },
      });
      expect(after.status).toBe(TicketStatus.WAITING_ON_REQUESTER);
    });
  });
});
