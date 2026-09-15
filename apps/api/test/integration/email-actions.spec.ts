import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { buildEmailActionScript } from '../../src/email-actions/email-action-page.util';
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
 * fetched first - and it would look exactly like the feature working.
 *
 * ⚠️ CARD 1.93 TIGHTENED THE SECOND HALF OF THAT. The action is a POST, and the
 * page used to make it from its script on load - safe only while "a scanner runs
 * no script" held. It does not hold for detonation sandboxes, which open links
 * in a real headless browser. The POST now needs a press; see the last describe.
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

    it('⚠️ does NOT say "already done" when the move is simply no longer possible', async () => {
      // Found by clicking the links in order during the browser pass, and by
      // nothing else: every test above clicks one link on a fresh ticket.
      //
      // Reopen, then click "Yes, close it" in the same email. REOPENED ->
      // CLOSED is not a move a requester may make, so the transition is
      // refused - and the page used to answer "that is already done" while the
      // ticket sat open. Telling somebody their request is handled when it is
      // not is the one thing this page must never do.
      const ticket = await plantResolvedTicket();
      await post(tokenFor(ticket.id, 'reopen')).expect(201);
      const res = await post(tokenFor(ticket.id, 'confirm')).expect(201);
      expect(res.body).toEqual({ outcome: 'noLongerPossible' });
      expect(await statusOf(ticket.id)).toBe('REOPENED');
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
      // ⚠️ Not cached. The script carries the outcome sentences and the server
      // sends the KEY, so the two must stay in step; a long cache leaves every
      // browser holding a script that cannot name a newly added outcome, and
      // the page then says "Something went wrong" about a perfectly good
      // answer. Observed in the browser pass, not imagined.
      expect(res.headers['cache-control']).toBe('no-cache');
    });

    it('knows every outcome the server can send', () => {
      // The other half of the same problem: if a key is added to the service
      // without a sentence, the page falls back to "Something went wrong".
      const script = buildEmailActionScript();
      for (const key of [
        'confirm',
        'reopen',
        'rate',
        'alreadyDone',
        'noLongerPossible',
        'expired',
        'invalid',
        'failed',
      ]) {
        expect(script).toContain(`"${key}"`);
      }
    });

    it('⚠️ the page src RESOLVES to that route', async () => {
      // The test that was missing, and the defect it would have caught: the
      // src was `../action.js`, which a browser resolves against
      // `/api/email-actions/<token>` to `/api/action.js` - a 404. The script
      // never loaded, the page sat on "One moment…", and every link in every
      // email did nothing at all. Everything above still passed, because it
      // asserted the script route works rather than that the page reaches it.
      //
      // Resolving with URL() is exactly what the browser does, so this cannot
      // drift from real behaviour.
      const ticket = await plantResolvedTicket();
      const token = tokenFor(ticket.id, 'confirm');
      const page = await get(token).expect(200);
      const src = /<script src="([^"]+)"><\/script>/.exec(page.text)?.[1];
      expect(src).toBeTruthy();
      const resolved = new URL(
        src as string,
        `http://localhost/api/email-actions/${token}`,
      );
      expect(resolved.pathname).toBe('/api/email-actions/action.js');
      // And that path really answers, from this same app.
      await request(server).get(resolved.pathname).expect(200);
    });
  });

  /**
   * Card 1.93 — the page waits for a press.
   *
   * ⚠️ WHY THE EXISTING SCANNER TESTS ABOVE ARE NOT ENOUGH. They prove a bare
   * GET writes nothing, which was the whole defence: the POST fired from the
   * script on load, and the reasoning was that a scanner runs no script. Link
   * detonation sandboxes DO run it, in a real headless browser, and every one
   * of them would have closed the ticket and looked like a happy user. A
   * server-side test cannot execute the script, so the property is asserted
   * where it lives - in the source of the file the browser is handed.
   */
  describe('⚠️ nothing happens until somebody presses the button (card 1.93)', () => {
    it('⚠️ the script has no fetch outside the submit handler', () => {
      // THE REGRESSION ASSERTION. Hoisting the fetch back out would read as a
      // tidy-up and would silently re-arm every scanner that runs scripts.
      const script = buildEmailActionScript();
      const listenerAt = script.indexOf("addEventListener('submit'");
      expect(listenerAt).toBeGreaterThan(-1);
      expect(script.indexOf('fetch(')).toBeGreaterThan(listenerAt);
      expect(script.split('fetch(').length - 1).toBe(1);
    });

    it('the page serves a real form with a submit button', async () => {
      const ticket = await plantResolvedTicket();
      const page = await get(tokenFor(ticket.id, 'confirm')).expect(200);
      expect(page.text).toContain('<form id="act" method="post" action="">');
      expect(page.text).toContain('<button type="submit"');
      // And it says so before it does anything, rather than claiming success.
      expect(page.text).toContain('Please confirm.');
      expect(page.text).not.toContain('we have closed this');
    });

    it('⚠️ serving that page still writes nothing', async () => {
      // The card's named test, re-stated against the page that now has a form:
      // rendering a button must not be the same as pressing it.
      const ticket = await plantResolvedTicket();
      await get(tokenFor(ticket.id, 'confirm')).expect(200);
      await get(tokenFor(ticket.id, 'reopen')).expect(200);
      expect(await statusOf(ticket.id)).toBe('RESOLVED');
      expect(
        await prisma.ticketEvent.count({
          where: { ticketId: ticket.id, type: 'TICKET_ACTION_FROM_EMAIL' },
        }),
      ).toBe(0);
    });

    it('⚠️ the press still closes the ticket', async () => {
      // The non-vacuity half. A gate that never opens passes everything above
      // and breaks the feature the owner asked for.
      const ticket = await plantResolvedTicket();
      const res = await post(tokenFor(ticket.id, 'confirm')).expect(201);
      expect((res.body as { outcome: string }).outcome).toBe('confirm');
      expect(await statusOf(ticket.id)).toBe('CLOSED');
    });

    it('a form post from a browser with no JavaScript works, and gets a page', async () => {
      // The degraded path: the same press, submitted natively. Without this the
      // no-JS user is shown raw JSON.
      const ticket = await plantResolvedTicket();
      const res = await post(tokenFor(ticket.id, 'confirm'))
        .set('Accept', 'text/html,application/xhtml+xml')
        .expect(201);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('we have closed this');
      expect(res.text).not.toContain('<form');
      expect(await statusOf(ticket.id)).toBe('CLOSED');
    });

    it('an expired link says so plainly, on both paths, and changes nothing', async () => {
      const ticket = await plantResolvedTicket();
      const expired = tokenFor(ticket.id, 'confirm', undefined, past());
      const asJson = await post(expired).expect(201);
      expect((asJson.body as { outcome: string }).outcome).toBe('expired');
      const asPage = await post(expired)
        .set('Accept', 'text/html')
        .expect(201);
      expect(asPage.text).toContain('This link has expired');
      expect(asPage.text).not.toContain('we have closed this');
      expect(await statusOf(ticket.id)).toBe('RESOLVED');
    });

    it('a second press is still harmless, and still says so', async () => {
      const ticket = await plantResolvedTicket();
      const token = tokenFor(ticket.id, 'confirm');
      await post(token).expect(201);
      const again = await post(token).set('Accept', 'text/html').expect(201);
      expect(again.text).toContain('already done');
      expect(await statusOf(ticket.id)).toBe('CLOSED');
    });
  });
});
