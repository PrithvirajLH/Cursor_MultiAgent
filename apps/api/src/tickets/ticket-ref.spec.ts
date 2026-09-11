import { isUuid, ticketRefWhere } from './ticket-ref.util';

const UUID = '7fe5d219-4b3c-4a2f-9f3a-1c2d3e4f5a6b';

describe('ticketRefWhere (card 2.12)', () => {
  it('reads a uuid as the id column', () => {
    expect(ticketRefWhere(UUID)).toEqual({ id: UUID });
  });

  it('⚠️ reads anything else as the display id column', () => {
    // No second query, no fallback: a display-id link would otherwise pay for
    // a failed id lookup first, on the hottest read path there is.
    expect(ticketRefWhere('IT-0042')).toEqual({ displayId: 'IT-0042' });
  });

  it('is case-insensitive about the uuid form', () => {
    expect(ticketRefWhere(UUID.toUpperCase())).toEqual({
      id: UUID.toUpperCase(),
    });
  });

  it('does not mistake a display id that contains hyphens', () => {
    expect(ticketRefWhere('PA-2026-08-29-021')).toEqual({
      displayId: 'PA-2026-08-29-021',
    });
  });
});

describe('isUuid', () => {
  it('accepts the canonical form', () => {
    expect(isUuid(UUID)).toBe(true);
  });

  it('rejects a near miss rather than guessing', () => {
    expect(isUuid(UUID.slice(0, -1))).toBe(false);
    expect(isUuid(`${UUID}x`)).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});
