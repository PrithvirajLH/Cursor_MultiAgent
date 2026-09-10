import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InboundEmailService } from '../tickets/inbound-email.service';
import { TicketEmailThreadService } from '../notifications/ticket-email-thread.service';
import { InboundMailboxService } from './inbound-mailbox.service';
import {
  GraphDeltaPage,
  GraphMailClient,
  GraphMailMessage,
} from './graph-mail.client';

const MAILBOX = 'helpdesk@csnhc.com';

function message(partial: Partial<GraphMailMessage> = {}): GraphMailMessage {
  return {
    id: 'graph-1',
    internetMessageId: '<rfc-1@sender.com>',
    subject: 'Payroll question',
    bodyText: 'Body',
    from: { address: 'requester@company.com', name: 'A Requester' },
    toRecipients: [{ address: 'helpdesk+payroll@csnhc.com' }],
    ccRecipients: [],
    deliveredTo: [],
    attachments: [],
    ...partial,
  };
}

/**
 * A fake Graph, scripted page by page.
 *
 * ⚠️ THIS IS WHY THE CARD COULD BE BUILT BEFORE THE PERMISSION EXISTED. Every
 * behaviour that matters is a property of the worker, not of Graph, so all of
 * it is provable here: the cursor surviving a restart, not ingesting twice,
 * and not moving a message that failed to store.
 */
class FakeGraph extends GraphMailClient {
  moved: string[] = [];
  fetchCalls: Array<string | null> = [];
  moveShouldThrow = false;
  private pages: GraphDeltaPage[];

  constructor(pages: GraphDeltaPage[], private configured = true) {
    super();
    this.pages = pages;
  }

  fetchDelta(_mailbox: string, link: string | null): Promise<GraphDeltaPage> {
    this.fetchCalls.push(link);
    const next = this.pages.shift();
    if (!next) {
      return Promise.resolve({ messages: [], deltaLink: 'delta-empty' });
    }
    return Promise.resolve(next);
  }

  moveToProcessed(_mailbox: string, messageId: string): Promise<void> {
    if (this.moveShouldThrow) {
      return Promise.reject(new Error('move failed'));
    }
    this.moved.push(messageId);
    return Promise.resolve();
  }

  isConfigured(): boolean {
    return this.configured;
  }

  describeConfiguration(): string {
    return this.configured ? 'configured' : 'missing AZURE_TENANT_ID';
  }
}

/** An in-memory stand-in for the one cursor row. */
function makeCursorStore() {
  const rows = new Map<string, { deltaLink: string | null }>();
  return {
    rows,
    prisma: {
      inboundMailboxCursor: {
        findUnique: ({ where }: { where: { mailbox: string } }) =>
          Promise.resolve(rows.get(where.mailbox) ?? null),
        upsert: ({
          where,
          create,
          update,
        }: {
          where: { mailbox: string };
          create: { deltaLink: string | null };
          update: { deltaLink: string | null };
        }) => {
          const existing = rows.get(where.mailbox);
          rows.set(where.mailbox, {
            deltaLink: existing ? update.deltaLink : create.deltaLink,
          });
          return Promise.resolve(rows.get(where.mailbox));
        },
      },
      team: { findFirst: () => Promise.resolve({ id: 'team-payroll' }) },
    } as unknown as PrismaService,
  };
}

function build(
  graph: GraphMailClient,
  env: Record<string, string | undefined>,
  ingest = jest.fn().mockResolvedValue({ threaded: false }),
  store = makeCursorStore(),
) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const inboundEmail = {
    ingestInboundEmailMessage: ingest,
  } as unknown as InboundEmailService;
  const threads = {
    getBaseReplyToAddress: () => MAILBOX,
  } as unknown as TicketEmailThreadService;
  const service = new InboundMailboxService(
    store.prisma,
    config,
    graph,
    inboundEmail,
    threads,
  );
  return { service, ingest, store };
}

const ON = { INBOUND_MAILBOX_ENABLED: 'true' };

