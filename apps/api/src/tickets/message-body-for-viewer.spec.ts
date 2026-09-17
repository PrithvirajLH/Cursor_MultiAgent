import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MessageType } from '@prisma/client';
import { AccessControlService } from '../common/access-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { messageBodyForViewer } from './message-body-for-viewer.util';
import { TicketRealtimeService } from './ticket-realtime.service';

/**
 * Card 1.139 — one message shape, so a display rule cannot be written once.
 *
 * ⚠️ THE FAULT THIS CARD FOUND RUNS THE OPPOSITE WAY TO THE FOUR BEFORE IT.
 * Cards 1.62 and 1.75 fixed a socket path that lagged the fetch path. Card
 * 1.135 added `markInlineImagesPending` to the socket path - and never to the
 * fetch path, which had exactly one caller when this card opened. So whoever
 * had a ticket OPEN saw a tidy placeholder and whoever OPENED it read
 * `[[cid:...]]` as literal text.
 */
describe('one message, both routes (card 1.139)', () => {
  const author = {
    id: 'u1',
    email: 'prithviraj_hulgur@csnhc.com',
    displayName: 'Prithviraj Hulgur',
  };

  let service: TicketRealtimeService;

  beforeEach(() => {
    service = new TicketRealtimeService(
      {} as unknown as PrismaService,
      {} as unknown as RealtimeService,
      new AccessControlService(),
    );
  });

  /** What a viewer with the ticket OPEN receives. */
  function overTheSocket(body: string): string {
    return service.toRealtimeMessagePayload({
      id: 'm1',
      body,
      type: MessageType.PUBLIC,
      createdAt: new Date('2026-09-17T13:05:00.000Z'),
      author,
    }).body;
  }

  /** What a viewer who OPENS the ticket receives - `listMessages`' transform. */
  function overHttp(body: string): string {
    return messageBodyForViewer(body);
  }

  /** A reply carrying every historical fault at once. */
  const STORED = [
    'Here is the screenshot you asked for.',
    '',
    '[[cid:5f02c6aa-3d21-4a8b-9c17-2e0b7a6d4f18]]',
    '',
    'Thank you,',
    'Prithviraj Hulgur',
    '',
    'From: Service Desk <glovebox@csnhc.com>',
    '----- Reply above this line -----',
    '',
    '[pilot mode] EMAIL_TEST_RECIPIENTS is set',
    'THIS MESSAGE IS CONFIDENTIAL',
  ].join('\n');

  it('⚠️ the same message reads identically whether it arrives or is fetched', () => {
    // THE ASSERTION THIS CARD EXISTS FOR, and it is driven from ONE stored body
    // through both routes rather than from two hand-written expectations -
    // which would have been the fifth copy of the rule.
    expect(overTheSocket(STORED)).toBe(overHttp(STORED));
  });

  it('⚠️ neither route leaks the quoted thread (card 1.75 returning)', () => {
    for (const rendered of [overTheSocket(STORED), overHttp(STORED)]) {
      expect(rendered).toContain('Here is the screenshot you asked for.');
      expect(rendered).not.toContain('Reply above this line');
      expect(rendered).not.toContain('pilot mode');
      expect(rendered).not.toContain('CONFIDENTIAL');
    }
  });

  it('⚠️ neither route shows a raw marker (cards 1.135 and 1.139 returning)', () => {
    // The fetch half of this is the new one: before card 1.139 `overHttp`
    // returned the `[[cid:...]]` text verbatim.
    for (const rendered of [overTheSocket(STORED), overHttp(STORED)]) {
      expect(rendered).not.toContain('[[cid:');
      expect(rendered).not.toContain('5f02c6aa');
      expect(rendered).toContain('data-attachment-pending="1"');
    }
  });

  it('an ordinary message is passed through untouched by both', () => {
    // NON-VACUITY. A body with no quote, no marker and no image must come back
    // exactly as stored - a transform that rewrote plain text would be worse
    // than the bug.
    const plain = 'Can you reset my Kronos password please?';
    expect(overTheSocket(plain)).toBe(plain);
    expect(overHttp(plain)).toBe(plain);
  });

  it('a body that is only a marker still renders something', () => {
    expect(overHttp('[[cid:abc]]')).toBe(
      '<img data-attachment-pending="1" alt="image">',
    );
  });
});

/**
 * ⚠️ THE POINT OF THE CARD IS THAT THERE IS ONE IMPLEMENTATION, AND ONLY THE
 * SOURCE CAN SHOW THAT.
 *
 * A test comparing two implementations still leaves two implementations - the
 * card says so outright. These assertions fail the moment a route grows its own
 * copy of a display rule again, which is the thing that happened four times.
 */
describe('both routes call the one function', () => {
  const source = (file: string) =>
    readFileSync(join(__dirname, file), 'utf8');

  const ROUTES = ['tickets.service.ts', 'ticket-realtime.service.ts'];

  for (const file of ROUTES) {
    it(`${file} builds its body with messageBodyForViewer`, () => {
      expect(source(file)).toContain('messageBodyForViewer(message.body)');
    });

    it(`⚠️ ${file} does not transform a body on its own`, () => {
      // Finding either util called directly here means the rule has been
      // written twice again.
      const text = source(file)
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .join('\n');
      expect(text).not.toContain('stripQuotedReply(');
      expect(text).not.toContain('markInlineImagesPending(');
    });
  }
});

/**
 * ⚠️ CARD 1.83 ON BOTH ROUTES, WHICH THE CARD SAYS HAS NEVER BEEN VERIFIED.
 *
 * It holds. An internal note is filtered where messages are SELECTED, not where
 * a body is transformed: `listMessages` narrows its `where` to PUBLIC for
 * anyone who may not read internal notes, and both socket pushes send
 * `message: null` unless the message is PUBLIC. So a requester with the ticket
 * open is told something changed and receives no internal body.
 */
describe('an internal note reaches neither route as a body', () => {
  const at = (file: string) =>
    readFileSync(join(__dirname, file), 'utf8');

  it('⚠️ the message-added push carries a body only when PUBLIC', () => {
    expect(at('tickets.service.ts')).toContain(
      'message.type === MessageType.PUBLIC\n            ? this.ticketRealtime.toRealtimeMessagePayload(message)\n            : null,',
    );
  });

  it('⚠️ the inbound marker-resolution push carries one only when PUBLIC', () => {
    // The second push, added by card 1.135 so a placeholder becomes the real
    // picture. It had to learn the same rule.
    expect(at('inbound-email.service.ts')).toContain(
      'message.type === MessageType.PUBLIC && message.author',
    );
  });

  it('⚠️ the fetch path narrows to PUBLIC for anyone who may not read notes', () => {
    expect(at('tickets.service.ts')).toContain(
      '? {}\n        : { type: MessageType.PUBLIC }',
    );
  });
});
