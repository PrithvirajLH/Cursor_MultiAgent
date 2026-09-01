/**
 * Make one person a LEAD of the Payroll department in production.
 *
 * Answers a question first, because getting it wrong creates a second account for
 * the same human: does logging in match on the UPN (`First_Last@csnhc.com`) or the
 * short mail address (`flast@csnhc.com`)?
 *
 * The auth guard takes the first of `preferred_username`, `upn`, `email` from the
 * token and looks the user up by that address. It cannot be asked directly, so
 * this infers it from data already present: an OWNER has certainly logged in, so
 * whichever shape the owner rows carry is the shape logins produce. The target
 * address is then chosen from that finding - never from a hardcoded preference.
 *
 * A LEAD's permissions are scoped by team (`operationalTeamIds` reads TeamMember
 * rows, falling back to primaryTeamId), so this sets the global role, the
 * primaryTeamId AND a TeamMember row. Setting only the role makes someone lead of
 * nothing.
 *
 * Run from apps/api. Writes nothing by default:
 *   node make-payroll-lead.mjs                 # report only
 *   node make-payroll-lead.mjs --apply         # actually write
 */
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');

/** The forms the owner supplied for the same person. */
const CANDIDATES = ['Vi_Le@csnhc.com', 'vle@csnhc.com'];
const DISPLAY_NAME = 'Vi Le';
const TEAM_SLUG = 'payroll';

const blank = () => console.log('');

