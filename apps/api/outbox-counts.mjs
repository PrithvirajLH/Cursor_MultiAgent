/**
 * Read-only. Prints the production email outbox by status.
 *
 * This is the number card 1.32 Task 1 asked for and nobody has: the implementer
 * has no database credentials, and the planner's writes are blocked. It matters
 * because 1.32's sweeper ships ENABLED, and §4.6 said to look at the queue before
 * enabling it rather than after.
 *
 * What the numbers mean:
 *   PENDING     with attempts left -> the sweeper WILL retry these on its first
 *               tick after deploy. This is the number to look at.
 *   PROCESSING  older than 10 minutes -> abandoned mid-send; the sweeper reclaims
 *               them. A large count means past crashes, not current work.
 *   FAILED      terminal. The sweeper never touches these.
 *   SENT        history.
 *
 * Run from apps/api:  node outbox-counts.mjs
 */
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

function productionUrl() {
  const out = execSync(
    'az webapp config appsettings list --name TicketTicket --resource-group csnhc-ai ' +
      '--query "[?name==\'DIRECT_URL\'].value | [0]" -o tsv',
    { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim();
  if (!out) throw new Error('Could not read DIRECT_URL from App Service.');
  return out;
}

const MAX_ATTEMPTS = 5;
const STALE_MINUTES = 10;

const url = productionUrl();
console.log(`Server: ${url.replace(/.*@([^:/?]+).*/, '$1')}`);
console.log('');

const prisma = new PrismaClient({ datasources: { db: { url } } });

const byStatus = await prisma.notificationOutbox.groupBy({
  by: ['status'],
  where: { channel: 'EMAIL' },
  _count: { _all: true },
});

console.log('--- email outbox by status ---');
if (byStatus.length === 0) {
  console.log('  empty');
} else {
  for (const row of byStatus) {
    console.log(`  ${String(row.status).padEnd(12)} ${row._count._all}`);
  }
}

// The one that actually decides whether the first sweep needs watching.
const retryable = await prisma.notificationOutbox.count({
  where: {
    channel: 'EMAIL',
    status: 'PENDING',
    attempts: { lt: MAX_ATTEMPTS },
  },
});
const staleProcessing = await prisma.notificationOutbox.count({
  where: {
    channel: 'EMAIL',
    status: 'PROCESSING',
    updatedAt: { lt: new Date(Date.now() - STALE_MINUTES * 60 * 1000) },
  },
});

console.log('');
console.log('--- what the sweeper will do on its first tick ---');
console.log(`  PENDING with attempts left        ${retryable}   <- it will retry these`);
console.log(`  PROCESSING abandoned >${STALE_MINUTES}min       ${staleProcessing}   <- it will reclaim these`);
console.log('');
if (retryable === 0 && staleProcessing === 0) {
  console.log('  Nothing queued. The first sweep is a no-op - deploy unsupervised.');
} else {
  console.log(
    `  ${retryable + staleProcessing} row(s) will move on the first tick.\n` +
      '  EMAIL_TEST_RECIPIENTS is set, so anything retried goes to the owner\n' +
      '  and nowhere else. Watch the first tick rather than deploying and leaving.',
  );
}

// Oldest pending, if any - tells you whether this is recent or historical.
const oldest = await prisma.notificationOutbox.findFirst({
  where: { channel: 'EMAIL', status: 'PENDING', attempts: { lt: MAX_ATTEMPTS } },
  orderBy: { createdAt: 'asc' },
  select: { createdAt: true, attempts: true, eventType: true },
});
if (oldest) {
  console.log('');
  console.log(
    `  oldest retryable: ${oldest.createdAt.toISOString()} ` +
      `(${oldest.eventType}, attempts ${oldest.attempts})`,
  );
}

await prisma.$disconnect();
