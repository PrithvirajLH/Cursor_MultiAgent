import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { authHeaders } from './auth';

const API_BASE = 'http://localhost:3000/api';
const IT_TEAM_ID = '11111111-1111-4111-8111-111111111111';
const REQUESTER_EMAIL = 'requester@company.com';
const ADMIN_EMAIL = 'admin@company.com';
const OWNER_EMAIL = 'owner@company.com';

const AGENT_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LEAD_USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

type TicketResponse = {
  id: string;
  assignee?: { id: string } | null;
};

type TeamResponse = {
  id: string;
  name: string;
};

async function openAs(page: Page, email: string, path: string) {
  await page.addInitScript((value) => window.localStorage.setItem('demoUserEmail', value), email);
  await page.goto(path, { waitUntil: 'networkidle' });
}

async function waitForTicketOverview(page: Page) {
  await expect(page.getByRole('tablist', { name: 'Ticket views' })).toBeVisible();
}

async function createTicket(
  api: APIRequestContext,
  subject: string,
  email: string,
  assignedTeamId: string
): Promise<TicketResponse> {
  const response = await api.post(`${API_BASE}/tickets`, {
    headers: authHeaders(email),
    data: {
      subject,
      description: 'E2E Sprint 3 test ticket',
      priority: 'P3',
      channel: 'PORTAL',
      assignedTeamId
    }
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as TicketResponse;
}

test('attachments upload and view in ticket detail', async ({ page, request }) => {
  const subject = `E2E Attach ${Date.now()}`;
  const ticket = await createTicket(request, subject, REQUESTER_EMAIL, IT_TEAM_ID);

  await openAs(page, REQUESTER_EMAIL, `/tickets/${ticket.id}`);
  await waitForTicketOverview(page);

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: 'hello.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello attachment')
  });

  await expect(page.getByText('hello.txt')).toBeVisible();

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'View' }).click()
  ]);

  await expect(popup).toHaveURL(/blob:/);
  await popup.close();
});

test('round-robin auto-assigns for teams configured with strategy', async ({ page, request }) => {
  const teamResponse = await request.post(`${API_BASE}/teams`, {
    headers: authHeaders(OWNER_EMAIL),
    data: { name: `RR Team ${Date.now()}` }
  });
  expect(teamResponse.ok()).toBeTruthy();
  const team = (await teamResponse.json()) as TeamResponse;

  await request.post(`${API_BASE}/teams/${team.id}/members`, {
    headers: authHeaders(OWNER_EMAIL),
    data: { userId: AGENT_USER_ID, role: 'AGENT' }
  });
  await request.post(`${API_BASE}/teams/${team.id}/members`, {
    headers: authHeaders(OWNER_EMAIL),
    data: { userId: LEAD_USER_ID, role: 'LEAD' }
  });

  const patchResponse = await request.patch(`${API_BASE}/teams/${team.id}`, {
    headers: authHeaders(OWNER_EMAIL),
    data: { assignmentStrategy: 'ROUND_ROBIN' }
  });
  expect(patchResponse.ok()).toBeTruthy();

  const firstTicket = await createTicket(request, `RR A ${Date.now()}`, REQUESTER_EMAIL, team.id);
  const secondTicket = await createTicket(request, `RR B ${Date.now()}`, REQUESTER_EMAIL, team.id);

  expect(firstTicket.assignee?.id).toBe(AGENT_USER_ID);
  expect(secondTicket.assignee?.id).toBe(LEAD_USER_ID);

  await openAs(page, OWNER_EMAIL, `/tickets/${firstTicket.id}`);
  await waitForTicketOverview(page);
  await expect(page.getByText('Assignee: Agent One')).toBeVisible();

  await openAs(page, OWNER_EMAIL, `/tickets/${secondTicket.id}`);
  await waitForTicketOverview(page);
  await expect(page.getByText('Assignee: Lead One')).toBeVisible();
});