function productionUrl() {
  const out = execSync(
    'az webapp config appsettings list --name TicketTicket --resource-group csnhc-ai ' +
      '--query "[?name==\'DIRECT_URL\'].value | [0]" -o tsv',
    { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim();
  if (!out) throw new Error('Could not read DIRECT_URL from App Service.');
  return out;
}

/** `First_Last@x` / `first.last@x` look like a UPN; `flast@x` looks like an alias. */
const shapeOf = (email) =>
  /[._]/.test(email.split('@')[0] ?? '') ? 'UPN-ish' : 'short';

/** "prithviraj_hulgur" -> "phulgur", the short form this tenant uses. */
const stemOf = (email) => {
  const local = (email.split('@')[0] ?? '').toLowerCase();
  if (!/[._]/.test(local)) return local;
  const parts = local.split(/[._]/).filter(Boolean);
  return parts.length > 1 ? parts[0][0] + parts[parts.length - 1] : local;
};

const url = productionUrl();
console.log(`Server: ${url.replace(/.*@([^:/?]+).*/, '$1')}`);
console.log(APPLY ? 'Mode:   APPLY (will write)' : 'Mode:   REPORT ONLY');
blank();

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  // ------------------------------------------------------------- diagnosis
  const owners = await prisma.user.findMany({
    where: { role: 'OWNER' },
    select: { email: true },
  });
  console.log('--- which address shape does a LOGIN produce? ---');
  for (const o of owners) {
    console.log(`  owner ${o.email}  -> ${shapeOf(o.email)}`);
  }
  const ownerShapes = new Set(owners.map((o) => shapeOf(o.email)));
  const loginShape = ownerShapes.size === 1 ? [...ownerShapes][0] : null;
  console.log(
    loginShape
      ? `  => logins almost certainly produce the ${loginShape} form`
      : '  => cannot tell (no owners, or they disagree)',
  );

  const all = await prisma.user.findMany({
    select: { email: true, role: true },
    orderBy: { createdAt: 'asc' },
  });

  // ------------------------------------------- one human, two accounts?
  const groups = new Map();
  for (const u of all) {
    const key = stemOf(u.email);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(u.email);
  }
  const dupes = [...groups.values()].filter((list) => list.length > 1);
  blank();
  console.log('--- one person with two accounts? ---');
  if (dupes.length === 0) {
    console.log('  none found');
  } else {
    for (const list of dupes) {
      for (const email of list) {
        const u = await prisma.user.findUnique({
          where: { email },
          select: {
            role: true,
            _count: {
              select: {
                requestedTickets: true,
                assignedTickets: true,
                teamMemberships: true,
              },
            },
          },
        });
        console.log(
          `  ${email.padEnd(32)} ${String(u.role).padEnd(12)} ` +
            `requested ${u._count.requestedTickets}, ` +
            `assigned ${u._count.assignedTickets}, ` +
            `teams ${u._count.teamMemberships}`,
        );
      }
      console.log('    ^ same person, two rows. The counts say which is real.');
    }
  }

  // ------------------------------------------------------------ the target
  const found = await prisma.user.findMany({
    where: { email: { in: CANDIDATES.map((e) => e.toLowerCase()) } },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      primaryTeamId: true,
    },
  });

  blank();
  console.log(`--- ${DISPLAY_NAME} ---`);
  for (const c of CANDIDATES) {
    const hit = found.find((f) => f.email === c.toLowerCase());
    console.log(
      `  ${c.padEnd(24)} ${hit ? `EXISTS (role ${hit.role})` : 'not present'}`,
    );
  }

  if (found.length > 1) {
    blank();
    console.log(
      'STOP: both addresses already exist as separate accounts. Merging two ' +
        'user rows is not something this script should guess at - report back.',
    );
    return 1;
  }

  const team = await prisma.team.findFirst({
    where: { slug: TEAM_SLUG, isActive: true },
    select: { id: true, name: true },
  });
  if (!team) {
    const active = await prisma.team.findMany({
      where: { isActive: true },
      select: { slug: true },
      orderBy: { slug: 'asc' },
    });
    blank();
    console.log(
      `STOP: no active team with slug "${TEAM_SLUG}". Active: ` +
        active.map((t) => t.slug).join(', '),
    );
    return 1;
  }
  blank();
  console.log(`Team: ${team.name} (${TEAM_SLUG})`);

  // Prefer the row that already exists. Otherwise create the shape LOGINS
  // produce. An account in the wrong shape is worse than none: the person signs
  // in, does not match it, and gets a second row as a plain employee.
  const existing = found[0] ?? null;
  let targetEmail = existing?.email ?? null;
  if (!targetEmail) {
    if (!loginShape) {
      blank();
      console.log(
        'STOP: cannot tell which address shape a login produces, so creating an ' +
          'account would be a guess. Have them sign in once, then re-run this - ' +
          'it will find the row and only need to promote it.',
      );
      return 1;
    }
    const match = CANDIDATES.find((c) => shapeOf(c) === loginShape);
    if (!match) {
      blank();
      console.log(
        `STOP: logins produce the ${loginShape} form, but neither supplied ` +
          `address is that shape (${CANDIDATES.join(', ')}). Get the address ` +
          'they actually sign in with.',
      );
      return 1;
    }
    console.log(`Logins produce the ${loginShape} form -> using ${match}`);
    targetEmail = match.toLowerCase();
  }

  const plan = [];
  if (!existing) {
    plan.push(`create user ${targetEmail} as LEAD`);
  } else {
    if (existing.role !== 'LEAD') plan.push(`role ${existing.role} -> LEAD`);
    if (existing.primaryTeamId !== team.id) {
      plan.push(`primaryTeamId -> ${TEAM_SLUG}`);
    }
  }
  plan.push(`ensure TeamMember row (${TEAM_SLUG}, LEAD)`);

  blank();
  console.log('Plan:');
  for (const step of plan) console.log(`  - ${step}`);

  if (!APPLY) {
    blank();
    console.log('Nothing written. Re-run with --apply to make these changes.');
    return 0;
  }

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { role: 'LEAD', primaryTeamId: team.id },
        select: { id: true },
      })
    : await prisma.user.create({
        data: {
          email: targetEmail,
          displayName: DISPLAY_NAME,
          role: 'LEAD',
          primaryTeamId: team.id,
        },
        select: { id: true },
      });

  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: team.id, userId: user.id } },
    update: { role: 'LEAD' },
    create: { teamId: team.id, userId: user.id, role: 'LEAD' },
  });

  const check = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      email: true,
      displayName: true,
      role: true,
      primaryTeamId: true,
      teamMemberships: {
        select: { role: true, team: { select: { slug: true } } },
      },
    },
  });
  blank();
  console.log('Done. Now in production:');
  console.log(`  ${check.email}  (${check.displayName})`);
  console.log(`  global role    ${check.role}`);
  console.log(
    `  primary team   ${check.primaryTeamId === team.id ? TEAM_SLUG : check.primaryTeamId}`,
  );
  console.log(
    `  memberships    ${check.teamMemberships
      .map((m) => `${m.team.slug}:${m.role}`)
      .join(', ')}`,
  );
  blank();
  console.log(
    `Watch for this: if ${DISPLAY_NAME} signs in with any address other than ` +
      `${check.email}, a SECOND account is created as a plain employee and this ` +
      'role will look like it did not stick.',
  );
  return 0;
}

const code = await main();
await prisma.$disconnect();
process.exit(code);
