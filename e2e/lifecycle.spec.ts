import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';
import { authHeaders } from './auth';

const API_BASE = 'http://localhost:3000/api';
const IT_TEAM_ID = '11111111-1111-4111-8111-111111111111';
const HR_TEAM_ID = '22222222-2222-4222-8222-222222222222';
const REQUESTER_EMAIL = 'requester@company.com';
const AGENT_EMAIL = 'agent@company.com';
const LEAD_EMAIL = 'lead@company.com';
const ADMIN_EMAIL = 'admin@company.com';
const OWNER_EMAIL = 'owner@company.com';

type TicketResponse = {
  id: string;
  status: string;
  subject: string;
  assignedTeam?: { id: string } | null;
};

async function openAs(page: Page, email: string, path: string) {
  await page.addInitScript((value) => window.localStorage.setItem('demoUserEmail', value), email);
  await page.goto(path, { waitUntil: 'networkidle' });
}

async function openCreateTicketModal(page: Page) {
  await page.getByRole('button', { name: 'New Ticket' }).click();
  await expect(page.getByRole('heading', { name: 'Raise a new ticket' })).toBeVisible();
}

async function waitForTicketOverview(page: Page) {
  await expect(page.getByRole('tablist', { name: 'Ticket views' })).toBeVisible();
}

async function waitForSelectOption(select: Locator, label: string) {
  await expect.poll(
    async () => {
      return await select.locator('option').allTextContents();
    },
    { timeout: 15_000 }
  ).toContain(label);
}

async function ensureDepartmentOption(page: Page, label: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const select = page
      .locator('label:has-text("Department")')
      .locator('..')
      .getByRole('combobox');
    try {
      await waitForSelectOption(select, label);
      return select;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
      await page.reload({ waitUntil: 'networkidle' });
      await openCreateTicketModal(page);
    }
  }
  throw new Error(`Department option "${label}" not found`);
}

async function createTicket(
  api: APIRequestContext,
  subject: string,
  email: string
): Promise<TicketResponse> {
  const response = await api.post(`${API_BASE}/tickets`, {
    headers: authHeaders(email),
    data: {
      subject,
      description: 'E2E lifecycle test ticket',
      priority: 'P3',
      channel: 'PORTAL',
      assignedTeamId: IT_TEAM_ID
    }
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as TicketResponse;
}

async function waitForStatus(
  api: APIRequestContext,
  ticketId: string,
  email: string,
  status: string
) {
  await expect.poll(
    async () => {
      const response = await api.get(`${API_BASE}/tickets/${ticketId}`, {
        headers: authHeaders(email)
      });
      if (!response.ok()) {
        return 'ERROR';
      }
      const body = (await response.json()) as TicketResponse;
      return body.status;
    },
    { timeout: 15_000 }
  ).toBe(status);
}

test('requester creates a ticket and sees it in My Tickets', async ({ page }) => {
  const subject = `E2E Ticket ${Date.now()}`;
  await openAs(page, REQUESTER_EMAIL, '/dashboard');

  await openCreateTicketModal(page);
  const departmentSelect = page.getByRole('combobox', { name: 'Department *' });
  await waitForSelectOption(departmentSelect, 'IT Service Desk');
  await departmentSelect.selectOption({ label: 'IT Service Desk' });

  await page.getByRole('textbox', { name: 'Subject *' }).fill(subject);

  await page.getByRole('textbox', { name: 'Description *' }).fill('E2E description');

  const [createResponse] = await Promise.all([
    page.waitForResponse((response) => {
      return response.url().includes('/api/tickets') && response.request().method() === 'POST';
    }),
    page.getByRole('button', { name: 'Submit ticket' }).click()
  ]);
  expect(createResponse.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Raise a new ticket' })).toBeHidden({
    timeout: 10_000
  });

  await page.goto('/tickets');
  await page
    .getByPlaceholder(/Search by ticket ID, subject, or description/)
    .first()
    .fill(subject);
  await expect(page.getByText(subject)).toBeVisible();
});

test('agent assigns and transitions a ticket', async ({ page, request }) => {
  const subject = `E2E Assign ${Date.now()}`;
  const ticket = await createTicket(request, subject, REQUESTER_EMAIL);

  await openAs(page, AGENT_EMAIL, `/tickets/${ticket.id}`);
  await waitForTicketOverview(page);

  const assignSelect = page.getByRole('combobox', { name: 'Assign', exact: true });
  await waitForSelectOption(assignSelect, 'Agent One');
  await assignSelect.selectOption({ label: 'Agent One' });
  await page.getByRole('button', { name: 'Assign', exact: true }).first().click();
  await waitForStatus(request, ticket.id, AGENT_EMAIL, 'ASSIGNED');

  const statusSelect = page.getByRole('combobox', { name: 'Status' });
  await statusSelect.selectOption({ label: 'In Progress' });
  await page.getByRole('button', { name: 'Update' }).first().click();
  await waitForStatus(request, ticket.id, AGENT_EMAIL, 'IN_PROGRESS');
});

test('internal notes are hidden from requester', async ({ page, request }) => {
  const subject = `E2E Notes ${Date.now()}`;
  const ticket = await createTicket(request, subject, REQUESTER_EMAIL);

  await openAs(page, AGENT_EMAIL, `/tickets/${ticket.id}`);
  await waitForTicketOverview(page);

  await page.getByRole('button', { name: 'Internal' }).click();
  const internalText = `Internal note ${Date.now()}`;
  await page.getByPlaceholder(/Add an internal note/).fill(internalText);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(internalText)).toBeVisible();

  await page.getByRole('button', { name: 'Public' }).click();
  const publicText = `Public reply ${Date.now()}`;
  await page.getByPlaceholder(/Write a reply/).fill(publicText);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(publicText)).toBeVisible();

  await openAs(page, REQUESTER_EMAIL, `/tickets/${ticket.id}`);
  await expect(page.getByText(publicText)).toBeVisible();
  await expect(page.getByText(internalText)).toHaveCount(0);

});

