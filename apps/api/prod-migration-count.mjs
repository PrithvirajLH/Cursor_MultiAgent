/**
 * Read-only: how many migrations has production applied, and what is the latest?
 *
 * Answers the one question a deploy handoff must state correctly — the starting
 * point. Writes nothing; there is no apply mode and no mutation in this file.
 *
 * Run from `apps/api`:  node prod-migration-count.mjs
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

const url = productionUrl();
console.log(`Server: ${url.replace(/.*@([^:/?]+).*/, '$1')}`);
console.log('Mode:   READ ONLY\n');
const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  const rows = await prisma.$queryRaw`
    SELECT migration_name, finished_at
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL
    ORDER BY finished_at DESC
    LIMIT 4`;
  const [{ n }] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
  console.log(`Applied migrations: ${n}`);
  console.log('Most recent four:');
  for (const r of rows) console.log(`  ${r.migration_name}`);
  const failed = await prisma.$queryRaw`
    SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL`;
  console.log(`\nUnfinished/failed rows: ${failed.length}`);
  for (const r of failed) console.log(`  ⚠️ ${r.migration_name}`);
} finally {
  await prisma.$disconnect();
}
