import {
  buildOutboundMessageId,
  buildTicketRootMessageId,
  extractOutboxIdsFromThreadHeaders,
  extractReplyTokensFromThreadHeaders,
  isUnroutableMessageId,
} from './email-threading.util';

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8';
const REPLY_ADDRESS = `helpdesk+ticket-${TOKEN}@csnhc.com`;

describe('buildTicketRootMessageId', () => {
  it('derives one stable id per ticket', () => {
    expect(buildTicketRootMessageId(TOKEN, REPLY_ADDRESS)).toBe(
      `<ticket.${TOKEN}@csnhc.com>`,
    );
  });

  it('returns the same id every time it is called', () => {
    // The point of deriving rather than storing: there is no state to drift,
    // and a failed send cannot leave a different value behind.
    const first = buildTicketRootMessageId(TOKEN, REPLY_ADDRESS);
    const second = buildTicketRootMessageId(TOKEN, REPLY_ADDRESS);
    expect(first).toBe(second);
  });

  it('degrades exactly the way the outbound helper does with no reply address', () => {
    expect(buildTicketRootMessageId(TOKEN, undefined)).toBe(
      `<ticket.${TOKEN}@localhost>`,
    );
    expect(buildTicketRootMessageId(TOKEN, '')).toBe(
      `<ticket.${TOKEN}@localhost>`,
    );
    // And that degraded form is recognisable as unusable, which is what stops
    // it being persisted or emitted.
    expect(isUnroutableMessageId(buildTicketRootMessageId(TOKEN, null))).toBe(
      true,
    );
  });
});

describe('isUnroutableMessageId', () => {
  it('rejects a localhost id however it is written', () => {
    expect(isUnroutableMessageId('<outbox.abc@localhost>')).toBe(true);
    expect(isUnroutableMessageId('<outbox.abc@LOCALHOST>')).toBe(true);
    expect(isUnroutableMessageId('  <ticket.x@localhost> ')).toBe(true);
    expect(isUnroutableMessageId(null)).toBe(true);
    expect(isUnroutableMessageId('')).toBe(true);
  });

  it('accepts a real domain', () => {
    expect(isUnroutableMessageId('<ticket.abc@csnhc.com>')).toBe(false);
    expect(isUnroutableMessageId(`<ticket.${TOKEN}@csnhc.com>`)).toBe(false);
  });

  it('does not mistake a hostname that merely contains localhost', () => {
    expect(isUnroutableMessageId('<x@localhost.csnhc.com>')).toBe(false);
  });
});

describe('extractReplyTokensFromThreadHeaders', () => {
  it('finds the root id an inbound reply quoted', () => {
    const references = `<ticket.${TOKEN}@csnhc.com> <other@example.com>`;
    expect(extractReplyTokensFromThreadHeaders(null, references)).toEqual([
      TOKEN,
    ]);
  });

  it('finds it in In-Reply-To as well', () => {
    expect(
      extractReplyTokensFromThreadHeaders(
        `<ticket.${TOKEN}@csnhc.com>`,
        undefined,
      ),
    ).toEqual([TOKEN]);
  });

  it('ignores an outbox id, which the other extractor owns', () => {
    const outbox = '<outbox.11111111-1111-4111-8111-111111111111@csnhc.com>';
    expect(extractReplyTokensFromThreadHeaders(outbox, null)).toEqual([]);
  });

  it('returns nothing for headers that carry no root', () => {
    expect(extractReplyTokensFromThreadHeaders(null, undefined)).toEqual([]);
    expect(extractReplyTokensFromThreadHeaders('<someone@example.com>')).toEqual(
      [],
    );
  });

  it('de-duplicates a root quoted more than once', () => {
    const references = `<ticket.${TOKEN}@csnhc.com> <ticket.${TOKEN}@csnhc.com>`;
    expect(extractReplyTokensFromThreadHeaders(references)).toEqual([TOKEN]);
  });
});

describe('the two extractors stay out of each other/s way', () => {
  it('resolves both shapes from one References header', () => {
    const outboxId = '11111111-1111-4111-8111-111111111111';
    const references = [
      buildTicketRootMessageId(TOKEN, REPLY_ADDRESS),
      buildOutboundMessageId(outboxId, REPLY_ADDRESS),
    ].join(' ');
    expect(extractReplyTokensFromThreadHeaders(references)).toEqual([TOKEN]);
    expect(extractOutboxIdsFromThreadHeaders(references)).toEqual([outboxId]);
  });
});
