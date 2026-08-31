/**
 * One-off operator script: create the 13 PAF - Termination custom fields in
 * production and attach them to the `paf-termination` category.
 *
 * Safe to run more than once: existing fields are left in place (their sort
 * order is corrected), missing ones are created. Nothing is ever deleted.
 *
 * Run from apps/api:  node paf-fields.mjs
 * Add --dry-run to see what it would do without writing anything.
 */
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');
const CATEGORY_SLUG = 'paf-termination';

/** name, sortOrder — all Short Text, all optional, all global across teams. */
const FIELDS = [
  ['Employee Number', 10],
  ['Job Title', 20],
  ['Termination Date', 30],
  ['Last Day Worked', 40],
  ['Reason for Separation', 50],
  ['Eligible for Rehire', 60],
  ['Self Termination', 70],
  ['Eligible for PTO Payout', 80],
  ['Approver', 90],
  ['Approval Date', 100],
  ['Approver Comments', 110],
  ['Submitted By', 120],
  ['Files Link', 130],
];

function productionUrl() {
  const out = execSync(
    'az webapp config appsettings list --name TicketTicket --resource-group csnhc-ai ' +
      '--query "[?name==\'DIRECT_URL\'].value | [0]" -o tsv',
    { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim();
  if (!out) {
    throw new Error('Could not read DIRECT_URL from App Service TicketTicket.');
  }
  return out;
}

const url = productionUrl();
console.log(`Server: ${url.replace(/.*@([^:/?]+).*/, '$1')}`);
console.log(DRY_RUN ? 'Mode:   DRY RUN (no writes)\n' : 'Mode:   LIVE\n');

const prisma = new PrismaClient({ datasources: { db: { url } } });

const category = await prisma.category.findFirst({
  where: { slug: CATEGORY_SLUG },
  select: { id: true, name: true, slug: true, isActive: true },
});

if (!category) {
  const all = await prisma.category.findMany({
    where: { isActive: true },
    select: { slug: true },
    orderBy: { slug: 'asc' },
  });
  console.error(`\nNo category with slug "${CATEGORY_SLUG}".`);
  console.error(`Active slugs: ${all.map((c) => c.slug).join(', ')}`);
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`Category: ${category.name} (${category.slug})`);
if (!category.isActive) {
  console.log('  WARNING: this category is INACTIVE — intake will reject it.');
}

const existing = await prisma.customField.findMany({
  where: { categoryId: category.id },
  select: {
    id: true,
    name: true,
    fieldType: true,
    isRequired: true,
    teamId: true,
    sortOrder: true,
  },
});
const byName = new Map(existing.map((f) => [f.name.trim().toLowerCase(), f]));
console.log(`Already attached: ${existing.length}\n`);

let created = 0;
let reordered = 0;
let skipped = 0;

for (const [name, sortOrder] of FIELDS) {
  const found = byName.get(name.trim().toLowerCase());
  if (found) {
    const notes = [];
    if (found.fieldType !== 'TEXT') notes.push(`type=${found.fieldType}`);
    if (found.isRequired) notes.push('REQUIRED — will reject blank values');
    if (found.teamId) notes.push('team-scoped');
    if (found.sortOrder !== sortOrder) {
      if (!DRY_RUN) {
        await prisma.customField.update({
          where: { id: found.id },
          data: { sortOrder },
        });
      }
      reordered += 1;
      notes.push(`sortOrder ${found.sortOrder} -> ${sortOrder}`);
    }
    skipped += 1;
    console.log(`  = ${name}${notes.length ? `  [${notes.join('; ')}]` : ''}`);
    continue;
  }
  if (!DRY_RUN) {
    await prisma.customField.create({
      data: {
        name,
        fieldType: 'TEXT',
        isRequired: false,
        teamId: null,
        categoryId: category.id,
        sortOrder,
      },
    });
  }
  created += 1;
  console.log(`  + ${name}`);
}

console.log(
  `\n${DRY_RUN ? 'Would create' : 'Created'}: ${created}   ` +
    `already present: ${skipped}   sort order fixed: ${reordered}`,
);

const final = await prisma.customField.findMany({
  where: { categoryId: category.id },
  select: { name: true, fieldType: true, isRequired: true, sortOrder: true },
  orderBy: { sortOrder: 'asc' },
});
console.log(`\nField list for "${category.slug}" (${final.length}):`);
for (const f of final) {
  console.log(
    `  ${String(f.sortOrder).padStart(4)}  ${f.name.padEnd(26)} ${f.fieldType}` +
      `${f.isRequired ? '  REQUIRED' : ''}`,
  );
}
const stillRequired = final.filter((f) => f.isRequired);
if (stillRequired.length > 0) {
  console.log(
    `\nWARNING: ${stillRequired.length} field(s) are Required. A blank value ` +
      'from Power Automate will reject the whole ticket. Turn Required off in ' +
      'Admin -> Custom Fields.',
  );
}

await prisma.$disconnect();
