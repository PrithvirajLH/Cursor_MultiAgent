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
import { AiService } from '../../src/ai/ai.service';
import type { InboundDepartmentRoute } from '../../src/ai/types/pipeline.types';
import {
  GraphAttachmentContent,
  GraphDeltaPage,
  GraphMailClient,
  GraphAttachmentMeta,
  GraphMailMessage,
} from '../../src/inbound-mailbox/graph-mail.client';

const MAILBOX = 'helpdesk@company.com';

/**
 * A stand-in for the classifier (card 1.63).
 *
 * ⚠️ IT DECLINES BY DEFAULT, so every test written before this card still
 * describes a world where the AI does nothing - which is also production's
 * world until the model is reachable. A test that wants routing sets `next`.
 */
class ScriptedAi {
  next: InboundDepartmentRoute = { routed: false, reason: 'pipeline_disabled' };
  calls = 0;

  classifyInboundDepartment(): Promise<InboundDepartmentRoute> {
    this.calls += 1;
    return Promise.resolve(this.next);
  }
}

/** Scripted Graph. The ONLY thing faked in this file. */
class ScriptedGraph extends GraphMailClient {
  pages: GraphDeltaPage[] = [];
  moved: string[] = [];

  fetchDelta(): Promise<GraphDeltaPage> {
    return Promise.resolve(
      this.pages.shift() ?? { messages: [], deltaLink: 'delta-end' },
    );
  }

  /** Card 1.116: attachments per Graph message id, and what was downloaded. */
  attachmentsByMessage = new Map<string, GraphAttachmentMeta[]>();
  contentByAttachment = new Map<string, string>();
  contentFetches: string[] = [];

  listAttachments(
    _mailbox: string,
    messageId: string,
  ): Promise<GraphAttachmentMeta[]> {
    return Promise.resolve(this.attachmentsByMessage.get(messageId) ?? []);
  }

  /** Card 1.129: the `contentId` a pasted image carries, per attachment id. */
  contentIdsByAttachment = new Map<string, string>();

