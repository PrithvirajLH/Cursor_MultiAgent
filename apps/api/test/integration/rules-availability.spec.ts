import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { RuleEngineService } from '../../src/automation/rule-engine.service';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TicketResponse = {
  id: string;
  assignee: { id: string } | null;
  assignedTeam: { id: string } | null;
};
type RuleResponse = { id: string };

/**
 * Card 1.94 — a RULE could still hand work to somebody on leave.
 *
 * Card 2.2 stopped the automatic pickers (round robin, least loaded) choosing
 * an unavailable person. It did not touch the two paths where a rule names a
 * SPECIFIC person: an automation rule's `assign_user` action, and a routing
 * rule's pinned assignee. Both bypassed availability entirely.
 *
 * ⚠️ The answer in both places is the same as card 2.2 gives for an all-away
 * team: fall back to the team queue, unassigned. An unassigned ticket sits
 * somewhere visible; one assigned to somebody on leave is invisible until they
 * come back.
 */
describe('rules do not assign to people on leave (card 1.94)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let priority = 500;

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

  afterEach(async () => {
    await getPrisma().user.updateMany({
      where: { id: fixtureUserIds.agent },
      data: { isAvailable: true, awayUntil: null },
    });
    await getPrisma().routingRule.deleteMany({ where: { name: { startsWith: 'c194' } } });
  });

  const setAway = (away: boolean) =>
    getPrisma().user.update({
      where: { id: fixtureUserIds.agent },
      data: { isAvailable: !away, awayUntil: null },
    });

  const createRule = async (token: string, userId: string) => {
    priority += 1;
    const res = await request(server)
      .post('/api/automation-rules')
      .set(authHeader(fixtureEmails.owner))
      .send({
        name: `c194 ${token}`,
        trigger: 'STATUS_CHANGED',
        conditions: [{ field: 'subject', operator: 'contains', value: token }],
        actions: [{ type: 'assign_user', userId }],
        teamId: fixtureTeamIds.it,
        isActive: true,
        priority,
      })
      .expect(201);
    return (res.body as RuleResponse).id;
  };

  const createTicket = async (subject: string) => {
    const res = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject,
        description: 'card 1.94 fixture',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    return res.body as TicketResponse;
  };

  /**
   * ⚠️ ROUTING RULES ONLY RUN WHEN THE TICKET ARRIVES WITHOUT A TEAM.
   * `tickets.service.ts` takes `payload.assignedTeamId` as the routed target
   * when it is present and never calls `routeTarget` at all - so a test that
   * pins a team proves nothing about routing. Caught by the available-assignee
   * case failing: its unavailable twin had been passing vacuously.
   */
  const createUnroutedTicket = async (subject: string) => {
    const res = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject,
        description: 'card 1.94 routing fixture',
        priority: 'SEV3',
        channel: 'PORTAL',
      })
      .expect(201);
    return res.body as TicketResponse;
  };

  const ticketRow = (id: string) =>
    getPrisma().ticket.findUniqueOrThrow({
      where: { id },
      select: { assigneeId: true, assignedTeamId: true },
    });

  describe('an automation rule pinning a person', () => {
    it('⚠️ does NOT assign to them when they are away, and the ticket keeps its team', async () => {
      // THE CARD'S POINT. The rule names the agent explicitly; they are on
      // leave; the ticket must stay in the team queue where somebody sees it.
      const token = `AWAY${Date.now()}`;
      await createRule(token, fixtureUserIds.agent);
      const ticket = await createTicket(`c194 ${token} pinned`);
      await setAway(true);
      const result = await app
        .get(RuleEngineService)
        .runForTicket(ticket.id, 'STATUS_CHANGED');
      expect(result.errors).toEqual([]);
      const row = await ticketRow(ticket.id);
      expect(row.assigneeId).toBeNull();
      expect(row.assignedTeamId).toBe(fixtureTeamIds.it);
    });

    it('⚠️ DOES assign to them when they are here', async () => {
      // The non-vacuity half. A gate that refused everybody would pass the
      // test above and break every pinned rule in the product.
      const token = `HERE${Date.now()}`;
      await createRule(token, fixtureUserIds.agent);
      const ticket = await createTicket(`c194 ${token} pinned`);
      await setAway(false);
      await app.get(RuleEngineService).runForTicket(ticket.id, 'STATUS_CHANGED');
      expect((await ticketRow(ticket.id)).assigneeId).toBe(fixtureUserIds.agent);
    });

    it('⚠️ says on the ticket that it declined to assign', async () => {
      // A rule that silently did nothing is indistinguishable from a rule that
      // did not match.
      const token = `SAID${Date.now()}`;
      await createRule(token, fixtureUserIds.agent);
      const ticket = await createTicket(`c194 ${token} pinned`);
      await setAway(true);
      await app.get(RuleEngineService).runForTicket(ticket.id, 'STATUS_CHANGED');
      const event = await getPrisma().ticketEvent.findFirst({
        where: { ticketId: ticket.id, type: 'AUTOMATION_RULE_EXECUTED' },
        orderBy: { createdAt: 'desc' },
        select: { payload: true },
      });
      expect(JSON.stringify(event?.payload)).toContain('assign_user:unavailable');
    });

    it('treats a PAST awayUntil as back, like everything else does', async () => {
      // `availableUserFilter` is the single definition of "actually here" and a
      // passed return date means back, whatever the stored flag says.
      const token = `PAST${Date.now()}`;
      await createRule(token, fixtureUserIds.agent);
      const ticket = await createTicket(`c194 ${token} pinned`);
      await getPrisma().user.update({
        where: { id: fixtureUserIds.agent },
        data: {
          isAvailable: false,
          awayUntil: new Date(Date.now() - 60 * 60_000),
        },
      });
      await app.get(RuleEngineService).runForTicket(ticket.id, 'STATUS_CHANGED');
      expect((await ticketRow(ticket.id)).assigneeId).toBe(fixtureUserIds.agent);
    });
  });

  describe('a routing rule pinning a person', () => {
    // ⚠️ THE SITE THE AUDIT MISSED, and the card 2.2 handoff missed before it:
    // its author called the round-robin picker "the one place assignment
    // actually picks a person", and it is not.
    const createRoutingRule = async (keyword: string, assigneeId: string) =>
      getPrisma().routingRule.create({
        data: {
          name: `c194 routing ${keyword}`,
          keywords: [keyword],
          teamId: fixtureTeamIds.it,
          assigneeId,
          isActive: true,
          priority: 1,
        },
        select: { id: true },
      });

    it('⚠️ does NOT assign to an unavailable pinned assignee', async () => {
      const keyword = `c194route${Date.now()}`;
      await createRoutingRule(keyword, fixtureUserIds.agent);
      await setAway(true);
      const ticket = await createUnroutedTicket(
        `please help with ${keyword} thanks`,
      );
      // The rule MATCHED - the team came from it, not from the request - and
      // it still declined to hand the ticket to somebody on leave.
      expect(ticket.assignedTeam?.id).toBe(fixtureTeamIds.it);
      expect(ticket.assignee).toBeNull();
    });

    it('⚠️ DOES assign to an available pinned assignee', async () => {
      const keyword = `c194route${Date.now()}b`;
      await createRoutingRule(keyword, fixtureUserIds.agent);
      await setAway(false);
      const ticket = await createUnroutedTicket(
        `please help with ${keyword} thanks`,
      );
      expect(ticket.assignedTeam?.id).toBe(fixtureTeamIds.it);
      expect(ticket.assignee?.id).toBe(fixtureUserIds.agent);
    });
  });
});
