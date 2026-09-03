/**
 * Read-only: does production have any account with role AGENT?
 *
 * Card 1.38 (a public reply saved as an internal note) only bites accounts whose
 * role is AGENT — `isPeerAgent` returns false for every other role. So this one
 * question decides whether 1.38 was a live fault on all unassigned tickets or a
 * latent one. The implementer could not run it (reading the production
 * connection string was blocked), so the owner runs this.
 *
 * Writes nothing. There is no apply mode and no mutation in this file.
 *
 * Run from `apps/api` so `@prisma/client` resolves:
 *   node agent-role-check.mjs
 */
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/** Production DIRECT_URL, read from App Service — same source as the other operator scripts. */
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
  const byRole = await prisma.user.groupBy({
    by: ['role'],
    _count: { _all: true },
    orderBy: { role: 'asc' },
  });
  console.log('Accounts by role');
  for (const row of byRole) {
    console.log(`  ${row.role.padEnd(11)} ${row._count._all}`);
  }

  const agents = await prisma.user.findMany({
    where: { role: 'AGENT' },
    select: { email: true, isActive: true, primaryTeamId: true },
    orderBy: { email: 'asc' },
  });

  console.log('');
  if (agents.length === 0) {
    console.log('No AGENT accounts.');
    console.log('=> Card 1.38 was LATENT in production, never live.');
    console.log('   It would have become live the day the first agent was onboarded.');
  } else {
    console.log(`${agents.length} AGENT account(s):`);
    for (const a of agents) {
      console.log(
        `  ${a.email.padEnd(34)} ${a.isActive ? 'active' : 'INACTIVE'}${a.primaryTeamId ? '' : '  (no primaryTeamId)'}`,
      );
    }
    const active = agents.filter((a) => a.isActive).length;
    console.log('');
    console.log(
      active > 0
        ? `=> Card 1.38 WAS LIVE for ${active} active agent(s), on every unassigned ticket.`
        : '=> All AGENT accounts are inactive, so 1.38 could not have been exercised.',
    );
    console.log('   The fix is already committed; this only tells you whether');
    console.log('   any reply was silently kept private before it deploys.');
  }

  const unassigned = await prisma.ticket.count({
    where: { assigneeId: null, deletedAt: null },
  });
  console.log(`\nUnassigned tickets (the affected set): ${unassigned}`);
} finally {
  await prisma.$disconnect();
}
