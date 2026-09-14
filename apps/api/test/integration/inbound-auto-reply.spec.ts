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

const inboundSecretHeader = { 'x-inbound-email-secret': 'test-inbound-secret' };

type TicketResponse = {
  id: string;
  displayId?: string | null;
  status?: string | null;
};

/**
 * Card 1.80 — an out-of-office must not reopen finished work.
 *
 * The `RESOLVED || CLOSED -> REOPENED` branch had no `!automated` gate, so a
 * mail server bouncing off our "we have resolved this" put the ticket back on
 * the board. The reasoning was already written one branch below, for
 * WAITING_ON_REQUESTER: an autoresponder answering our acknowledgement is not
 * the requester answering our question. It applies with more force here.
 */
describe('an auto-reply does not reopen a ticket (card 1.80)', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  /** A resolved ticket owned by the fixture requester. */
  const resolvedTicket = async (subject: string) => {
    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject,
        description: 'card 1.80 fixture',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    const ticket = created.body as TicketResponse;
    // RESOLVED needs an assignee, as tickets.inbound-email.spec.ts does it.
    await request(server)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set(authHeader(fixtureEmails.owner))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);
    await request(server)
      .post(`/api/tickets/${ticket.id}/transition`)
      .set(authHeader(fixtureEmails.owner))
      .send({ status: 'RESOLVED' })
      .expect(201);
    return ticket;
  };

  const inbound = async (
    ticket: TicketResponse,
    body: string,
    headers: Record<string, string> = {},
  ) =>
    request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: fixtureEmails.requester,
        fromName: 'Fixture Requester',
        subject: `Re: ${ticket.displayId} update`,
        body,
        messageId: `c180-${Date.now()}-${Math.random()}@mail.example`,
        ...headers,
      })
      .expect(201);

  const statusOf = async (id: string) =>
    getPrisma().ticket.findUniqueOrThrow({
      where: { id },
      select: { status: true, resolvedAt: true, completedAt: true },
    });

  it('⚠️ an auto-reply leaves it RESOLVED, and resolvedAt untouched', async () => {
    // THE REGRESSION ASSERTION. Work that was finished must not come back to
    // the board because a mail server answered.
    const ticket = await resolvedTicket('c180 autoresponder');
    const before = await statusOf(ticket.id);
    await inbound(ticket, 'I am out of the office until Monday.', {
      autoSubmitted: 'auto-replied',
    });
    const after = await statusOf(ticket.id);
    expect(after.status).toBe('RESOLVED');
    expect(after.resolvedAt?.toISOString()).toBe(
      before.resolvedAt?.toISOString(),
    );
    expect(after.completedAt?.toISOString()).toBe(
      before.completedAt?.toISOString(),
    );
  });

  it('⚠️ a GENUINE human reply still reopens it', async () => {
    // The non-vacuity half, and the thing most at risk from a careless fix. A
    // gate that swallowed every reply would pass the test above and break the
    // feature that matters.
    const ticket = await resolvedTicket('c180 human reply');
    await inbound(ticket, 'It is still broken, please look again.');
    expect((await statusOf(ticket.id)).status).toBe('REOPENED');
  });

  it('⚠️ the message is stored either way — suppressing a transition is not suppressing content', async () => {
    const ticket = await resolvedTicket('c180 content kept');
    const body = `Automatic reply: away until Monday ${Date.now()}`;
    await inbound(ticket, body, { autoSubmitted: 'auto-replied' });
    const messages = await request(server)
      .get(`/api/tickets/${ticket.id}/messages`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    expect(JSON.stringify(messages.body)).toContain('away until Monday');
  });

  it('⚠️ says on the timeline that it ignored an autoresponder', async () => {
    // A silent decision is a mystery: an agent needs to see why a reply
    // changed nothing.
    const ticket = await resolvedTicket('c180 visible decision');
    await inbound(ticket, 'Out of office.', { autoSubmitted: 'auto-replied' });
    const event = await getPrisma().ticketEvent.findFirst({
      where: { ticketId: ticket.id, type: 'INBOUND_EMAIL_RECEIVED' },
      orderBy: { createdAt: 'desc' },
      select: { payload: true },
    });
    expect(JSON.stringify(event?.payload)).toContain('statusChangeSkipped');
    expect(JSON.stringify(event?.payload)).toContain('automated');
    // ...and the flag must not be able to claim a skip that did not happen.
    expect((await statusOf(ticket.id)).status).toBe('RESOLVED');
  });

  it('does not stamp that on an ordinary reply', async () => {
    // The flag means something only if it is absent when nothing was withheld.
    const ticket = await resolvedTicket('c180 no flag');
    await inbound(ticket, 'Still broken.');
    const event = await getPrisma().ticketEvent.findFirst({
      where: { ticketId: ticket.id, type: 'INBOUND_EMAIL_RECEIVED' },
      orderBy: { createdAt: 'desc' },
      select: { payload: true },
    });
    expect(JSON.stringify(event?.payload)).not.toContain('statusChangeSkipped');
  });

  it('a bounce with a null reverse-path does not reopen either', async () => {
    // The other common shape of machine mail: Return-Path <>.
    const ticket = await resolvedTicket('c180 bounce');
    await inbound(ticket, 'Undeliverable.', { returnPath: '<>' });
    expect((await statusOf(ticket.id)).status).toBe('RESOLVED');
  });
});
