/**
 * Read-only: how fast are ticket and knowledge-base search IN PRODUCTION?
 *
 * Card 0.9. The stated requirement is sub-500 ms. The board's note said to
 * measure against local WSL Postgres because there is no staging - but local
 * Postgres is far faster than the remote pooler, which is exactly how card
 * 1.51's transaction timeout hid from a green test suite. Production has been
 * readable from this machine since the firewall rule landed on 2026-09-08, so
 * this measures there.
 *
 * ⚠️ READ ONLY. Every statement is a SELECT or an EXPLAIN of one. There is no
 * apply mode, no fixture creation and no mutation anywhere in this file.
 * `EXPLAIN ANALYZE` does execute its query - which is the point, it is how the
 * real plan and the real timing are obtained - but the query it executes is a
 * SELECT.
 *
 * Run from `apps/api`:  node prod-search-timing.mjs
 */
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/** Iterations per query. Enough for a stable median without hammering prod. */
const N = 15;
/** The stated requirement, in milliseconds. */
const BUDGET_MS = 500;

function productionUrl() {
  const out = execSync(
    'az webapp config appsettings list --name TicketTicket --resource-group csnhc-ai ' +
      '--query "[?name==\'DIRECT_URL\'].value | [0]" -o tsv',
    { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim();
  if (!out) throw new Error('Could not read DIRECT_URL from App Service.');
  return out;
}

const url = productionUrl();
console.log(`Server: ${url.replace(/.*@([^:/?]+).*/, '$1')}`);
console.log(`Mode:   READ ONLY    Iterations: ${N}    Budget: ${BUDGET_MS} ms\n`);

const prisma = new PrismaClient({ datasources: { db: { url } } });

/** p50 and the worst of N. An average hides the tail; the tail is the complaint. */
function summarise(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length / 2)],
    worst: sorted[sorted.length - 1],
    best: sorted[0],
  };
}

async function timeQuery(label, run) {
  // One untimed call first: the first query on a cold pooled connection pays
  // for the connection, not for the query, and reporting that as the p50 would
  // be measuring the wrong thing.
  await run();
  const times = [];
  for (let i = 0; i < N; i += 1) {
    const started = process.hrtime.bigint();
    await run();
    times.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  const { p50, worst, best } = summarise(times);
  const verdict = worst <= BUDGET_MS ? 'PASS' : 'OVER BUDGET';
  console.log(
    `${label}\n` +
      `    p50 ${p50.toFixed(1)} ms   worst ${worst.toFixed(1)} ms   ` +
      `best ${best.toFixed(1)} ms   -> ${verdict}`,
  );
  return { label, p50, worst, best };
}

try {
  // ---- What is actually in there? A timing number is meaningless without it.
  const [volumes] = await prisma.$queryRaw`
    SELECT
      (SELECT COUNT(*)::int FROM "Ticket")               AS tickets,
      (SELECT COUNT(*)::int FROM "Ticket" WHERE "deletedAt" IS NULL) AS live_tickets,
      (SELECT COUNT(*)::int FROM "TicketMessage")        AS messages,
      (SELECT COUNT(*)::int FROM "KbArticle")            AS kb_articles,
      (SELECT COUNT(*)::int FROM "User")                 AS users`;
  console.log('Production volumes');
  console.log(`    tickets ${volumes.tickets} (${volumes.live_tickets} live), ` +
    `messages ${volumes.messages}, KB articles ${volumes.kb_articles}, users ${volumes.users}\n`);

  // ---- Are the six trigram GIN indexes actually there?
  // ⚠️ The migration row for 20260220150000_add_ticket_search_trigram_indexes is
  // marked rolled-back in production, so the catalogue is the only honest answer.
  const indexes = await prisma.$queryRaw`
    SELECT indexname, tablename
    FROM pg_indexes
    WHERE indexname LIKE '%trgm%'
    ORDER BY indexname`;
  console.log(`Trigram indexes present: ${indexes.length}`);
  for (const row of indexes) console.log(`    ${row.tablename}.${row.indexname}`);
  console.log('');

  // ---- The three queries the card names. These mirror what Prisma emits for
  // `contains` + `mode: 'insensitive'`, which is ILIKE '%term%'.
  const term = '%Termination%';
  const results = [];

  results.push(
    await timeQuery('Ticket list, first page (no search)', () =>
      prisma.$queryRaw`
        SELECT id, "displayId", subject, status, priority, "updatedAt"
        FROM "Ticket"
        WHERE "deletedAt" IS NULL
        ORDER BY "updatedAt" DESC
        LIMIT 50`),
  );

  results.push(
    await timeQuery('Ticket search, text term', () =>
      prisma.$queryRaw`
        SELECT id, "displayId", subject, status, priority, "updatedAt"
        FROM "Ticket"
        WHERE "deletedAt" IS NULL
          AND (subject ILIKE ${term}
               OR description ILIKE ${term}
               OR "displayId" ILIKE ${term})
        ORDER BY "updatedAt" DESC
        LIMIT 50`),
  );

  results.push(
    await timeQuery('Knowledge-base search', () =>
      prisma.$queryRaw`
        SELECT id, title, summary
        FROM "KbArticle"
        WHERE (title ILIKE ${term}
               OR summary ILIKE ${term}
               OR content ILIKE ${term})
        LIMIT 20`),
  );

  // ---- Which index did the planner actually choose?
  console.log('\nEXPLAIN (the plan line that decides it)');
  const plans = [
    [
      'Ticket search',
      await prisma.$queryRaw`
        EXPLAIN ANALYZE
        SELECT id FROM "Ticket"
        WHERE "deletedAt" IS NULL
          AND (subject ILIKE ${term}
               OR description ILIKE ${term}
               OR "displayId" ILIKE ${term})
        ORDER BY "updatedAt" DESC
        LIMIT 50`,
    ],
    [
      'KB search',
      await prisma.$queryRaw`
        EXPLAIN ANALYZE
        SELECT id FROM "KbArticle"
        WHERE (title ILIKE ${term}
               OR summary ILIKE ${term}
               OR content ILIKE ${term})
        LIMIT 20`,
    ],
  ];
  for (const [label, plan] of plans) {
    console.log(`\n  ${label}:`);
    for (const row of plan) console.log(`    ${row['QUERY PLAN']}`);
  }

  console.log('\nSummary');
  for (const r of results) {
    console.log(
      `    ${r.label.padEnd(38)} p50 ${r.p50.toFixed(1).padStart(7)} ms   ` +
        `worst ${r.worst.toFixed(1).padStart(7)} ms`,
    );
  }
} finally {
  await prisma.$disconnect();
}
