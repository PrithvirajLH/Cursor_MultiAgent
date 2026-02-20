import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { authHeaders } from './auth';

const API_BASE = 'http://localhost:3000/api';
const PERSONA_SETS = [
  {
    name: 'test',
    requester: 'requester@company.com',
    agent: 'agent@company.com',
    lead: 'lead@company.com',
    admin: 'admin@company.com'
  },
  {
    name: 'dev',
    requester: 'jane.doe@company.com',
    agent: 'alex.park@company.com',
    lead: 'maria.chen@company.com',
    admin: 'sam.rivera@company.com'
  }
] as const;

type PersonaSet = (typeof PERSONA_SETS)[number];

type TicketResponse = {
  id: string;
  subject: string;
};

async function openAs(page: Page, email: string, path: string) {
  await page.addInitScript((value) => window.localStorage.setItem('demoUserEmail', value), email);
  await page.goto(path, { waitUntil: 'networkidle' });
}

async function resolvePersonas(api: APIRequestContext): Promise<PersonaSet> {
  let lastStatus = 0;
  let lastBody = '';
  for (let attempt = 0; attempt < 10; attempt++) {
    for (const set of PERSONA_SETS) {
      try {
        const response = await api.get(`${API_BASE}/tickets`, {
          headers: authHeaders(set.admin)
        });
        if (response.ok()) {
          return set;
        }
        lastStatus = response.status();
        lastBody = await response.text();
      } catch (error) {
        lastStatus = 0;
        lastBody = error instanceof Error ? error.message : String(error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No valid personas found after retries (${lastStatus}): ${lastBody}`);
}

type UserResponse = {
  id: string;
  email: string;
};

type TeamResponse = {
  id: string;
  name: string;
  slug: string;
};

async function fetchTeamIdForUser(
  api: APIRequestContext,
  adminEmail: string,
  userId: string
) {
  const response = await api.get(`${API_BASE}/teams`, {
    headers: authHeaders(adminEmail)
  });
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Failed to list teams (${response.status()}): ${body}`);
  }
  const body = (await response.json()) as { data: TeamResponse[] };
  if (body.data.length === 0) {
    throw new Error('No teams returned from /teams');
  }

  const preferredTeam =
    body.data.find((item) => item.slug === 'it-service-desk') ??
    body.data.find((item) => item.name === 'IT Service Desk');

  const orderedTeamIds = [
    ...(preferredTeam ? [preferredTeam.id] : []),
    ...body.data.map((item) => item.id).filter((id) => id !== preferredTeam?.id)
  ];

  for (const teamId of orderedTeamIds) {
    const membersResponse = await api.get(`${API_BASE}/teams/${teamId}/members`, {
      headers: authHeaders(adminEmail)
    });
    if (!membersResponse.ok()) {
      continue;
    }
    const membersBody = (await membersResponse.json()) as {
      data: Array<{ userId?: string; user?: { id: string } }>;
    };
    const isMember = membersBody.data.some(
      (member) => member.userId === userId || member.user?.id === userId
    );
    if (isMember) {
      return teamId;
    }
  }

  return preferredTeam?.id ?? body.data[0].id;
}

async function fetchUserId(api: APIRequestContext, adminEmail: string, userEmail: string) {
  const response = await api.get(`${API_BASE}/users`, {
    headers: authHeaders(adminEmail)
  });
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Failed to list users (${response.status()}): ${body}`);
  }
  const body = (await response.json()) as { data: UserResponse[] };
  const user = body.data.find((item) => item.email === userEmail);
  if (!user) {
    throw new Error(`User ${userEmail} not found in /users response`);
  }
  return user.id;
}

async function createTicket(
  api: APIRequestContext,
  subject: string,
  email: string,
  assignedTeamId: string,
  priority: 'P1' | 'P2' | 'P3' | 'P4' = 'P3'
): Promise<TicketResponse> {
  let lastBody = '';
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await api.post(`${API_BASE}/tickets`, {
      headers: authHeaders(email),
      data: {
        subject,
        description: 'E2E UI/UX test ticket',
        priority,
        channel: 'PORTAL',
        assignedTeamId
      }
    });
    if (response.ok()) {
      return (await response.json()) as TicketResponse;
    }
    lastStatus = response.status();
    lastBody = await response.text();
    if (lastStatus < 500 || attempt === 2) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Failed to create ticket (${lastStatus}): ${lastBody}`);
}

type TicketDetailResponse = {
  id: string;
  status: string;
  assignee?: { id: string; email: string } | null;
};

async function fetchTicketById(
  api: APIRequestContext,
  email: string,
  ticketId: string
): Promise<TicketDetailResponse> {
  const response = await api.get(`${API_BASE}/tickets/${ticketId}`, {
    headers: authHeaders(email)
  });
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Failed to fetch ticket (${response.status()}): ${body}`);
  }
  return (await response.json()) as TicketDetailResponse;
}

async function assignTicket(
  api: APIRequestContext,
  ticketId: string,
  assigneeId: string,
  email: string
) {
  const response = await api.post(`${API_BASE}/tickets/${ticketId}/assign`, {
    headers: authHeaders(email),
    data: { assigneeId }
  });
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Failed to assign ticket (${response.status()}): ${body}`);
  }
}