test('triage board drag-drop updates status and shows SLA badge', async ({ page, request }) => {
  const subject = `E2E Triage ${Date.now()}`;
  const ticket = await createTicket(request, subject, REQUESTER_EMAIL);

  await openAs(page, LEAD_EMAIL, '/triage');
  await expect(page.getByRole('heading', { name: 'Triage Board', level: 1 })).toBeVisible();
  const triageSearch = page.getByPlaceholder('Search by ID, subject, requester, or team...');
  await expect(triageSearch).toBeVisible();
  await triageSearch.fill(subject);

  const ticketCardTitle = page.getByRole('heading', { name: subject, level: 3 }).first();
  const ticketCard = ticketCardTitle.locator('xpath=ancestor::div[contains(@class,"cursor-grab")]').first();
  await expect(ticketCard).toBeVisible();
  await expect(ticketCard.getByText('On track')).toBeVisible();

  const moveSelect = ticketCard.getByRole('combobox', { name: 'Move ticket (keyboard accessible)' });
  await moveSelect.selectOption({ label: 'Triaged' });

  await waitForStatus(request, ticket.id, LEAD_EMAIL, 'TRIAGED');
});

test('owner can transfer ticket and lead becomes read-only', async ({ page, request }) => {
  const subject = `E2E Transfer ${Date.now()}`;
  const ticket = await createTicket(request, subject, REQUESTER_EMAIL);

  await openAs(page, OWNER_EMAIL, `/tickets/${ticket.id}`);
  await waitForTicketOverview(page);

  const teamSelect = page.getByRole('combobox', { name: 'Transfer to department' });
  await waitForSelectOption(teamSelect, 'HR Operations');
  await teamSelect.selectOption({ label: 'HR Operations' });
  await expect(teamSelect).toHaveValue(HR_TEAM_ID);
  const transferCard = teamSelect.locator('xpath=ancestor::div[contains(@class,"space-y-2")]').first();
  const transferButton = transferCard.getByRole('button', { name: 'Transfer' });
  await expect(transferButton).toBeEnabled();
  await transferButton.click();

  await expect.poll(async () => {
    const response = await request.get(`${API_BASE}/tickets/${ticket.id}`, {
      headers: authHeaders(OWNER_EMAIL)
    });
    if (!response.ok()) {
      return 'ERROR';
    }
    const body = (await response.json()) as TicketResponse;
    return body.assignedTeam?.id ?? 'NONE';
  }, { timeout: 15_000 }).toBe(HR_TEAM_ID);

  const writeAttempt = await request.post(`${API_BASE}/tickets/${ticket.id}/messages`, {
    headers: authHeaders(LEAD_EMAIL),
    data: { body: 'Lead follow-up', type: 'PUBLIC' }
  });
  expect(writeAttempt.status()).toBe(403);
});

test('SLA badge appears on ticket list', async ({ page, request }) => {
  const subject = `E2E SLA ${Date.now()}`;
  await createTicket(request, subject, REQUESTER_EMAIL);

  await openAs(page, AGENT_EMAIL, '/tickets?scope=all');
  const searchInput = page
    .getByPlaceholder(/Search by ticket ID, subject, or description/)
    .first();
  await expect(searchInput).toBeVisible();
  await searchInput.fill(subject);

  const ticketCard = page.getByRole('button', { name: new RegExp(subject) }).first();
  await expect(ticketCard).toBeVisible();
  await expect(ticketCard.getByText('On track')).toBeVisible();
});
