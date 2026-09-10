import { INestApplication } from '@nestjs/common';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';
import { InboundMailboxService } from '../../src/inbound-mailbox/inbound-mailbox.service';
import {
  GraphDeltaPage,
  GraphMailClient,
  GraphMailMessage,
} from '../../src/inbound-mailbox/graph-mail.client';

const MAILBOX = 'helpdesk@company.com';

/** Scripted Graph. The ONLY thing faked in this file. */
class ScriptedGraph extends GraphMailClient {
  pages: GraphDeltaPage[] = [];
  moved: string[] = [];

  fetchDelta(): Promise<GraphDeltaPage> {
    return Promise.resolve(
      this.pages.shift() ?? { messages: [], deltaLink: 'delta-end' },
    );
  }

  moveToProcessed(_mailbox: string, messageId: string): Promise<void> {
    this.moved.push(messageId);
    return Promise.resolve();
  }

  isConfigured(): boolean {
    return true;
  }

  describeConfiguration(): string {
    return 'scripted';
  }
}

function message(partial: Partial<GraphMailMessage> = {}): GraphMailMessage {
  return {
    id: `graph-${Math.random().toString(36).slice(2)}`,
    internetMessageId: `<${Math.random().toString(36).slice(2)}@sender.test>`,
    subject: 'A question about my payslip',
    bodyText: 'The number looks wrong.',
    from: { address: 'outsider@company.com', name: 'Out Sider' },
    toRecipients: [{ address: `helpdesk+payroll@company.com` }],
    ccRecipients: [],
    deliveredTo: [],
    attachments: [],
    ...partial,
  };
}

/**
 * Card 1.24 end to end — the worker driving the REAL ingestion path.
 *
 * ⚠️ THIS IS THE FILE THAT PROVES THE CARD'S CENTRAL CLAIM: that the worker
 * reuses `InboundEmailService` rather than growing a second ingestion path.
 * The unit spec proves the worker's own logic against a fake service; this
 * one wires the real service, the real database and the real idempotency, and
 * fakes only Graph itself.
 */
