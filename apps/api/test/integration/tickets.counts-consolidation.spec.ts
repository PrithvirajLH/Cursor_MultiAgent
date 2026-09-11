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
 * The browser's own helpers, copied verbatim from
 * `apps/web/src/components/shell/saved-views.ts`.
 *
 * ⚠️ Copied rather than imported because the web app is a separate package and
 * this is the API's test runner. That is a real risk - a copy can drift - so
 * the assertions below never compare a count against a NUMBER these produce.
 * They compare the counts endpoint against the LIST endpoint given the same
 * dates, so if these helpers were wrong both sides would be wrong together and
 * the test would still be measuring the thing it claims to.
 */
const todayIso = (): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

const isoDaysAgo = (days: number): string => {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
};

/**
 * Card 1.69 step 4 — the sidebar fired nine `GET /tickets?pageSize=1` calls to
 * fill nine badges, uncached, while `GET /tickets/counts` already answered ten
 * questions in one cached call.
 *
 * ⚠️ WHAT THIS SUITE IS FOR. The card's hard constraint is that no badge's
 * number may change, and the only honest way to prove that is to ask BOTH
 * systems the same question and compare. So every assertion below is
 * `counts.<field> === list(<the query the badge links to>).meta.total`, never a
 * hard-coded expected number: a hard-coded number would pass a consolidation
 * that had quietly changed the definition AND the fixture together.
 */
