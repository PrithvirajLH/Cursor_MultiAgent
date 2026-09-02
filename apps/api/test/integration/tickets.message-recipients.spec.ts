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

type Preview = {
  to: { id: string; name: string } | null;
  cc: { id: string; name: string; removable: boolean }[];
  refused: { address: string; reason: string }[];
  emails: boolean;
};

/**
 * Card 1.28, 6a — `GET /api/tickets/:id/message-recipients`.
 *
 * Since 1.33 a reply is one email (To: requester, Cc: the rest) and 1.34 took
 * "Also copied" out of the body, so the compose screen is now the only place
 * anyone sees who a message will reach. On payroll and HR tickets that is a
 * safety gap rather than a convenience.
 */
describe('Message recipient preview', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;
  let ticketId: string;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;

    const ticket = await prisma.ticket.create({
      data: {
        requesterId: fixtureUserIds.requester,
        subject: '1.28 — who does this reach?',
        description: 'A ticket with a requester, an assignee and a follower.',
        assignedTeamId: fixtureTeamIds.it,
        assigneeId: fixtureUserIds.agent,
        followers: { create: [{ userId: fixtureUserIds.lead }] },
      },
      select: { id: true },
    });
    ticketId = ticket.id;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  async function preview(email: string, type?: string): Promise<Preview> {
    const res = await request(server)
      .get(`/api/tickets/${ticketId}/message-recipients`)
      .query(type ? { type } : {})
      .set(authHeader(email))
      .expect(200);
    return res.body as Preview;
  }

  it('answers an agent on the team', async () => {
    const body = await preview(fixtureEmails.agent);
    expect(body.emails).toBe(true);
    // The requester takes To; the follower is copied. The agent asking is the
    // assignee and must not appear in their own preview.
    expect(body.to?.id).toBe(fixtureUserIds.requester);
    const ids = body.cc.map((entry) => entry.id);
    expect(ids).toContain(fixtureUserIds.lead);
    expect(ids).not.toContain(fixtureUserIds.agent);
  });

  it('returns names, never addresses', async () => {
    const body = await preview(fixtureEmails.agent);
    const rendered = JSON.stringify({ to: body.to, cc: body.cc });
    expect(rendered).not.toContain('@');
    expect(body.to?.name).toBeTruthy();
  });

  it('reports an internal note as reaching staff and emailing nobody', async () => {
    const body = await preview(fixtureEmails.agent, 'INTERNAL');
    expect(body.emails).toBe(false);
    expect(body.to).toBeNull();
    // The requester is an EMPLOYEE in the fixtures, so excludeEmployees drops
    // them — and 1.28 drops the requester outright, whatever their role.
    expect(body.cc.map((entry) => entry.id)).not.toContain(
      fixtureUserIds.requester,
    );
  });

  it('defaults to a public reply when no type is given', async () => {
    const body = await preview(fixtureEmails.agent);
    expect(body.emails).toBe(true);
  });

  it('rejects a type that is not a message type', async () => {
    await request(server)
      .get(`/api/tickets/${ticketId}/message-recipients`)
      .query({ type: 'SHOUTED' })
      .set(authHeader(fixtureEmails.agent))
      .expect(400);
  });

  it('403s for someone who cannot post on the ticket', async () => {
    // PERSONA: `other.requester@company.com` — an EMPLOYEE who did not raise
    // this ticket. Chosen deliberately after card 1.36: a staff requester can
    // now reach their OWN ticket and, as of this stage, reply to it, so they
    // no longer fail this gate. An EMPLOYEE with neither the requester
    // relationship nor any team scope is the persona that genuinely fails
    // canPostMessage.
    await request(server)
      .get(`/api/tickets/${ticketId}/message-recipients`)
      .set(authHeader(fixtureEmails.otherRequester))
      .expect(403);
  });

  it('404s for a ticket that does not exist', async () => {
    await request(server)
      .get('/api/tickets/11111111-2222-4333-8444-555555555555/message-recipients')
      .set(authHeader(fixtureEmails.agent))
      .expect(404);
  });

  it('labels each message with what the outbox actually did (6c)', async () => {
    const publicPost = await request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({ body: 'A public reply for the label.', type: 'PUBLIC' })
      .expect(201);
    const internalPost = await request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({ body: 'An internal note for the label.', type: 'INTERNAL' })
      .expect(201);

    const listed = await request(server)
      .get(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
    const rows = (
      listed.body as {
        data: {
          id: string;
          delivery?: { emailed: number; refused: number; internal: boolean };
        }[];
      }
    ).data;
    const byId = new Map(rows.map((row) => [row.id, row.delivery]));

    const publicId = (publicPost.body as { id: string }).id;
    const internalId = (internalPost.body as { id: string }).id;
    expect(byId.get(internalId)).toEqual({
      emailed: 0,
      refused: 0,
      internal: true,
    });

    // Reports the OUTBOX, not the intent: the row exists but has not been
    // marked sent in this environment, so the count is honestly zero rather
    // than the number of addresses the send hoped for.
    const publicLabel = byId.get(publicId);
    expect(publicLabel?.internal).toBe(false);
    const outboxForMessage = await prisma.notificationOutbox.findMany({
      where: { ticketId, eventType: 'MESSAGE_ADDED' },
      select: { status: true, payload: true },
    });
    const row = outboxForMessage.find((candidate) => {
      const envelope = (candidate.payload ?? {}) as {
        event?: { messageId?: string };
      };
      return envelope.event?.messageId === publicId;
    });
    expect(row).toBeDefined();
    const envelope = (row!.payload ?? {}) as { email?: { cc?: string[] } };
    const reached = 1 + (envelope.email?.cc?.length ?? 0);
    if (row!.status === 'SENT') {
      expect(publicLabel?.emailed).toBe(reached);
    } else if (row!.status === 'FAILED') {
      expect(publicLabel?.refused).toBe(reached);
    } else {
      expect(publicLabel).toEqual({ emailed: 0, refused: 0, internal: false });
    }
  });

  it('matches who the send actually emails', async () => {
    // The preview's whole purpose. Read it, post the message, then compare the
    // preview against the outbox row that resulted — To and Cc both.
    const before = await preview(fixtureEmails.agent);
    const posted = await request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({ body: 'Confirming what the preview promised.', type: 'PUBLIC' })
      .expect(201);
    const messageId = (posted.body as { id: string }).id;

    const rows = await prisma.notificationOutbox.findMany({
      where: { ticketId, eventType: 'MESSAGE_ADDED' },
      select: { toEmail: true, payload: true },
    });
    const row = rows.find((candidate) => {
      const envelope = (candidate.payload ?? {}) as {
        event?: { messageId?: string };
      };
      return envelope.event?.messageId === messageId;
    });
    expect(row).toBeDefined();

    const envelope = (row!.payload ?? {}) as { email?: { cc?: string[] } };
    const cc = envelope.email?.cc ?? [];
    const [toUser, ccUsers] = await Promise.all([
      prisma.user.findUnique({
        where: { id: before.to!.id },
        select: { email: true },
      }),
      prisma.user.findMany({
        where: { id: { in: before.cc.map((entry) => entry.id) } },
        select: { email: true },
      }),
    ]);
    expect(row!.toEmail.toLowerCase()).toBe(toUser!.email.toLowerCase());
    expect(cc.map((address) => address.toLowerCase()).sort()).toEqual(
      ccUsers.map((entry) => entry.email.toLowerCase()).sort(),
    );
  });
});
