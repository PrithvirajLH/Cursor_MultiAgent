import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { stripQuotedReply } from '../../src/notifications/quoted-reply.util';
import {
  fixtureEmails,
  fixtureTeamIds,
  fixtureUserIds,
} from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

const inboundSecretHeader = { 'x-inbound-email-secret': 'test-inbound-secret' };

type TicketResponse = { id: string; displayId?: string | null };

type InboundEmailResponse = { threaded: boolean; ticket: TicketResponse };

/** A brand-new correspondent, for the "email creates a ticket" case. */
const NEW_SENDER = 'outside.sender@csnhc.com';
/**
 * Replies come from the ticket's own requester. An EMPLOYEE posting on someone
 * else's ticket is refused by addMessage, which is existing behaviour and
 * nothing to do with this card.
 */
const SENDER = fixtureEmails.requester;

async function createTicket(
  server: SupertestApp,
  subject: string,
): Promise<TicketResponse> {
  const response = await request(server)
    .post('/api/tickets')
    .set(authHeader(fixtureEmails.requester))
    .send({
      subject,
      description: 'Email safety rails test ticket',
      priority: 'SEV3',
      channel: 'PORTAL',
      assignedTeamId: fixtureTeamIds.it,
    })
    .expect(201);
  const ticket = response.body as TicketResponse;
  // Assign it: without a recipient other than the sender, "no notification was
  // raised" would pass whether or not the guard works. The assignee is who a
  // reply from the requester is supposed to reach.
  await request(server)
    .post(`/api/tickets/${ticket.id}/assign`)
    .set(authHeader(fixtureEmails.lead))
    .send({ assigneeId: fixtureUserIds.agent })
    .expect(201);
  return ticket;
}