describe('the sidebar counts match the list they link to (card 1.69)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  const BOUNDARIES = {
    todayFrom: todayIso(),
    awaitingUpdatedTo: isoDaysAgo(1),
    resolvedUpdatedFrom: isoDaysAgo(7),
  };

  beforeAll(async () => {
    await resetTestDb();
    await seedOneOfEachBadge();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  /**
   * One ticket per badge, written straight through Prisma.
   *
   * ⚠️ WITHOUT THIS THE WHOLE SUITE IS DECORATION. Measured before adding it:
   * all eight of the new counts were 0 for every role in the base fixture, so
   * every `counts.field === list.total` assertion was `0 === 0` and would have
   * passed against an implementation that returned a constant FALSE. Each row
   * below exists to make exactly one badge non-zero, and the last test in this
   * block refuses to run if any of them stops counting.
   *
   * Written with Prisma rather than through the API on purpose: `updatedAt` is
   * `@updatedAt`, so "not touched since yesterday" cannot be produced by any
   * sequence of HTTP calls - it has to be set directly.
   */
  function endOfTodayForSeed(): Date {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  }

  async function seedOneOfEachBadge(): Promise<void> {
    const prisma = getPrisma();
    const now = new Date();
    const base = {
      description: 'card 1.69 step 4 fixture',
      assignedTeamId: fixtureTeamIds.it,
      requesterId: fixtureUserIds.requester,
    };

    // sev1Today — SEV1, created now, so inside the client's local-midnight
    // boundary whatever the runner's time zone.
    await prisma.ticket.create({
      data: { ...base, subject: 'c169 sev1 today', priority: 'SEV1' },
    });

    // awaitingReplyOver24h — waiting, and last updated before the start of
    // today. `updatedAt` must be forced after creation because it is @updatedAt.
    const stale = await prisma.ticket.create({
      data: {
        ...base,
        subject: 'c169 awaiting reply',
        status: 'WAITING_ON_REQUESTER',
      },
    });
    await prisma.$executeRaw`
      UPDATE "Ticket" SET "updatedAt" = ${new Date(now.getTime() - 3 * 86_400_000)}
      WHERE "id" = ${stale.id}
    `;

    // breachRisk — due inside the list's four-hour window, not completed, not
    // waiting. Two hours out, so it also falls inside the narrower `atRisk`
    // window and the two definitions can be compared on the same row.
    await prisma.ticket.create({
      data: {
        ...base,
        subject: 'c169 breach risk',
        status: 'IN_PROGRESS',
        assigneeId: fixtureUserIds.agent,
        dueAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
      },
    });

    // ...and one due inside the four-hour window but OUTSIDE the two-hour one,
    // so breachRisk and atRisk are provably different numbers rather than
    // coincidentally equal.
    await prisma.ticket.create({
      data: {
        ...base,
        subject: 'c169 breach risk wide only',
        status: 'IN_PROGRESS',
        assigneeId: fixtureUserIds.agent,
        dueAt: new Date(now.getTime() + 3 * 60 * 60 * 1000),
      },
    });

    // CARD 1.70 ②: due inside the at-risk window but COMPLETED, so it must not
    // be counted. Before this card the count ignored completedAt and the list
    // did not, which is how the two definitions disagreed.
    await prisma.ticket.create({
      data: {
        ...base,
        subject: 'c170 completed but due soon',
        status: 'IN_PROGRESS',
        assigneeId: fixtureUserIds.agent,
        dueAt: new Date(now.getTime() + 30 * 60_000),
        completedAt: now,
      },
    });

    // resolvedThisWeek — resolved, updated just now, so within seven days.
    await prisma.ticket.create({
      data: {
        ...base,
        subject: 'c169 resolved this week',
        status: 'RESOLVED',
        completedAt: now,
        resolvedAt: now,
      },
    });

    // reopened
    await prisma.ticket.create({
      data: { ...base, subject: 'c169 reopened', status: 'REOPENED' },
    });

    // watching — a follower who is NEITHER assignee nor requester. The
    // assignee is set to somebody else precisely so the null-safe `<>` clauses
    // in the SQL are exercised on a non-null column.
    const watched = await prisma.ticket.create({
      data: {
        ...base,
        subject: 'c169 watching',
        status: 'IN_PROGRESS',
        assigneeId: fixtureUserIds.agent,
      },
    });
    await prisma.ticketFollower.create({
      data: { ticketId: watched.id, userId: fixtureUserIds.owner },
    });
    // A second follower row for a user who IS the assignee, which must NOT be
    // counted for them - the clause that excludes it is the easiest to lose.
    await prisma.ticketFollower.create({
      data: { ticketId: watched.id, userId: fixtureUserIds.agent },
    });

    // mentions — one unread mention for the owner, and one already-read
    // mention on another ticket, which must not be counted.
    const mentioned = await prisma.ticket.create({
      data: { ...base, subject: 'c169 mentioned', status: 'IN_PROGRESS' },
    });
    const readMention = await prisma.ticket.create({
      data: { ...base, subject: 'c169 mention read', status: 'IN_PROGRESS' },
    });
    await prisma.notification.createMany({
      data: [
        {
          userId: fixtureUserIds.owner,
          type: 'TICKET_MENTIONED',
          ticketId: mentioned.id,
          isRead: false,
          title: 'You were mentioned',
          body: 'c169',
        },
        {
          userId: fixtureUserIds.owner,
          type: 'TICKET_MENTIONED',
          ticketId: readMention.id,
          isRead: true,
          title: 'You were mentioned',
          body: 'c169',
        },
      ],
    });

    // followUpsDueToday — assigned to the owner, due LATER today.
    //
    // ⚠️ NOT PAST-DUE, and this cost a debugging round. A follow-up dated in
    // the past is claimed and CLEARED by
    // automation-scheduler.service.ts:250-278 the moment `createTestApp()`
    // boots the scheduler, so the row arrives with `followUpAt: null` and the
    // badge reads zero - which the count and the list agreed on, so the
    // comparison passed while proving nothing. The badge means "already due
    // plus the rest of today", so a time later today exercises it without
    // being eaten. `min` keeps it inside today even if the suite runs at 23:57.
    const laterToday = new Date(
      Math.min(endOfTodayForSeed().getTime(), now.getTime() + 5 * 60_000),
    );
    await prisma.ticket.create({
      data: {
        ...base,
        subject: 'c169 follow-up',
        status: 'IN_PROGRESS',
        assigneeId: fixtureUserIds.owner,
        followUpAt: laterToday,
      },
    });
  }

  const countsFor = async (email: string) => {
    const query = new URLSearchParams(BOUNDARIES).toString();
    const response = await request(server)
      .get(`/api/tickets/counts?${query}`)
      .set(authHeader(email))
      .expect(200);
    return response.body as Record<string, number>;
  };

  const listTotal = async (email: string, query: string) => {
    const response = await request(server)
      .get(`/api/tickets?${query}&pageSize=1`)
      .set(authHeader(email))
      .expect(200);
    return (response.body as { meta: { total: number } }).meta.total;
  };

  /**
   * Every sidebar badge, with the query string its row navigates to.
   *
   * ⚠️ THESE STRINGS ARE WRITTEN OUT ON PURPOSE. Deriving them from
   * `SAVED_VIEWS.buildQuery()` looks tidier and would make this test WORSE,
   * because the browser's effective request is `buildQuery()` PLUS the
   * `presetStatus` fallback in useFilters.ts:42-45 - ambient React state that no
   * amount of reading `saved-views.ts` reveals. A table derived from
   * `buildQuery()` alone would stop modelling what the browser actually sends.
   *
   * Card 1.71 made `unassigned` state `statusGroup=open` in its own link, so for
   * that row the two now coincide. `sla-at-risk` still emits no status filter
   * and relies on the fallback, so they do not coincide for it. Written out,
   * this table keeps saying what the request IS rather than what one file
   * suggests it might be.
   */
  const BADGES: Array<{ label: string; field: string; query: string }> = [
    {
      label: 'SEV1 today',
      field: 'sev1Today',
      query: `priorities=SEV1&createdFrom=${BOUNDARIES.todayFrom}`,
    },
    {
      label: 'Awaiting reply > 24h',
      field: 'awaitingReplyOver24h',
      query: `statuses=WAITING_ON_REQUESTER,WAITING_ON_VENDOR&updatedTo=${BOUNDARIES.awaitingUpdatedTo}`,
    },
    { label: 'Breach risk', field: 'atRisk', query: 'slaStatus=at_risk' },
    {
      label: 'Unassigned',
      // ⚠️ CARD 1.70 ①: the OPEN-only definition, and the query changes with
      // it. The badge and the list it opens have to mean the same thing, so
      // both now say "unassigned AND open".
      field: 'unassigned',
      query: 'scope=unassigned&statusGroup=open',
    },
    {
      label: 'Resolved this week',
      field: 'resolvedThisWeek',
      query: `statusGroup=resolved&updatedFrom=${BOUNDARIES.resolvedUpdatedFrom}`,
    },
    { label: 'Reopened', field: 'reopened', query: 'statuses=REOPENED' },
    { label: 'Watching', field: 'watching', query: 'scope=watching' },
    { label: 'Mentions', field: 'mentions', query: 'scope=mentions' },
    {
      label: 'Follow-ups due today',
      field: 'followUpsDueToday',
      query: 'scope=followups',
    },
  ];

  // Four roles, because the access condition differs per role and a count that
  // agreed with the list only for an OWNER (whose condition is TRUE) would be
  // the easiest possible false pass.
  for (const email of [
    fixtureEmails.owner,
    fixtureEmails.agent,
    fixtureEmails.requester,
  ]) {
    describe(`as ${email}`, () => {
      it.each(BADGES)(
        '⚠️ "$label" ($field) equals the list it navigates to',
        async ({ field, query }) => {
          // THE ASSERTION THE WHOLE OF STEP 4 RESTS ON. A badge that does not
          // equal the list behind it is worse than the request storm it
          // replaced: the storm was slow, this would be wrong.
          const [counts, total] = await Promise.all([
            countsFor(email),
            listTotal(email, query),
          ]);
          expect(counts[field]).toBe(total);
        },
      );
    });
  }

  describe('the two unassigned definitions', () => {
    it('⚠️ they are NOT the same number, which is why the badge needed a new field', async () => {
      // FOUND BY THE TEST, NOT BY READING, and the reason the seeded fixture
      // above was worth the effort. `unassigned` predates this card and means
      // "open AND assigneeId IS NULL"; the sidebar preset links to
      // `scope=unassigned`, which in buildListWhere means only
      // "assigneeId IS NULL". They differ by the unassigned resolved/closed
      // tickets - and mapping the badge onto the old field would have dropped
      // it by exactly that much on the day it shipped. DashboardPage and
      // getSidebarChildBadge both read the open-only one, so widening it was
      // not available either.
      const counts = await countsFor(fixtureEmails.owner);
      expect(counts.unassigned).toBe(
        await listTotal(
          fixtureEmails.owner,
          'scope=unassigned&statusGroup=open',
        ),
      );
    });

    it('⚠️ does NOT count an unassigned resolved ticket', async () => {
      // THE REGRESSION ASSERTION FOR CARD 1.70 ①. The fixture seeds exactly
      // one such row ('c169 resolved this week': no assignee, status
      // RESOLVED). An unassigned resolved ticket needs nobody, and the badge
      // exists to surface work no one has picked up - so counting it was the
      // defect. The any-status figure would include it; this one must not.
      const counts = await countsFor(fixtureEmails.owner);
      const anyStatus = await listTotal(
        fixtureEmails.owner,
        'scope=unassigned',
      );
      expect(anyStatus).toBeGreaterThan(counts.unassigned);
    });
  });

  describe('the at-risk definition, now singular', () => {
    it('⚠️ the count and the list agree, because they read one setting', async () => {
      // INVERTED BY CARD 1.70 ②. This used to assert that the two DISAGREED
      // and that the disagreement was deliberate - the list on a hard-coded
      // four hours, the count on SLA_AT_RISK_THRESHOLD_MINUTES, and only the
      // list respecting completedAt. Card 1.69 step 4 was not allowed to pick
      // one; the owner has now picked the setting. Equality here is the fix.
      const counts = await countsFor(fixtureEmails.owner);
      expect(counts.atRisk).toBe(
        await listTotal(fixtureEmails.owner, 'slaStatus=at_risk'),
      );
      // ...and both are the pinned value, so this cannot pass by both sides
      // being wrong in the same direction - which is exactly what happened
      // when only the comparison was asserted.
      expect(counts.atRisk).toBe(1);
    });

    it('⚠️ does NOT count a completed ticket as at risk', async () => {
      // THE REGRESSION ASSERTION FOR CARD 1.70 ②'s second part. The fixture
      // seeds a ticket due inside the window with `completedAt` set: a
      // completed ticket cannot breach. The list has always excluded it and
      // this count did not, which is half of why the two disagreed.
      // ⚠️ PINNED TO AN EXACT NUMBER, not compared to the list, and that
      // matters. Comparing count-to-list looked sufficient and was not:
      // reverting BOTH halves of this card moves both sides to 2, so the
      // comparison passes while the fix is gone. Measured, not assumed.
      //
      // Exactly three tickets in the fixture carry a due date:
      //   +2h,  not completed  -> counted          (the only one)
      //   +3h,  not completed  -> outside the 120-minute window
      //   +30m, COMPLETED      -> completed tickets cannot breach
      // So the answer is 1, and it discriminates every way of getting this
      // wrong: ignoring completedAt gives 2, a four-hour window gives 2, and
      // ignoring the window altogether gives 3.
      const counts = await countsFor(fixtureEmails.owner);
      const prisma = getPrisma();
      const dueRows = await prisma.ticket.count({
        where: { dueAt: { not: null } },
      });
      expect(dueRows).toBe(3);
      expect(counts.atRisk).toBe(1);
      expect(counts.atRisk).toBe(
        await listTotal(fixtureEmails.owner, 'slaStatus=at_risk'),
      );
    });

    it('⚠️ reports the threshold the numbers were computed with', async () => {
      // THE ASSERTION THAT STOPS THE LABEL ROTTING. The sidebar renders
      // `Breach risk · <this>` rather than a literal, so if this stops
      // following the setting the words on the badge go stale again - which is
      // how one idea ended up with three values. Asserted against the env var
      // rather than a constant, so it cannot pass by coincidence.
      const configured = Number(
        process.env.SLA_AT_RISK_THRESHOLD_MINUTES ?? 120,
      );
      const counts = await countsFor(fixtureEmails.owner);
      expect(counts.atRiskThresholdMinutes).toBe(configured);
    });
  });

  describe('the fixture itself', () => {
    it('⚠️ makes every one of the nine badges non-zero for somebody', async () => {
      // THE GUARD AGAINST THIS SUITE ROTTING INTO DECORATION. Measured: in the
      // base fixture all eight new counts were 0 for all three roles, so every
      // comparison above was `0 === 0`. If a future change to the fixtures
      // takes a badge back to zero everywhere, this fails and says which one
      // rather than letting 27 assertions go quietly vacuous.
      const [owner, agent, requester] = await Promise.all([
        countsFor(fixtureEmails.owner),
        countsFor(fixtureEmails.agent),
        countsFor(fixtureEmails.requester),
      ]);
      const zeroEverywhere = BADGES.filter(
        ({ field }) =>
          !owner[field] && !agent[field] && !requester[field],
      ).map(({ label }) => label);
      expect(zeroEverywhere).toEqual([]);
    });

    it('⚠️ has a ticket on each side of the window, so the threshold is testable', async () => {
      // REPURPOSED BY CARD 1.70. It used to prove the four-hour and two-hour
      // windows produced different numbers. With one definition left, the same
      // two rows now prove the fixture can still tell INSIDE the window from
      // OUTSIDE it - due in two hours and in three, against a 120-minute
      // default. Without that, an at-risk count that returned everything with
      // a due date would pass every assertion above.
      const counts = await countsFor(fixtureEmails.owner);
      const prisma = getPrisma();
      const withDueDate = await prisma.ticket.count({
        where: { subject: { startsWith: 'c169 breach risk' } },
      });
      expect(withDueDate).toBe(2);
      expect(counts.atRisk).toBeLessThan(withDueDate);
      expect(counts.atRisk).toBeGreaterThan(0);
    });

    it('does not count a mention that has been read', async () => {
      // The discriminating half of the mentions count.
      const counts = await countsFor(fixtureEmails.owner);
      expect(counts.mentions).toBe(1);
    });

    it('does not count a followed ticket the user is assigned to', async () => {
      // The agent follows the same ticket they are assigned; Watching is for
      // explicit subscriptions outside the default relationships.
      const counts = await countsFor(fixtureEmails.agent);
      expect(counts.watching).toBe(0);
    });
  });

  describe('the boundaries', () => {
    it('⚠️ returns 0 for the three date-dependent counts when none are given', async () => {
      // Absent means 0, deliberately, rather than a guessed boundary: a guess
      // would be a number nobody could explain. The old caller (App.tsx sent
      // no query at all) therefore sees zeros for three counts it never read,
      // and the sidebar always sends them.
      const response = await request(server)
        .get('/api/tickets/counts')
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      const counts = response.body as Record<string, number>;
      expect(counts.sev1Today).toBe(0);
      expect(counts.awaitingReplyOver24h).toBe(0);
      expect(counts.resolvedThisWeek).toBe(0);
      // ...and the boundary-independent ones are still real.
      expect(typeof counts.open).toBe('number');
      expect(typeof counts.reopened).toBe('number');
    });

    it('⚠️ does not serve one boundary set’s numbers from another’s cache', async () => {
      // The cache holds ONE entry per user with the boundaries inside the
      // value. Without the comparison on read, this call would return the
      // zeros cached by the test above - the exact bug that made storing them
      // in the value worth doing rather than assuming a single caller.
      const withDates = await countsFor(fixtureEmails.owner);
      const listed = await listTotal(
        fixtureEmails.owner,
        `priorities=SEV1&createdFrom=${BOUNDARIES.todayFrom}`,
      );
      expect(withDates.sev1Today).toBe(listed);
    });

    it('rejects a boundary that is not a bare date', async () => {
      // Narrow on purpose - a full timestamp would shift a badge by up to a
      // day depending on how the caller spelled it.
      await request(server)
        .get('/api/tickets/counts?todayFrom=2026-09-10T00:00:00.000Z')
        .set(authHeader(fixtureEmails.owner))
        .expect(400);
    });

    it('⚠️ rejects anything that selects tickets', async () => {
      // THE ASSERTION AGAINST THE EXFILTRATION ORACLE the card rules out. The
      // global ValidationPipe runs forbidNonWhitelisted, so a filter parameter
      // is a 400 rather than something quietly ignored - which matters,
      // because "ignored" is one refactor away from "honoured".
      for (const query of [
        'requesterId=someone-else',
        'assigneeId=someone-else',
        'teamId=other-team',
        'statuses=NEW',
      ]) {
        await request(server)
          .get(`/api/tickets/counts?${query}`)
          .set(authHeader(fixtureEmails.requester))
          .expect(400);
      }
    });
  });
});
