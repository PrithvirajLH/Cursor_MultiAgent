import { buildThreadIndex } from './email-threading.util';

describe('buildThreadIndex (card 1.66)', () => {
  const token = 'efda930ef729d3760039e5167ceed151dbb0';

  it('is stable for a token, so every email on a ticket groups', () => {
    expect(buildThreadIndex(token)).toBe(buildThreadIndex(token));
  });

  it('differs between tickets, so two tickets are two conversations', () => {
    expect(buildThreadIndex(token)).not.toBe(buildThreadIndex(`${token}x`));
  });

  it('decodes to a 22-byte ConversationIndex root block', () => {
    const bytes = Buffer.from(buildThreadIndex(token), 'base64');
    expect(bytes).toHaveLength(22);
  });

  it('starts with the version byte Outlook expects', () => {
    const bytes = Buffer.from(buildThreadIndex(token), 'base64');
    expect(bytes[0]).toBe(1);
  });

  it('is valid base64 that round-trips unchanged', () => {
    const value = buildThreadIndex(token);
    expect(Buffer.from(value, 'base64').toString('base64')).toBe(value);
  });

  it('does not throw on an empty token', () => {
    expect(() => buildThreadIndex('')).not.toThrow();
    expect(Buffer.from(buildThreadIndex(''), 'base64')).toHaveLength(22);
  });
});
