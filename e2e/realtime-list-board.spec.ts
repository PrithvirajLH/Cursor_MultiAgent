import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { authHeaders } from './auth';

const API_BASE = 'http://localhost:3000/api';
const IT_TEAM_ID = '11111111-1111-4111-8111-111111111111';
const REQUESTER_EMAIL = 'requester@company.com';
const AGENT_EMAIL = 'agent@company.com';
const LEAD_EMAIL = 'lead@company.com';

type TicketRecord = {
  id: string;
  status: string;
  priority: string;
  updatedAt: string;
  assignedTeam?: { id: string; name: string } | null;
  assignee?: { id: string; email: string; displayName: string } | null;
};

function buildTicketListRequestCounter(page: Page) {
  let requestCount = 0;
  const handler = (request: { url: () => string; method: () => string }) => {
    const url = request.url();
    if (request.method() === 'GET' && url.includes('/api/tickets?')) {
      requestCount += 1;
    }
  };

  page.on('request', handler);
  return {
    reset() {
      requestCount = 0;
    },
    get() {
      return requestCount;
    },
    dispose() {
      page.off('request', handler);
    },
  };
}

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
      description: 'Realtime list/board regression ticket',
      priority: 'P3',
      channel: 'PORTAL',
      assignedTeamId: IT_TEAM_ID,
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as TicketRecord;
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

async function dispatchTicketChanged(
  page: Page,
  payload: {
    ticketId: string;
    reason: string;
    status: string;
    priority: string;
    updatedAt: string;
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

function triageColumn(page: Page, label: string) {
  return page
    .locator('div.w-80')
    .filter({
      has: page.getByRole('heading', {
        level: 2,
        name: label,
      }),
    })
    .first();
}

test('tickets list updates in place for realtime status change without list refetch', async ({
  page,
  request,
}) => {
  const subject = `Realtime list ${Date.now()}`;
  const ticket = await createTicket(request, subject, REQUESTER_EMAIL);

  const listRequestCounter = buildTicketListRequestCounter(page);
  try {
    await openAs(page, AGENT_EMAIL, '/tickets?scope=all&statusGroup=open');

    const searchInput = page
      .getByPlaceholder(/Search by ticket ID, subject, or description/)
      .first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill(subject);
    await expect(page.locator('tr[role="button"]').filter({ hasText: subject })).toHaveCount(1);
    await page.waitForLoadState('networkidle');

    const row = page.locator('tr[role="button"]').filter({ hasText: subject }).first();
    await expect(row.getByText(/^New$/)).toBeVisible();

    listRequestCounter.reset();
    const inProgressAt = new Date(Date.now() + 1500).toISOString();
    await dispatchTicketChanged(page, {
      ticketId: ticket.id,
      reason: 'status_changed',
      status: 'IN_PROGRESS',
      priority: ticket.priority,
      updatedAt: inProgressAt,
      occurredAt: inProgressAt,
    });

    await expect(row.getByText(/^In Progress$/)).toBeVisible();
    await expect.poll(() => listRequestCounter.get(), { timeout: 1000 }).toBe(0);

    listRequestCounter.reset();
    const resolvedAt = new Date(Date.now() + 3000).toISOString();
    await dispatchTicketChanged(page, {
      ticketId: ticket.id,
      reason: 'status_changed',
      status: 'RESOLVED',
      priority: ticket.priority,
      updatedAt: resolvedAt,
      occurredAt: resolvedAt,
    });

    await expect(page.locator('tr[role="button"]').filter({ hasText: subject })).toHaveCount(0);
    await expect.poll(() => listRequestCounter.get(), { timeout: 1000 }).toBe(0);
  } finally {
    listRequestCounter.dispose();
  }
});

test('triage board moves/removes card in place for realtime status change without board refetch', async ({
  page,
  request,
}) => {
  const subject = `Realtime board ${Date.now()}`;
  const ticket = await createTicket(request, subject, REQUESTER_EMAIL);
  const ticketState = await fetchTicketById(request, LEAD_EMAIL, ticket.id);

  const listRequestCounter = buildTicketListRequestCounter(page);
  try {
    await openAs(page, LEAD_EMAIL, '/triage');
    await expect(page.getByRole('heading', { name: 'Triage Board', level: 1 })).toBeVisible();

    const triageSearch = page.getByPlaceholder('Search by ID, subject, requester, or team...');
    await expect(triageSearch).toBeVisible();
    await triageSearch.fill(subject);

    const newColumn = triageColumn(page, 'New');
    const inProgressColumn = triageColumn(page, 'In Progress');
    await expect(newColumn.getByRole('heading', { level: 3, name: subject })).toBeVisible();
    await page.waitForLoadState('networkidle');

    listRequestCounter.reset();
    const inProgressAt = new Date(Date.now() + 1500).toISOString();
    await dispatchTicketChanged(page, {
      ticketId: ticket.id,
      reason: 'status_changed',
      status: 'IN_PROGRESS',
      priority: ticketState.priority,
      updatedAt: inProgressAt,
      occurredAt: inProgressAt,
    });

    await expect(inProgressColumn.getByRole('heading', { level: 3, name: subject })).toBeVisible();
    await expect(newColumn.getByRole('heading', { level: 3, name: subject })).toHaveCount(0);
    await expect.poll(() => listRequestCounter.get(), { timeout: 1000 }).toBe(0);

    listRequestCounter.reset();
    const resolvedAt = new Date(Date.now() + 3000).toISOString();
    await dispatchTicketChanged(page, {
      ticketId: ticket.id,
      reason: 'status_changed',
      status: 'RESOLVED',
      priority: ticketState.priority,
      updatedAt: resolvedAt,
      occurredAt: resolvedAt,
    });

    await expect(page.getByRole('heading', { level: 3, name: subject })).toHaveCount(0);
    await expect.poll(() => listRequestCounter.get(), { timeout: 1000 }).toBe(0);
  } finally {
    listRequestCounter.dispose();
  }
});
