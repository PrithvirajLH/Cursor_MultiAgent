import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

/**
 * Card 1.60 — one default saved view per user, PER KIND.
 *
 * Making a report view your default silently cleared your default ticket view,
 * because both kinds share one table and `clearOtherDefaults` spanned them.
 * Card 1.53's implementer scoped the clear per kind, got
 * `Unique constraint failed on the fields: (userId)` and backed it out - the
 * database enforced one default per user one level down, in a partial unique
 * index that predates the reports/tickets split.
 *
 * Migration 61 moves the invariant: `viewType` becomes a real column, the index
 * is rekeyed on `(userId, viewType)`, and the JSON key is stripped so there is
 * exactly one discriminator.
 */
describe('a user may hold one default of each kind (card 1.60)', () => {
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

  const createView = (
    name: string,
    viewType: 'tickets' | 'reports',
    isDefault: boolean,
  ) =>
    request(server)
      .post('/api/saved-views')
      .set(authHeader(fixtureEmails.agent))
      .send({ name, viewType, isDefault, filters: { statusGroup: 'open' } });

  it('⚠️ a default report view and a default ticket view coexist', async () => {
    // THE REGRESSION ASSERTION FOR CARD 1.60, and the flow that 500s today.
    // The second create used to violate SavedView_default_per_user, because
    // that index was keyed on userId alone.
    const tickets = await createView('My tickets view', 'tickets', true).expect(
      201,
    );
    const reports = await createView('My reports view', 'reports', true).expect(
      201,
    );

    const prisma = getPrisma();
    const defaults = await prisma.savedView.findMany({
      where: { userId: fixtureUserIds.agent, isDefault: true },
      select: { id: true, viewType: true },
      orderBy: { viewType: 'asc' },
    });
    // BOTH survive. Before this card the first was cleared by the second.
    expect(defaults.map((d) => d.viewType)).toEqual(['reports', 'tickets']);
    expect(defaults.map((d) => d.id).sort()).toEqual(
      [tickets.body.id, reports.body.id].sort(),
    );
  });

  it('⚠️ a second default of the SAME kind still replaces the first', async () => {
    // The other half. Scoping the clear must not weaken it: one default per
    // kind is still exactly one, or the index would reject the write anyway.
    const first = await createView('Ticket view A', 'tickets', true).expect(201);
    const second = await createView('Ticket view B', 'tickets', true).expect(
      201,
    );

    const prisma = getPrisma();
    const ticketDefaults = await prisma.savedView.findMany({
      where: {
        userId: fixtureUserIds.agent,
        isDefault: true,
        viewType: 'tickets',
      },
      select: { id: true },
    });
    expect(ticketDefaults).toHaveLength(1);
    expect(ticketDefaults[0].id).toBe(second.body.id);
    expect(ticketDefaults[0].id).not.toBe(first.body.id);
    // ...and the report default is untouched by any of it.
    const reportDefaults = await prisma.savedView.count({
      where: {
        userId: fixtureUserIds.agent,
        isDefault: true,
        viewType: 'reports',
      },
    });
    expect(reportDefaults).toBe(1);
  });

  it('defaults to tickets when the caller does not say', async () => {
    // The sidebar creates views without naming a kind, which must keep working
    // and must land in the tickets namespace.
    const created = await request(server)
      .post('/api/saved-views')
      .set(authHeader(fixtureEmails.owner))
      .send({ name: 'Unspecified kind', filters: { statusGroup: 'open' } })
      .expect(201);
    expect(created.body.viewType).toBe('tickets');
  });

  it('⚠️ never writes the discriminator back into the filters blob', async () => {
    // THE ASSERTION THAT KEEPS ONE SOURCE OF TRUTH. The column replaces the
    // JSON key; if anything starts writing both, they drift the first time one
    // is edited - the objection 1.53's implementer raised, and the reason
    // migration 61 strips the key rather than leaving it.
    const created = await createView('No key in filters', 'reports', false)
      .expect(201);
    const prisma = getPrisma();
    const row = await prisma.savedView.findUniqueOrThrow({
      where: { id: created.body.id },
      select: { viewType: true, filters: true },
    });
    expect(row.viewType).toBe('reports');
    expect(Object.keys(row.filters as object)).not.toContain('viewType');
  });

  it('rejects a kind that is not one of the two', async () => {
    await request(server)
      .post('/api/saved-views')
      .set(authHeader(fixtureEmails.owner))
      .send({ name: 'Bad kind', viewType: 'dashboards', filters: {} })
      .expect(400);
  });

  it('a rename does not move a view between kinds', async () => {
    // `viewType` omitted on PATCH means "leave it alone". Without that, an
    // ordinary rename would drag a report view into the tickets namespace and
    // take its default with it.
    const created = await createView('Report to rename', 'reports', false)
      .expect(201);
    const renamed = await request(server)
      .patch(`/api/saved-views/${created.body.id}`)
      .set(authHeader(fixtureEmails.agent))
      .send({ name: 'Report renamed' })
      .expect(200);
    expect(renamed.body.viewType).toBe('reports');
  });

  describe('the backfill in migration 61', () => {
    it('⚠️ maps an old report view to reports and an old ticket view to tickets', async () => {
      // The migration has already run by the time any test executes, so its two
      // UPDATE statements are replayed here against rows crafted in the OLD
      // shape - the discriminator inside `filters`, the column still at its
      // default. That is the only honest way to exercise backfill SQL from a
      // suite that starts post-migration, and it runs the statements verbatim.
      const prisma = getPrisma();
      const oldReport = await prisma.savedView.create({
        data: {
          name: 'legacy report',
          filters: { viewType: 'reports', range: '30' },
          userId: fixtureUserIds.owner,
        },
        select: { id: true },
      });
      const oldTicket = await prisma.savedView.create({
        data: {
          name: 'legacy ticket',
          filters: { statusGroup: 'open' },
          userId: fixtureUserIds.owner,
        },
        select: { id: true },
      });

      await prisma.$executeRawUnsafe(
        `UPDATE "SavedView" SET "viewType" = 'reports' WHERE "filters" ->> 'viewType' = 'reports'`,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE "SavedView" SET "filters" = "filters" - 'viewType' WHERE "filters" ? 'viewType'`,
      );

      const report = await prisma.savedView.findUniqueOrThrow({
        where: { id: oldReport.id },
        select: { viewType: true, filters: true },
      });
      const ticket = await prisma.savedView.findUniqueOrThrow({
        where: { id: oldTicket.id },
        select: { viewType: true, filters: true },
      });
      expect(report.viewType).toBe('reports');
      expect(ticket.viewType).toBe('tickets');
      // ...and the key is gone from the one that had it, while the rest of the
      // blob survives untouched.
      expect(Object.keys(report.filters as object)).toEqual(['range']);
      expect(ticket.filters).toEqual({ statusGroup: 'open' });
    });
  });

  describe('the index itself', () => {
    it('⚠️ is keyed on (userId, viewType), and the team guard is untouched', async () => {
      // Read from the database rather than the migration file, so this fails if
      // the statement was written but never applied - and pins that
      // SavedView_default_per_team was deliberately left alone. Card 1.53
      // decided team views cannot be default, so it is unreachable rather than
      // wrong; dropping it would remove a guard for a feature somebody may
      // still want.
      const prisma = getPrisma();
      const rows = await prisma.$queryRawUnsafe<
        Array<{ indexname: string; indexdef: string }>
      >(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'SavedView'`);
      const perUser = rows.find(
        (r) => r.indexname === 'SavedView_default_per_user',
      );
      expect(perUser?.indexdef).toContain('"userId", "viewType"');
      expect(perUser?.indexdef).toContain('isDefault');
      const perTeam = rows.find(
        (r) => r.indexname === 'SavedView_default_per_team',
      );
      expect(perTeam).toBeDefined();
      expect(perTeam?.indexdef).toContain('"teamId"');
    });

    it('⚠️ still has all six trigram indexes', async () => {
      // THE CHECK THAT THE TWELVE DESTRUCTIVE STATEMENTS WERE STRIPPED.
      // Migration 61 legitimately contains one DROP INDEX, which is the point
      // of it - and `migrate diff` would have emitted six more for the trigram
      // GIN indexes Prisma cannot model, plus six DROP DEFAULTs. Shipping those
      // destroys ticket and KB search against a stated sub-500ms requirement,
      // and nothing else in the suite would notice.
      const prisma = getPrisma();
      const rows = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
        `SELECT indexname FROM pg_indexes WHERE indexname LIKE '%trgm_idx' ORDER BY indexname`,
      );
      expect(rows.map((r) => r.indexname)).toEqual([
        'KbArticle_content_trgm_idx',
        'KbArticle_summary_trgm_idx',
        'KbArticle_title_trgm_idx',
        'Ticket_description_trgm_idx',
        'Ticket_displayId_trgm_idx',
        'Ticket_subject_trgm_idx',
      ]);
    });
  });
});
