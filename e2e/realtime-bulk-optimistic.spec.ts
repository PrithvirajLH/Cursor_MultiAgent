import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { authHeaders } from './auth';

const API_BASE = 'http://localhost:3000/api';
const IT_TEAM_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_EMAIL = 'agent@company.com';
const ADMIN_EMAIL = 'admin@company.com';

type TicketRecord = {
  id: string;
  subject: string;
  status: string;
  priority: string;
};

function buildTicketListRequestCounter(page: Page) {
  let requestCount = 0;
  const handler = (request: { url: () => string; method: () => string }) => {
    const url = request.url();
    if (
      request.method() === 'GET' &&
      url.includes('/api/tickets?') &&
      url.includes('scope=all') &&
      url.includes('statusGroup=open')
    ) {
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
      description: 'E2E optimistic bulk action ticket',
      priority: 'P3',
      channel: 'PORTAL',
      assignedTeamId: IT_TEAM_ID,
    },
  });
  if (!response.ok()) {
    throw new Error(`Create ticket failed (${response.status()}): ${await response.text()}`);
  }
  return (await response.json()) as TicketRecord;
}

test('bulk status uses optimistic in-place update, avoids full refetch, and rolls back failed rows', async ({
  page,
  request,
}) => {
  const prefix = `Bulk optimistic ${Date.now()}`;
  const successTicket = await createTicket(request, `${prefix} success`, ADMIN_EMAIL);
  const failedTicket = await createTicket(request, `${prefix} failed`, ADMIN_EMAIL);

  const listRequestCounter = buildTicketListRequestCounter(page);
  let bulkStatusRequestCount = 0;

  try {
    await openAs(page, AGENT_EMAIL, '/tickets?scope=all&statusGroup=open');

    const searchInput = page
      .getByPlaceholder(/Search by ticket ID, subject, or description/)
      .first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill(prefix);

    const successRow = page.locator('tr[role="button"]').filter({ hasText: successTicket.subject }).first();
    const failedRow = page.locator('tr[role="button"]').filter({ hasText: failedTicket.subject }).first();
    await expect(successRow).toBeVisible();
    await expect(failedRow).toBeVisible();
    await expect(successRow.getByText(/^New$/)).toBeVisible();
    await expect(failedRow.getByText(/^New$/)).toBeVisible();
    await page.waitForLoadState('networkidle');

    await successRow.getByRole('checkbox', { name: `Select ticket ${successTicket.subject}` }).check();
    await failedRow.getByRole('checkbox', { name: `Select ticket ${failedTicket.subject}` }).check();

    const toolbar = page.locator('div.rounded-lg.border.border-blue-200.bg-blue-50');
    await expect(toolbar.getByText('2 tickets selected')).toBeVisible();

    await page.route('**/api/tickets/bulk/status', async (route) => {
      bulkStatusRequestCount += 1;
      const body = JSON.parse(route.request().postData() ?? '{}') as {
        ticketIds?: string[];
        status?: string;
      };

      expect(body.status).toBe('IN_PROGRESS');
      expect(body.ticketIds).toBeTruthy();
      expect(new Set(body.ticketIds)).toEqual(
        new Set([successTicket.id, failedTicket.id]),
      );

      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            success: 1,
            failed: 1,
            succeededTicketIds: [successTicket.id],
            failedTicketIds: [failedTicket.id],
            errors: [{ ticketId: failedTicket.id, message: 'Simulated failure for rollback validation' }],
          },
        }),
      });
    });

    listRequestCounter.reset();
    await toolbar.locator('select').nth(1).selectOption('IN_PROGRESS');
    await toolbar.getByRole('button', { name: 'Apply' }).nth(1).click();

    await expect(successRow.getByText(/^In Progress$/)).toBeVisible({ timeout: 1200 });
    await expect(failedRow.getByText(/^In Progress$/)).toBeVisible({ timeout: 1200 });

    await expect.poll(() => bulkStatusRequestCount).toBe(1);
    await expect(failedRow.getByText(/^New$/)).toBeVisible();
    await expect(successRow.getByText(/^In Progress$/)).toBeVisible();
    await expect.poll(() => listRequestCounter.get(), { timeout: 1500 }).toBe(0);
  } finally {
    await page.unroute('**/api/tickets/bulk/status');
    listRequestCounter.dispose();
  }
});
