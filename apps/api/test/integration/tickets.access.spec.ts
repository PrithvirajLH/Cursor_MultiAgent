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

type TicketListItem = {
  id: string;
  subject: string;
  assignedTeam?: { id: string } | null;
  assignee?: { email?: string | null } | null;
};

type TicketListResponse = {
  data: TicketListItem[];
};

type TicketResponse = {
  assignee?: { email?: string | null } | null;
  assignedTeam?: { id: string } | null;
};

describe('Ticket access control', () => {
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

  it('limits requesters to their own tickets', async () => {
    const response = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .expect(200);

    const body = response.body as TicketListResponse;
    const subjects = body.data.map((ticket) => ticket.subject);

    expect(subjects).toContain('VPN access request');
    expect(subjects).toContain('Laptop provisioning');
    expect(subjects).toContain('HR onboarding');
    expect(subjects).not.toContain('Benefits update');
  });

  it('shows agents assigned + unassigned tickets in their department only', async () => {
    const response = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);

    const body = response.body as TicketListResponse;
    const subjects = body.data.map((ticket) => ticket.subject);

    expect(subjects).toContain('VPN access request');
    expect(subjects).toContain('Laptop provisioning');
    expect(subjects).not.toContain('HR onboarding');
    expect(subjects).not.toContain('Benefits update');
  });

  it('shows leads all tickets in their department', async () => {
    const response = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.lead))
      .expect(200);

    const body = response.body as TicketListResponse;
    const subjects = body.data.map((ticket) => ticket.subject);

    expect(subjects).toContain('VPN access request');
    expect(subjects).toContain('Laptop provisioning');
    expect(subjects).not.toContain('HR onboarding');
    expect(subjects).not.toContain('Benefits update');
  });

  it('shows team admins tickets in primary team scope', async () => {
    const response = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.admin))
      .expect(200);

    const body = response.body as TicketListResponse;
    const subjects = body.data.map((ticket) => ticket.subject);

    expect(subjects).toContain('VPN access request');
    expect(subjects).toContain('Laptop provisioning');
    expect(subjects).not.toContain('HR onboarding');
    expect(subjects).not.toContain('Benefits update');
  });

  it('shows owners all tickets across departments', async () => {
    const response = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const body = response.body as TicketListResponse;
    const subjects = body.data.map((ticket) => ticket.subject);

    expect(subjects).toContain('VPN access request');
    expect(subjects).toContain('Laptop provisioning');
    expect(subjects).toContain('HR onboarding');
    expect(subjects).toContain('Benefits update');
  });

  it('allows agents to self-assign unassigned tickets', async () => {
    const list = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
    const listBody = list.body as TicketListResponse;
    const ticket = listBody.data.find(
      (item) => item.subject === 'Laptop provisioning',
    );
    if (!ticket) {
      throw new Error('Missing fixture ticket: Laptop provisioning');
    }

    const response = await request(server)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set(authHeader(fixtureEmails.agent))
      .send({})
      .expect(201);

    const body = response.body as TicketResponse;
    expect(body.assignee?.email).toBe(fixtureEmails.agent);
  });

  it('allows agents to assign unassigned team tickets to another team member', async () => {
    const list = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
    const listBody = list.body as TicketListResponse;
    const ticket = listBody.data.find(
      (item) => item.subject === 'Laptop provisioning',
    );
    if (!ticket) {
      throw new Error('Missing fixture ticket: Laptop provisioning');
    }

    const response = await request(server)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set(authHeader(fixtureEmails.agent))
      .send({ assigneeId: fixtureUserIds.lead })
      .expect(201);

    const body = response.body as TicketResponse;
    expect(body.assignee?.email).toBe(fixtureEmails.lead);
  });

  it('does not allow agents to reassign tickets already owned by another teammate', async () => {
    const list = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);
    const listBody = list.body as TicketListResponse;
    const ticket = listBody.data.find(
      (item) => item.subject === 'VPN access request',
    );
    if (!ticket) {
      throw new Error('Missing fixture ticket: VPN access request');
    }

    await request(server)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set(authHeader(fixtureEmails.owner))
      .send({ assigneeId: fixtureUserIds.lead })
      .expect(201);

    await request(server)
      .post(`/api/tickets/${ticket.id}/assign`)
      .set(authHeader(fixtureEmails.agent))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(403);
  });

  it('keeps read-only history for the prior department on transfer', async () => {
    const list = await request(server)
      .get('/api/tickets')
      .set(authHeader(fixtureEmails.lead))
      .expect(200);
    const listBody = list.body as TicketListResponse;
    const ticket = listBody.data.find(
      (item) => item.subject === 'VPN access request',
    );
    if (!ticket) {
      throw new Error('Missing fixture ticket: VPN access request');
    }

    // Skip if ticket already transferred (happens on repeated test runs without db reset)
    if (ticket.assignedTeam?.id === fixtureTeamIds.hr) {
      console.log('Ticket already transferred to HR, skipping transfer step');
    } else {
      const transferRes = await request(server)
        .post(`/api/tickets/${ticket.id}/transfer`)
        .set(authHeader(fixtureEmails.lead))
        .send({ newTeamId: fixtureTeamIds.hr });

      if (transferRes.status !== 201) {
        console.log('Transfer failed:', transferRes.status, transferRes.body);
      }
      expect(transferRes.status).toBe(201);
    }

    // After transfer, lead should still have read access (via ticketAccess grant)
    await request(server)
      .get(`/api/tickets/${ticket.id}`)
      .set(authHeader(fixtureEmails.lead))
      .expect(200);

    // But lead should NOT have write access (only read-only history)
    await request(server)
      .post(`/api/tickets/${ticket.id}/messages`)
      .set(authHeader(fixtureEmails.lead))
      .send({
        authorId: fixtureUserIds.lead,
        body: 'Follow up',
        type: 'PUBLIC',
      })
      .expect(403);
  });
  /**
   * Card 1.36. Before this, ticket visibility was decided by rank alone: a
   * LEAD or TEAM_ADMIN saw their team's tickets and nothing else, so a ticket
   * they raised THEMSELVES to another team was invisible to them - not in a
   * list, not by URL, no reply, no notice that it had been resolved. And the
   * message filter cut on role alone, so any non-EMPLOYEE who could open a
   * ticket read every internal note on it, including on their own ticket.
   *
   * The two faults had to be fixed together: fixing visibility alone would
   * have let a staff requester reach their own ticket AND read the internal
   * notes staff wrote about them.
   */
  describe('a staff member who raised their own ticket', () => {
    const prisma = getPrisma();
    let ownTicketId: string;
    let colleagueTicketId: string;
    let ownerTicketId: string;

    beforeAll(async () => {
      // The LEAD is on IT (per the seed); this goes to HR, where they are not
      // a member. That is the real shape: payroll and HR take tickets, and
      // staff on other teams raise them.
      const own = await prisma.ticket.create({
        data: {
          requesterId: fixtureUserIds.lead,
          subject: '1.36 — my own pay query',
          description: 'Raised by the IT lead, to HR.',
          assignedTeamId: fixtureTeamIds.hr,
        },
        select: { id: true },
      });
      ownTicketId = own.id;

      // A colleague's ticket on the lead's OWN team. Internal notes here must
      // still be readable - this fix must not cost a lead their team's notes.
      const colleague = await prisma.ticket.create({
        data: {
          requesterId: fixtureUserIds.requester,
          subject: '1.36 — a colleague ticket on IT',
          description: 'Raised by someone else, to the lead\'s team.',
          assignedTeamId: fixtureTeamIds.it,
        },
        select: { id: true },
      });
      colleagueTicketId = colleague.id;

      // Rank must not beat relationship even at the top: OWNER's role filter
      // is `{}`, so nothing about team scope would have stopped this one.
      const ownerTicket = await prisma.ticket.create({
        data: {
          requesterId: fixtureUserIds.owner,
          subject: '1.36 — the owner raises one too',
          description: 'Raised by the owner, to HR.',
          assignedTeamId: fixtureTeamIds.hr,
        },
        select: { id: true },
      });
      ownerTicketId = ownerTicket.id;

      await prisma.ticketMessage.createMany({
        data: [ownTicketId, colleagueTicketId, ownerTicketId].flatMap(
          (ticketId) => [
            {
              ticketId,
              authorId: fixtureUserIds.admin,
              body: 'PUBLIC-BODY Looking into this now.',
              type: 'PUBLIC' as const,
            },
            {
              ticketId,
              authorId: fixtureUserIds.admin,
              body: 'INTERNAL-BODY Check the prior grievance before replying.',
              type: 'INTERNAL' as const,
            },
          ],
        ),
      });
    });

    async function messageBodies(
      ticketId: string,
      email: string,
    ): Promise<string[]> {
      const res = await request(server)
        .get(`/api/tickets/${ticketId}/messages`)
        .set(authHeader(email))
        .expect(200);
      const body = res.body as { data: { body: string }[] };
      return body.data.map((message) => message.body);
    }

    it('can list a ticket they raised to a team they are not on', async () => {
      const res = await request(server)
        .get('/api/tickets')
        .set(authHeader(fixtureEmails.lead))
        .expect(200);
      const body = res.body as TicketListResponse;
      expect(body.data.map((ticket) => ticket.id)).toContain(ownTicketId);
    });

    it('can open it directly', async () => {
      await request(server)
        .get(`/api/tickets/${ownTicketId}`)
        .set(authHeader(fixtureEmails.lead))
        .expect(200);
    });

    it('is counted in "created by me", which runs the raw-SQL sibling', async () => {
      // getCountsUncached computes createdByMeOpen as `requesterId = :me`
      // INSIDE `WHERE <accessCondition>`, so before this fix the outer
      // condition filtered the ticket away before the inner clause could count
      // it: a lead's "Created by me" was structurally incapable of counting a
      // ticket they raised outside their own team. Asserting it here is what
      // proves roleConditionSql got the clause too, not just roleFilter.
      const res = await request(server)
        .get('/api/tickets/counts')
        .set(authHeader(fixtureEmails.lead))
        .expect(200);
      const counts = res.body as { createdByMeOpen: number };
      expect(typeof counts.createdByMeOpen).toBe('number');
      expect(counts.createdByMeOpen).toBeGreaterThanOrEqual(1);
    });

    it('sees ONLY public messages on their own ticket', async () => {
      const bodies = await messageBodies(ownTicketId, fixtureEmails.lead);
      expect(bodies.some((body) => body.startsWith('PUBLIC-BODY'))).toBe(true);
      expect(bodies.some((body) => body.startsWith('INTERNAL-BODY'))).toBe(
        false,
      );
    });

    it('still sees internal notes on a colleague ticket in their team', async () => {
      const bodies = await messageBodies(
        colleagueTicketId,
        fixtureEmails.lead,
      );
      expect(bodies.some((body) => body.startsWith('INTERNAL-BODY'))).toBe(
        true,
      );
    });

    it('applies to an OWNER on their own ticket as well', async () => {
      const bodies = await messageBodies(ownerTicketId, fixtureEmails.owner);
      expect(bodies.some((body) => body.startsWith('PUBLIC-BODY'))).toBe(true);
      expect(bodies.some((body) => body.startsWith('INTERNAL-BODY'))).toBe(
        false,
      );
    });

    it('leaves the OWNER every internal note on everyone else tickets', async () => {
      const bodies = await messageBodies(
        colleagueTicketId,
        fixtureEmails.owner,
      );
      expect(bodies.some((body) => body.startsWith('INTERNAL-BODY'))).toBe(
        true,
      );
    });
  });
});