describe('Email safety rails', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let prisma: PrismaService;
  let messageSeq = 0;

  const nextMessageId = () => `<safety-${Date.now()}-${(messageSeq += 1)}@csnhc.com>`;

  const outboxCount = (ticketId: string) =>
    prisma.notificationOutbox.count({ where: { ticketId } });

  const suppressionEvents = (ticketId: string) =>
    prisma.ticketEvent.findMany({
      where: { ticketId, type: 'INBOUND_EMAIL_SUPPRESSED' },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('records an auto-reply on a new ticket and answers it with silence', async () => {
    const response = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: NEW_SENDER,
        fromName: 'Outside Sender',
        subject: 'Automatic reply: Out of office',
        body: 'I am away until Monday.',
        messageId: nextMessageId(),
        autoSubmitted: 'auto-replied',
      })
      .expect(201);

    const { ticket } = response.body as InboundEmailResponse;
    // The ticket exists: an out-of-office is still information about the request.
    expect(ticket.id).toBeTruthy();
    // The acknowledgement is the message that would have started the loop.
    expect(await outboxCount(ticket.id)).toBe(0);
    const events = await suppressionEvents(ticket.id);
    expect(events).toHaveLength(1);
    expect((events[0].payload as { reason?: string }).reason).toBe('automated');
  });

  it('records an auto-reply on an existing ticket and raises no notification', async () => {
    const ticket = await createTicket(server, 'Auto reply to an open ticket');
    const before = await outboxCount(ticket.id);

    await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: SENDER,
        subject: `Re: ${ticket.displayId} update`,
        body: 'I am away until Monday.',
        messageId: nextMessageId(),
        autoSubmitted: 'auto-generated',
      })
      .expect(201);

    expect(await outboxCount(ticket.id)).toBe(before);
    const messages = await prisma.ticketMessage.findMany({
      where: { ticketId: ticket.id },
    });
    expect(messages.some((m) => m.body.includes('away until Monday'))).toBe(true);
    const events = await suppressionEvents(ticket.id);
    expect(events).toHaveLength(1);
    expect((events[0].payload as { reason?: string }).reason).toBe('automated');
  });

  it('stops answering a sender past the rate cap, but still records them', async () => {
    const ticket = await createTicket(server, 'Rate capped sender');
    for (let index = 1; index <= 5; index += 1) {
      await request(server)
        .post('/api/tickets/inbound-email')
        .set(inboundSecretHeader)
        .send({
          fromEmail: SENDER,
          subject: `Re: ${ticket.displayId} update`,
          body: `Message number ${index}`,
          messageId: nextMessageId(),
        })
        .expect(201);
    }
    const afterFive = await outboxCount(ticket.id);
    expect(await suppressionEvents(ticket.id)).toHaveLength(0);

    await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: SENDER,
        subject: `Re: ${ticket.displayId} update`,
        body: 'Message number 6',
        messageId: nextMessageId(),
      })
      .expect(201);

    expect(await outboxCount(ticket.id)).toBe(afterFive);
    const messages = await prisma.ticketMessage.findMany({
      where: { ticketId: ticket.id },
    });
    expect(messages.some((m) => m.body.includes('Message number 6'))).toBe(true);
    const events = await suppressionEvents(ticket.id);
    expect(events).toHaveLength(1);
    expect((events[0].payload as { reason?: string }).reason).toBe('rate_limited');
  });

  it('stores a quoted reply in full and only trims it for display', async () => {
    const ticket = await createTicket(server, 'Quoted reply handling');
    const typed = 'That fixed it, thank you.';
    const quoted = [
      typed,
      '',
      'On Mon, 1 Sep 2026 at 11:42, CSNHC Helpdesk <helpdesk@csnhc.com> wrote:',
      '> Please confirm the printer is working.',
      '> Ticket ID: ' + ticket.displayId,
    ].join('\n');

    await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: SENDER,
        subject: `Re: ${ticket.displayId} update`,
        body: quoted,
        messageId: nextMessageId(),
      })
      .expect(201);

    const message = await prisma.ticketMessage.findFirst({
      where: { ticketId: ticket.id, body: { contains: 'That fixed it' } },
    });
    // Stored complete: the quote is part of the record an audit may need.
    expect(message?.body).toBe(quoted);
    expect(message?.body).toContain('Please confirm the printer is working.');
    // Trimmed only when shown.
    expect(stripQuotedReply(message?.body ?? '')).toBe(typed);
  });

  it('behaves exactly as before when none of the new headers are present', async () => {
    const ticket = await createTicket(server, 'Ordinary human reply');
    const before = await outboxCount(ticket.id);

    await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: SENDER,
        subject: `Re: ${ticket.displayId} update`,
        body: 'Any update on this please?',
        messageId: nextMessageId(),
      })
      .expect(201);

    // REWRITTEN BY CARD 1.42. This asserted the outbox grew, as a proxy for
    // "an ordinary reply is processed normally". That proxy no longer holds and
    // the new behaviour is correct: the inbound sender IS the requester, so
    // after card 1.42 the only people left are staff, and staff are not
    // emailed - the reply is on their screen with a bell.
    //
    // The intent of the test is that card 1.22's header handling is ADDITIVE,
    // so the proxy moves to what actually proves the reply was processed: the
    // message is stored and the in-app notification fires.
    void before;
    const stored = await prisma.ticketMessage.findFirst({
      where: { ticketId: ticket.id, body: { contains: 'Any update on this' } },
    });
    expect(stored).toBeTruthy();
    const bells = await prisma.notification.findMany({
      where: { ticketId: ticket.id, type: 'NEW_MESSAGE' },
    });
    expect(bells.length).toBeGreaterThan(0);
    expect(await suppressionEvents(ticket.id)).toHaveLength(0);
  });

  it('drops an out-of-domain recipient from the CC and says so on the ticket', async () => {
    // INHERITED FROM CARD 1.33, which shipped this path untested. Card 1.33
    // moved the domain check to compose time, so an out-of-domain colleague now
    // drops out of the Cc and everyone else still gets the email. The
    // EMAIL_RECIPIENT_REFUSED event it writes is the ONLY way an agent ever
    // learns somebody did not receive their reply - and the write is wrapped in
    // a .catch() that only logs, so if it broke, nothing would look wrong.
    const ticket = await createTicket(server, 'Out of domain colleague');
    const outsider = await prisma.user.create({
      data: {
        email: `outside.colleague.${Date.now()}@gmail.com`,
        displayName: 'Outside Colleague',
        role: 'EMPLOYEE',
      },
    });
    await prisma.ticketFollower.create({
      data: { ticketId: ticket.id, userId: outsider.id },
    });
    const before = await outboxCount(ticket.id);

    await request(server)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set(authHeader(fixtureEmails.owner))
      .send({ body: 'Here is the answer.', type: 'PUBLIC' })
      .expect(201);

    // (a) the email still went out, to everyone who was allowed
    expect(await outboxCount(ticket.id)).toBeGreaterThan(before);
    const rows = await prisma.notificationOutbox.findMany({
      where: { ticketId: ticket.id, eventType: 'MESSAGE_ADDED' },
    });
    expect(rows).toHaveLength(1);
    const envelope = rows[0].payload as { email?: { cc?: string[] } } | null;
    const cc = envelope?.email?.cc ?? [];
    expect(cc).not.toContain(outsider.email);

    // (b) and the ticket records who did not get it, with the address
    const refusals = await prisma.ticketEvent.findMany({
      where: { ticketId: ticket.id, type: 'EMAIL_RECIPIENT_REFUSED' },
    });
    expect(refusals).toHaveLength(1);
    const payload = refusals[0].payload as {
      refused?: Array<{ address: string; reason: string }>;
    };
    expect(payload.refused).toEqual([
      { address: outsider.email, reason: 'outside the allowed domains' },
    ]);
  });

  it('still refuses an inbound email with a bad secret', async () => {
    await request(server)
      .post('/api/tickets/inbound-email')
      .set({ 'x-inbound-email-secret': 'wrong' })
      .send({
        fromEmail: NEW_SENDER,
        subject: 'Should not be accepted',
        body: 'nope',
        messageId: nextMessageId(),
      })
      .expect(403);
  });
});
