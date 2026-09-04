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
 * Card 1.7 — macros: canned responses that do things.
 *
 * Two rules carry most of the weight:
 *
 *   1. A MACRO CANNOT SEND EMAIL, on save or on execute. Card 1.42 deleted most
 *      of this system's email to stop noise; a one-click macro that emails puts
 *      it straight back through a side door. The assertion that matters is a
 *      count of ZERO outbox rows, not a response code.
 *   2. THE AUDIT TRAIL MUST SAY A PERSON DID IT. `AutomationExecution` rows are
 *      per-rule and drive automation reporting, so a macro must write none —
 *      otherwise a human's click is reported as a rule firing.
 */
describe('Macros', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  let seq = 0;
  const unique = () => {
    seq += 1;
    return `${Date.now()}${seq}`;
  };

  async function makeTicket(overrides: Record<string, unknown> = {}) {
    seq += 1;
    return prisma.ticket.create({
      data: {
        requesterId: fixtureUserIds.requester,
        subject: `Macro fixture ${seq}`,
        description: 'A ticket for a macro to act on.',
        assignedTeamId: fixtureTeamIds.it,
        assigneeId: fixtureUserIds.agent,
        // ASSIGNED, because a macro's status change goes through the SAME
        // transition table as a manual one - RESOLVED is not reachable from
        // NEW, and the first draft of this spec learned that from a 403.
        status: 'ASSIGNED',
        displayId: `MC_20260904_${String(200 + seq).padStart(3, '0')}`,
        ...overrides,
      },
      select: { id: true, displayId: true },
    });
  }

  function saveMacro(
    body: Record<string, unknown>,
    email: string = fixtureEmails.agent,
  ) {
    return request(server)
      .post('/api/canned-responses')
      .set(authHeader(email))
      .send(body);
  }

  /** Write a macro straight to the database, bypassing the save-time gate. */
  async function plantMacro(actions: unknown[], content = 'Planted.') {
    return prisma.cannedResponse.create({
      data: {
        name: `planted ${unique()}`,
        content,
        actions: actions as never,
        userId: fixtureUserIds.agent,
      },
      select: { id: true },
    });
  }

  const render = (macroId: string, ticketId: string, email: string) =>
    request(server)
      .post(`/api/canned-responses/${macroId}/render?ticketId=${ticketId}`)
      .set(authHeader(email));

  const apply = (macroId: string, ticketId: string, email: string) =>
    request(server)
      .post(`/api/canned-responses/${macroId}/apply?ticketId=${ticketId}`)
      .set(authHeader(email));

  describe('the action allowlist (§2)', () => {
    it.each([['send_email'], ['notify_requester'], ['notify_team_lead']])(
      'refuses to SAVE a macro carrying %s',
      async (type) => {
        const res = await saveMacro({
          name: `bad ${unique()}`,
          content: 'Text',
          actions: [
            {
              type,
              to: 'requester',
              subject: 'Hello',
              body: 'Body',
            },
          ],
        });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain(type);
      },
    );

    it('saves the allowlisted actions happily', async () => {
      const res = await saveMacro({
        name: `good ${unique()}`,
        content: 'Done.',
        actions: [
          { type: 'set_status', status: 'RESOLVED' },
          { type: 'add_tag', tags: ['password'] },
          { type: 'add_internal_note', body: 'Standard reset performed.' },
        ],
      });
      expect(res.status).toBe(201);
      expect((res.body as { actions: unknown[] }).actions).toHaveLength(3);
    });

    it('does NOT EXECUTE a forbidden action already stored on a macro', async () => {
      // The case the save-time gate cannot cover: a row written before the
      // allowlist existed, or through a stale client. ZERO outbox rows is the
      // assertion that matters.
      const ticket = await makeTicket();
      const macro = await plantMacro([
        { type: 'add_tag', tags: ['planted'] },
        {
          type: 'send_email',
          to: 'address',
          address: 'outsider@company.com',
          subject: 'Should never send',
          body: 'Should never send',
        },
      ]);
      const res = await apply(macro.id, ticket.id, fixtureEmails.agent);
      expect(res.status).toBe(201);
      expect((res.body as { skippedActions: string[] }).skippedActions).toEqual([
        'send_email',
      ]);

      const outbox = await prisma.notificationOutbox.findMany({
        where: { ticketId: ticket.id },
      });
      expect(outbox).toHaveLength(0);

      // ...and the allowlisted half still ran, so a stale macro degrades
      // rather than breaking.
      const tags = await prisma.ticketTag.findMany({
        where: { ticketId: ticket.id },
        include: { tag: true },
      });
      expect(tags.map((row) => row.tag.name)).toContain('planted');
    });

    it('names the skipped action in the render preview too', async () => {
      const ticket = await makeTicket();
      const macro = await plantMacro([
        { type: 'notify_requester', body: 'nope' },
        { type: 'set_priority', priority: 'SEV2' },
      ]);
      const res = await render(macro.id, ticket.id, fixtureEmails.agent);
      expect(res.status).toBe(201);
      const body = res.body as {
        actions: { type: string }[];
        skippedActions: string[];
      };
      expect(body.actions.map((a) => a.type)).toEqual(['set_priority']);
      expect(body.skippedActions).toEqual(['notify_requester']);
    });
  });

  describe('render shows before it acts (§4)', () => {
    it('returns the filled text and the actions, and changes nothing', async () => {
      const ticket = await makeTicket();
      const saved = await saveMacro({
        name: `preview ${unique()}`,
        content: 'Hi {{requester.firstName}}, {{ticket.displayId}} is sorted.',
        actions: [{ type: 'set_status', status: 'RESOLVED' }],
      });
      const macroId = (saved.body as { id: string }).id;

      const res = await render(macroId, ticket.id, fixtureEmails.agent);
      expect(res.status).toBe(201);
      const body = res.body as { content: string; actions: { type: string }[] };
      expect(body.content).toBe(
        `Hi Requestor, ${ticket.displayId} is sorted.`,
      );
      expect(body.actions.map((a) => a.type)).toEqual(['set_status']);

      // Nothing happened: the ticket is untouched and no event was written.
      const after = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { status: true },
      });
      expect(after.status).toBe('ASSIGNED');
      expect(
        await prisma.ticketEvent.count({
          where: { ticketId: ticket.id, type: 'MACRO_APPLIED' },
        }),
      ).toBe(0);
    });
  });

  describe('applying one (§7.1)', () => {
    it('sets the status and adds the tag in one call', async () => {
      const ticket = await makeTicket();
      const saved = await saveMacro({
        name: `password reset done ${unique()}`,
        content: 'Hi {{requester.firstName}}, your password has been reset.',
        actions: [
          { type: 'set_status', status: 'RESOLVED' },
          { type: 'add_tag', tags: ['password'] },
        ],
      });
      const macroId = (saved.body as { id: string }).id;

      const res = await apply(macroId, ticket.id, fixtureEmails.agent);
      expect(res.status).toBe(201);
      expect((res.body as { applied: number }).applied).toBe(2);
      expect((res.body as { content: string }).content).toContain(
        'Hi Requestor,',
      );

      const after = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { status: true, resolvedAt: true },
      });
      expect(after.status).toBe('RESOLVED');
      const tags = await prisma.ticketTag.findMany({
        where: { ticketId: ticket.id },
        include: { tag: true },
      });
      expect(tags.map((row) => row.tag.name)).toContain('password');
    });

    it('takes the normal transition path, so the SLA accounting holds', async () => {
      // The trap card 1.29 documented: a status set behind the transition
      // logic's back leaves the SLA clock and the history wrong.
      const ticket = await makeTicket();
      const saved = await saveMacro({
        name: `waiting ${unique()}`,
        content: 'Waiting on you.',
        actions: [{ type: 'set_status', status: 'WAITING_ON_REQUESTER' }],
      });
      await apply(
        (saved.body as { id: string }).id,
        ticket.id,
        fixtureEmails.agent,
      );

      const statusEvents = await prisma.ticketEvent.findMany({
        where: { ticketId: ticket.id, type: 'TICKET_STATUS_CHANGED' },
        select: { payload: true },
      });
      expect(statusEvents).toHaveLength(1);
      expect(statusEvents[0].payload).toMatchObject({
        to: 'WAITING_ON_REQUESTER',
      });
      // WAITING_ON_REQUESTER pauses the clock; that only happens if the macro
      // went through applyStatusTransitionInTx rather than writing the column.
      const after = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { status: true, slaPausedAt: true },
      });
      expect(after.status).toBe('WAITING_ON_REQUESTER');
      expect(after.slaPausedAt).not.toBeNull();
    });

    it('adds an internal note as the PERSON, not as a rule author', async () => {
      const ticket = await makeTicket();
      const saved = await saveMacro({
        name: `note ${unique()}`,
        content: 'Noted.',
        actions: [
          { type: 'add_internal_note', body: 'Standard reset performed.' },
        ],
      });
      await apply(
        (saved.body as { id: string }).id,
        ticket.id,
        fixtureEmails.agent,
      );
      const notes = await prisma.ticketMessage.findMany({
        where: { ticketId: ticket.id, type: 'INTERNAL' },
        select: { authorId: true, body: true },
      });
      expect(notes).toHaveLength(1);
      expect(notes[0].authorId).toBe(fixtureUserIds.agent);
      // An internal note emails nobody (card 1.42), which is why it is on the
      // allowlist at all.
      expect(
        await prisma.notificationOutbox.count({ where: { ticketId: ticket.id } }),
      ).toBe(0);
    });
  });

  describe('the audit trail (§7.6)', () => {
    it('records MACRO_APPLIED by the actor, and NO AutomationExecution row', async () => {
      const ticket = await makeTicket();
      const saved = await saveMacro({
        name: `audit ${unique()}`,
        content: 'Audited.',
        actions: [{ type: 'set_priority', priority: 'SEV2' }],
      });
      const macroId = (saved.body as { id: string }).id;
      await apply(macroId, ticket.id, fixtureEmails.agent);

      const events = await prisma.ticketEvent.findMany({
        where: { ticketId: ticket.id, type: 'MACRO_APPLIED' },
        select: { createdById: true, payload: true },
      });
      expect(events).toHaveLength(1);
      expect(events[0].createdById).toBe(fixtureUserIds.agent);
      expect(events[0].payload).toMatchObject({ cannedResponseId: macroId });

      // The point of the provenance parameter. A macro is not a rule firing.
      expect(
        await prisma.automationExecution.count({
          where: { ticketId: ticket.id },
        }),
      ).toBe(0);
      expect(
        await prisma.ticketEvent.count({
          where: { ticketId: ticket.id, type: 'AUTOMATION_RULE_EXECUTED' },
        }),
      ).toBe(0);
    });
  });

  describe('permissions (§4)', () => {
    it('refuses a ticket the agent cannot write', async () => {
      const hidden = await makeTicket({
        assignedTeamId: fixtureTeamIds.hr,
        assigneeId: null,
        requesterId: fixtureUserIds.otherRequester,
      });
      const saved = await saveMacro({
        name: `nope ${unique()}`,
        content: 'Text',
        actions: [{ type: 'set_status', status: 'RESOLVED' }],
      });
      const res = await apply(
        (saved.body as { id: string }).id,
        hidden.id,
        fixtureEmails.agent,
      );
      expect(res.status).toBe(403);
      const after = await prisma.ticket.findUniqueOrThrow({
        where: { id: hidden.id },
        select: { status: true },
      });
      expect(after.status).toBe('ASSIGNED');
    });

    it('cannot force a status the transition table forbids', async () => {
      // Found while writing this spec, and worth asserting deliberately: a
      // macro is subject to the same transition legality as a human clicking
      // the dropdown, because it goes through applyStatusTransitionInTx. A
      // macro is not a way round the workflow any more than round permissions.
      const ticket = await makeTicket({ status: 'NEW' });
      const saved = await saveMacro({
        name: `illegal ${unique()}`,
        content: 'Text',
        actions: [{ type: 'set_status', status: 'RESOLVED' }],
      });
      const res = await apply(
        (saved.body as { id: string }).id,
        ticket.id,
        fixtureEmails.agent,
      );
      expect(res.status).toBe(403);
      const after = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { status: true },
      });
      expect(after.status).toBe('NEW');
      // The whole macro rolled back - nothing half-applied.
      expect(
        await prisma.ticketEvent.count({
          where: { ticketId: ticket.id, type: 'MACRO_APPLIED' },
        }),
      ).toBe(0);
    });

    it("refuses somebody else's private macro, as a 404", async () => {
      // A 403 would confirm the id belongs to a real template.
      const ticket = await makeTicket();
      const mine = await prisma.cannedResponse.create({
        data: {
          name: `private ${unique()}`,
          content: 'Private.',
          userId: fixtureUserIds.lead,
        },
        select: { id: true },
      });
      const res = await apply(mine.id, ticket.id, fixtureEmails.agent);
      expect(res.status).toBe(404);
    });

    it('refuses a soft-deleted ticket', async () => {
      const ticket = await makeTicket({ deletedAt: new Date() });
      const saved = await saveMacro({
        name: `deleted ${unique()}`,
        content: 'Text',
        actions: [{ type: 'set_priority', priority: 'SEV4' }],
      });
      const res = await apply(
        (saved.body as { id: string }).id,
        ticket.id,
        fixtureEmails.agent,
      );
      expect(res.status).toBe(404);
    });

    it('requires a ticketId at all', async () => {
      const saved = await saveMacro({
        name: `noticket ${unique()}`,
        content: 'Text',
      });
      const res = await request(server)
        .post(`/api/canned-responses/${(saved.body as { id: string }).id}/apply`)
        .set(authHeader(fixtureEmails.agent));
      expect(res.status).toBe(400);
    });
  });

  describe('a plain template still works', () => {
    it('saves and applies with no actions at all', async () => {
      const ticket = await makeTicket();
      const saved = await saveMacro({
        name: `plain ${unique()}`,
        content: 'Hi {{requester.firstName}}, thanks for waiting.',
      });
      expect(saved.status).toBe(201);
      expect((saved.body as { actions: unknown[] }).actions).toEqual([]);
      const res = await apply(
        (saved.body as { id: string }).id,
        ticket.id,
        fixtureEmails.agent,
      );
      expect(res.status).toBe(201);
      expect((res.body as { applied: number }).applied).toBe(0);
      expect((res.body as { content: string }).content).toBe(
        'Hi Requestor, thanks for waiting.',
      );
      // No actions means no event: nothing happened, so nothing is recorded.
      expect(
        await prisma.ticketEvent.count({
          where: { ticketId: ticket.id, type: 'MACRO_APPLIED' },
        }),
      ).toBe(0);
    });
  });
});