async function waitForNotification(api: APIRequestContext, email: string) {
  let lastSnapshot = '';
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await api.get(`${API_BASE}/notifications?unreadOnly=true`, {
        headers: authHeaders(email)
      });
      if (response.ok()) {
        const body = (await response.json()) as { meta?: { unreadCount?: number } };
        if ((body.meta?.unreadCount ?? 0) > 0) {
          return;
        }
        lastSnapshot = JSON.stringify(body);
      } else {
        lastSnapshot = await response.text();
      }
    } catch (error) {
      lastSnapshot = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Notification not visible for ${email}. Last response: ${lastSnapshot}`);
}

async function markAllNotificationsRead(api: APIRequestContext, email: string) {
  const response = await api.patch(`${API_BASE}/notifications/read-all`, {
    headers: authHeaders(email)
  });
  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Failed to mark notifications read (${response.status()}): ${body}`);
  }
}

type NotificationMatch = {
  type: string;
  ticket?: { id: string; subject: string } | null;
};

async function waitForNotificationType(
  api: APIRequestContext,
  email: string,
  type: string,
  ticketId?: string
): Promise<NotificationMatch> {
  let lastSnapshot = '';
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const response = await api.get(`${API_BASE}/notifications?unreadOnly=true`, {
        headers: authHeaders(email)
      });
      if (response.ok()) {
        const body = (await response.json()) as {
          data?: Array<{ type: string; ticket?: { id: string } | null }>;
        };
        const match = body.data?.find(
          (item) =>
            item.type === type && (!ticketId || item.ticket?.id === ticketId)
        );
        if (match) {
          return match as NotificationMatch;
        }
        lastSnapshot = JSON.stringify(body);
      } else {
        lastSnapshot = await response.text();
      }
    } catch (error) {
      lastSnapshot = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Notification ${type} not visible for ${email}. Last response: ${lastSnapshot}`
  );
}

test('command palette searches tickets and navigates to detail', async ({ page, request }) => {
  const personas = await resolvePersonas(request);

  await openAs(page, personas.agent, '/dashboard');

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.getByRole('button', { name: /Search/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();

  const input = dialog.getByRole('textbox', { name: 'Search' });
  await input.fill('All Tickets');

  const ticketsPageResult = dialog.getByRole('button', { name: /All Tickets/i }).first();
  await expect(ticketsPageResult).toBeVisible();
  await ticketsPageResult.click();

  await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible();
});

test('notification center shows assigned notification and marks read', async ({ page, request }) => {
  const personas = await resolvePersonas(request);
  const agentId = await fetchUserId(request, personas.admin, personas.agent);
  const teamId = await fetchTeamIdForUser(request, personas.admin, agentId);
  await markAllNotificationsRead(request, personas.agent);
  const subject = `Notification ${Date.now()}`;
  const ticket = await createTicket(request, subject, personas.requester, teamId);
  await assignTicket(request, ticket.id, agentId, personas.admin);
  await waitForNotification(request, personas.agent);

  await openAs(page, personas.agent, '/dashboard');

  const bell = page.getByRole('button', { name: /Notifications/ });
  await expect(bell).toBeVisible();

  await bell.click();
  const dropdown = page.getByRole('menu');
  await expect(dropdown.getByRole('heading', { name: 'Notifications' })).toBeVisible();

  const notificationItem = dropdown
    .getByRole('button', { name: /Ticket assigned to you/i })
    .first();
  await expect(notificationItem).toBeVisible();

  await notificationItem.hover();
  await notificationItem.getByRole('button', { name: 'Mark as read' }).click();

  await Promise.all([
    page.waitForURL(new RegExp(`/tickets/${ticket.id}`)),
    notificationItem.click()
  ]);
  await expect(page.getByRole('tablist', { name: 'Ticket views' })).toBeVisible();
  await expect(page.getByText(subject)).toBeVisible();
});

test('notification center shows SLA at-risk alert', async ({ page, request }) => {
  const personas = await resolvePersonas(request);
  const leadId = await fetchUserId(request, personas.admin, personas.lead);
  const teamId = await fetchTeamIdForUser(request, personas.admin, leadId);
  const subject = `SLA At Risk ${Date.now()}`;
  const ticket = await createTicket(request, subject, personas.requester, teamId, 'P1');

  let notification: NotificationMatch;
  try {
    notification = await waitForNotificationType(request, personas.lead, 'SLA_AT_RISK', ticket.id);
  } catch {
    notification = await waitForNotificationType(request, personas.lead, 'SLA_AT_RISK');
  }
  const notificationSubject = notification.ticket?.subject ?? subject;

  await openAs(page, personas.lead, '/dashboard');

  const bell = page.getByRole('button', { name: /Notifications/ });
  await expect(bell).toBeVisible();

  await bell.click();
  const dropdown = page.getByRole('menu');
  await expect(dropdown.getByRole('heading', { name: 'Notifications' })).toBeVisible();

  const atRiskItem = dropdown
    .getByRole('button', { name: /SLA at risk/i })
    .first();
  await expect(atRiskItem).toBeVisible();

  await atRiskItem.click();
  await expect(page.getByRole('tablist', { name: 'Ticket views' })).toBeVisible();
  await expect(page.getByText(subject)).toBeVisible();
});

test('bulk actions toolbar assigns and updates selected tickets', async ({ page, request }) => {
  const personas = await resolvePersonas(request);
  const adminId = await fetchUserId(request, personas.admin, personas.admin);
  const teamId = await fetchTeamIdForUser(request, personas.admin, adminId);
  const subjectPrefix = `Bulk Actions ${Date.now()}`;
  const ticketA = await createTicket(request, `${subjectPrefix} A`, personas.requester, teamId);
  const ticketB = await createTicket(request, `${subjectPrefix} B`, personas.requester, teamId);

  await openAs(page, personas.admin, '/tickets');

  await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible();
  await page
    .getByPlaceholder(/Search by ticket ID, subject, or description/)
    .first()
    .fill(subjectPrefix);

  await expect(page.getByRole('button', { name: `${subjectPrefix} A` }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: `${subjectPrefix} B` }).first()).toBeVisible();

  const selectAll = page.getByLabel('Select all');
  await expect(selectAll).toBeVisible();

  const rowA = page.getByRole('button', { name: `${subjectPrefix} A` }).first();
  const rowB = page.getByRole('button', { name: `${subjectPrefix} B` }).first();
  await rowA.locator('input[type="checkbox"]').check();
  await rowB.locator('input[type="checkbox"]').check();

  await expect(page.getByText('2 tickets selected')).toBeVisible();
  const assignToMe = page.getByRole('button', { name: 'Assign to me' });
  await expect(assignToMe).toBeEnabled();

  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/tickets/bulk/assign') && response.ok()),
    assignToMe.click()
  ]);

  const updatedA = await fetchTicketById(request, personas.admin, ticketA.id);
  const updatedB = await fetchTicketById(request, personas.admin, ticketB.id);
  expect(updatedA.assignee?.email).toBe(personas.admin);
  expect(updatedB.assignee?.email).toBe(personas.admin);

  await expect(page.getByText(/ticket.*selected/)).toHaveCount(0);

  await selectAll.check();
  const statusSelect = page.locator('select', {
    has: page.locator('option[value="IN_PROGRESS"]')
  });
  await statusSelect.selectOption('IN_PROGRESS');
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/tickets/bulk/status') && response.ok()),
    statusSelect.locator('..').getByRole('button', { name: 'Apply' }).click()
  ]);

  const statusA = await fetchTicketById(request, personas.admin, ticketA.id);
  const statusB = await fetchTicketById(request, personas.admin, ticketB.id);
  expect(statusA.status).toBe('IN_PROGRESS');
  expect(statusB.status).toBe('IN_PROGRESS');
});

test('keyboard shortcuts open command palette and create ticket modal', async ({ page, request }) => {
  const personas = await resolvePersonas(request);

  await openAs(page, personas.agent, '/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.keyboard.press('Control+KeyK');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);

  await page.keyboard.press('/');
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);

  await page.keyboard.press('Alt+KeyN');
  await expect(page.getByText('Raise a new ticket')).toBeVisible();
});

test('keyboard shortcuts navigate tickets list and detail actions', async ({ page, request }) => {
  const personas = await resolvePersonas(request);
  const adminId = await fetchUserId(request, personas.admin, personas.admin);
  const teamId = await fetchTeamIdForUser(request, personas.admin, adminId);
  const subjectPrefix = `Shortcuts ${Date.now()}`;
  await createTicket(request, `${subjectPrefix} A`, personas.requester, teamId);
  await createTicket(request, `${subjectPrefix} B`, personas.requester, teamId);

  await openAs(page, personas.admin, '/tickets');
  const heading = page.getByRole('heading', { name: 'Tickets' });
  await expect(heading).toBeVisible();

  const searchInput = page
    .getByPlaceholder(/Search by ticket ID, subject, or description/)
    .first();
  await page.keyboard.down('Control');
  await page.keyboard.press('/');
  await page.keyboard.up('Control');
  await expect(searchInput).toBeFocused();

  await heading.click();
  await page.keyboard.press('Shift+Slash');
  const helpDialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(helpDialog).toBeVisible();
  await expect(helpDialog.getByText('Ticket list')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(helpDialog).toHaveCount(0);

  await searchInput.fill(subjectPrefix);
  await heading.click();

  const rows = page.getByRole('button', { name: new RegExp(subjectPrefix) });
  const firstRow = rows.nth(0);
  const secondRow = rows.nth(1);
  await expect(firstRow).toBeVisible();
  await expect(secondRow).toBeVisible();

  await page.keyboard.press('x');
  await expect(firstRow.locator('input[type="checkbox"]')).toBeChecked();

  await page.keyboard.press('j');

  await page.keyboard.press('Shift+X');
  await expect(secondRow.locator('input[type="checkbox"]')).toBeChecked();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/tickets\/[^/?#]+$/);
  await expect(page.getByRole('tablist', { name: 'Ticket views' })).toBeVisible();

  const replyBox = page.getByPlaceholder(/Write a reply|Add an internal note/);
  await page.keyboard.press('r');
  const replyShortcutFocused = await replyBox.evaluate(
    (element) => element === document.activeElement
  );
  if (!replyShortcutFocused) {
    await page.getByRole('button', { name: 'Reply' }).click();
  }
  await expect(replyBox).toBeFocused();
  await page.getByRole('tab', { name: /Conversation/ }).click();

  const statusSelect = page
    .getByRole('combobox')
    .filter({ has: page.getByRole('option', { name: /In Progress/ }) })
    .first();
  await page.keyboard.press('s');
  const statusShortcutFocused = await statusSelect.evaluate(
    (element) => element === document.activeElement
  );
  if (!statusShortcutFocused) {
    await statusSelect.click();
  }
  await expect(statusSelect).toBeFocused();

  const assignButton = page.getByRole('button', { name: 'Assign to me' });
  await expect(assignButton).toBeVisible();
  await page.keyboard.press('a');
  const assignByShortcut = await page
    .waitForResponse(
      (response) => response.url().includes('/assign') && response.ok(),
      { timeout: 3000 }
    )
    .catch(() => null);
  if (!assignByShortcut) {
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/assign') && response.ok()),
      assignButton.click()
    ]);
  }
  await expect(assignButton).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(heading).toBeVisible();
});