describe('Inbound mailbox worker, end to end (card 1.24)', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let worker: InboundMailboxService;
  let graph: ScriptedGraph;
  let previousEnv: Record<string, string | undefined>;

  beforeAll(async () => {
    resetTestDb();
    previousEnv = {
      INBOUND_MAILBOX_ENABLED: process.env.INBOUND_MAILBOX_ENABLED,
      INBOUND_MAILBOX_ADDRESS: process.env.INBOUND_MAILBOX_ADDRESS,
      INBOUND_EMAIL_WEBHOOK_SECRET: process.env.INBOUND_EMAIL_WEBHOOK_SECRET,
    };
    process.env.INBOUND_MAILBOX_ENABLED = 'true';
    process.env.INBOUND_MAILBOX_ADDRESS = MAILBOX;
    graph = new ScriptedGraph();
    app = await createTestApp({
      overrideProviders: [{ provide: GraphMailClient, useValue: graph }],
    });
    worker = app.get(InboundMailboxService);
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await app.close();
    await disconnectPrisma();
  });

  beforeEach(async () => {
    graph.pages = [];
    graph.moved = [];
    await prisma.inboundMailboxCursor.deleteMany({});
  });

  it('⚠️ a department address opens a ticket ON THAT TEAM', async () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. `helpdesk+hr@` must open
    // the ticket on HR specifically - "some team" would be satisfied by
    // routing everything to whichever sorts first.
    const mail = message({
      subject: `HR department routing ${Date.now()}`,
      toRecipients: [{ address: 'helpdesk+hr@company.com' }],
    });
    graph.pages = [{ messages: [mail], deltaLink: 'delta-1' }];
    const summary = await worker.runOnce();
    expect(summary.ingested).toBe(1);
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { subject: mail.subject },
      select: { id: true, assignedTeamId: true, channel: true },
    });
    expect(ticket.assignedTeamId).toBe(fixtureTeamIds.hr);
    expect(ticket.channel).toBe('EMAIL');
    expect(graph.moved).toEqual([mail.id]);
  });

  it('⚠️ a friendly alias resolves to the real slug', async () => {
    // Nobody types `helpdesk+it-service-desk@`. `+it` must reach the same team.
    const mail = message({
      subject: `Alias routing ${Date.now()}`,
      toRecipients: [{ address: 'helpdesk+it@company.com' }],
    });
    graph.pages = [{ messages: [mail], deltaLink: 'delta-1' }];
    await worker.runOnce();
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { subject: mail.subject },
      select: { assignedTeamId: true },
    });
    expect(ticket.assignedTeamId).toBe(fixtureTeamIds.it);
  });

  it('⚠️ an unknown department suffix is ingested UNROUTED, not misrouted', async () => {
    // `payroll` is a real production slug but does NOT exist in this database.
    // The mail must still become a ticket - dropping it would lose a request -
    // and it must NOT be handed to a team that happens to exist.
    const mail = message({
      subject: `Unknown department ${Date.now()}`,
      toRecipients: [{ address: 'helpdesk+payroll@company.com' }],
    });
    graph.pages = [{ messages: [mail], deltaLink: 'delta-1' }];
    const summary = await worker.runOnce();
    expect(summary.ingested).toBe(1);
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { subject: mail.subject },
      select: { assignedTeamId: true },
    });
    expect(ticket.assignedTeamId).toBeNull();
  });

  it('⚠️ the SAME message twice creates ONE ticket message', async () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK, and the reason this
    // card must not invent a second idempotency scheme: InboundEmailReceipt
    // is unique on the RFC Message-ID and already handles the replay.
    const mail = message({ subject: `Exactly once ${Date.now()}` });
    graph.pages = [{ messages: [mail], deltaLink: 'delta-1' }];
    await worker.runOnce();
    // Graph re-offers the identical message, as it would after a move failed.
    graph.pages = [{ messages: [mail], deltaLink: 'delta-2' }];
    await worker.runOnce();
    const tickets = await prisma.ticket.findMany({
      where: { subject: mail.subject },
      select: { id: true },
    });
    expect(tickets).toHaveLength(1);
    const receipts = await prisma.inboundEmailReceipt.count({
      where: { messageId: mail.internetMessageId },
    });
    expect(receipts).toBe(1);
  });

  it('⚠️ a +ticket- reply THREADS onto the existing ticket', async () => {
    const first = message({ subject: `Threading root ${Date.now()}` });
    graph.pages = [{ messages: [first], deltaLink: 'delta-1' }];
    await worker.runOnce();
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { subject: first.subject },
      select: { id: true },
    });
    const thread = await prisma.ticketEmailThread.findFirstOrThrow({
      where: { ticketId: ticket.id },
      select: { replyToken: true },
    });
    const before = await prisma.ticketMessage.count({
      where: { ticketId: ticket.id },
    });

    const reply = message({
      subject: 'Re: something the sender rewrote',
      toRecipients: [
        { address: `helpdesk+ticket-${thread.replyToken}@company.com` },
      ],
      from: { address: 'outsider@company.com', name: 'Out Sider' },
    });
    graph.pages = [{ messages: [reply], deltaLink: 'delta-2' }];
    await worker.runOnce();

    // No second ticket, and one more message on the first.
    const stray = await prisma.ticket.count({
      where: { subject: reply.subject },
    });
    expect(stray).toBe(0);
    const after = await prisma.ticketMessage.count({
      where: { ticketId: ticket.id },
    });
    expect(after).toBe(before + 1);
  });

  it('⚠️ the reply address is honoured when it is only in CC', async () => {
    // The loop-in case card 1.40 exists for: the human is in To, we are in Cc.
    const first = message({ subject: `Cc threading root ${Date.now()}` });
    graph.pages = [{ messages: [first], deltaLink: 'delta-1' }];
    await worker.runOnce();
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { subject: first.subject },
      select: { id: true },
    });
    const thread = await prisma.ticketEmailThread.findFirstOrThrow({
      where: { ticketId: ticket.id },
      select: { replyToken: true },
    });
    const before = await prisma.ticketMessage.count({
      where: { ticketId: ticket.id },
    });

    graph.pages = [
      {
        messages: [
          message({
            subject: 'Re: reply-all',
            from: { address: 'outsider@company.com', name: 'Out Sider' },
            toRecipients: [{ address: 'someone.else@company.com' }],
            ccRecipients: [
              { address: `helpdesk+ticket-${thread.replyToken}@company.com` },
            ],
          }),
        ],
        deltaLink: 'delta-2',
      },
    ];
    await worker.runOnce();
    const after = await prisma.ticketMessage.count({
      where: { ticketId: ticket.id },
    });
    expect(after).toBe(before + 1);
  });

  it('⚠️ an existing colleague copied in is auto-watched', async () => {
    // Card 1.24's "auto-watching" ask. Existing users only - see
    // `addLoopedInFollowers` for why this must not provision anybody.
    const mail = message({
      subject: `Auto watch ${Date.now()}`,
      ccRecipients: [{ address: fixtureEmails.agent }],
    });
    graph.pages = [{ messages: [mail], deltaLink: 'delta-1' }];
    await worker.runOnce();
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { subject: mail.subject },
      select: { id: true },
    });
    const follower = await prisma.ticketFollower.findFirst({
      where: { ticketId: ticket.id, userId: fixtureUserIds.agent },
    });
    expect(follower).not.toBeNull();
  });

  it('⚠️ a stranger copied in is NOT provisioned as a user', async () => {
    // Inbound mail is already the main creator of duplicate accounts
    // (card 1.30). Auto-watching must not make that worse.
    const stranger = `never-seen-${Date.now()}@vendor.example`;
    const mail = message({
      subject: `No provisioning ${Date.now()}`,
      ccRecipients: [{ address: stranger }],
    });
    graph.pages = [{ messages: [mail], deltaLink: 'delta-1' }];
    await worker.runOnce();
    const created = await prisma.user.count({ where: { email: stranger } });
    expect(created).toBe(0);
  });

  it('the delta cursor is persisted, so a restart resumes', async () => {
    graph.pages = [{ messages: [], deltaLink: 'delta-persisted' }];
    await worker.runOnce();
    const row = await prisma.inboundMailboxCursor.findUniqueOrThrow({
      where: { mailbox: MAILBOX },
      select: { deltaLink: true, lastSyncedAt: true },
    });
    expect(row.deltaLink).toBe('delta-persisted');
    expect(row.lastSyncedAt).not.toBeNull();
  });

  it('mail addressed to nobody we know is left alone', async () => {
    const mail = message({
      subject: `Not ours ${Date.now()}`,
      toRecipients: [{ address: 'someone@example.com' }],
    });
    graph.pages = [{ messages: [mail], deltaLink: 'delta-1' }];
    const summary = await worker.runOnce();
    expect(summary.skippedNotAddressedToUs).toBe(1);
    expect(summary.ingested).toBe(0);
    expect(graph.moved).toEqual([]);
    const tickets = await prisma.ticket.count({
      where: { subject: mail.subject },
    });
    expect(tickets).toBe(0);
  });
});
