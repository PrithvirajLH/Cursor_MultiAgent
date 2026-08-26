import { performance } from 'node:perf_hooks';

const baseApi = process.env.API_BASE ?? 'http://localhost:3000/api';
const baseWeb = process.env.WEB_BASE ?? 'http://localhost:5173';
const agentEmail = process.env.AGENT_EMAIL ?? 'alex.park@company.com';
const adminEmail = process.env.ADMIN_EMAIL ?? 'sam.rivera@company.com';

const headers = (email) => ({
  'x-user-email': email
});

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function stats(values) {
  if (!values.length) {
    return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0 };
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    avg: sum / values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95)
  };
}

async function timedFetch(url, options) {
  const start = performance.now();
  const res = await fetch(url, options);
  await res.text();
  const ms = performance.now() - start;
  return { ms, status: res.status };
}

async function runLoad(name, makeRequest, { iterations, concurrency, warmup = 5 }) {
  for (let i = 0; i < warmup; i += 1) {
    await makeRequest();
  }

  let idx = 0;
  const timings = [];
  const statuses = {};

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const current = idx;
      idx += 1;
      if (current >= iterations) return;
      const result = await makeRequest();
      timings.push(result.ms);
      statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    }
  });

  await Promise.all(workers);

  return {
    name,
    timings,
    stats: stats(timings),
    statuses
  };
}

function formatStats({ count, min, max, avg, p50, p95 }) {
  return {
    count,
    min: min.toFixed(1),
    max: max.toFixed(1),
    avg: avg.toFixed(1),
    p50: p50.toFixed(1),
    p95: p95.toFixed(1)
  };
}

async function main() {
  console.log('Performance check starting...');

  const health = () => timedFetch(`${baseApi}/health`);

  const listTickets = () =>
    timedFetch(`${baseApi}/tickets?page=1&pageSize=20`, {
      headers: headers(agentEmail)
    });

  const listRes = await fetch(`${baseApi}/tickets?page=1&pageSize=1`, {
    headers: headers(agentEmail)
  });

  let ticketId = null;
  if (listRes.ok) {
    const data = await listRes.json();
    ticketId = data?.data?.[0]?.id ?? null;
  }

  const getTicket = () =>
    timedFetch(`${baseApi}/tickets/${ticketId}`, {
      headers: headers(agentEmail)
    });

  const reportSummary = () =>
    timedFetch(`${baseApi}/reports/summary`, {
      headers: headers(adminEmail)
    });

  const webHome = () => timedFetch(`${baseWeb}`);

  const suites = [];
  suites.push(await runLoad('API health', health, { iterations: 50, concurrency: 5 }));
  suites.push(await runLoad('API tickets list', listTickets, { iterations: 100, concurrency: 5 }));

  if (ticketId) {
    suites.push(await runLoad('API ticket detail', getTicket, { iterations: 80, concurrency: 5 }));
  } else {
    console.log('Skipping ticket detail (no ticket id found).');
  }

  suites.push(await runLoad('API reports summary', reportSummary, { iterations: 40, concurrency: 3 }));
  suites.push(await runLoad('Web home', webHome, { iterations: 30, concurrency: 3 }));

  console.log('--- Results (ms) ---');
  for (const suite of suites) {
    console.log(`${suite.name}:`, formatStats(suite.stats), 'status:', suite.statuses);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
