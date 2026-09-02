import { ConfigService } from '@nestjs/config';
import { OutboxStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { TicketEmailThreadService } from './ticket-email-thread.service';

const TICKET_ID = 'ticket-1';
const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8';
const ROOT = `<ticket.${TOKEN}@csnhc.com>`;

type ThreadRow = {
  id: string;
  ticketId: string;
  replyToken: string;
  canonicalSubject: string;
  rootInboundMessageId: string | null;
  lastInboundMessageId: string | null;
  lastInboundAt: Date | null;
  lastOutboundMessageId: string | null;
  lastOutboundAt: Date | null;
};

function thread(overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: 'thread-1',
    ticketId: TICKET_ID,
    replyToken: TOKEN,
    canonicalSubject: 'Printer down',
    rootInboundMessageId: null,
    lastInboundMessageId: null,
    lastInboundAt: null,
    lastOutboundMessageId: null,
    lastOutboundAt: null,
    ...overrides,
  };
}

function buildHarness(options: {
  thread?: ThreadRow;
  inbound?: string[];
  sentOutboxIds?: string[];
}) {
  const row = options.thread ?? thread();
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    ticketEmailThread: {
      findUnique: jest.fn(async () => row),
      findFirst: jest.fn(async () => row),
      create: jest.fn(async () => row),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return row;
      }),
      updateMany: jest.fn(
        async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return { count: 1 };
        },
      ),
    },
    inboundEmailReceipt: {
      findMany: jest.fn(async () =>
        (options.inbound ?? []).map((messageId) => ({ messageId })),
      ),
    },
    notificationOutbox: {
      findMany: jest.fn(async ({ where }: { where: { status?: string } }) => {
        // The harness enforces the filter the code relies on: only SENT rows.
        expect(where.status).toBe(OutboxStatus.SENT);
        return (options.sentOutboxIds ?? []).map((id) => ({ id }));
      }),
    },
  } as unknown as PrismaService;
  const config = {
    get: (key: string) =>
      key === 'SMTP_REPLY_TO' ? 'helpdesk@csnhc.com' : undefined,
  } as unknown as ConfigService;
  return { service: new TicketEmailThreadService(prisma, config), updates };
}

const context = (harness: ReturnType<typeof buildHarness>) =>
  harness.service.buildOutboundEmailContext({
    ticketId: TICKET_ID,
    ticketSubject: 'Printer down',
    ticketDisplayId: 'IS_20260902_001',
    ticketNumber: 1,
  });

describe('buildOutboundEmailContext', () => {
  it('puts the synthetic root first in References', async () => {
    const harness = buildHarness({});
    const result = await context(harness);
    expect(result.emailMetadata.references?.[0]).toBe(ROOT);
  });

  it('references the same root on a second message', async () => {
    const first = await context(buildHarness({}));
    const second = await context(
      buildHarness({
        thread: thread({ lastOutboundMessageId: '<outbox.x@csnhc.com>' }),
        sentOutboxIds: ['11111111-1111-4111-8111-111111111111'],
      }),
    );
    expect(second.emailMetadata.references?.[0]).toBe(
      first.emailMetadata.references?.[0],
    );
  });

  it('accumulates the ancestry it can prove was delivered', async () => {
    const harness = buildHarness({
      inbound: ['<requester-1@mail.example>', '<requester-2@mail.example>'],
      sentOutboxIds: [
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ],
    });
    const result = await context(harness);
    const references = result.emailMetadata.references ?? [];
    expect(references[0]).toBe(ROOT);
    expect(references).toContain('<requester-1@mail.example>');
    expect(references).toContain('<requester-2@mail.example>');
    expect(references).toContain(
      '<outbox.11111111-1111-4111-8111-111111111111@csnhc.com>',
    );
    expect(references.length).toBeGreaterThan(3);
  });

  it('keeps the root when the cap trims the list', async () => {
    const many = Array.from(
      { length: 40 },
      (_, index) => `<inbound-${index}@mail.example>`,
    );
    const result = await context(buildHarness({ inbound: many }));
    const references = result.emailMetadata.references ?? [];
    expect(references).toHaveLength(20);
    expect(references[0]).toBe(ROOT);
  });

  it('never emits an unroutable id', async () => {
    const result = await context(
      buildHarness({
        thread: thread({
          lastOutboundMessageId: '<outbox.old@localhost>',
          rootInboundMessageId: '<outbox.older@localhost>',
        }),
      }),
    );
    const references = result.emailMetadata.references ?? [];
    expect(references.some((id) => id.includes('@localhost'))).toBe(false);
    expect(result.emailMetadata.inReplyTo).not.toContain('@localhost');
  });

  it('addresses In-Reply-To to the requester/s own last message when there is one', async () => {
    const result = await context(
      buildHarness({
        thread: thread({
          rootInboundMessageId: '<first-from-them@mail.example>',
          lastInboundMessageId: '<latest-from-them@mail.example>',
          lastOutboundMessageId: '<outbox.someone-elses-copy@csnhc.com>',
        }),
      }),
    );
    expect(result.emailMetadata.inReplyTo).toBe('<latest-from-them@mail.example>');
  });

  it('falls back to the root, never to a shared outbound id', async () => {
    // lastOutboundMessageId was the fault: one field shared across the ticket
    // while Message-IDs were per recipient, so it usually named somebody
    // else's copy.
    const result = await context(
      buildHarness({
        thread: thread({
          lastOutboundMessageId: '<outbox.someone-elses-copy@csnhc.com>',
        }),
      }),
    );
    expect(result.emailMetadata.inReplyTo).toBe(ROOT);
  });
});

describe('recordOutboundEmail', () => {
  it('records a routable id', async () => {
    const harness = buildHarness({});
    await harness.service.recordOutboundEmail({
      ticketId: TICKET_ID,
      messageId: '<outbox.abc@csnhc.com>',
    });
    expect(harness.updates).toHaveLength(1);
    expect(harness.updates[0].lastOutboundMessageId).toBe(
      '<outbox.abc@csnhc.com>',
    );
  });

  it('refuses to persist a localhost id', async () => {
    // It would be quoted forever in every reply and could never be matched.
    const harness = buildHarness({});
    await harness.service.recordOutboundEmail({
      ticketId: TICKET_ID,
      messageId: '<outbox.abc@localhost>',
    });
    expect(harness.updates).toHaveLength(0);
  });

  it('ignores an empty id', async () => {
    const harness = buildHarness({});
    await harness.service.recordOutboundEmail({
      ticketId: TICKET_ID,
      messageId: '   ',
    });
    expect(harness.updates).toHaveLength(0);
  });
});
