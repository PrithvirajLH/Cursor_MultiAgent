import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';

const baseWeb = process.env.WEB_BASE ?? 'http://localhost:5173';
const baseApi = process.env.API_BASE ?? 'http://localhost:3000/api';
const agentEmail = process.env.AGENT_EMAIL ?? 'alex.park@company.com';

const headers = {
  'x-user-email': agentEmail
};

async function measure(label, fn) {
  const start = performance.now();
  await fn();
  const ms = performance.now() - start;
  return { label, ms };
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const results = [];

  results.push(await measure('Tickets page load (table ready)', async () => {
    await page.goto(`${baseWeb}/tickets`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('input[placeholder=\"Search subject or description…\"]', { timeout: 60000 });
    await page.getByRole('tab', { name: 'Table' }).click();
    await page.waitForSelector('#view-toggle-table[aria-selected=\"true\"]', { timeout: 10000 });
    await Promise.any([
      page.waitForSelector('table tbody tr', { timeout: 60000 }),
      page.getByText('No tickets found', { exact: false }).waitFor({ timeout: 60000 }),
      page.getByText('Unable to load tickets', { exact: false }).waitFor({ timeout: 60000 })
    ]);
  }));

  let ticketId = null;
  try {
    const listRes = await fetch(`${baseApi}/tickets?page=1&pageSize=1`, { headers });
    if (listRes.ok) {
      const data = await listRes.json();
      ticketId = data?.data?.[0]?.id ?? null;
    }
  } catch {}

  if (ticketId) {
    results.push(await measure('Ticket detail load (conversation panel)', async () => {
      await page.goto(`${baseWeb}/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' });
      await Promise.any([
        page.waitForSelector('#ticket-conversation-panel', { timeout: 60000 }),
        page.getByText('You don’t have access to this ticket', { exact: false }).waitFor({ timeout: 60000 }),
        page.getByText('Ticket not found', { exact: false }).waitFor({ timeout: 60000 })
      ]);
    }));

    results.push(await measure('Timeline tab switch', async () => {
      await page.getByRole('tab', { name: 'Timeline' }).click();
      await page.waitForSelector('#ticket-timeline-panel', { timeout: 60000 });
    }));
  } else {
    results.push({ label: 'Ticket detail load (conversation panel)', ms: 0 });
    results.push({ label: 'Timeline tab switch', ms: 0 });
  }

  console.log('--- UI Interaction Timings (ms) ---');
  for (const result of results) {
    console.log(`${result.label}: ${result.ms.toFixed(1)}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