  fetchAttachmentContent(
    _mailbox: string,
    _messageId: string,
    attachmentId: string,
  ): Promise<GraphAttachmentContent> {
    this.contentFetches.push(attachmentId);
    const content = this.contentByAttachment.get(attachmentId);
    if (content === undefined) {
      return Promise.reject(new Error('no scripted content'));
    }
    return Promise.resolve({
      contentBytes: content,
      contentId: this.contentIdsByAttachment.get(attachmentId) ?? null,
    });
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
    bodyHtml: null,
    from: { address: 'outsider@company.com', name: 'Out Sider' },
    toRecipients: [{ address: `helpdesk+payroll@company.com` }],
    ccRecipients: [],
    deliveredTo: [],
    hasAttachments: false,
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
  let ai: ScriptedAi;
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
    ai = new ScriptedAi();
    app = await createTestApp({
      overrideProviders: [
        { provide: GraphMailClient, useValue: graph },
        { provide: AiService, useValue: ai },
      ],
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
    ai.next = { routed: false, reason: 'pipeline_disabled' };
    ai.calls = 0;
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

  describe('the AI routes mail nobody addressed (card 1.63)', () => {
    /** A bare helpdesk address: no suffix, so nothing else decides the team. */
    const bare = (subject: string) =>
      message({ subject, toRecipients: [{ address: MAILBOX }] });

    it('⚠️ an unaddressed email lands on the team the AI named, and SAYS SO', async () => {
      // THE ASSERTION THIS CARD EXISTS FOR, end to end: the real ingestion
      // path, the real database, the real ticket.
      ai.next = {
        routed: true,
        teamId: fixtureTeamIds.hr,
        teamName: 'HR',
        confidence: 0.93,
        thresholdUsed: 0.7,
      };
      const mail = bare(`AI routed ${Date.now()}`);
      graph.pages = [{ messages: [mail], deltaLink: 'delta-ai-1' }];

      const summary = await worker.runOnce();

      expect(summary.ingested).toBe(1);
      expect(ai.calls).toBe(1);
      const ticket = await prisma.ticket.findFirstOrThrow({
        where: { subject: mail.subject },
        select: { id: true, assignedTeamId: true },
      });
      expect(ticket.assignedTeamId).toBe(fixtureTeamIds.hr);

      // ⚠️ AND IT IS AUDITABLE. Without the event nobody can ever tell how
      // often the classifier is right, which is the number that decides
      // whether the threshold is set correctly.
      const event = await prisma.ticketEvent.findFirstOrThrow({
        where: { ticketId: ticket.id, type: 'TICKET_ROUTED_BY_AI' },
        select: { payload: true },
      });
      expect(event.payload).toMatchObject({
        teamId: fixtureTeamIds.hr,
        teamName: 'HR',
        confidence: 0.93,
        thresholdUsed: 0.7,
      });
    });

    it('⚠️ below the threshold it lands unrouted, with no AI event', async () => {
      // NON-VACUITY, and the behaviour this card promised not to change. There
      // is no triage team in this system and this card does not invent one.
      ai.next = {
        routed: false,
        reason: 'below_threshold',
        confidence: 0.3,
        thresholdUsed: 0.7,
      };
      const mail = bare(`AI declined ${Date.now()}`);
      graph.pages = [{ messages: [mail], deltaLink: 'delta-ai-2' }];

      const summary = await worker.runOnce();

      expect(summary.ingested).toBe(1);
      const ticket = await prisma.ticket.findFirstOrThrow({
        where: { subject: mail.subject },
        select: { id: true, assignedTeamId: true },
      });
      expect(ticket.assignedTeamId).toBeNull();
      const events = await prisma.ticketEvent.count({
        where: { ticketId: ticket.id, type: 'TICKET_ROUTED_BY_AI' },
      });
      expect(events).toBe(0);
    });

    it('⚠️ a plus-addressed email is never sent to the classifier', async () => {
      // 367 of 370 tickets arrive this way (card 1.19). An explicit department
      // beats a classifier, and must not cost a model call either.
      ai.next = {
        routed: true,
        teamId: fixtureTeamIds.hr,
        teamName: 'HR',
        confidence: 0.99,
        thresholdUsed: 0.7,
      };
      const mail = message({
        subject: `Plus addressed ${Date.now()}`,
        toRecipients: [{ address: 'helpdesk+it@company.com' }],
      });
      graph.pages = [{ messages: [mail], deltaLink: 'delta-ai-3' }];

      await worker.runOnce();

      expect(ai.calls).toBe(0);
      const ticket = await prisma.ticket.findFirstOrThrow({
        where: { subject: mail.subject },
        select: { assignedTeamId: true },
      });
      expect(ticket.assignedTeamId).toBe(fixtureTeamIds.it);
    });
  });

  it('⚠️ emailed files become real attachments, minus the signature logo', async () => {
    // THE END-TO-END PROOF FOR CARD 1.116, and the reason it belongs in this
    // tier rather than the unit one. The unit tests show the worker builds the
    // right payload; this shows the payload actually survives the normalizer,
    // the size checks and storage, and lands as Attachment ROWS on the ticket.
    //
    // ⚠️ EVERYTHING DOWNSTREAM WAS ALWAYS CORRECT AND ALWAYS STARVING. The
    // delta query never returned the attachments collection, so every emailed
    // image since this worker shipped was left in the mailbox and none of that
    // machinery ever ran on a real file. This is the first test that feeds it.
    //
    // Shaped from the real email that produced the card: two genuine files, one
    // pasted screenshot, and the sender's signature logo.
    // ⚠️ REAL PNG BYTES, NOT A STRING. Uploads are checked against a magic-byte
    // signature as well as the extension and MIME type, so "pretend it is a
    // png" is refused - correctly - and the first version of this test saw zero
    // rows for that reason rather than the one it was written for.
    const PNG_1X1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const pasted = PNG_1X1;
    const fileOne = PNG_1X1;
    const fileTwo = PNG_1X1;

    const mail = message({
      subject: `Attachments end to end ${Date.now()}`,
      toRecipients: [{ address: 'helpdesk+it@company.com' }],
      hasAttachments: true,
    });
    graph.attachmentsByMessage.set(mail.id, [
      {
        id: 'att-logo',
        name: 'signature-logo.png',
        contentType: 'image/png',
        sizeBytes: 6 * 1024,
        isInline: true,
      },
      {
        id: 'att-pasted',
        name: 'image.png',
        contentType: 'image/png',
        sizeBytes: 212 * 1024,
        isInline: true,
      },
      {
        id: 'att-1',
        name: 'aginf.png',
        contentType: 'image/png',
        sizeBytes: 4_573_184,
        isInline: false,
      },
      {
        id: 'att-2',
        name: 'Back Injury.png',
        contentType: 'image/png',
        sizeBytes: 4_552_704,
        isInline: false,
      },
    ]);
    graph.contentByAttachment.set('att-pasted', pasted.toString('base64'));
    graph.contentByAttachment.set('att-1', fileOne.toString('base64'));
    graph.contentByAttachment.set('att-2', fileTwo.toString('base64'));

    graph.pages = [{ messages: [mail], deltaLink: 'delta-att' }];
    const summary = await worker.runOnce();
    expect(summary.ingested).toBe(1);

    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { subject: mail.subject },
      select: { id: true },
    });
    const attachments = await prisma.attachment.findMany({
      where: { ticketId: ticket.id },
      select: { fileName: true, sizeBytes: true },
      orderBy: { createdAt: 'asc' },
    });

    expect(attachments.map((a) => a.fileName)).toEqual([
      'image.png',
      'aginf.png',
      'Back Injury.png',
    ]);
    // ⚠️ THE SIGNATURE LOGO IS NOT HERE AND WAS NEVER DOWNLOADED - the
    // owner's decision, enforced before the bytes are paid for.
    expect(graph.contentFetches).not.toContain('att-logo');

    // ⚠️ THE STORED SIZE IS THE REAL FILE, which is the second half of the
    // card. Graph reports a wire size about a third larger; passing that
    // through made the normalizer reject every attachment for a size mismatch.
    const stored = new Map(
      attachments.map((a) => [a.fileName, a.sizeBytes]),
    );
    expect(stored.get('aginf.png')).toBe(fileOne.length);
    expect(stored.get('Back Injury.png')).toBe(fileTwo.length);
    expect(stored.get('image.png')).toBe(pasted.length);
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

  it('⚠️ a pasted image lands IN the reply, where the sender put it (card 1.129)', async () => {
    // Fault B. The owner pasted a screenshot mid-sentence; it arrived as a file
    // on the ticket and the body had no trace of where it had been, because
    // card 1.62's conversion drops `<img>` and the `cid:` reference with it.
    const first = message({ subject: `Inline paste root ${Date.now()}` });
    graph.pages = [{ messages: [first], deltaLink: 'delta-inline-1' }];
    await worker.runOnce();
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { subject: first.subject },
      select: { id: true },
    });
    const thread = await prisma.ticketEmailThread.findFirstOrThrow({
      where: { ticketId: ticket.id },
      select: { replyToken: true },
    });

    // ⚠️ A REAL PNG, NOT A STRING PRETENDING TO BE ONE. `ticket-attachment.
    // service` matches magic bytes against the declared contentType, so text
    // labelled `image/png` is refused and the file never lands - which reads
    // exactly like the inline mapping having failed. It cost this test two red
    // runs before the cause was the fixture rather than the code.
    const pasted = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const reply = message({
      subject: 'Re: Inline paste root',
      toRecipients: [
        { address: `helpdesk+ticket-${thread.replyToken}@company.com` },
      ],
      from: { address: 'outsider@company.com', name: 'Out Sider' },
      bodyText: ['The error looks like this:', '', 'Can you fix it?'].join('\n'),
      bodyHtml:
        '<html><body><p>The error looks like this:</p>' +
        '<p><img src="cid:paste@outlook" alt="screenshot.png"></p>' +
        '<p>Can you fix it?</p></body></html>',
      hasAttachments: false,
    });
    graph.attachmentsByMessage.set(reply.id, [
      {
        id: 'att-inline',
        name: 'screenshot.png',
        contentType: 'image/png',
        // ⚠️ THE METADATA SIZE IS WHAT `isSignatureImage` JUDGES, not the
        // content's. Below `INBOUND_INLINE_IMAGE_MIN_BYTES` this is discarded
        // as a signature logo before it is ever downloaded - which the test
        // below this one relies on, and which cost this one a red run first.
        sizeBytes: 212 * 1024,
        isInline: true,
      },
    ]);
    graph.contentByAttachment.set('att-inline', pasted.toString('base64'));
    graph.contentIdsByAttachment.set('att-inline', 'paste@outlook');
    graph.pages = [{ messages: [reply], deltaLink: 'delta-inline-2' }];
    await worker.runOnce();

    const stored = await prisma.ticketMessage.findFirstOrThrow({
      where: { ticketId: ticket.id, body: { contains: 'looks like this' } },
      select: { id: true, body: true },
    });
    const attachment = await prisma.attachment.findFirstOrThrow({
      where: { ticketId: ticket.id, fileName: { contains: 'screenshot' } },
      select: { id: true, messageId: true },
    });

    // The image is IN the message, as the same markup the web composer writes -
    // so `MessageBody` hydrates it with no new rendering code.
    expect(stored.body).toContain(`<img data-attachment-id="${attachment.id}"`);
    // And in its place: after the first sentence, before the second.
    expect(stored.body.indexOf('<img')).toBeGreaterThan(
      stored.body.indexOf('looks like this'),
    );
    expect(stored.body.indexOf('<img')).toBeLessThan(
      stored.body.indexOf('Can you fix it'),
    );
    // ⚠️ NO MARKER SURVIVES. An unresolved `[[cid:...]]` in front of a
    // requester is worse than the missing picture it stands for.
    expect(stored.body).not.toContain('[[cid:');
    // Card 1.121's link still holds, which is what lets card 1.83 work at all.
    expect(attachment.messageId).toBe(stored.id);
  });

  it('⚠️ an inline image that was NOT kept leaves the body exactly as before (card 1.129)', async () => {
    // A signature logo is discarded before it is ever downloaded, so it has no
    // contentId to match - and the body must come back as card 1.62 made it,
    // with no marker and no trace.
    const first = message({ subject: `Logo only root ${Date.now()}` });
    graph.pages = [{ messages: [first], deltaLink: 'delta-logo-1' }];
    await worker.runOnce();
    const ticket = await prisma.ticket.findFirstOrThrow({
      where: { subject: first.subject },
      select: { id: true },
    });
    const thread = await prisma.ticketEmailThread.findFirstOrThrow({
      where: { ticketId: ticket.id },
      select: { replyToken: true },
    });

    const reply = message({
      subject: 'Re: Logo only root',
      toRecipients: [
        { address: `helpdesk+ticket-${thread.replyToken}@company.com` },
      ],
      from: { address: 'outsider@company.com', name: 'Out Sider' },
      bodyText: 'Thanks for the update.',
      bodyHtml:
        '<html><body><p>Thanks for the update.</p>' +
        '<img src="cid:logo@corp" alt="logo.png"></body></html>',
    });
    graph.attachmentsByMessage.set(reply.id, [
      {
        id: 'att-logo',
        name: 'logo.png',
        contentType: 'image/png',
        // Under the inline floor, so `isSignatureImage` discards it.
        sizeBytes: 900,
        isInline: true,
      },
    ]);
    graph.pages = [{ messages: [reply], deltaLink: 'delta-logo-2' }];
    await worker.runOnce();

    const stored = await prisma.ticketMessage.findFirstOrThrow({
      where: { ticketId: ticket.id, body: { contains: 'Thanks for the update' } },
      select: { body: true },
    });
    expect(stored.body).not.toContain('[[cid:');
    expect(stored.body).not.toContain('<img');
    expect(stored.body).not.toContain('logo.png');
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
