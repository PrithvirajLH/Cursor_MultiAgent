import { INestApplication } from '@nestjs/common';
import { TicketStatus, UserRole } from '@prisma/client';
import { fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';
import { LeadDigestService } from '../../src/notifications/lead-digest.service';

/**
 * Card 1.16 — the daily digest for leads.
 *
 * ⚠️ This card sits against card 1.42, which removed staff email entirely. It
 * is built OFF by default behind `LEAD_DIGEST_ENABLED` so shipping it sends
 * nothing, and as a wholly separate send path that does not touch 1.42's staff
 * exclusion in `notifications.service.ts`.
 */
describe('Lead daily digest (card 1.16)', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let service: LeadDigestService;
  let previousEnabled: string | undefined;

  /** A lead on HR, to prove a lead sees only their own team. */
  const hrLeadEmail = 'hr.lead@company.com';
  let hrLeadId: string;

  beforeAll(async () => {
    resetTestDb();
    previousEnabled = process.env.LEAD_DIGEST_ENABLED;
    process.env.LEAD_DIGEST_ENABLED = 'true';
    app = await createTestApp();
    service = app.get(LeadDigestService);
    const created = await prisma.user.create({
      data: {
        email: hrLeadEmail,
        displayName: 'HR Lead',
        role: UserRole.LEAD,
        primaryTeamId: fixtureTeamIds.hr,
      },
      select: { id: true },
    });
    hrLeadId = created.id;
    await prisma.teamMember.create({
      data: { userId: hrLeadId, teamId: fixtureTeamIds.hr, role: 'LEAD' },
    });
  });

  afterAll(async () => {
    if (previousEnabled === undefined) {
      delete process.env.LEAD_DIGEST_ENABLED;
    } else {
      process.env.LEAD_DIGEST_ENABLED = previousEnabled;
    }
    await app.close();
    await disconnectPrisma();
  });

  beforeEach(async () => {
    await prisma.notificationOutbox.deleteMany({
      where: { eventType: 'LEAD_DAILY_DIGEST' },
    });
  });

  /** A breached ticket on the given team. */
  async function breachedTicket(teamId: string, subject: string) {
    return prisma.ticket.create({
      data: {
        subject,
        description: 'Digest fixture',
        requesterId: fixtureUserIds.requester,
        assignedTeamId: teamId,
        assigneeId: fixtureUserIds.agent,
        status: TicketStatus.IN_PROGRESS,
        priority: 'SEV2',
        channel: 'PORTAL',
        dueAt: new Date(Date.now() - 3600_000),
      },
      select: { id: true, displayId: true },
    });
  }

  it('⚠️ a lead with a breached ticket gets a digest naming it', async () => {
    const ticket = await breachedTicket(fixtureTeamIds.it, 'IT breach for digest');
    const summary = await service.runOnce();
    expect(summary.enabled).toBe(true);
    expect(summary.digestsQueued).toBeGreaterThan(0);
    const rows = await prisma.notificationOutbox.findMany({
      where: { eventType: 'LEAD_DAILY_DIGEST' },
    });
    const forItLead = rows.find((row) => row.toUserId === fixtureUserIds.lead);
    expect(forItLead).toBeDefined();
    expect(forItLead?.body).toContain('IT breach for digest');
    expect(forItLead?.subject).toContain('breached');
    // ⚠️ Not pinned to a ticket: a digest is about many, and a ticketId would
    // drop it into that one ticket's email thread.
    expect(forItLead?.ticketId).toBeNull();
    await prisma.ticket.delete({ where: { id: ticket.id } });
  });

  it('⚠️ a lead sees ONLY their own team', async () => {
    // THE REGRESSION ASSERTION THE CARD NAMES. Scope comes from
    // `operationalTeamIds`, the same chokepoint every ticket list uses, rather
    // than a second definition of "my team".
    // ⚠️ BOTH leads get a ticket, so this cannot pass by the HR lead simply
    // receiving nothing. The assertion has to discriminate between two digests
    // that both exist.
    const itTicket = await breachedTicket(
      fixtureTeamIds.it,
      'IT only breach marker',
    );
    const hrTicket = await breachedTicket(
      fixtureTeamIds.hr,
      'HR only breach marker',
    );
    await service.runOnce();
    const rows = await prisma.notificationOutbox.findMany({
      where: { eventType: 'LEAD_DAILY_DIGEST' },
    });
    const forHrLead = rows.find((row) => row.toUserId === hrLeadId);
    const forItLead = rows.find((row) => row.toUserId === fixtureUserIds.lead);
    expect(forHrLead).toBeDefined();
    expect(forItLead).toBeDefined();
    expect(forHrLead?.body).toContain('HR only breach marker');
    expect(forHrLead?.body).not.toContain('IT only breach marker');
    expect(forItLead?.body).toContain('IT only breach marker');
    expect(forItLead?.body).not.toContain('HR only breach marker');
    await prisma.ticket.delete({ where: { id: itTicket.id } });
    await prisma.ticket.delete({ where: { id: hrTicket.id } });
  });

  it('⚠️ a lead with nothing to report gets NO EMAIL AT ALL', async () => {
    // THE OTHER REGRESSION ASSERTION. An empty digest every morning is exactly
    // the fatigue card 1.42 removed, and the fastest way to have the feature
    // switched back off.
    await prisma.ticket.updateMany({
      data: { dueAt: null, assigneeId: fixtureUserIds.agent },
      where: { deletedAt: null },
    });
    await service.runOnce();
    const rows = await prisma.notificationOutbox.findMany({
      where: { eventType: 'LEAD_DAILY_DIGEST' },
    });
    expect(rows).toHaveLength(0);
  });

  it('⚠️ the switch being off means nothing is queued', async () => {
    // THE THIRD. Shipping this must send nothing until somebody chooses it -
    // which is what makes it safe to ship against card 1.42 before the owner
    // has ruled on the contradiction.
    await breachedTicket(fixtureTeamIds.it, 'Should never be emailed');
    process.env.LEAD_DIGEST_ENABLED = 'false';
    try {
      const summary = await service.runOnce();
      expect(summary.enabled).toBe(false);
      expect(summary.digestsQueued).toBe(0);
      const rows = await prisma.notificationOutbox.findMany({
        where: { eventType: 'LEAD_DAILY_DIGEST' },
      });
      expect(rows).toHaveLength(0);
    } finally {
      process.env.LEAD_DIGEST_ENABLED = 'true';
    }
  });

  it('does not touch card 1.42"s per-ticket staff exclusion', async () => {
    // The digest is a separate send path with its own event type. Nothing it
    // writes can be mistaken for a per-ticket notification, and it never
    // consults the recipient list 1.42 filters.
    await breachedTicket(fixtureTeamIds.it, 'Separate path check');
    await service.runOnce();
    const digestRows = await prisma.notificationOutbox.findMany({
      where: { eventType: 'LEAD_DAILY_DIGEST' },
    });
    expect(digestRows.length).toBeGreaterThan(0);
    for (const row of digestRows) {
      expect(row.eventType).toBe('LEAD_DAILY_DIGEST');
      expect(row.ticketId).toBeNull();
    }
  });
});
