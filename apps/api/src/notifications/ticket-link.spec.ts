import { readFileSync } from 'fs';
import { join } from 'path';
import { ticketLink } from './ticket-link.util';

const UUID = '7fe5d219-4b3c-4a2f-9f3a-1c2d3e4f5a6b';

/** Source with comments stripped, so an assertion cannot match a comment. */
function codeOnly(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('ticketLink (card 2.12)', () => {
  it('⚠️ links by display id, which is the point of the card', () => {
    expect(
      ticketLink('https://tickets.example.com', {
        id: UUID,
        displayId: 'IT-0042',
      }),
    ).toBe('https://tickets.example.com/tickets/IT-0042');
  });

  it('⚠️ falls back to the uuid when a ticket has no display id', () => {
    // The column is nullable. /tickets/undefined would be worse than ugly.
    expect(ticketLink('https://tickets.example.com', { id: UUID })).toBe(
      `https://tickets.example.com/tickets/${UUID}`,
    );
    expect(
      ticketLink('https://tickets.example.com', { id: UUID, displayId: null }),
    ).toBe(`https://tickets.example.com/tickets/${UUID}`);
  });

  it('trims a trailing slash off the base', () => {
    expect(
      ticketLink('https://tickets.example.com/', {
        id: UUID,
        displayId: 'IT-1',
      }),
    ).toBe('https://tickets.example.com/tickets/IT-1');
  });

  it('falls back to the dev origin when WEB_APP_URL is unset', () => {
    expect(ticketLink(undefined, { id: UUID, displayId: 'IT-1' })).toBe(
      'http://localhost:5173/tickets/IT-1',
    );
  });
});

describe('⚠️ the two services cannot drift apart again (card 2.12)', () => {
  // `ticketLink` was written TWICE, identically, in these two files. One rule
  // in two places is the drift behind cards 1.36, 1.38, 1.47, 1.50, 1.61, 1.70,
  // 1.71 and 1.75. This is the assertion that stops a third copy appearing.
  const files = [
    'notifications.service.ts',
    '../slas/sla-breach.service.ts',
  ] as const;

  it.each(files)('%s has no ticketLink of its own', (file) => {
    const source = codeOnly(file);
    expect(source).not.toMatch(/private\s+ticketLink\s*\(/);
    expect(source).not.toMatch(/\/tickets\/\$\{/);
  });

  it.each(files)('%s imports the shared one', (file) => {
    expect(codeOnly(file)).toMatch(/import \{ ticketLink \} from/);
  });
});
