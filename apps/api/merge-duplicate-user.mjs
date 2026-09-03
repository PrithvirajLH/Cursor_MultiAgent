/**
 * Merge two accounts that are the same human into one (card 1.30).
 *
 * Production has one person as `phulgur@csnhc.com` (AGENT) and
 * `prithviraj_hulgur@csnhc.com` (EMPLOYEE) because all three provisioning paths
 * match addresses as exact strings. Which of the two a ticket lands on decides
 * who can see it: card 1.36's rules all key off `requesterId`.
 *
 * NOTHING HERE GUESSES. Both addresses are arguments, and the script refuses to
 * run unless each resolves to exactly one row. It cannot be pointed at "probable
 * duplicates" in bulk, deliberately: `jsmith@` is a plausible short form of both
 * `john_smith@` and `jane_smith@`, so merging on a derived stem would put one
 * person's HR and payroll tickets in front of somebody else. Detection is
 * automatic (DuplicateAccountService); the merge is a human decision, which is
 * this script being run on purpose with two addresses typed out.
 *
 * Run from apps/api. Writes nothing by default:
 *   node merge-duplicate-user.mjs --keeper=phulgur@csnhc.com --loser=prithviraj_hulgur@csnhc.com
 *   node merge-duplicate-user.mjs --keeper=... --loser=... --apply
 *
 * Add --local to work against the local .env database instead of production.
 */
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LOCAL = args.includes('--local');
const argOf = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim().toLowerCase() : null;
};
const KEEPER = argOf('keeper');
const LOSER = argOf('loser');

const blank = () => console.log('');

/**
 * Every place a user id is stored, taken from the schema rather than memory.
 *
 * `dedupe` marks the two columns covered by a composite unique that includes
 * the user: TeamMember(teamId, userId) and TicketFollower(ticketId, userId). A
 * plain `UPDATE ... SET userId = keeper` violates those the moment the two
 * accounts share a team or follow the same ticket, which is the single most
 * likely way to break this repair. Those rows are deduped first.
 *
 * `Tag.createdById`, `TicketTag.createdById` and `IdempotencyRequest.actorId`
 * are NOT Prisma relations - they are plain String columns holding a user id,
 * so enumerating relations alone misses them and no cascade protects them.
 * The first two carry real attribution and are moved. The third is skipped on
 * purpose: idempotency rows are short-lived (they carry `expiresAt`), moving
 * them achieves nothing, and its own unique (key, method, route, actorId)
 * would be at risk.
 */
const TARGETS = [
  { model: 'ticket', column: 'requesterId' },
  { model: 'ticket', column: 'assigneeId' },
  { model: 'ticketMessage', column: 'authorId' },
  { model: 'ticketEvent', column: 'createdById' },
  { model: 'ticketFollower', column: 'userId', dedupe: 'ticketId' },
  { model: 'teamMember', column: 'userId', dedupe: 'teamId' },
  { model: 'team', column: 'lastAssignedUserId' },
  { model: 'attachment', column: 'uploadedById' },
  { model: 'notification', column: 'userId' },
  { model: 'notification', column: 'actorId' },
  { model: 'notificationOutbox', column: 'toUserId' },
  { model: 'savedView', column: 'userId' },
  { model: 'cannedResponse', column: 'userId' },
  { model: 'automationRule', column: 'createdById' },
  { model: 'routingRule', column: 'assigneeId' },
  { model: 'slaPolicyConfig', column: 'createdById' },
  { model: 'adminAuditEvent', column: 'createdById' },
  { model: 'kbArticle', column: 'authorId' },
  { model: 'tag', column: 'createdById' },
  { model: 'ticketTag', column: 'createdById' },
];

const SKIPPED = [
  {
    what: 'IdempotencyRequest.actorId',
    why: 'short-lived rows with expiresAt; moving them gains nothing and risks its (key, method, route, actorId) unique',
  },
  {
    what: 'User.primaryTeamId',
    why: "a permission setting on the loser, not a reference TO it - carrying it over would silently change the keeper's scope, which is the owner's decision",
  },
];

