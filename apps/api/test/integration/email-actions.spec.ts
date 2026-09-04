import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { signEmailActionToken } from '../../src/email-actions/email-action-token.util';
import { fixtureEmails, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

// The same value setup-tests.ts pins, so the app under test and these tokens
// agree without this spec mutating the environment.
const SECRET = 'test-email-action-secret';
const soon = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 60;

/**
 * Card 1.44 — one click from the email, end to end.
 *
 * ⚠️ THE MOST IMPORTANT TEST IN THIS FILE is "a bare GET changes nothing".
 * Microsoft Defender Safe Links, antivirus gateways and link-preview bots fetch
 * URLs out of email before a human ever reads the message. If the link acted on
 * GET, the scanner would confirm every resolved ticket and set whichever star it
 * fetched first - and it would look exactly like the feature working. The action
 * is a POST that only the page's script makes, and a scanner runs no script.
 */
describe('One-click email actions (card 1.44)', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;

  let seq = 0;
  const unique = () => {
    seq += 1;
    return `${Date.now()}${seq}`;
  };

  async function plantResolvedTicket() {
    return prisma.ticket.create({
      data: {
        subject: `Payroll password reset ${unique()}`,
        description: 'Fixture',
        requesterId: fixtureUserIds.requester,
        status: 'RESOLVED',
        resolvedAt: new Date(),
      },
      select: { id: true, subject: true, displayId: true, number: true },
    });
  }

  const tokenFor = (
    ticketId: string,
    action: 'confirm' | 'reopen' | 'rate',
    value?: number,
    expiresAt = soon(),
  ) => signEmailActionToken({ ticketId, action, value, expiresAt }, SECRET);

  const post = (token: string) =>
    request(server).post(`/api/email-actions/${token}`);
  const get = (token: string) =>
    request(server).get(`/api/email-actions/${token}`);

  const statusOf = async (id: string) =>
    (
      await prisma.ticket.findUniqueOrThrow({
        where: { id },
        select: { status: true },
      })
    ).status;

  const ratingsOf = (ticketId: string) =>
    prisma.ticketEvent.findMany({
      where: { ticketId, type: 'CSAT_SUBMITTED' },
      select: { payload: true },
    });

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  describe('⚠️ a bare GET changes NOTHING (the scanner test)', () => {
    it('serves the page and leaves the ticket exactly as it was', async () => {
      const ticket = await plantResolvedTicket();
      const token = tokenFor(ticket.id, 'confirm');
      const res = await get(token).expect(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(await statusOf(ticket.id)).toBe('RESOLVED');
      expect(await ratingsOf(ticket.id)).toHaveLength(0);
      expect(
        await prisma.ticketEvent.count({
          where: { ticketId: ticket.id, type: 'TICKET_ACTION_FROM_EMAIL' },
        }),
      ).toBe(0);
    });

    it('is still inert when the scanner fetches every one of the seven links', async () => {
      // What Safe Links actually does: it walks every URL in the message.
      const ticket = await plantResolvedTicket();
      const tokens = [
        tokenFor(ticket.id, 'confirm'),
        tokenFor(ticket.id, 'reopen'),
        ...[1, 2, 3, 4, 5].map((v) => tokenFor(ticket.id, 'rate', v)),
      ];
      for (const token of tokens) {
        await get(token).expect(200);
      }
      expect(await statusOf(ticket.id)).toBe('RESOLVED');
      expect(await ratingsOf(ticket.id)).toHaveLength(0);
    });

    it('the page it serves carries no ticket details at all', async () => {
      const ticket = await plantResolvedTicket();
      const res = await get(tokenFor(ticket.id, 'confirm')).expect(200);
      expect(res.text).not.toContain(ticket.subject);
      expect(res.text).not.toContain(ticket.id);
      expect(res.text).not.toContain('Requester');
      if (ticket.displayId) {
        expect(res.text).not.toContain(ticket.displayId);
      }
    });
  });

  describe('the POST performs the action, once', () => {
    it('closes the ticket on confirm', async () => {
      const ticket = await plantResolvedTicket();
      const res = await post(tokenFor(ticket.id, 'confirm')).expect(201);
      expect(res.body).toEqual({ outcome: 'confirm' });
      expect(await statusOf(ticket.id)).toBe('CLOSED');
    });

    it('reopens the ticket on reopen', async () => {
      const ticket = await plantResolvedTicket();
      const res = await post(tokenFor(ticket.id, 'reopen')).expect(201);
      expect(res.body).toEqual({ outcome: 'reopen' });
      expect(await statusOf(ticket.id)).toBe('REOPENED');
    });

    it('records the rating on a star', async () => {
      const ticket = await plantResolvedTicket();
      const res = await post(tokenFor(ticket.id, 'rate', 4)).expect(201);
      expect(res.body).toEqual({ outcome: 'rate' });
      const events = await ratingsOf(ticket.id);
      expect(events).toHaveLength(1);
      expect((events[0].payload as { rating: number }).rating).toBe(4);
    });

    it('records that the action came from an email link', async () => {
      const ticket = await plantResolvedTicket();
      await post(tokenFor(ticket.id, 'confirm')).expect(201);
      const event = await prisma.ticketEvent.findFirstOrThrow({
        where: { ticketId: ticket.id, type: 'TICKET_ACTION_FROM_EMAIL' },
        select: { payload: true, createdById: true },
      });
      expect((event.payload as { action: string }).action).toBe('confirm');
      // Attributed to the requester, because they are who clicked it.
      expect(event.createdById).toBe(fixtureUserIds.requester);
    });

    it('⚠️ answers nothing about the ticket', async () => {
      const ticket = await plantResolvedTicket();
      const res = await post(tokenFor(ticket.id, 'confirm')).expect(201);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(ticket.subject);
      expect(body).not.toContain(ticket.id);
      expect(Object.keys(res.body as object)).toEqual(['outcome']);
    });
  });

  describe('⚠️ one token does exactly one thing', () => {
    it('a confirm token cannot reopen', async () => {
      const ticket = await plantResolvedTicket();
      await post(tokenFor(ticket.id, 'confirm')).expect(201);
      expect(await statusOf(ticket.id)).toBe('CLOSED');
      // Not REOPENED - the action is inside the signature.
      expect(await statusOf(ticket.id)).not.toBe('REOPENED');
    });

    it('a rating=4 token cannot write 5', async () => {
      const ticket = await plantResolvedTicket();
      await post(tokenFor(ticket.id, 'rate', 4)).expect(201);
      const events = await ratingsOf(ticket.id);
      expect((events[0].payload as { rating: number }).rating).toBe(4);
      expect((events[0].payload as { rating: number }).rating).not.toBe(5);
    });

    it('a token for one ticket does not touch another', async () => {
      const mine = await plantResolvedTicket();
      const other = await plantResolvedTicket();
      await post(tokenFor(mine.id, 'confirm')).expect(201);
      expect(await statusOf(other.id)).toBe('RESOLVED');
    });
  });

  describe('the unhappy paths are calm, and change nothing', () => {
    it('refuses a tampered token', async () => {
      const ticket = await plantResolvedTicket();
      const token = tokenFor(ticket.id, 'confirm');
      const [payload, signature] = token.split('.');
      const res = await post(`${payload}x.${signature}`).expect(201);
      expect(res.body).toEqual({ outcome: 'invalid' });
      expect(await statusOf(ticket.id)).toBe('RESOLVED');
    });

    it('refuses a truncated token', async () => {
      const ticket = await plantResolvedTicket();
      const token = tokenFor(ticket.id, 'confirm');
      const res = await post(token.slice(0, token.length - 5)).expect(201);
      expect(res.body).toEqual({ outcome: 'invalid' });
      expect(await statusOf(ticket.id)).toBe('RESOLVED');
    });

    it('refuses an expired token, with no state change', async () => {
      const ticket = await plantResolvedTicket();
      const res = await post(
        tokenFor(ticket.id, 'confirm', undefined, past()),
      ).expect(201);
      expect(res.body).toEqual({ outcome: 'expired' });
      expect(await statusOf(ticket.id)).toBe('RESOLVED');
    });

    it('says nothing revealing about a deleted ticket', async () => {
      const ticket = await plantResolvedTicket();
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { deletedAt: new Date() },
      });
      const res = await post(tokenFor(ticket.id, 'confirm')).expect(201);
      // The same answer as a forged token, on purpose: a different one would
      // let a token holder learn the ticket had been deleted.
      expect(res.body).toEqual({ outcome: 'invalid' });
    });

    it('a token for a ticket that never existed answers the same way', async () => {
      const res = await post(
        tokenFor('11111111-2222-4333-8444-555555555555', 'confirm'),
      ).expect(201);
      expect(res.body).toEqual({ outcome: 'invalid' });
    });
  });

  describe('⚠️ a second click is harmless', () => {
    it('does not close twice or write a second event', async () => {
      const ticket = await plantResolvedTicket();
      const token = tokenFor(ticket.id, 'confirm');
      expect((await post(token).expect(201)).body).toEqual({
        outcome: 'confirm',
      });
      const second = await post(token).expect(201);
      expect(second.body).toEqual({ outcome: 'alreadyDone' });
      expect(await statusOf(ticket.id)).toBe('CLOSED');
      expect(
        await prisma.ticketEvent.count({
          where: { ticketId: ticket.id, type: 'TICKET_ACTION_FROM_EMAIL' },
        }),
      ).toBe(1);
    });

    it('does not record a second rating', async () => {
      const ticket = await plantResolvedTicket();
      await post(tokenFor(ticket.id, 'rate', 5)).expect(201);
      const second = await post(tokenFor(ticket.id, 'rate', 1)).expect(201);
      expect(second.body).toEqual({ outcome: 'alreadyDone' });
      const events = await ratingsOf(ticket.id);
      expect(events).toHaveLength(1);
      // The FIRST rating stands. A second link cannot overwrite it.
      expect((events[0].payload as { rating: number }).rating).toBe(5);
    });

    it('reopening an already reopened ticket is harmless', async () => {
      const ticket = await plantResolvedTicket();
      const token = tokenFor(ticket.id, 'reopen');
      await post(token).expect(201);
      const second = await post(token).expect(201);
      expect(second.body).toEqual({ outcome: 'alreadyDone' });
      expect(await statusOf(ticket.id)).toBe('REOPENED');
    });
  });

  describe('the authenticated rating path is untouched', () => {
    it('still requires a signed-in requester and still refuses a second rating', async () => {
      const ticket = await plantResolvedTicket();
      await request(server)
        .post('/api/csat')
        .set({ 'x-user-email': fixtureEmails.requester })
        .send({ ticketId: ticket.id, rating: 3 })
        .expect(201);
      // The token path cannot overwrite what the widget recorded, either.
      const viaLink = await post(tokenFor(ticket.id, 'rate', 5)).expect(201);
      expect(viaLink.body).toEqual({ outcome: 'alreadyDone' });
      const events = await ratingsOf(ticket.id);
      expect(events).toHaveLength(1);
      expect((events[0].payload as { rating: number }).rating).toBe(3);
    });

    it('still refuses somebody who is not the requester', async () => {
      const ticket = await plantResolvedTicket();
      await request(server)
        .post('/api/csat')
        .set({ 'x-user-email': fixtureEmails.agent })
        .send({ ticketId: ticket.id, rating: 5 })
        .expect(403);
    });
  });

  describe('the script the page loads', () => {
    it('is served same-origin, as JavaScript', async () => {
      const res = await request(server)
        .get('/api/email-actions/action.js')
        .expect(200);
      expect(res.headers['content-type']).toContain('javascript');
      expect(res.text).toContain("method: 'POST'");
    });
  });
});
