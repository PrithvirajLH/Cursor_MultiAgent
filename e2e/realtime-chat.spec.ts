import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { authHeaders } from './auth';

const API_BASE = 'http://localhost:3000/api';
const IT_TEAM_ID = '11111111-1111-4111-8111-111111111111';
const IT_TEAM_NAME = 'IT Service Desk';
const REQUESTER_EMAIL = 'requester@company.com';
const AGENT_EMAIL = 'agent@company.com';
const LEAD_EMAIL = 'lead@company.com';
const ADMIN_EMAIL = 'admin@company.com';

type TicketRecord = {
  id: string;
  status: string;
  priority: string;
  updatedAt: string;
  assignedTeam?: { id: string; name: string } | null;
  assignee?: { id: string; email: string; displayName: string } | null;
};

type UserRecord = {
  id: string;
  email: string;
  displayName: string;
};

async function openAs(page: Page, email: string, path: string) {
  await page.addInitScript(
    (value) => window.localStorage.setItem('demoUserEmail', value),
    email,
  );
  await page.goto(path, { waitUntil: 'networkidle' });
}

async function createTicket(
  api: APIRequestContext,
  subject: string,
  email: string,
) {
  const response = await api.post(`${API_BASE}/tickets`, {
    headers: authHeaders(email),
    data: {
      subject,
      description: 'Realtime regression ticket',
      priority: 'P3',
      channel: 'PORTAL',
      assignedTeamId: IT_TEAM_ID,
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as TicketRecord;
}

async function addPublicMessage(
  api: APIRequestContext,
  ticketId: string,
  email: string,
  body: string,
) {
  const response = await api.post(`${API_BASE}/tickets/${ticketId}/messages`, {
    headers: authHeaders(email),
    data: {
      body,
      type: 'PUBLIC',
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function fetchTicketById(
  api: APIRequestContext,
  email: string,
  ticketId: string,
) {
  const response = await api.get(`${API_BASE}/tickets/${ticketId}`, {
    headers: authHeaders(email),
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as TicketRecord;
}

async function fetchUserByEmail(
  api: APIRequestContext,
  adminEmail: string,
  userEmail: string,
) {
  const response = await api.get(`${API_BASE}/users`, {
    headers: authHeaders(adminEmail),
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { data: UserRecord[] };
  const user = body.data.find((item) => item.email === userEmail);
  if (!user) {
    throw new Error(`User not found: ${userEmail}`);
  }
  return user;
}

async function dispatchTicketTyping(
  page: Page,
  payload: {
    ticketId: string;
    actorId: string;
    actorDisplayName: string;
    actorEmail: string;
    isTyping: boolean;
    occurredAt: string;
  },
) {
  await page.evaluate((detail) => {
    window.dispatchEvent(
      new CustomEvent('ticketing:ticket-typing', {
        detail,
      }),
    );
  }, payload);
}

async function dispatchTicketChanged(
  page: Page,
  payload: {
    ticketId: string;
    reason: string;
    actorId: string | null;
    status: string;
    priority: string;
    updatedAt: string;
    assignedTeamId: string | null;
    assignedTeam: { id: string; name: string } | null;
    assigneeId: string | null;
    assignee: { id: string; email: string; displayName: string } | null;
    followerCount: number;
    actor: { id: string; email: string; displayName: string } | null;
    message?: {
      id: string;
      body: string;
      type: string;
      createdAt: string;
      author: { id: string; email: string; displayName: string };
    } | null;
    occurredAt: string;
  },
) {
  await page.evaluate((detail) => {
    window.dispatchEvent(
      new CustomEvent('ticketing:ticket-changed', {
        detail,
      }),
    );
  }, payload);
}

test('agent B sees typing and deduped realtime message without conversation reset', async ({
  browser,
  request,
}) => {
  const subject = `Realtime chat ${Date.now()}`;
  const baseMessage = `Baseline ${Date.now()}`;
  const realtimeMessage = `Realtime incoming ${Date.now()}`;
  const ticket = await createTicket(request, subject, REQUESTER_EMAIL);
  await addPublicMessage(request, ticket.id, REQUESTER_EMAIL, baseMessage);
  const agentUser = await fetchUserByEmail(request, ADMIN_EMAIL, AGENT_EMAIL);

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await openAs(viewerPage, LEAD_EMAIL, `/tickets/${ticket.id}`);
  await expect(
    viewerPage.getByRole('tablist', { name: 'Ticket views' }),
  ).toBeVisible();
  await expect(viewerPage.getByText(baseMessage)).toBeVisible();

  const typingAt = new Date().toISOString();
  await dispatchTicketTyping(viewerPage, {
    ticketId: ticket.id,
    actorId: agentUser.id,
    actorDisplayName: agentUser.displayName,
    actorEmail: agentUser.email,
    isTyping: true,
    occurredAt: typingAt,
  });

  await expect(viewerPage.getByText(agentUser.displayName).first()).toBeVisible();

  const messageCreatedAt = new Date(Date.now() + 500).toISOString();
  const messageId = `rt-msg-${Date.now()}`;
  const ticketAfterBase = await fetchTicketById(request, LEAD_EMAIL, ticket.id);
  const messagePayload = {
    ticketId: ticket.id,
    reason: 'message_added',
    actorId: agentUser.id,
    status: ticketAfterBase.status,
    priority: ticketAfterBase.priority,
    updatedAt: messageCreatedAt,
    assignedTeamId: ticketAfterBase.assignedTeam?.id ?? IT_TEAM_ID,
    assignedTeam: ticketAfterBase.assignedTeam ?? {
      id: IT_TEAM_ID,
      name: IT_TEAM_NAME,
    },
    assigneeId: ticketAfterBase.assignee?.id ?? null,
    assignee: ticketAfterBase.assignee ?? null,
    followerCount: 1,
    actor: agentUser,
    message: {
      id: messageId,
      body: realtimeMessage,
      type: 'PUBLIC',
      createdAt: messageCreatedAt,
      author: agentUser,
    },
    occurredAt: messageCreatedAt,
  } as const;

  await dispatchTicketChanged(viewerPage, messagePayload);
  await dispatchTicketChanged(viewerPage, messagePayload);

  await expect(viewerPage.getByText(realtimeMessage)).toBeVisible();
  await expect(viewerPage.getByText(realtimeMessage)).toHaveCount(1);
  await expect(viewerPage.getByText(baseMessage)).toBeVisible();

  await viewerContext.close();
});

test('stale realtime status updates are ignored and latest status remains visible', async ({
  page,
  request,
}) => {
  const subject = `Realtime status ${Date.now()}`;
  const baselineMessage = `Keep visible ${Date.now()}`;
  const ticket = await createTicket(request, subject, REQUESTER_EMAIL);
  await addPublicMessage(request, ticket.id, REQUESTER_EMAIL, baselineMessage);
  const agentUser = await fetchUserByEmail(request, ADMIN_EMAIL, AGENT_EMAIL);

  await openAs(page, LEAD_EMAIL, `/tickets/${ticket.id}`);
  await expect(page.getByRole('tablist', { name: 'Ticket views' })).toBeVisible();
  await expect(page.getByText(baselineMessage)).toBeVisible();

  const baseTicket = await fetchTicketById(request, LEAD_EMAIL, ticket.id);
  const newerUpdateAt = new Date(Date.now() + 1000).toISOString();
  const olderUpdateAt = new Date(Date.now() + 100).toISOString();

  await dispatchTicketChanged(page, {
    ticketId: ticket.id,
    reason: 'status_changed',
    actorId: agentUser.id,
    status: 'IN_PROGRESS',
    priority: baseTicket.priority,
    updatedAt: newerUpdateAt,
    assignedTeamId: baseTicket.assignedTeam?.id ?? IT_TEAM_ID,
    assignedTeam: baseTicket.assignedTeam ?? { id: IT_TEAM_ID, name: IT_TEAM_NAME },
    assigneeId: baseTicket.assignee?.id ?? null,
    assignee: baseTicket.assignee ?? null,
    followerCount: 1,
    actor: agentUser,
    message: null,
    occurredAt: newerUpdateAt,
  });

  await expect(page.getByText(/^In Progress$/).first()).toBeVisible();

  await dispatchTicketChanged(page, {
    ticketId: ticket.id,
    reason: 'status_changed',
    actorId: agentUser.id,
    status: 'TRIAGED',
    priority: baseTicket.priority,
    updatedAt: olderUpdateAt,
    assignedTeamId: baseTicket.assignedTeam?.id ?? IT_TEAM_ID,
    assignedTeam: baseTicket.assignedTeam ?? { id: IT_TEAM_ID, name: IT_TEAM_NAME },
    assigneeId: baseTicket.assignee?.id ?? null,
    assignee: baseTicket.assignee ?? null,
    followerCount: 1,
    actor: agentUser,
    message: null,
    occurredAt: olderUpdateAt,
  });

  await expect(page.getByText(/^In Progress$/).first()).toBeVisible();
  await expect(page.getByText(baselineMessage)).toBeVisible();
});
