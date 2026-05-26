// One-time backfill: extract tags from existing AI_CLASSIFICATION TicketEvent
// payloads and populate the Tag + TicketTag tables (source = AI).
//
// Usage (from apps/api):
//   node scripts/backfill-tags.cjs                # local: uses .env DATABASE_URL
//   DATABASE_URL=<azure-url> node scripts/backfill-tags.cjs   # against Azure
//
// Idempotent: re-running won't double-insert because of unique constraints on
// Tag.name and TicketTag(ticketId, tagId).

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function normalize(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!value) return null;
  if (value.length > 50) return null;
  // Same regex as TagsService.normalize
  if (!/^[a-z0-9][a-z0-9 _.\-/]*$/.test(value)) return null;
  return value;
}

async function main() {
  console.log('Scanning AI_CLASSIFICATION events for tag arrays…');
  const events = await prisma.ticketEvent.findMany({
    where: { type: 'AI_CLASSIFICATION' },
    select: { ticketId: true, payload: true, createdById: true },
  });
  console.log(`Found ${events.length} AI_CLASSIFICATION events.`);

  let tagsCreated = 0;
  let ticketTagsCreated = 0;
  let skippedNoTags = 0;
  let skippedInvalid = 0;

  for (const event of events) {
    const payload = event.payload;
    const rawTags = payload && typeof payload === 'object' ? payload.tags : null;
    if (!Array.isArray(rawTags) || rawTags.length === 0) {
      skippedNoTags += 1;
      continue;
    }

    const seen = new Set();
    for (const raw of rawTags) {
      const name = normalize(raw);
      if (!name) {
        skippedInvalid += 1;
        continue;
      }
      if (seen.has(name)) continue;
      seen.add(name);

      try {
        const tagBefore = await prisma.tag.findUnique({ where: { name } });
        const tag = await prisma.tag.upsert({
          where: { name },
          update: {},
          create: { name, createdById: event.createdById ?? undefined },
        });
        if (!tagBefore) tagsCreated += 1;

        const ttBefore = await prisma.ticketTag.findUnique({
          where: { ticketId_tagId: { ticketId: event.ticketId, tagId: tag.id } },
        });
        if (!ttBefore) {
          await prisma.ticketTag.create({
            data: {
              ticketId: event.ticketId,
              tagId: tag.id,
              source: 'AI',
              createdById: event.createdById ?? undefined,
            },
          });
          ticketTagsCreated += 1;
        }
      } catch (error) {
        console.warn(
          `  ! skipped ticket=${event.ticketId} tag="${name}": ${error.message}`,
        );
      }
    }
  }

  console.log('Done.');
  console.log(`  events scanned:     ${events.length}`);
  console.log(`  events without tags: ${skippedNoTags}`);
  console.log(`  invalid tag strings: ${skippedInvalid}`);
  console.log(`  new Tag rows:       ${tagsCreated}`);
  console.log(`  new TicketTag rows: ${ticketTagsCreated}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
