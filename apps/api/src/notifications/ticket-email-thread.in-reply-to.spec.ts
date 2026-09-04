import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TicketEmailThreadService } from './ticket-email-thread.service';

/**
 * Card 1.43 — the inbound Message-ID must be bracketed on the way out.
 *
 * `preferredInReplyTo` comes from the requester's own mail client and may arrive
 * bare. RFC 5322 requires `msg-id = "<" id-left "@" id-right ">"`, and this
 * header rides on the acknowledgement — the FIRST thing an emailing requester
 * ever receives. If their client fails to match it, their reply opens a new
 * ticket instead of threading onto this one, which is the whole thing cards 1.33
 * and 1.35 were built to prevent.
 *
 * Driven through the real service rather than the util, because the defect was
 * never in `normalizeMessageId` — it was in one call site not using it.
 */
describe('outbound In-Reply-To bracketing', () => {
  const THREAD = {
    id: 'thread-1',
    ticketId: 't-1',
    replyToken: 'abc123',
    canonicalSubject: 'Printer offline',
    rootInboundMessageId: null,
    lastInboundMessageId: null,
    lastOutboundMessageId: null,
  };

  function buildService() {
    const prisma = {
      ticketEmailThread: {
        findUnique: jest.fn().mockResolvedValue(THREAD),
        create: jest.fn().mockResolvedValue(THREAD),
        update: jest.fn().mockResolvedValue(THREAD),
      },
      // No prior ancestry, so what lands in References comes only from this
      // call's own inputs - which is exactly what is under test.
      inboundEmailReceipt: { findMany: jest.fn().mockResolvedValue([]) },
      notificationOutbox: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const config = {
      get: jest.fn((key: string) =>
        key === 'SMTP_REPLY_TO' ? 'helpdesk@csnhc.com' : undefined,
      ),
    } as unknown as ConfigService;
    return new TicketEmailThreadService(prisma, config);
  }

  const build = (preferredInReplyTo: string | null | undefined) =>
    buildService().buildOutboundEmailContext({
      ticketId: 't-1',
      ticketSubject: 'Printer offline',
      ticketDisplayId: 'IS_20260904_001',
      ticketNumber: 1,
      preferredInReplyTo,
    });

  it('brackets a BARE inbound id, in both headers', async () => {
    const ctx = await build('bare-id-123@mail.example');
    expect(ctx.emailMetadata.inReplyTo).toBe('<bare-id-123@mail.example>');
    expect(ctx.emailMetadata.references).toContain(
      '<bare-id-123@mail.example>',
    );
    // and never the bare form alongside it
    expect(ctx.emailMetadata.references).not.toContain(
      'bare-id-123@mail.example',
    );
  });

  it('leaves an ALREADY bracketed id alone, never <<id>>', async () => {
    const ctx = await build('<already@mail.example>');
    expect(ctx.emailMetadata.inReplyTo).toBe('<already@mail.example>');
    expect(ctx.emailMetadata.inReplyTo).not.toContain('<<');
    expect(
      (ctx.emailMetadata.references ?? []).some((id) => id.includes('<<')),
    ).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['whitespace', '   '],
  ])(
    'falls through to pickInReplyTo for %s, and emits no empty brackets',
    async (_label, value) => {
      const ctx = await build(value);
      // Whatever it picked, it must not be the empty-bracket artefact this
      // card's normalisation could have introduced.
      expect(ctx.emailMetadata.inReplyTo).not.toBe('<>');
      expect(ctx.emailMetadata.references ?? []).not.toContain('<>');
      expect(ctx.emailMetadata.references ?? []).not.toContain('');
    },
  );

  it('still filters a BARE unroutable id out of References', async () => {
    // The ordering check the card asks about: normalisation happens first, so
    // the filter sees `<abc@localhost>`. isUnroutableMessageId matches
    // /@localhost>?\s*$/ and therefore tolerates the trailing bracket - a bare
    // unroutable id is still dropped after bracketing.
    const ctx = await build('abc@localhost');
    expect(ctx.emailMetadata.inReplyTo).toBe('<abc@localhost>');
    expect(
      (ctx.emailMetadata.references ?? []).some((id) =>
        id.includes('@localhost'),
      ),
    ).toBe(false);
  });
});
