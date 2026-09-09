/**
 * Read-only: what in PRODUCTION came from the seed, and what now depends on it?
 *
 * Card 0.10, first half. **Inventory before deletion. Numbers before verbs.**
 * This file cannot delete anything - there is no apply mode and no mutation in
 * it. Its companion, `seed-cleanup.mjs`, does the deleting and refuses to run
 * until you have read this.
 *
 * ⚠️ THE POINT IS THE REFERENCES, NOT THE COUNTS. Production has been used, so
 * a seeded canned response may have been sent to a real requester and a seeded
 * tag may be on a real ticket. Anything referenced is reported as KEEP and is
 * not a deletion candidate; deleting it would take real history with it.
 *
 * Run from the repo root:  node seed-inventory.mjs
 * Requires `az` logged in. The connection string is read from the App Service
 * settings and never written down here.
 */
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/** The prefix `prisma/seed.ts` puts on everything it creates. */
const SEED_PREFIX = '[Seed]';
/** Named in CLAUDE.md as awaiting deletion by the owner. */
const PROBE_TICKETS = ['PA_20260829_021', 'IT_20260829_022'];

/**
 * Where to point.
 *
 * WARNING: `SEED_TARGET_URL` exists so this can be REHEARSED AGAINST DEV before
 * it is ever aimed at production, which is how it was tested. When it is set,
 * that is the target and the banner says so; with no override the target is
 * production, read from the App Service settings and never written down here.
 */
function targetUrl() {
  const override = process.env.SEED_TARGET_URL;
  if (override) {
    return { url: override, label: 'SEED_TARGET_URL override (not production)' };
  }
  const out = execSync(
    'az webapp config appsettings list --name TicketTicket --resource-group csnhc-ai ' +
      '--query "[?name==\'DIRECT_URL\'].value | [0]" -o tsv',
    { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim();
  if (!out) throw new Error('Could not read DIRECT_URL from App Service.');
  return { url: out, label: 'PRODUCTION' };
}

const { url, label } = targetUrl();
console.log(`Server: ${url.replace(/.*@([^:/?]+).*/, '$1')}  [${label}]`);
console.log('Mode:   READ ONLY — this script deletes nothing\n');

const prisma = new PrismaClient({ datasources: { db: { url } } });
const verdicts = [];

function report(label, count, referenced, note) {
  const safe = referenced === 0;
  verdicts.push({ label, count, referenced, safe });
  const tag = count === 0 ? '—' : safe ? 'DELETABLE' : 'KEEP';
  console.log(
    `  ${tag.padEnd(10)} ${label.padEnd(34)} ${String(count).padStart(4)}` +
      (referenced > 0 ? `   (${referenced} referenced)` : '') +
      (note ? `\n             ${note}` : ''),
  );
}

try {
  console.log('Seeded canned responses');
  const cannedSeeded = await prisma.cannedResponse.findMany({
    where: { name: { startsWith: SEED_PREFIX } },
    select: { id: true, name: true },
  });
  // ⚠️ A macro that has been APPLIED leaves its text in a TicketMessage, not a
  // foreign key - so "referenced" here means a real message contains the
  // template's text. That is the collateral the card warns about.
  let cannedReferenced = 0;
  for (const canned of cannedSeeded) {
    const stripped = canned.name.replace(SEED_PREFIX, '').trim();
    if (stripped.length < 8) continue;
    const used = await prisma.ticketMessage.count({
      where: { body: { contains: stripped, mode: 'insensitive' } },
    });
    if (used > 0) cannedReferenced += 1;
  }
  report('CannedResponse [Seed]', cannedSeeded.length, cannedReferenced,
    cannedReferenced > 0
      ? 'Some template text appears in real messages — decide, do not bulk delete.'
      : undefined);

  console.log('\nSeeded automation rule');
  const seedRules = await prisma.automationRule.findMany({
    where: { name: { contains: SEED_PREFIX } },
    select: { id: true, name: true },
  });
  let ruleExecutions = 0;
  for (const rule of seedRules) {
    ruleExecutions += await prisma.automationExecution.count({
      where: { ruleId: rule.id },
    });
  }
  report('AutomationRule [Seed]', seedRules.length, ruleExecutions,
    ruleExecutions > 0
      ? 'It has fired against real tickets; its executions are real history.'
      : undefined);

  console.log('\nSeeded tags');
  const seedTags = await prisma.tag.findMany({
    where: { name: { startsWith: 'seed-' } },
    select: { id: true, name: true },
  });
  let taggedTickets = 0;
  for (const tag of seedTags) {
    taggedTickets += await prisma.ticketTag.count({ where: { tagId: tag.id } });
  }
  report('Tag seed-*', seedTags.length, taggedTickets,
    taggedTickets > 0 ? 'On real tickets — removing the tag edits real tickets.' : undefined);

  console.log('\nThe two probe tickets (CLAUDE.md)');
  const probes = await prisma.ticket.findMany({
    where: { displayId: { in: PROBE_TICKETS } },
    select: { id: true, displayId: true, subject: true, deletedAt: true },
  });
  for (const probe of probes) {
    const messages = await prisma.ticketMessage.count({
      where: { ticketId: probe.id },
    });
    console.log(
      `  ${probe.deletedAt ? 'already soft-deleted' : 'LIVE'.padEnd(20)} ` +
        `${probe.displayId}  ${probe.subject.slice(0, 40)}  (${messages} messages)`,
    );
  }
  if (probes.length === 0) {
    console.log('  none found — already gone');
  }
  verdicts.push({
    label: 'Probe tickets',
    count: probes.length,
    referenced: 0,
    safe: true,
  });

  console.log('\nFixture users (seed personas still present)');
  const fixtureUsers = await prisma.user.findMany({
    where: {
      email: {
        in: [
          'requester@company.com',
          'agent@company.com',
          'lead@company.com',
          'admin@company.com',
          'owner@company.com',
        ],
      },
    },
    select: { id: true, email: true, role: true },
  });
  let usersWithHistory = 0;
  for (const user of fixtureUsers) {
    const owned = await prisma.ticket.count({ where: { requesterId: user.id } });
    const wrote = await prisma.ticketMessage.count({ where: { authorId: user.id } });
    if (owned + wrote > 0) usersWithHistory += 1;
    console.log(
      `    ${user.email.padEnd(28)} ${user.role.padEnd(11)} ` +
        `${owned} tickets, ${wrote} messages`,
    );
  }
  report('Fixture users', fixtureUsers.length, usersWithHistory,
    usersWithHistory > 0
      ? 'These accounts own real rows. Deactivate rather than delete.'
      : undefined);

  console.log('\n──────────────────────────────────────────────────────────');
  const deletable = verdicts.filter((v) => v.count > 0 && v.safe);
  const keep = verdicts.filter((v) => v.count > 0 && !v.safe);
  console.log(`Safe to delete: ${deletable.length} group(s)` +
    (deletable.length ? ` — ${deletable.map((v) => v.label).join(', ')}` : ''));
  console.log(`Needs a decision: ${keep.length} group(s)` +
    (keep.length ? ` — ${keep.map((v) => v.label).join(', ')}` : ''));
  console.log(
    '\nNothing has been changed. When you have read the above:\n' +
      '  node seed-cleanup.mjs --dry-run     # shows the exact deletes\n' +
      '  node seed-cleanup.mjs --apply       # performs them, in one transaction',
  );
} finally {
  await prisma.$disconnect();
}
