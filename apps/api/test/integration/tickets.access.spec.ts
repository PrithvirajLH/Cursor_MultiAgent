import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import {
  fixtureEmails,
  fixtureTeamIds,
  fixtureUserIds,
} from '../utils/fixtures';
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
});