describe('InboundMailboxService (card 1.24)', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('the switch', () => {
    it('⚠️ off means the timer never fires and nothing is polled', () => {
      // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. Shipping this must
      // send nothing at a mailbox until somebody chooses to.
      const graph = new FakeGraph([]);
      const { service } = build(graph, {});
      service.onModuleInit();
      expect(graph.fetchCalls).toHaveLength(0);
      service.onModuleDestroy();
    });

    it('off still answers Run now, and explains itself', async () => {
      const graph = new FakeGraph([]);
      const { service } = build(graph, {});
      const summary = await service.runOnce();
      expect(summary.enabled).toBe(false);
      expect(summary.error).toContain('INBOUND_MAILBOX_ENABLED');
      expect(graph.fetchCalls).toHaveLength(0);
    });

    it('⚠️ fails loudly rather than no-opping when Graph is unconfigured', async () => {
      // A worker that silently does nothing in production is worse than one
      // that fails: the mail is still arriving and nobody is told.
      const graph = new FakeGraph([], false);
      const { service, ingest } = build(graph, ON);
      const summary = await service.runOnce();
      expect(summary.error).toContain('not configured');
      expect(ingest).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('the cursor', () => {
    it('⚠️ resumes from the STORED cursor after a restart, losing nothing', async () => {
      // THE REGRESSION ASSERTION FOR THIS CARD. The delta token being durable
      // is the entire reason 1.24 polls rather than using a webhook: an app
      // that was down for a deploy must collect what arrived meanwhile. An
      // in-memory cursor would silently lose all of it.
      const store = makeCursorStore();
      const first = new FakeGraph([
        { messages: [message()], deltaLink: 'delta-after-first' },
      ]);
      const { service } = build(first, ON, undefined, store);
      await service.runOnce();
      expect(store.rows.get(MAILBOX)?.deltaLink).toBe('delta-after-first');

      // A completely new instance, as after a restart. Same store.
      const second = new FakeGraph([{ messages: [], deltaLink: 'delta-after-second' }]);
      const restarted = build(second, ON, undefined, store);
      await restarted.service.runOnce();
      expect(second.fetchCalls).toEqual(['delta-after-first']);
    });

    it('starts a fresh delta when the mailbox has never been synced', async () => {
      const graph = new FakeGraph([{ messages: [], deltaLink: 'delta-1' }]);
      const { service } = build(graph, ON);
      await service.runOnce();
      expect(graph.fetchCalls).toEqual([null]);
    });

    it('⚠️ advances the cursor only to a deltaLink, never to a nextLink', async () => {
      // Storing a nextLink would strand the worker mid-history if the app
      // restarted before the final page.
      const store = makeCursorStore();
      const graph = new FakeGraph([
        { messages: [message()], nextLink: 'page-2' },
        { messages: [], deltaLink: 'delta-final' },
      ]);
      const { service } = build(graph, ON, undefined, store);
      await service.runOnce();
      expect(graph.fetchCalls).toEqual([null, 'page-2']);
      expect(store.rows.get(MAILBOX)?.deltaLink).toBe('delta-final');
    });
  });

  describe('ingestion', () => {
    it('⚠️ two polls do not ingest the same message twice', async () => {
      // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. The second poll
      // resumes from the delta token's tail, so the message is simply not
      // offered again. (Belt and braces: even if Graph re-offered it, the
      // existing InboundEmailReceipt would make it a replay - which is why
      // this card does NOT add a second idempotency scheme.)
      const store = makeCursorStore();
      const graph = new FakeGraph([
        { messages: [message()], deltaLink: 'delta-1' },
        { messages: [], deltaLink: 'delta-2' },
      ]);
      const { service, ingest } = build(graph, ON, undefined, store);
      await service.runOnce();
      await service.runOnce();
      expect(ingest).toHaveBeenCalledTimes(1);
    });

    it('⚠️ a store failure leaves the message UNMOVED so the next poll retries', async () => {
      // THE TRAP THIS CARD EXISTS TO AVOID. Move-then-store loses mail with no
      // trace: out of the Inbox, past the cursor, gone. Store-then-move means
      // the worst case is a message still sitting in the Inbox.
      const graph = new FakeGraph([
        { messages: [message()], deltaLink: 'delta-1' },
      ]);
      const ingest = jest.fn().mockRejectedValue(new Error('database down'));
      const { service } = build(graph, ON, ingest);
      const summary = await service.runOnce();
      expect(summary.failed).toBe(1);
      expect(summary.ingested).toBe(0);
      expect(graph.moved).toEqual([]);
    });

    it('moves to Processed only after a successful store', async () => {
      const graph = new FakeGraph([
        { messages: [message({ id: 'graph-9' })], deltaLink: 'delta-1' },
      ]);
      const { service } = build(graph, ON);
      const summary = await service.runOnce();
      expect(summary.ingested).toBe(1);
      expect(graph.moved).toEqual(['graph-9']);
    });

    it('a message stored but not moved is not counted as failed', async () => {
      // It will be re-offered and the existing receipt makes it a replay.
      const graph = new FakeGraph([
        { messages: [message()], deltaLink: 'delta-1' },
      ]);
      graph.moveShouldThrow = true;
      const { service } = build(graph, ON);
      const summary = await service.runOnce();
      expect(summary.ingested).toBe(1);
      expect(summary.movedToProcessed).toBe(0);
      expect(summary.failed).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('passes the address WE matched, not the first To', async () => {
      const graph = new FakeGraph([
        {
          messages: [
            message({
              toRecipients: [{ address: 'manager@csnhc.com' }],
              ccRecipients: [
                { address: 'helpdesk+ticket-a1b2c3d4e5f6a7b8@csnhc.com' },
              ],
            }),
          ],
          deltaLink: 'delta-1',
        },
      ]);
      const { service, ingest } = build(graph, ON);
      await service.runOnce();
      expect(ingest.mock.calls[0][0].toEmail).toBe(
        'helpdesk+ticket-a1b2c3d4e5f6a7b8@csnhc.com',
      );
    });

    it('routes a department address to that team, and a reply to none', async () => {
      const graph = new FakeGraph([
        { messages: [message()], deltaLink: 'delta-1' },
      ]);
      const { service, ingest } = build(graph, ON);
      await service.runOnce();
      expect(ingest.mock.calls[0][1]).toEqual({ assignedTeamId: 'team-payroll' });
    });

    it('⚠️ mail not addressed to us is skipped and left where it is', async () => {
      const graph = new FakeGraph([
        {
          messages: [
            message({ toRecipients: [{ address: 'someone@example.com' }] }),
          ],
          deltaLink: 'delta-1',
        },
      ]);
      const { service, ingest } = build(graph, ON);
      const summary = await service.runOnce();
      expect(summary.skippedNotAddressedToUs).toBe(1);
      expect(ingest).not.toHaveBeenCalled();
      expect(graph.moved).toEqual([]);
    });

    it('⚠️ an unknown department suffix is ingested UNROUTED, not guessed', async () => {
      // Falling through to whichever team sorts first would put one
      // department's mail in front of another.
      const store = makeCursorStore();
      (store.prisma as unknown as { team: { findFirst: () => Promise<null> } }).team.findFirst =
        () => Promise.resolve(null);
      const graph = new FakeGraph([
        {
          messages: [
            message({ toRecipients: [{ address: 'helpdesk+nosuch@csnhc.com' }] }),
          ],
          deltaLink: 'delta-1',
        },
      ]);
      const { service, ingest } = build(graph, ON, undefined, store);
      const summary = await service.runOnce();
      expect(summary.ingested).toBe(1);
      expect(ingest.mock.calls[0][1]).toEqual({ assignedTeamId: null });
      expect(warnSpy).toHaveBeenCalled();
    });

    it('a Graph failure is reported rather than thrown', async () => {
      const graph = new FakeGraph([]);
      graph.fetchDelta = () => Promise.reject(new Error('403 Forbidden'));
      const { service } = build(graph, ON);
      const summary = await service.runOnce();
      expect(summary.error).toContain('403');
    });
  });

  describe('configuration it reports', () => {
    it('defaults to a 30 second poll and says so', () => {
      const { service } = build(new FakeGraph([]), ON);
      expect(service.getIntervalMs()).toBe(30_000);
    });

    it('honours an override', () => {
      const { service } = build(new FakeGraph([]), {
        ...ON,
        INBOUND_MAILBOX_POLL_INTERVAL_MS: '5000',
      });
      expect(service.getIntervalMs()).toBe(5_000);
    });

    it('falls back to the outbound reply address for the mailbox', () => {
      const { service } = build(new FakeGraph([]), ON);
      expect(service.getMailbox()).toBe(MAILBOX);
    });
  });
});
