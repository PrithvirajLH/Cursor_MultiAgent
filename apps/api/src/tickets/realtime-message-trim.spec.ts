import { MessageType } from '@prisma/client';
import { AccessControlService } from '../common/access-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TicketRealtimeService } from './ticket-realtime.service';

/**
 * Card 1.75 — the socket push must trim exactly like the fetch path.
 *
 * Card 1.62 wired `stripQuotedReply` into `listMessages`, calling it "the single
 * message-read path". It is not: `toRealtimeMessagePayload` is the other one,
 * and it pushed the body raw. Observed in production 2026-09-11 on
 * PA_20260910_381 — 1655 characters arrived on an open ticket where 192 were
 * fetched, so the message silently corrected itself on the next page load.
 *
 * These cases fail if that line is ever unwired again.
 */
describe('toRealtimeMessagePayload trims quoted replies (card 1.75)', () => {
  const author = {
    id: 'u1',
    email: 'prithviraj_hulgur@csnhc.com',
    displayName: 'Prithviraj Hulgur',
  };
  /** The real shape, once card 1.62 has converted the HTML to text. */
  const INBOUND_REPLY = [
    "I still don't see it on my end.",
    '',
    'Thank you,',
    'Prithviraj Hulgur',
    '',
    'From: Prithviraj Hulgur <Prithviraj_Hulgur@csnhc.com>',
    'Sent: Thursday, September 10, 2026 1:59 PM',
    'To: glovebox+ticket-efda930e@csnhc.com',
    '',
    '----- Reply above this line -----',
    '',
    '[pilot mode] EMAIL_TEST_RECIPIENTS is set',
    '!!! WARNING !!!',
    'THIS MESSAGE IS CONFIDENTIAL',
  ].join('\n');
  const KEPT = [
    "I still don't see it on my end.",
    '',
    'Thank you,',
    'Prithviraj Hulgur',
  ].join('\n');
  let service: TicketRealtimeService;

  beforeEach(() => {
    service = new TicketRealtimeService(
      {} as unknown as PrismaService,
      {} as unknown as RealtimeService,
      new AccessControlService(),
    );
  });

  function push(body: string, type: MessageType = MessageType.PUBLIC) {
    return service.toRealtimeMessagePayload({
      id: 'm1',
      body,
      type,
      createdAt: new Date('2026-09-11T15:47:47.939Z'),
      author,
    });
  }

  it('keeps only what the sender typed', () => {
    expect(push(INBOUND_REPLY).body).toBe(KEPT);
  });

  it('pushes nothing the fetch path would hide', () => {
    const { body } = push(INBOUND_REPLY);
    expect(body).not.toContain('pilot mode');
    expect(body).not.toContain('CONFIDENTIAL');
    expect(body).not.toContain('Reply above this line');
    expect(body).not.toContain('Sent: Thursday');
  });

  it("leaves an agent's own note byte-identical", () => {
    const note = 'Checked with Finance.\n\nThey will confirm tomorrow.';
    expect(push(note, MessageType.INTERNAL).body).toBe(note);
  });

  it('carries the rest of the payload through untouched', () => {
    const payload = push(INBOUND_REPLY);
    expect(payload.id).toBe('m1');
    expect(payload.type).toBe(MessageType.PUBLIC);
    expect(payload.author.email).toBe('prithviraj_hulgur@csnhc.com');
    expect(payload.createdAt).toBe('2026-09-11T15:47:47.939Z');
  });
});

/**
 * Card 1.135 — and the same method had a second one of these.
 *
 * Card 1.129 stores an emailed body carrying `[[cid:...]]` markers, because at
 * that moment the files have no ids, then swaps them for real
 * `<img data-attachment-id>` once they do. `addMessage` pushes the message
 * BETWEEN those two steps, so whoever had the ticket open read
 * `[[cid:5f02c6aa-2131-403d-b060-0eeb65adf606]]` as literal text while whoever
 * opened it later saw the picture. Observed in production 2026-09-17 on
 * PA_20260910_381 — the same ticket, in the same method, as card 1.75.
 */
describe('toRealtimeMessagePayload hides unresolved image markers (card 1.135)', () => {
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

  function push(body: string, type: MessageType = MessageType.PUBLIC) {
    return service.toRealtimeMessagePayload({
      id: 'm1',
      body,
      type,
      createdAt: new Date('2026-09-17T15:35:03.000Z'),
      author,
    });
  }

  /** The body exactly as it is stored between the two ingest steps. */
  const MID_INGEST = [
    'Yes I am still seeing this error, when I login',
    '',
    '[[cid:5f02c6aa-2131-403d-b060-0eeb65adf606]]',
    '',
    'Thank you,',
    'Prithviraj Hulgur',
  ].join('\n');

  it('⚠️ never pushes a raw marker', () => {
    expect(push(MID_INGEST).body).not.toContain('[[cid:');
  });

  it('draws a placeholder where the picture will be', () => {
    const { body } = push(MID_INGEST);
    expect(body).toContain('data-attachment-pending');
    // In position: the sentence above it, the signature below.
    expect(body.indexOf('still seeing this error')).toBeLessThan(
      body.indexOf('data-attachment-pending'),
    );
    expect(body.indexOf('data-attachment-pending')).toBeLessThan(
      body.indexOf('Thank you,'),
    );
  });

  it('keeps the words around it', () => {
    const { body } = push(MID_INGEST);
    expect(body).toContain('Yes I am still seeing this error, when I login');
    expect(body).toContain('Prithviraj Hulgur');
  });

  it('replaces every marker, not just the first', () => {
    const two = '[[cid:one]] and [[cid:two]]';
    const { body } = push(two);
    expect(body).not.toContain('[[cid:');
    expect(body.match(/data-attachment-pending/g)).toHaveLength(2);
  });

  it('leaves a body with no markers byte-identical', () => {
    const plain = 'Just a sentence.';
    expect(push(plain).body).toBe(plain);
  });

  it('⚠️ still trims the quoted reply as well', () => {
    // Non-vacuity for card 1.75: adding the second transform must not have
    // displaced the first. Both run, in that order.
    const withQuote = [
      '[[cid:abc]]',
      '',
      '----- Reply above this line -----',
      'THIS MESSAGE IS CONFIDENTIAL',
    ].join('\n');
    const { body } = push(withQuote);
    expect(body).toContain('data-attachment-pending');
    expect(body).not.toContain('[[cid:');
    expect(body).not.toContain('CONFIDENTIAL');
  });
});
