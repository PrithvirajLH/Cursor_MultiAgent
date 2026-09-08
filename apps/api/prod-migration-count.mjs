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
  // `finished_at IS NULL` alone is NOT a problem and must not be reported as one.
  // A row that failed and was then resolved with `prisma migrate resolve
  // --rolled-back` keeps finished_at NULL for ever and carries rolled_back_at
  // instead. Prisma treats that as settled and `migrate deploy` proceeds. Only a
  // row with NEITHER timestamp actually blocks a deploy (P3009).
  const blocking = await prisma.$queryRaw`
    SELECT migration_name FROM "_prisma_migrations"
    WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
  const resolved = await prisma.$queryRaw`
    SELECT migration_name, rolled_back_at FROM "_prisma_migrations"
    WHERE finished_at IS NULL AND rolled_back_at IS NOT NULL`;
  console.log(`\nBlocking rows (would stop migrate deploy): ${blocking.length}`);
  for (const r of blocking) console.log(`  ⚠️ ${r.migration_name}`);
  if (resolved.length > 0) {
    console.log(
      `\nKnown resolved-as-rolled-back rows (harmless, do NOT "fix" these): ${resolved.length}`,
    );
    for (const r of resolved) {
      console.log(`  ${r.migration_name} — rolled back ${r.rolled_back_at.toISOString()}`);
    }
  }
  const trigram = await prisma.$queryRaw`
    SELECT indexname FROM pg_indexes WHERE indexname LIKE '%_trgm_idx'`;
  console.log(`\nTrigram indexes present: ${trigram.length} (must be 6)`);
} finally {
  await prisma.$disconnect();
}
