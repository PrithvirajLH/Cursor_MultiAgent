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

/**
 * Card 1.12 — tagging and macros across a selection.
 *
 * The two things these tests exist to hold down:
 *
 *  1. **Permission is per ticket.** A selection can span teams, and a bulk
 *     endpoint is exactly where a role check gets done once and then applied to
 *     twenty rows. `attachManyToTicket` says in its own comment that it skips
 *     access control because its caller is trusted, so if the caller stops
 *     checking, tagging becomes a way to write to anybody's ticket.
 *  2. **The outcome is per ticket.** A macro rolls back on a ticket whose
 *     status transition is illegal (card 1.7), and across twenty tickets some
 *     will be in such a state. One awkward ticket must not block nineteen good
 *     ones, and the agent must be able to see which failed.
 */
describe('Bulk tags and bulk macro (card 1.12)', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;

  let seq = 0;
  const unique = () => {
    seq += 1;
    return `${Date.now()}${seq}`;
  };

  async function plantTicket(opts: {
    teamId: string | null;
    status?: 'NEW' | 'ASSIGNED' | 'IN_PROGRESS';
  }) {
    return prisma.ticket.create({
      data: {
        subject: `Bulk fixture ${unique()}`,
        description: 'Fixture',
        requesterId: fixtureUserIds.requester,
        assignedTeamId: opts.teamId,
        assigneeId: opts.teamId === fixtureTeamIds.it ? fixtureUserIds.agent : null,
        status: opts.status ?? 'ASSIGNED',
      },
      select: { id: true },
    });
  }

  const tagsOf = async (ticketId: string) => {
    const rows = await prisma.ticketTag.findMany({
      where: { ticketId },
      select: { tag: { select: { name: true } } },
    });
    return rows.map((row) => row.tag.name).sort();
  };

  const bulkTags = (body: Record<string, unknown>, email: string) =>
    request(server)
      .post('/api/tickets/bulk/tags')
      .set(authHeader(email))
      .send(body);

  const bulkMacro = (body: Record<string, unknown>, email: string) =>
    request(server)
      .post('/api/tickets/bulk/macro')
      .set(authHeader(email))
      .send(body);

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  describe('bulk tags', () => {
    it('adds a tag to every ticket in the selection', async () => {
      const a = await plantTicket({ teamId: fixtureTeamIds.it });
      const b = await plantTicket({ teamId: fixtureTeamIds.it });
      const res = await bulkTags(
        { ticketIds: [a.id, b.id], add: ['vpn', 'Laptop'] },
        fixtureEmails.lead,
      );
      expect(res.status).toBe(201);
      expect(res.body.data.errors).toEqual([]);
      expect(res.body.data.success).toBe(2);
      expect(res.body.data.failed).toBe(0);
      // Normalised the same way a single-ticket tag is: lowercased.
      expect(await tagsOf(a.id)).toEqual(['laptop', 'vpn']);
      expect(await tagsOf(b.id)).toEqual(['laptop', 'vpn']);
    });

    it('removes a tag, and is untroubled by tickets that never had it', async () => {
      const has = await plantTicket({ teamId: fixtureTeamIds.it });
      const hasNot = await plantTicket({ teamId: fixtureTeamIds.it });
      await bulkTags({ ticketIds: [has.id], add: ['stale'] }, fixtureEmails.lead);
      const res = await bulkTags(
        { ticketIds: [has.id, hasNot.id], remove: ['stale'] },
        fixtureEmails.lead,
      );
      expect(res.status).toBe(201);
      // Both count as successes. Removing a tag from a ticket that does not
      // carry it is a no-op, not a failure.
      expect(res.body.data.success).toBe(2);
      expect(await tagsOf(has.id)).toEqual([]);
    });

    it('adds and removes in one call', async () => {
      const t = await plantTicket({ teamId: fixtureTeamIds.it });
      await bulkTags({ ticketIds: [t.id], add: ['old'] }, fixtureEmails.lead);
      await bulkTags(
        { ticketIds: [t.id], add: ['new'], remove: ['old'] },
        fixtureEmails.lead,
      );
      expect(await tagsOf(t.id)).toEqual(['new']);
    });

    it('⚠️ checks write access PER TICKET across a mixed selection', async () => {
      // The agent is on IT. The HR ticket is one they can neither write nor,
      // in this shape, see - and it must come back as a named failure rather
      // than being tagged or silently dropped from the count.
      const mine = await plantTicket({ teamId: fixtureTeamIds.it });
      const theirs = await plantTicket({ teamId: fixtureTeamIds.hr });
      const res = await bulkTags(
        { ticketIds: [mine.id, theirs.id], add: ['spans-teams'] },
        fixtureEmails.agent,
      );
      expect(res.status).toBe(201);
      expect(res.body.data.success).toBe(1);
      expect(res.body.data.failed).toBe(1);
      expect(res.body.data.succeededTicketIds).toEqual([mine.id]);
      expect(res.body.data.failedTicketIds).toEqual([theirs.id]);
      expect(await tagsOf(mine.id)).toEqual(['spans-teams']);
      expect(await tagsOf(theirs.id)).toEqual([]);
    });

    it('refuses a requester outright', async () => {
      const t = await plantTicket({ teamId: fixtureTeamIds.it });
      const res = await bulkTags(
        { ticketIds: [t.id], add: ['nope'] },
        fixtureEmails.requester,
      );
      expect(res.status).toBe(403);
      expect(await tagsOf(t.id)).toEqual([]);
    });

    it('refuses a call that would do nothing', async () => {
      const t = await plantTicket({ teamId: fixtureTeamIds.it });
      const res = await bulkTags({ ticketIds: [t.id] }, fixtureEmails.lead);
      expect(res.status).toBe(400);
    });

    it('refuses a malformed tag once, not once per ticket', async () => {
      const a = await plantTicket({ teamId: fixtureTeamIds.it });
      const b = await plantTicket({ teamId: fixtureTeamIds.it });
      const res = await bulkTags(
        { ticketIds: [a.id, b.id], add: ['   '] },
        fixtureEmails.lead,
      );
      expect(res.status).toBe(400);
      expect(await tagsOf(a.id)).toEqual([]);
    });

    it('creates a BRAND NEW tag across many tickets at once', async () => {
      // The bug this found. `Tag.name` is unique and the create was a plain
      // upsert, so five concurrent workers all missed on the read and four
      // lost the insert - bulk-tagging with a tag that did not exist yet
      // failed on most of the selection. Ten tickets, one new tag, no
      // pre-warming.
      const tickets = [];
      for (let i = 0; i < 10; i += 1) {
        tickets.push(await plantTicket({ teamId: fixtureTeamIds.it }));
      }
      const name = `race-${unique()}`;
      const res = await bulkTags(
        { ticketIds: tickets.map((t) => t.id), add: [name] },
        fixtureEmails.lead,
      );
      expect(res.body.data.errors).toEqual([]);
      expect(res.body.data.success).toBe(10);
      for (const t of tickets) {
        expect(await tagsOf(t.id)).toContain(name);
      }
      // And exactly one Tag row exists for it.
      expect(await prisma.tag.count({ where: { name } })).toBe(1);
    });

    it('caps the selection at 100', async () => {
      const ids = Array.from(
        { length: 101 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      );
      const res = await bulkTags(
        { ticketIds: ids, add: ['too-many'] },
        fixtureEmails.lead,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('bulk macro', () => {
    /** A macro owned by the LEAD, shared with IT. */
    async function plantMacro(actions: unknown[]) {
      return prisma.cannedResponse.create({
        data: {
          name: `bulk macro ${unique()}`,
          content: 'Hello {{requester.firstName}}, this is the reply text.',
          userId: fixtureUserIds.lead,
          teamId: fixtureTeamIds.it,
          actions: actions as never,
        },
        select: { id: true },
      });
    }

    it('applies the actions to every ticket', async () => {
      const macro = await plantMacro([
        { type: 'add_tag', tags: ['bulk-macro'] },
        { type: 'set_priority', priority: 'SEV2' },
      ]);
      const a = await plantTicket({ teamId: fixtureTeamIds.it });
      const b = await plantTicket({ teamId: fixtureTeamIds.it });
      const res = await bulkMacro(
        { ticketIds: [a.id, b.id], cannedResponseId: macro.id },
        fixtureEmails.lead,
      );
      expect(res.status).toBe(201);
      expect(res.body.data.errors).toEqual([]);
      expect(res.body.data.success).toBe(2);
      for (const id of [a.id, b.id]) {
        const ticket = await prisma.ticket.findUniqueOrThrow({
          where: { id },
          select: { priority: true },
        });
        expect(ticket.priority).toBe('SEV2');
        expect(await tagsOf(id)).toContain('bulk-macro');
      }
    });

    it('⚠️ never posts the macro text as a message', async () => {
      // Card 1.7 hands the text to the composer instead of sending it, and
      // there is no composer for twenty tickets. If this ever fails, somebody
      // has given bulk a send path that skips every rule the composer enforces.
      const macro = await plantMacro([{ type: 'add_tag', tags: ['quiet'] }]);
      const t = await plantTicket({ teamId: fixtureTeamIds.it });
      const before = await prisma.ticketMessage.count({
        where: { ticketId: t.id },
      });
      await bulkMacro(
        { ticketIds: [t.id], cannedResponseId: macro.id },
        fixtureEmails.lead,
      );
      expect(await prisma.ticketMessage.count({ where: { ticketId: t.id } })).toBe(
        before,
      );
      // And nothing was queued to anybody either.
      expect(
        await prisma.notificationOutbox.count({ where: { ticketId: t.id } }),
      ).toBe(0);
    });

    it('reports per ticket when a status change is illegal for some', async () => {
      // NEW -> RESOLVED is not a legal transition, so the macro rolls back on
      // that ticket and succeeds on the other. This is the whole reason the
      // card chose per-ticket over all-or-nothing.
      const macro = await plantMacro([
        { type: 'set_status', status: 'RESOLVED' },
      ]);
      const legal = await plantTicket({
        teamId: fixtureTeamIds.it,
        status: 'IN_PROGRESS',
      });
      const illegal = await plantTicket({
        teamId: fixtureTeamIds.it,
        status: 'NEW',
      });
      const res = await bulkMacro(
        { ticketIds: [legal.id, illegal.id], cannedResponseId: macro.id },
        fixtureEmails.lead,
      );
      expect(res.status).toBe(201);
      expect(res.body.data.success).toBe(1);
      expect(res.body.data.failed).toBe(1);
      expect(res.body.data.failedTicketIds).toEqual([illegal.id]);
      // The message says which one and why, rather than "1 failed".
      expect(res.body.data.errors[0].ticketId).toBe(illegal.id);
      expect(String(res.body.data.errors[0].message).length).toBeGreaterThan(0);
      expect(
        (
          await prisma.ticket.findUniqueOrThrow({
            where: { id: illegal.id },
            select: { status: true },
          })
        ).status,
      ).toBe('NEW');
      expect(
        (
          await prisma.ticket.findUniqueOrThrow({
            where: { id: legal.id },
            select: { status: true },
          })
        ).status,
      ).toBe('RESOLVED');
    });

    it('⚠️ still refuses a forbidden action, on every ticket', async () => {
      // A macro row saved before the allowlist existed, or written straight to
      // the database. The execute-time gate is the one it meets.
      const macro = await plantMacro([
        { type: 'add_tag', tags: ['allowed'] },
        { type: 'send_email', to: 'requester', subject: 's', body: 'b' },
      ]);
      const t = await plantTicket({ teamId: fixtureTeamIds.it });
      const res = await bulkMacro(
        { ticketIds: [t.id], cannedResponseId: macro.id },
        fixtureEmails.lead,
      );
      expect(res.status).toBe(201);
      expect(res.body.data.success).toBe(1);
      expect(await tagsOf(t.id)).toContain('allowed');
      expect(
        await prisma.notificationOutbox.count({ where: { ticketId: t.id } }),
      ).toBe(0);
    });

    it('checks write access per ticket here too', async () => {
      const macro = await plantMacro([{ type: 'add_tag', tags: ['mixed'] }]);
      const mine = await plantTicket({ teamId: fixtureTeamIds.it });
      const theirs = await plantTicket({ teamId: fixtureTeamIds.hr });
      const res = await bulkMacro(
        { ticketIds: [mine.id, theirs.id], cannedResponseId: macro.id },
        fixtureEmails.agent,
      );
      expect(res.body.data.success).toBe(1);
      expect(res.body.data.failedTicketIds).toEqual([theirs.id]);
      expect(await tagsOf(theirs.id)).toEqual([]);
    });

    it("refuses a macro the caller cannot see", async () => {
      // Someone else's PRIVATE template, reached by id. 404 rather than 403,
      // the rule card 1.7 set: a 403 would confirm the id is real.
      const priv = await prisma.cannedResponse.create({
        data: {
          name: `private ${unique()}`,
          content: 'Mine.',
          userId: fixtureUserIds.owner,
          teamId: null,
          actions: [{ type: 'add_tag', tags: ['stolen'] }] as never,
        },
        select: { id: true },
      });
      const t = await plantTicket({ teamId: fixtureTeamIds.it });
      const res = await bulkMacro(
        { ticketIds: [t.id], cannedResponseId: priv.id },
        fixtureEmails.lead,
      );
      // Every ticket fails, because the macro itself is refused.
      expect(res.body.data.success).toBe(0);
      expect(await tagsOf(t.id)).toEqual([]);
    });
  });
});
