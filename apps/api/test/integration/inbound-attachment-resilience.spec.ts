import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { InboundEmailService } from '../../src/tickets/inbound-email.service';
import { createTestApp } from '../utils/test-app';

const INBOUND_SECRET = 'test-inbound-secret';

/** A tiny valid attachment payload. */
const file = (fileName: string, bytes: number) => {
  const buffer = Buffer.alloc(bytes, 'a');
  return {
    fileName,
    contentType: 'text/plain',
    sizeBytes: buffer.length,
    contentBase64: buffer.toString('base64'),
  };
};

/**
 * Card 1.105 — one bad attachment must not lose the whole email.
 *
 * ⚠️ `normalizeInboundEmailAttachments` was the FIRST call in the try block,
 * ahead of the requester, the thread target and the ticket, and it threw. So
 * exceeding a limit discarded the entire email — the person's words included —
 * and on the mailbox path the message stayed in the Inbox and was re-offered
 * every thirty seconds, failing identically each time, with only a counter as
 * the signal.
 *
 * ⚠️ TEN IS LOWER THAN IT SOUNDS. A corporate Outlook signature is routinely
 * three to five inline images, so a requester replying with six screenshots is
 * over the limit before attaching anything unusual.
 */
describe('an attachment problem never loses the email (card 1.105)', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  let seq = 0;
  const send = async (body: Record<string, unknown>) => {
    seq += 1;
    return request(server)
      .post('/api/tickets/inbound-email')
      .set('x-inbound-email-secret', INBOUND_SECRET)
      .send({
        messageId: `c1105-${Date.now()}-${seq}@example.com`,
        fromEmail: 'sender@company.com',
        fromName: 'Sender',
        subject: 'inbound with attachments',
        body: 'THE SENDER WORDS THAT MUST SURVIVE',
        ...body,
      });
  };

  const ticketOf = async (res: request.Response) => {
    // The endpoint answers `{ threaded, ticket }`.
    const body = res.body as {
      ticket?: { id: string };
      data?: { ticket?: { id: string } };
    };
    const id = body.ticket?.id ?? body.data?.ticket?.id;
    return getPrisma().ticket.findUniqueOrThrow({
      where: { id: id as string },
      select: { id: true, subject: true, description: true },
    });
  };

  const droppedEvent = (ticketId: string) =>
    getPrisma().ticketEvent.findFirst({
      where: { ticketId, type: 'INBOUND_ATTACHMENTS_DROPPED' },
      select: { payload: true },
    });

  it('⚠️ twelve attachments: the ticket is created, ten are saved, two are recorded', async () => {
    // THE ASSERTION THE CARD EXISTS FOR. Before the fix this returned 400 and
    // the email - words and all - was gone.
    const res = await send({
      attachments: Array.from({ length: 12 }, (_, i) => file(`file-${i}.txt`, 16)),
    });
    expect(res.status).toBeLessThan(400);

    const ticket = await ticketOf(res);
    expect(ticket.description).toContain('THE SENDER WORDS THAT MUST SURVIVE');

    const saved = await getPrisma().attachment.count({
      where: { ticketId: ticket.id },
    });
    expect(saved).toBe(10);

    const event = await droppedEvent(ticket.id);
    expect(event).not.toBeNull();
    const payload = event?.payload as { count: number; files: { fileName: string; reason: string }[] };
    expect(payload.count).toBe(2);
    // ⚠️ The agent has to be able to read this and ask for the file again.
    expect(payload.files[0].reason).toMatch(/more than 10 attachments/i);
    expect(payload.files[0].fileName).toBeTruthy();
  }, 60_000);

  it('⚠️ one oversized file still creates the ticket, and says which file went', async () => {
    // The second cliff: `attachInboundEmailAttachments` used Promise.all over a
    // throwing size check, so one big file rejected the batch AFTER the ticket
    // existed.
    //
    // ⚠️ DRIVEN THROUGH THE SERVICE, NOT THE HTTP ROUTE, and deliberately.
    // A file big enough to exceed the attachment ceiling is also big enough for
    // express to refuse the request body with a 413 before any of this code
    // runs - so over HTTP this branch cannot be reached honestly at all. The
    // mailbox worker calls this same method directly, which is the path that
    // actually carries large files in production.
    const inbound = app.get(InboundEmailService);
    // ⚠️ SIX MEGABYTES, BECAUSE .env.test PINS ATTACHMENTS_MAX_MB=5 AND
    // ConfigService SNAPSHOTS IT AT IMPORT. Setting the variable in `beforeAll`
    // looks like it works and does nothing - the snapshot is already taken. So
    // the fixture exceeds the real configured ceiling instead of pretending to
    // lower it.
    const oversized = Buffer.alloc(6 * 1024 * 1024, 'a');
    const result = await inbound.ingestInboundEmailMessage({
      messageId: `c1105-oversized-${Date.now()}@example.com`,
      fromEmail: 'sender@company.com',
      fromName: 'Sender',
      subject: 'one big file',
      body: 'THE SENDER WORDS THAT MUST SURVIVE',
      attachments: [
        {
          fileName: 'small.txt',
          contentType: 'text/plain',
          sizeBytes: 16,
          contentBase64: Buffer.alloc(16, 'a').toString('base64'),
        },
        {
          // .txt, not .bin: an unknown extension is refused for its TYPE, which
          // is a different branch. This test is about SIZE.
          fileName: 'huge.txt',
          contentType: 'text/plain',
          sizeBytes: oversized.length,
          contentBase64: oversized.toString('base64'),
        },
      ],
    } as never);

    const ticketId = (result as { ticket: { id: string } }).ticket.id;
    const ticket = await getPrisma().ticket.findUniqueOrThrow({
      where: { id: ticketId },
      select: { description: true },
    });
    expect(ticket.description).toContain('THE SENDER WORDS THAT MUST SURVIVE');

    const saved = await getPrisma().attachment.findMany({
      where: { ticketId },
      select: { fileName: true },
    });
    expect(saved.map((a) => a.fileName)).toContain('small.txt');
    expect(saved.map((a) => a.fileName)).not.toContain('huge.txt');

    const payload = (await droppedEvent(ticketId))?.payload as {
      files: { fileName: string; reason: string }[];
    };
    expect(payload.files.map((f) => f.fileName)).toContain('huge.txt');
    expect(payload.files[0].reason).toMatch(/exceed|limit|MB/i);
  }, 120_000);

  it('a 250-character subject creates the ticket with a truncated subject', async () => {
    // `Ticket.subject` is VarChar(200), so this used to raise Prisma P2000 and
    // take the email with it. "FW: RE: FW:" chains reach this easily.
    const long = 'S'.repeat(250);
    const res = await send({ subject: long });
    expect(res.status).toBeLessThan(400);

    const ticket = await ticketOf(res);
    expect(ticket.subject.length).toBeLessThanOrEqual(200);
    expect(ticket.subject.startsWith('SSS')).toBe(true);
  }, 60_000);

  it('a normal email with two small attachments is completely unaffected', async () => {
    // Non-vacuity. Everything above could pass while ordinary mail broke.
    const res = await send({
      subject: 'an ordinary email',
      attachments: [file('one.txt', 16), file('two.txt', 16)],
    });
    expect(res.status).toBeLessThan(400);

    const ticket = await ticketOf(res);
    const saved = await getPrisma().attachment.count({
      where: { ticketId: ticket.id },
    });
    expect(saved).toBe(2);
    // ⚠️ And NO dropped-files note, or every clean email would carry a scary
    // event nobody should be reading.
    expect(await droppedEvent(ticket.id)).toBeNull();
  }, 60_000);
});
