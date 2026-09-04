import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { buildTicketRootMessageId } from '../../src/notifications/email-threading.util';
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

type EmailHeaders = {
  replyTo?: string;
  inReplyTo?: string;
  references?: string[];
  cc?: string[];
};

/** The composed headers as they were queued, off the outbox row's payload. */
function headersOf(payload: unknown): EmailHeaders {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const email = (payload as { email?: unknown }).email;
  if (!email || typeof email !== 'object' || Array.isArray(email)) {
    return {};
  }
  return email as EmailHeaders;
}

describe('Email threading', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let prisma: PrismaService;

  async function createAssignedTicket(): Promise<TicketResponse> {
    const response = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `Threading ${Date.now()}-${Math.random()}`,
        description: 'One conversation, please.',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    const ticket = response.body as TicketResponse;
    await request(server)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set(authHeader(fixtureEmails.lead))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);
    // UPDATED BY CARD 1.42. The comment here used to read "an assignee gives
    // the public reply somebody to CC" - it no longer does, because staff are
    // not emailed at all now. A NON-STAFF follower is what gives the reply a
    // Cc, so the one-email-with-a-Cc shape this suite protects still has
    // something to protect.
    await request(server)
      .post(`/api/tickets/${ticket.id}/followers`)
      .set(authHeader(fixtureEmails.lead))
      .send({ userId: fixtureUserIds.otherRequester })
      .expect(201);
    return ticket;
  }

  const reply = (ticketId: string, body: string, type = 'PUBLIC') =>
    request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.owner))
      .send({ body, type })
      .expect(201);

  const messageRows = (ticketId: string) =>
    prisma.notificationOutbox.findMany({
      where: { ticketId, eventType: 'MESSAGE_ADDED' },
      orderBy: { createdAt: 'asc' },
    });

  async function rootFor(ticketId: string): Promise<string> {
    const thread = await prisma.ticketEmailThread.findUnique({
      where: { ticketId },
      select: { replyToken: true },
    });
    const replyTo = `helpdesk+ticket-${thread?.replyToken}@csnhc.com`;
    return buildTicketRootMessageId(thread?.replyToken ?? '', replyTo);
  }

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends one email per public reply, with the others on CC', async () => {
    const ticket = await createAssignedTicket();
    await reply(ticket.id, 'Looking into this now.');
    const rows = await messageRows(ticket.id);
    // One row, not one per recipient: that is what removes the per-recipient
    // Message-ID divergence entirely.
    expect(rows).toHaveLength(1);
    expect(rows[0].toEmail).toBe(fixtureEmails.requester);
    // The Cc is the external colleague. Card 1.42: the AGENT assignee is on
    // this ticket and is deliberately NOT on the email - the reply is already
    // on her screen with a bell.
    const cc = headersOf(rows[0].payload).cc ?? [];
    expect(cc).toContain(fixtureEmails.otherRequester);
    expect(cc).not.toContain(fixtureEmails.agent);
  });

  it('threads two replies onto the same root, and grows References', async () => {
    const ticket = await createAssignedTicket();
    await reply(ticket.id, 'First reply.');
    await reply(ticket.id, 'Second reply.');
    const rows = await messageRows(ticket.id);
    expect(rows).toHaveLength(2);
    const root = await rootFor(ticket.id);
    const first = headersOf(rows[0].payload);
    const second = headersOf(rows[1].payload);
    expect(first.references?.[0]).toBe(root);
    expect(second.references?.[0]).toBe(root);
    // Neither may carry an unroutable id.
    for (const headers of [first, second]) {
      expect(
        (headers.references ?? []).some((id) => id.includes('@localhost')),
      ).toBe(false);
      expect(headers.inReplyTo ?? '').not.toContain('@localhost');
    }
  });

  it('sends no email at all for an internal note, and does not disturb the thread', async () => {
    const ticket = await createAssignedTicket();
    await reply(ticket.id, 'Public one.');
    await reply(ticket.id, 'Internal: chasing the vendor.', 'INTERNAL');
    await reply(ticket.id, 'Public two.');
    const rows = await messageRows(ticket.id);
    // Two rows, not three: the internal note queued nothing.
    expect(rows).toHaveLength(2);
    const bodies = rows.map((row) => row.body).join('\n');
    expect(bodies).not.toContain('chasing the vendor');
    const root = await rootFor(ticket.id);
    for (const row of rows) {
      expect(headersOf(row.payload).references?.[0]).toBe(root);
    }
    // And the note is still on the ticket for staff to read.
    const messages = await prisma.ticketMessage.findMany({
      where: { ticketId: ticket.id },
    });
    expect(
      messages.some((m) => m.body.includes('chasing the vendor')),
    ).toBe(true);
  });

  it('records no thread pointer for a message that was never sent', async () => {
    // SMTP is unconfigured in the suite, so nothing is ever delivered. The
    // pointer must stay null - it used to be written at queue time, which is
    // how a failed send poisoned every later email.
    const ticket = await createAssignedTicket();
    await reply(ticket.id, 'Never going to be delivered.');
    const thread = await prisma.ticketEmailThread.findUnique({
      where: { ticketId: ticket.id },
    });
    expect(thread?.lastOutboundMessageId).toBeNull();
    expect(thread?.lastOutboundAt).toBeNull();
  });

  it('lands an inbound reply that quotes only the root on the right ticket', async () => {
    const ticket = await createAssignedTicket();
    await reply(ticket.id, 'Please confirm.');
    const root = await rootFor(ticket.id);

    await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: fixtureEmails.requester,
        // No display id in the subject and no reply token in the To address, so
        // the only thing that can resolve this is the root in the header.
        subject: 'Re: something completely different',
        toEmail: 'helpdesk@csnhc.com',
        body: 'Confirmed, thank you.',
        messageId: `<inbound-${Date.now()}@mail.example>`,
        inReplyTo: root,
      })
      .expect(201);

    const messages = await prisma.ticketMessage.findMany({
      where: { ticketId: ticket.id },
    });
    expect(messages.some((m) => m.body.includes('Confirmed, thank you'))).toBe(
      true,
    );
  });

  it('still threads an inbound reply by reply token and by subject id', async () => {
    const ticket = await createAssignedTicket();
    const thread = await prisma.ticketEmailThread.findUnique({
      where: { ticketId: ticket.id },
      select: { replyToken: true },
    });

    await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: fixtureEmails.requester,
        subject: 'Re: no identifiers here',
        toEmail: `helpdesk+ticket-${thread?.replyToken}@csnhc.com`,
        body: 'Threaded by token.',
        messageId: `<inbound-token-${Date.now()}@mail.example>`,
      })
      .expect(201);

    await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: fixtureEmails.requester,
        subject: `Re: ${ticket.displayId} still broken`,
        toEmail: 'helpdesk@csnhc.com',
        body: 'Threaded by subject.',
        messageId: `<inbound-subject-${Date.now()}@mail.example>`,
      })
      .expect(201);

    const messages = await prisma.ticketMessage.findMany({
      where: { ticketId: ticket.id },
    });
    const bodies = messages.map((m) => m.body).join('\n');
    expect(bodies).toContain('Threaded by token.');
    expect(bodies).toContain('Threaded by subject.');
  });
});
