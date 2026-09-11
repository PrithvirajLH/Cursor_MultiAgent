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
 * Card 1.72 — two spellings of "finished".
 *
 * The counts said `status NOT IN (RESOLVED, CLOSED)`; the list's `slaStatus`
 * branches said `completedAt IS NULL`. They agree only while the invariant
 * "completedAt is set exactly when a ticket is finished" holds, and it has two
 * holes: `20260123151500_add_completed_at` added the column with no backfill,
 * and nothing stops a stamp existing on an open row.
 *
 * ⚠️ THIS SUITE EXISTS BECAUSE THE EXISTING FIXTURE STRUCTURALLY CANNOT CONTAIN
 * THOSE SHAPES. Everything created through the API obeys the invariant, so the
 * divergence was invisible to every other test in the repo. These rows are
 * written with Prisma precisely to break it.
 *
 * ⚠️ AND THE HANDOFF'S SUGGESTED FIX COULD NOT BE TAKEN. It proposed
 * `completedAt IS NULL` as the single spelling; its own required assertion is
 * that a legacy RESOLVED row with a null stamp be excluded by BOTH, and
 * `completedAt IS NULL` alone includes it. Finished means EITHER signal.
 */
describe('one definition of finished (card 1.72)', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    await resetTestDb();
    await seedTheShapesTheApiCannotMake();
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
   * Four rows, each one a different corner of the invariant.
   *
   * The base fixture contributes nothing here - measured: `atRisk` and
   * `overdue` are both 0 on a fresh reset - so every number below comes from
   * these four and can be pinned exactly.
   */
  async function seedTheShapesTheApiCannotMake(): Promise<void> {
    const prisma = getPrisma();
    const now = Date.now();
    const base = {
      description: 'card 1.72 fixture',
      assignedTeamId: fixtureTeamIds.it,
      requesterId: fixtureUserIds.requester,
      assigneeId: fixtureUserIds.agent,
    };
    await prisma.ticket.createMany({
      data: [
        {
          ...base,
          subject: 'c172 legacy finished, past due',
          status: 'RESOLVED',
          completedAt: null,
          dueAt: new Date(now - 3 * 60 * 60_000),
        },
        {
          ...base,
          subject: 'c172 legacy finished, due soon',
          status: 'RESOLVED',
          completedAt: null,
          dueAt: new Date(now + 30 * 60_000),
        },
        {
          ...base,
          subject: 'c172 genuinely overdue',
          status: 'IN_PROGRESS',
          completedAt: null,
          dueAt: new Date(now - 2 * 60 * 60_000),
        },
        {
          ...base,
          subject: 'c172 stamped but still open, past due',
          status: 'IN_PROGRESS',
          completedAt: new Date(now - 60 * 60_000),
          dueAt: new Date(now - 90 * 60_000),
        },
      ],
    });
  }

  const counts = async () => {
    const response = await request(server)
      .get('/api/tickets/counts')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    return response.body as Record<string, number>;
  };

  const listTotal = async (query: string) => {
    const response = await request(server)
      .get(`/api/tickets?pageSize=1&${query}`)
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    return (response.body as { meta: { total: number } }).meta.total;
  };

  it('⚠️ a legacy finished ticket is not overdue, in the count OR the list', () => {
    // THE WHOLE CARD. RESOLVED with a null stamp and a due date three hours
    // past. The count always excluded it (status); the list counted it as
    // breached forever (stamp). Pinned to exact numbers rather than to each
    // other - card 1.70's lesson, where comparing the two passed while both
    // sides were wrong together.
    return Promise.all([counts(), listTotal('slaStatus=breached')]).then(
      ([c, breached]) => {
        // Only 'c172 genuinely overdue' qualifies. The legacy row is finished,
        // and the stamped-but-open row is finished too.
        expect(c.overdue).toBe(1);
        expect(breached).toBe(1);
      },
    );
  });

  it('⚠️ a legacy finished ticket is not at risk either', async () => {
    // The same shape inside the at-risk window rather than past it.
    const [c, atRisk] = await Promise.all([
      counts(),
      listTotal('slaStatus=at_risk'),
    ]);
    // 'c172 legacy finished, due soon' is the only row in the window, and it is
    // finished - so nothing is at risk.
    expect(c.atRisk).toBe(0);
    expect(atRisk).toBe(0);
  });

  it('⚠️ a stamp on an open ticket also means finished', async () => {
    // The other hole, and the one the COUNT used to fall through. Status says
    // open, the stamp says done; the list excluded it and `overdue` did not.
    const prisma = getPrisma();
    const stamped = await prisma.ticket.count({
      where: {
        subject: 'c172 stamped but still open, past due',
        completedAt: { not: null },
        status: 'IN_PROGRESS',
      },
    });
    expect(stamped).toBe(1);
    const c = await counts();
    // It is past due and open by status, so a status-only definition counts it.
    expect(c.overdue).toBe(1);
  });

  it('the genuinely unfinished one IS counted, so this is not vacuous', async () => {
    // Without this the suite would pass on an implementation that excluded
    // everything.
    const c = await counts();
    expect(c.overdue).toBeGreaterThan(0);
    expect(await listTotal('slaStatus=breached')).toBeGreaterThan(0);
  });

  it('⚠️ the count and the list agree on every sla bucket', async () => {
    // The parity that card 1.70 established for at_risk, now extended to
    // breached - which is the pair this card actually unified.
    const c = await counts();
    expect(c.overdue).toBe(await listTotal('slaStatus=breached'));
    expect(c.atRisk).toBe(await listTotal('slaStatus=at_risk'));
  });
});
