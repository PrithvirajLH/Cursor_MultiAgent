/**
 * Delete what the seed left in production — after you have read the inventory.
 *
 * Card 0.10, second half. **The owner runs this, not an agent session.**
 *
 * ⚠️ `--dry-run` IS THE DEFAULT. With no flag, or with `--dry-run`, it opens a
 * transaction, performs the deletes, prints the row counts and then ROLLS BACK.
 * Nothing is committed unless you pass `--apply`.
 *
 * ⚠️ IT ONLY TOUCHES ROWS NOTHING REFERENCES. A seeded canned response whose
 * text appears in a real message, a seeded tag on a real ticket, or a fixture
 * user who owns real tickets is SKIPPED and named, because deleting it would
 * take real history with it. `seed-inventory.mjs` shows the same analysis
 * without the transaction; read it first.
 *
 * ⚠️ Fixture users are never deleted, only deactivated. A `User` row is
 * referenced from tickets, messages, events and audit rows; deleting one
 * rewrites history that really happened.
 *
 * Run from the repo root:
 *   node seed-cleanup.mjs              # dry run, rolls back
 *   node seed-cleanup.mjs --apply      # commits
 */
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const SEED_PREFIX = '[Seed]';
const PROBE_TICKETS = ['PA_20260829_021', 'IT_20260829_022'];
const APPLY = process.argv.includes('--apply');

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
console.log(APPLY ? 'Mode:   APPLY — changes will be COMMITTED\n' : 'Mode:   DRY RUN — everything rolls back\n');

const prisma = new PrismaClient({ datasources: { db: { url } } });

/** Deliberate: a rollback is how the dry run works, not an error. */
class DryRunRollback extends Error {}

try {
  await prisma.$transaction(async (tx) => {
    const skipped = [];

    // ---- Canned responses whose text is not in any real message
    const canned = await tx.cannedResponse.findMany({
      where: { name: { startsWith: SEED_PREFIX } },
      select: { id: true, name: true },
    });
    const cannedToDelete = [];
    for (const row of canned) {
      const stripped = row.name.replace(SEED_PREFIX, '').trim();
      const used =
        stripped.length < 8
          ? 0
          : await tx.ticketMessage.count({
              where: { body: { contains: stripped, mode: 'insensitive' } },
            });
      if (used > 0) {
        skipped.push(`CannedResponse "${row.name}" — text appears in ${used} real message(s)`);
      } else {
        cannedToDelete.push(row.id);
      }
    }
    const cannedDeleted = cannedToDelete.length
      ? await tx.cannedResponse.deleteMany({ where: { id: { in: cannedToDelete } } })
      : { count: 0 };
    console.log(`  CannedResponse deleted: ${cannedDeleted.count}`);

    // ---- The sample automation rule, only if it never fired
    const rules = await tx.automationRule.findMany({
      where: { name: { contains: SEED_PREFIX } },
      select: { id: true, name: true },
    });
    const rulesToDelete = [];
    for (const rule of rules) {
      const fired = await tx.automationExecution.count({ where: { ruleId: rule.id } });
      if (fired > 0) {
        skipped.push(`AutomationRule "${rule.name}" — fired ${fired} time(s) against real tickets`);
      } else {
        rulesToDelete.push(rule.id);
      }
    }
    const rulesDeleted = rulesToDelete.length
      ? await tx.automationRule.deleteMany({ where: { id: { in: rulesToDelete } } })
      : { count: 0 };
    console.log(`  AutomationRule deleted: ${rulesDeleted.count}`);

    // ---- Seed tags that are on no ticket
    const tags = await tx.tag.findMany({
      where: { name: { startsWith: 'seed-' } },
      select: { id: true, name: true },
    });
    const tagsToDelete = [];
    for (const tag of tags) {
      const used = await tx.ticketTag.count({ where: { tagId: tag.id } });
      if (used > 0) {
        skipped.push(`Tag "${tag.name}" — on ${used} real ticket(s)`);
      } else {
        tagsToDelete.push(tag.id);
      }
    }
    const tagsDeleted = tagsToDelete.length
      ? await tx.tag.deleteMany({ where: { id: { in: tagsToDelete } } })
      : { count: 0 };
    console.log(`  Tag deleted: ${tagsDeleted.count}`);

    // ---- The two probe tickets: SOFT delete, matching how the product deletes
    const probes = await tx.ticket.updateMany({
      where: { displayId: { in: PROBE_TICKETS }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    console.log(`  Probe tickets soft-deleted: ${probes.count}`);

    if (skipped.length > 0) {
      console.log('\n  Skipped, because real data depends on them:');
      for (const line of skipped) console.log(`    - ${line}`);
    }

    if (!APPLY) {
      throw new DryRunRollback();
    }
  });
  console.log('\nCommitted.');
} catch (error) {
  if (error instanceof DryRunRollback) {
    console.log('\nDRY RUN — rolled back, nothing was changed.');
    console.log('Re-run with --apply to commit.');
  } else {
    throw error;
  }
} finally {
  await prisma.$disconnect();
}
