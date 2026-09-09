import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

/**
 * Card 1.45 — reports have never excluded soft-deleted tickets.
 *
 * `reports.service.ts` carried a comment saying the raw-SQL reports get
 * `deletedAt IS NULL` from `accessConditionSql`. They do not: reports never
 * call that function. Only the Prisma `where` path filtered it, and of the
 * file's 23 `$queryRaw` reports exactly three did — the three added by card
 * 1.17. The other 20 counted deleted tickets from the day they were written.
 *
 * ⚠️ ONE TEST, NOT ONE PER REPORT. Every report is called before and after
 * soft-deleting a ticket that it must have counted, and every figure has to
 * move. A per-report test would rot; this cannot, because a new report that
 * forgets the clause is caught the moment it is added to the list below.
 */
describe('Reports exclude soft-deleted tickets (card 1.45)', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;

  /**
   * A recent window. Anything wider than the fixtures' own timestamps, so
   * every report has data to count.
   */
  const range = {
    from: new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10),
    to: new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10),
  };

  /** Every report endpoint that takes the standard query. */
  const REPORTS = [
    'ticket-volume',
    'sla-compliance',
    'sla-compliance-by-priority',
    'sla-compliance-by-team',
    'resolution-time',
    'tickets-by-status',
    'tickets-by-priority',
    'agent-performance',
    'agent-workload',
    'tickets-by-age',
    'reopen-rate',
    'csat-trend',
    'csat-drivers',
    'csat-low-tags',
    'sla-breaches',
    'channel-breakdown',
    'tickets-by-category',
    'team-summary',
    'transfers',
    'first-contact-resolution',
    'reassignment-count',
    'time-in-status',
  ] as const;

  let ticketId: string;
  /**
   * A second, still-OPEN ticket.
   *
   * ⚠️ Needed because several reports only count open work - `agent-workload`
   * and `tickets-by-age` default to "not resolved" - so a resolved fixture is
   * invisible to them and the test would report them as broken when they were
   * simply looking at a different set. Two tickets cover both families.
   */
  let openTicketId: string;

  /**
   * Sum every number anywhere in a report's payload.
   *
   * Crude on purpose: it does not need to know each report's shape, only that
   * a report which counted a ticket must count less once that ticket is gone.
   * Dates and ids are strings, so they contribute nothing.
   */
  function totalOf(value: unknown): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    if (Array.isArray(value)) {
      return value.reduce<number>((sum, item) => sum + totalOf(item), 0);
    }
    if (value && typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).reduce<number>(
        (sum, item) => sum + totalOf(item),
        0,
      );
    }
    return 0;
  }

  const fetchReport = async (report: string) => {
    const res = await request(server)
      .get(`/api/reports/${report}`)
      .query(range)
      .set(authHeader(fixtureEmails.owner));
    expect(res.status).toBe(200);
    return res.body as unknown;
  };

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;

    // One ticket that every report has a reason to count: resolved inside the
    // window, assigned, on a team, with a status history, a reassignment, a
    // transfer, a rating, a tag and an SLA to have met.
    const created = await prisma.ticket.create({
      data: {
        subject: `Card 1.45 fixture ${Date.now()}`,
        description: 'Counted by every report until it is deleted.',
        requesterId: fixtureUserIds.requester,
        assignedTeamId: fixtureTeamIds.it,
        assigneeId: fixtureUserIds.agent,
        status: 'RESOLVED',
        priority: 'SEV2',
        channel: 'PORTAL',
        resolvedAt: new Date(Date.now() - 3600_000),
        completedAt: new Date(Date.now() - 3600_000),
        // Both due dates in the PAST, so the ticket is an SLA breach and
        // `sla-breaches` has something to count. Without this it returned
        // 0 -> 0 and the test could not tell a filtered report from an empty
        // one.
        firstResponseDueAt: new Date(Date.now() - 5400_000),
        dueAt: new Date(Date.now() - 5400_000),
        createdAt: new Date(Date.now() - 2 * 3600_000),
      },
      select: { id: true },
    });
    ticketId = created.id;

    await prisma.ticketMessage.create({
      data: {
        ticketId,
        authorId: fixtureUserIds.agent,
        type: 'PUBLIC',
        body: 'One reply, so first-contact resolution counts it.',
      },
    });
    for (const [type, payload] of [
      ['TICKET_ASSIGNED', {}],
      ['TICKET_ASSIGNED', {}],
      ['TICKET_TRANSFERRED', { fromTeamId: fixtureTeamIds.hr, toTeamId: fixtureTeamIds.it }],
      ['TICKET_STATUS_CHANGED', { from: 'NEW', to: 'TRIAGED' }],
      ['TICKET_STATUS_CHANGED', { from: 'TRIAGED', to: 'REOPENED' }],
      ['TICKET_STATUS_CHANGED', { from: 'REOPENED', to: 'RESOLVED' }],
      // A LOW rating, and the tags on the EVENT payload rather than the
      // ticket - `getCsatLowTags` reads `payload.tags`, so a TicketTag row is
      // invisible to it.
      ['CSAT_SUBMITTED', { rating: 2, tags: ['card-145'] }],
    ] as [string, Record<string, unknown>][]) {
      await prisma.ticketEvent.create({
        data: {
          ticketId,
          type,
          payload: payload as never,
          createdById: fixtureUserIds.agent,
          createdAt: new Date(Date.now() - 3600_000),
        },
      });
    }
    const tag = await prisma.tag.upsert({
      where: { name: 'card-145' },
      update: {},
      create: { name: 'card-145', createdById: fixtureUserIds.agent },
      select: { id: true },
    });
    await prisma.ticketTag.create({
      data: {
        ticketId,
        tagId: tag.id,
        source: 'MANUAL',
        createdById: fixtureUserIds.agent,
      },
    });

    const open = await prisma.ticket.create({
      data: {
        subject: `Card 1.45 open fixture ${Date.now()}`,
        description: 'Counted by the open-work reports until it is deleted.',
        requesterId: fixtureUserIds.requester,
        assignedTeamId: fixtureTeamIds.it,
        assigneeId: fixtureUserIds.agent,
        status: 'IN_PROGRESS',
        priority: 'SEV3',
        channel: 'PORTAL',
        createdAt: new Date(Date.now() - 2 * 3600_000),
      },
      select: { id: true },
    });
    openTicketId = open.id;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  it('⚠️ every report stops counting a ticket once it is soft-deleted', async () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. Before card 1.45, 16 of
    // these 22 reports returned the same figures after the delete as before.
    //
    // Two signals, because the reports are not all shaped alike:
    //  - a report that NAMES the ticket must stop naming it. That is the
    //    strongest form and it is immune to clock drift, which matters for
    //    `sla-breaches` - its numbers are breach durations that grow between
    //    one call and the next, so a plain sum there would rise and look like
    //    a pass for the wrong reason.
    //  - an aggregate report must total LESS.
    //
    // A report with neither - nothing counted before - is reported as a
    // fixture gap rather than passing quietly, because "0 -> 0" cannot tell a
    // filtered report from an empty one.
    const snapshot = async (report: string) => {
      const body = await fetchReport(report);
      const json = JSON.stringify(body);
      return {
        total: totalOf(body),
        namesTicket: json.includes(ticketId) || json.includes(openTicketId),
      };
    };

    const before: Record<string, { total: number; namesTicket: boolean }> = {};
    for (const report of REPORTS) {
      before[report] = await snapshot(report);
    }

    await prisma.ticket.updateMany({
      where: { id: { in: [ticketId, openTicketId] } },
      data: { deletedAt: new Date() },
    });

    const stillCounting: string[] = [];
    const noData: string[] = [];
    for (const report of REPORTS) {
      const after = await snapshot(report);
      if (before[report].namesTicket) {
        if (after.namesTicket) {
          stillCounting.push(`${report}: still names the deleted ticket`);
        }
        continue;
      }
      if (before[report].total > 0) {
        if (after.total >= before[report].total) {
          stillCounting.push(
            `${report}: ${before[report].total} -> ${after.total}`,
          );
        }
        continue;
      }
      noData.push(report);
    }
    // Named, so a failure says WHICH report still counts the deleted ticket
    // rather than only that one does.
    expect(stillCounting).toEqual([]);
    expect(noData).toEqual([]);
  });

  it('tag analytics stops counting it too', async () => {
    // Its own endpoint, with a `days` param rather than the standard range.
    const res = await request(server)
      .get('/api/reports/tag-analytics')
      .query({ days: 30 })
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    expect(JSON.stringify(res.body)).not.toContain('card-145');
  });

  it('the summary, which composes six of them, drops it too', async () => {
    // ⚠️ The summary is CACHED for 45 seconds, keyed on the user and the whole
    // query - so calling it with the same range before and after the delete
    // would compare a fresh answer with a stale one and prove nothing. The
    // second call widens the window by a day: still contains the fixture,
    // different cache key, genuinely recomputed.
    //
    // And the count is compared to itself rather than to zero: this database
    // has other SEV2 tickets, so "0" was never the right expectation.
    const sev2Of = (body: unknown) =>
      (
        body as {
          ticketsByPriority?: { data?: { priority: string; count: number }[] };
        }
      ).ticketsByPriority?.data?.find((row) => row.priority === 'SEV2')
        ?.count ?? 0;

    const widened = {
      from: range.from,
      to: new Date(Date.now() + 2 * 24 * 3600_000).toISOString().slice(0, 10),
    };
    const after = await request(server)
      .get('/api/reports/summary')
      .query(widened)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    // The deleted fixture was SEV2, so restoring it must put the count back up
    // by exactly one. Comparing in this direction needs no cache-busting: the
    // restore changes the data, not the key, and the key for `widened` has
    // already been used once.
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { deletedAt: null },
    });
    const restored = await request(server)
      .get('/api/reports/summary')
      .query({ ...widened, to: widened.to, dateField: 'createdAt' })
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    expect(sev2Of(restored.body)).toBe(sev2Of(after.body) + 1);
  });
});
