/**
 * Read-only: which replies did card 1.38 silently keep private?
 *
 * Production has exactly one AGENT (`phulgur@csnhc.com`, active), so 1.38 was
 * live: on any ticket that AGENT was not the assignee of, a message they posted
 * as PUBLIC was stored INTERNAL, no email was sent, and the screen said
 * "Reply sent". This finds those messages so the owner knows whether a real
 * requester is still waiting for an answer.
 *
 * It also answers whether 1.38 explains the 2026-09-02 incident on
 * PA_20260902_046, by reporting that ticket's assignee.
 *
 * Writes nothing. There is no apply mode and no mutation in this file.
 *
 * Run from `apps/api`:
 *   node silent-internal-check.mjs
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
  const agents = await prisma.user.findMany({
    where: { role: 'AGENT' },
    select: { id: true, email: true },
  });
  if (agents.length === 0) {
    console.log('No AGENT accounts — nothing to check.');
    process.exit(0);
  }
  const agentIds = agents.map((a) => a.id);
  console.log(`Checking ${agents.map((a) => a.email).join(', ')}\n`);

  // Every INTERNAL message an agent wrote on a ticket they do not own. On an
  // unassigned ticket the override was unconditional, so a PUBLIC intent here
  // was silently downgraded and no email left the building.
  const suspect = await prisma.ticketMessage.findMany({
    where: { type: 'INTERNAL', authorId: { in: agentIds } },
    orderBy: { createdAt: 'asc' },
    select: {
      createdAt: true,
      body: true,
      ticket: {
        select: {
          number: true,
          subject: true,
          assigneeId: true,
          requester: { select: { email: true } },
        },
      },
    },
  });

  const affected = suspect.filter(
    (m) => m.ticket && !agentIds.includes(m.ticket.assigneeId ?? ''),
  );

  console.log(
    `INTERNAL messages by an agent on a ticket they were not assigned: ${affected.length}`,
  );
  if (affected.length > 0) {
    console.log('(a PUBLIC intent on any of these was stored private, emailed to nobody)\n');
    const byTicket = new Map();
    for (const m of affected) {
      const key = m.ticket.number;
      if (!byTicket.has(key)) byTicket.set(key, { ticket: m.ticket, msgs: [] });
      byTicket.get(key).msgs.push(m);
    }
    for (const { ticket, msgs } of byTicket.values()) {
      console.log(
        `  #${ticket.number}  ${ticket.assigneeId ? 'assigned to someone else' : 'UNASSIGNED'}  ${msgs.length} note(s)  requester ${ticket.requester?.email ?? '?'}`,
      );
      for (const m of msgs) {
        const text = m.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        console.log(
          `      ${m.createdAt.toISOString().slice(0, 16).replace('T', ' ')}  ${text.slice(0, 66)}`,
        );
      }
    }
    console.log(
      '\nRead each one. If it reads like an answer meant for the requester,',
    );
    console.log('that person never received it and is still waiting.');
  }

  // Did 1.38 cause the 2026-09-02 incident? It did if that ticket was not
  // assigned to the agent who posted.
  const incident = await prisma.ticket.findFirst({
    where: { number: 46 },
    select: {
      number: true,
      subject: true,
      assigneeId: true,
      assignee: { select: { email: true } },
    },
  });
  console.log('\n--- the 2026-09-02 incident ---');
  if (!incident) {
    console.log('Ticket number 46 not found; check the reference by hand.');
  } else {
    console.log(`#${incident.number} ${incident.subject.slice(0, 50)}`);
    console.log(
      `Assignee: ${incident.assignee?.email ?? 'UNASSIGNED'} ${
        incident.assigneeId && agentIds.includes(incident.assigneeId)
          ? '=> assigned to the agent, so 1.38 did NOT apply; card 1.37 explains it'
          : '=> 1.38 applied: those messages were forced INTERNAL whatever the toggle said'
      }`,
    );
    console.log(
      'Caveat: this is the assignee NOW. If it was assigned after the messages',
    );
    console.log('were posted, check the ticket timeline for when.');
  }
} finally {
  await prisma.$disconnect();
}