function productionUrl() {
  const out = execSync(
    'az webapp config appsettings list --name TicketTicket --resource-group csnhc-ai ' +
      '--query "[?name==\'DIRECT_URL\'].value | [0]" -o tsv',
    { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim();
  if (!out) throw new Error('Could not read DIRECT_URL from the App Service');
  return out;
}

function usage(message) {
  console.log(`ERROR: ${message}`);
  blank();
  console.log('Usage:');
  console.log(
    '  node merge-duplicate-user.mjs --keeper=<address> --loser=<address> [--apply] [--local]',
  );
  blank();
  console.log('Both addresses are required and must each match exactly one user.');
  console.log('Without --apply nothing is written.');
  process.exit(1);
}

async function describe(prisma, user) {
  const [requested, assigned, messages, memberships] = await Promise.all([
    prisma.ticket.count({ where: { requesterId: user.id } }),
    prisma.ticket.count({ where: { assigneeId: user.id } }),
    prisma.ticketMessage.count({ where: { authorId: user.id } }),
    prisma.teamMember.findMany({
      where: { userId: user.id },
      select: { role: true, team: { select: { name: true, slug: true } } },
    }),
  ]);
  return { requested, assigned, messages, memberships };
}

async function main() {
  if (!KEEPER || !LOSER) usage('both --keeper and --loser are required');
  if (KEEPER === LOSER) usage('--keeper and --loser are the same address');

  const url = LOCAL ? process.env.DIRECT_URL ?? process.env.DATABASE_URL : productionUrl();
  if (!url) usage('no database URL available');
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    console.log(
      `Target: ${LOCAL ? 'LOCAL (.env)' : 'PRODUCTION (TicketTicket DIRECT_URL)'}`,
    );
    console.log(`Mode  : ${APPLY ? 'APPLY - this will write' : 'DRY RUN - nothing will be written'}`);
    blank();

    // Refuse on anything but exactly one row each. An address that matches
    // nothing, or somehow more than one, is a reason to stop and look.
    const [keeperRows, loserRows] = await Promise.all([
      prisma.user.findMany({ where: { email: KEEPER } }),
      prisma.user.findMany({ where: { email: LOSER } }),
    ]);
    if (keeperRows.length !== 1) {
      usage(`--keeper ${KEEPER} matched ${keeperRows.length} users, need exactly 1`);
    }
    if (loserRows.length !== 1) {
      usage(`--loser ${LOSER} matched ${loserRows.length} users, need exactly 1`);
    }
    const keeper = keeperRows[0];
    const loser = loserRows[0];

    const [keeperInfo, loserInfo] = await Promise.all([
      describe(prisma, keeper),
      describe(prisma, loser),
    ]);

    // The owner has to choose which account survives, so both are printed with
    // the things that differ between them.
    for (const [label, user, info] of [
      ['KEEPER', keeper, keeperInfo],
      ['LOSER ', loser, loserInfo],
    ]) {
      console.log(`${label} ${user.email}`);
      console.log(`   id            ${user.id}`);
      console.log(`   displayName   ${user.displayName}`);
      console.log(`   role          ${user.role}`);
      console.log(`   isActive      ${user.isActive}`);
      console.log(`   primaryTeamId ${user.primaryTeamId ?? '(none)'}`);
      console.log(
        `   teams         ${
          info.memberships.length === 0
            ? '(none)'
            : info.memberships
                .map((m) => `${m.team?.slug ?? m.team?.name} as ${m.role}`)
                .join(', ')
        }`,
      );
      console.log(
        `   tickets       requested ${info.requested}, assigned ${info.assigned}, messages ${info.messages}`,
      );
      blank();
    }

    if (keeper.role !== loser.role) {
      console.log(
        `NOTE: the two accounts hold different roles (${keeper.role} vs ${loser.role}).`,
      );
      console.log(
        '      The keeper keeps its own role. Nothing here changes permissions.',
      );
      blank();
    }

    // What would move, per column, before anything is written.
    console.log('Rows that would move to the keeper:');
    let total = 0;
    const plan = [];
    for (const target of TARGETS) {
      const delegate = prisma[target.model];
      const all = await delegate.count({ where: { [target.column]: loser.id } });
      let duplicates = 0;
      if (target.dedupe && all > 0) {
        // Rows where the keeper already has an equivalent: these are deleted
        // rather than moved, because the composite unique forbids both.
        const loserRows2 = await delegate.findMany({
          where: { [target.column]: loser.id },
          select: { id: true, [target.dedupe]: true },
        });
        const keeperKeys = new Set(
          (
            await delegate.findMany({
              where: { [target.column]: keeper.id },
              select: { [target.dedupe]: true },
            })
          ).map((row) => row[target.dedupe]),
        );
        duplicates = loserRows2.filter((row) =>
          keeperKeys.has(row[target.dedupe]),
        ).length;
      }
      const moving = all - duplicates;
      total += all;
      plan.push({ ...target, all, duplicates, moving });
      if (all > 0) {
        console.log(
          `   ${target.model}.${target.column}`.padEnd(44) +
            `${all} row(s)` +
            (duplicates > 0
              ? `  -> ${moving} moved, ${duplicates} deleted as duplicates of the keeper's`
              : ''),
        );
      }
    }
    if (total === 0) console.log('   (nothing references the loser)');
    blank();
    console.log('Deliberately not touched:');
    for (const skip of SKIPPED) console.log(`   ${skip.what} - ${skip.why}`);
    blank();
    console.log(
      `The loser row is deactivated (isActive: false), never deleted, so audit rows that name it keep resolving.`,
    );
    blank();

    if (!APPLY) {
      console.log('DRY RUN complete. Re-run with --apply to write.');
      return;
    }

    // One transaction. A half-merged human is worse than two whole ones.
    await prisma.$transaction(async (tx) => {
      for (const target of plan) {
        if (target.all === 0) continue;
        const delegate = tx[target.model];
        if (target.dedupe) {
          const keeperKeys = new Set(
            (
              await delegate.findMany({
                where: { [target.column]: keeper.id },
                select: { [target.dedupe]: true },
              })
            ).map((row) => row[target.dedupe]),
          );
          const loserRows2 = await delegate.findMany({
            where: { [target.column]: loser.id },
            select: { id: true, [target.dedupe]: true },
          });
          const redundant = loserRows2
            .filter((row) => keeperKeys.has(row[target.dedupe]))
            .map((row) => row.id);
          if (redundant.length > 0) {
            await delegate.deleteMany({ where: { id: { in: redundant } } });
          }
        }
        await delegate.updateMany({
          where: { [target.column]: loser.id },
          data: { [target.column]: keeper.id },
        });
      }

      await tx.user.update({
        where: { id: loser.id },
        data: { isActive: false, deactivatedAt: new Date() },
      });
    });

    console.log('APPLIED. Re-running the counts to confirm nothing is left behind:');
    let leftover = 0;
    for (const target of TARGETS) {
      const remaining = await prisma[target.model].count({
        where: { [target.column]: loser.id },
      });
      if (remaining > 0) {
        leftover += remaining;
        console.log(`   STILL POINTING AT THE LOSER: ${target.model}.${target.column} = ${remaining}`);
      }
    }
    console.log(
      leftover === 0
        ? '   clean - every reference moved'
        : '   SOMETHING REMAINS, investigate before deleting anything',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
