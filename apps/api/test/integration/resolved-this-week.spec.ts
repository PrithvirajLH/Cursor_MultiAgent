import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { INestApplication } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type CountsResponse = { data?: { resolvedThisWeek: number } } & {
  resolvedThisWeek?: number;
};

const DAY = 24 * 60 * 60_000;

/**
 * Card 1.88 — "resolved this week" counted the wrong thing.
 *
 * The column keyed on `updatedAt`, so editing a ticket resolved two months ago
 * dragged it into this week's figure and a bulk touch inflated it for everyone
 * at once.
 *
 * ⚠️ AND NOT `completedAt`, which the card first asked for: that column is
 * REWRITTEN when a ticket closes, so closing an old resolved ticket would drag
 * it into this week exactly as `updatedAt` did. `resolvedAt` is set on
 * RESOLVED, cleared on REOPENED and preserved through CLOSED.
 */
describe('resolved this week counts when it was RESOLVED (card 1.88)', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    // Start from a known floor: nothing in the fixture counts as resolved in
    // the last seven days, so every number below is the tickets this spec made.
    await getPrisma().ticket.updateMany({
      where: { resolvedAt: { not: null } },
      data: { resolvedAt: new Date(Date.now() - 90 * DAY) },
    });
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  /**
   * The counts endpoint validates this as YYYY-MM-DD (TicketCountsDto), so the
   * window is date-granular. The list takes a full ISO string; both describe
   * the same midnight.
   */
  const resolvedFromDay = () =>
    new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);
  const resolvedFromIso = () =>
    new Date(`${resolvedFromDay()}T00:00:00.000Z`).toISOString();

  /**
   * The badge number, asked for the same window the sidebar asks for.
   *
   * ⚠️ THE COUNTS ARE CACHED PER USER (`tickets:counts:<id>`), and this spec
   * sets `resolvedAt` straight in the database because no endpoint backdates a
   * resolution. A real transition would have invalidated that key, so the spec
   * invalidates it too - otherwise every assertion here reads a stale number
   * and the suite would pass while the change did nothing.
   */
  const badge = async () => {
    await (app.get<Cache>(CACHE_MANAGER) as Cache).del(
      `tickets:counts:${fixtureUserIds.owner}`,
    );
    const res = await request(server)
      .get(`/api/tickets/counts?resolvedUpdatedFrom=${resolvedFromDay()}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const body = res.body as CountsResponse;
    return body.data?.resolvedThisWeek ?? body.resolvedThisWeek ?? 0;
  };

  /** The list the badge links to, asked the same way the saved view asks. */
  const listCount = async () => {
    const res = await request(server)
      .get(
        `/api/tickets?statusGroup=resolved&resolvedFrom=${resolvedFromIso()}&pageSize=100&includeTotal=true`,
      )
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    return (res.body as { data: unknown[] }).data.length;
  };

  /** A ticket resolved at a chosen moment, optionally closed or touched later. */
  const resolvedTicket = async (
    subject: string,
    resolvedAt: Date,
    extra: { status?: 'RESOLVED' | 'CLOSED'; updatedAt?: Date } = {},
  ) => {
    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject,
        description: 'card 1.88 fixture',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    const id = (created.body as { id: string }).id;
    await getPrisma().ticket.update({
      where: { id },
      data: {
        status: extra.status ?? 'RESOLVED',
        assigneeId: fixtureUserIds.agent,
        resolvedAt,
        completedAt: resolvedAt,
        ...(extra.updatedAt ? { updatedAt: extra.updatedAt } : {}),
      },
    });
    return id;
  };

  it('⚠️ a ticket resolved LAST MONTH then edited today is NOT counted', async () => {
    // THE REGRESSION ASSERTION. Touching old work must not inflate this week.
    const before = await badge();
    await resolvedTicket('c188 old but edited', new Date(Date.now() - 40 * DAY), {
      updatedAt: new Date(),
    });
    expect(await badge()).toBe(before);
  });

  it('⚠️ a ticket resolved this week IS counted', async () => {
    // The non-vacuity half: a column that counted nothing would pass the test
    // above and report zero forever.
    const before = await badge();
    await resolvedTicket('c188 resolved this week', new Date(Date.now() - 2 * DAY));
    expect(await badge()).toBe(before + 1);
  });

  it('⚠️ a ticket resolved this week and CLOSED today is still counted', async () => {
    // The case that catches the `completedAt` mistake: closing rewrites
    // completedAt, so a count keyed on it would move this ticket to the week it
    // was closed rather than the week it was resolved.
    const before = await badge();
    const id = await resolvedTicket(
      'c188 resolved then closed',
      new Date(Date.now() - 3 * DAY),
    );
    await getPrisma().ticket.update({
      where: { id },
      data: { status: 'CLOSED', completedAt: new Date(), updatedAt: new Date() },
    });
    expect(await badge()).toBe(before + 1);
  });

  it('a ticket resolved last month and CLOSED today is NOT counted', async () => {
    // The same trap from the other side.
    const before = await badge();
    const id = await resolvedTicket(
      'c188 old then closed',
      new Date(Date.now() - 60 * DAY),
    );
    await getPrisma().ticket.update({
      where: { id },
      data: { status: 'CLOSED', completedAt: new Date(), updatedAt: new Date() },
    });
    expect(await badge()).toBe(before);
  });

  it('⚠️ the badge and the list behind it agree', async () => {
    // A number you can click has to show the same tickets it counted. The
    // saved view used `updatedFrom` while the badge counted `updatedAt`; moving
    // only one of them would have left them disagreeing.
    expect(await listCount()).toBe(await badge());
  });
});
