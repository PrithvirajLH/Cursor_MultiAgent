import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { TicketsService } from '../../src/tickets/tickets.service';
import { selectBodyText } from '../../src/inbound-mailbox/select-body-text.util';
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

  /**
   * Card 1.62 — the real Outlook reply, end to end.
   *
   * ⚠️ The body here is produced by the REAL `selectBodyText`, which is
   * exactly what `GraphMailHttpClient.toMessage` calls. The scripted client
   * hands over an already-reduced `GraphMailMessage`, so composing the real
   * conversion here is what keeps this honest rather than feeding the
   * pipeline text it flattened by hand.
   */
  describe('an Outlook HTML reply (card 1.62)', () => {
    const RAW_HTML = readFileSync(
      join(__dirname, '..', '..', 'src', 'inbound-mailbox', '__fixtures__', 'outlook-reply.html'),
      'utf8',
    );
    const CONVERTED = selectBodyText(
      { contentType: 'html', content: RAW_HTML },
      'Ticket acknowledgement received.',
    );

    it('⚠️ a NEW email ticket gets text as its description, not markup', async () => {
      // THE ASSERTION THAT FAILS IF FAULT C COMES BACK. `description` carries
      // `Ticket_description_trgm_idx`, so markup landing here puts
      // `font-family` and a confidentiality footer into ticket search for
      // every email ticket ever opened.
      const mail = message({
        subject: `C162 html description ${Date.now()}`,
        bodyText: CONVERTED,
      });
      graph.pages = [{ messages: [mail], deltaLink: 'delta-1' }];
      await worker.runOnce();
      const ticket = await prisma.ticket.findFirstOrThrow({
        where: { subject: mail.subject },
        select: { description: true },
      });
      expect(ticket.description).not.toContain('<html');
      expect(ticket.description).not.toContain('font-family');
      expect(ticket.description).not.toContain('<style');
      expect(ticket.description).toContain('Ticket acknowledgement received.');
    });

    it('⚠️ ticket search for "font-family" finds nothing', async () => {
      // The consequence of the above, asserted the way a user would hit it.
      const mail = message({
        subject: `C162 search hygiene ${Date.now()}`,
        bodyText: CONVERTED,
      });
      graph.pages = [{ messages: [mail], deltaLink: 'delta-1' }];
      await worker.runOnce();
      const poisoned = await prisma.ticket.count({
        where: { description: { contains: 'font-family', mode: 'insensitive' } },
      });
      expect(poisoned).toBe(0);
    });

    it('⚠️ the quoted block is GONE from the display and PRESENT on the record', async () => {
      // THE ASSERTION THAT FAILS IF `stripQuotedReply` IS UNWIRED AGAIN.
      // It had twelve passing tests and no production caller; this is the one
      // that notices. Both halves matter: trimming on display, and the whole
      // body still on the record so nothing an audit needs is discarded.
      const root = message({ subject: `C162 threading root ${Date.now()}` });
      graph.pages = [{ messages: [root], deltaLink: 'delta-1' }];
      await worker.runOnce();
      const ticket = await prisma.ticket.findFirstOrThrow({
        where: { subject: root.subject },
        select: { id: true },
      });
      const thread = await prisma.ticketEmailThread.findFirstOrThrow({
        where: { ticketId: ticket.id },
        select: { replyToken: true },
      });
      graph.pages = [
        {
          messages: [
            message({
              subject: 'Re: whatever the sender renamed it',
              bodyText: CONVERTED,
              toRecipients: [
                { address: `helpdesk+ticket-${thread.replyToken}@company.com` },
              ],
            }),
          ],
          deltaLink: 'delta-2',
        },
      ];
      await worker.runOnce();

      const stored = await prisma.ticketMessage.findFirstOrThrow({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: 'desc' },
        select: { body: true },
      });
      // Stored: the whole thing, quoted block and all.
      expect(stored.body).toContain('Reply above this line');
      expect(stored.body).toContain('Ticket acknowledgement received.');

      // Displayed: only what the sender typed.
      const owner = await prisma.user.findFirstOrThrow({
        where: { email: fixtureEmails.owner },
        select: { id: true, email: true, displayName: true, role: true },
      });
      const shown = await app
        .get(TicketsService)
        .listMessages(ticket.id, owner as never, 50);
      const last = shown.data[shown.data.length - 1];
      expect(last.body).toContain('Ticket acknowledgement received.');
      expect(last.body).not.toContain('Reply above this line');
      expect(last.body).not.toContain('pilot mode');
      expect(last.body.length).toBeLessThan(stored.body.length);
    });

    it('a reply that is ENTIRELY quoted text still shows something', async () => {
      // The util's "kept.length === 0" guard, which must survive being wired
      // up: an empty message is worse than a quoted one.
      const root = message({ subject: `C162 all quoted ${Date.now()}` });
      graph.pages = [{ messages: [root], deltaLink: 'delta-1' }];
      await worker.runOnce();
      const ticket = await prisma.ticket.findFirstOrThrow({
        where: { subject: root.subject },
        select: { id: true },
      });
      const thread = await prisma.ticketEmailThread.findFirstOrThrow({
        where: { ticketId: ticket.id },
        select: { replyToken: true },
      });
      graph.pages = [
        {
          messages: [
            message({
              subject: 'Re: nothing of my own',
              bodyText: '----- Reply above this line -----\nOnly quoted text.',
              toRecipients: [
                { address: `helpdesk+ticket-${thread.replyToken}@company.com` },
              ],
            }),
          ],
          deltaLink: 'delta-2',
        },
      ];
      await worker.runOnce();
      const owner = await prisma.user.findFirstOrThrow({
        where: { email: fixtureEmails.owner },
        select: { id: true, email: true, displayName: true, role: true },
      });
      const shown = await app
        .get(TicketsService)
        .listMessages(ticket.id, owner as never, 50);
      const last = shown.data[shown.data.length - 1];
      expect(last.body.trim().length).toBeGreaterThan(0);
      expect(last.body).toContain('Only quoted text.');
    });
  });
});
