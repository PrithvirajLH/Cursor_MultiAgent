import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { InboundEmailService } from '../../src/tickets/inbound-email.service';
import { TicketRealtimeService } from '../../src/tickets/ticket-realtime.service';
import { TicketsService } from '../../src/tickets/tickets.service';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

const inboundSecretHeader = { 'x-inbound-email-secret': 'test-inbound-secret' };

function authHeader(email: string) {
  return { 'x-user-email': email };
}

/** The realtime service a given service actually pushes through. */
function realtimeHeldBy(owner: unknown): TicketRealtimeService {
  return (owner as { ticketRealtime: TicketRealtimeService }).ticketRealtime;
}

type PushedMessage = {
  id: string;
  attachments: { id: string; fileName: string; sizeBytes: number }[];
} | null;

/**
 * Card 1.137 — a file that arrives live gets its chip without a reload.
 *
 * ⚠️ THE ORDERING IS THE WHOLE PROBLEM, NOT THE PAYLOAD SHAPE. `addMessage`
 * pushes the message and returns; `attachInboundEmailAttachments` stores the
 * files afterwards. So the first push cannot carry them however the payload is
 * typed, and card 1.135's second push only fired when the BODY changed - which
 * a paperclip document never does. This asserts the second push now fires for
 * one and carries it.
 */
describe('a file on an emailed reply is pushed, not waited for (card 1.137)', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  }, 180_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  /** A ticket the fixture requester can reply to by email. */
  async function ticketToReplyTo(): Promise<{ id: string; displayId: string }> {
    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: `card 1.137 ${Date.now()}`,
        description: 'a ticket that will receive an emailed file',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    const body = created.body as { id: string; displayId: string };
    await request(server)
      .post(`/api/tickets/${body.id}/assign`)
      .set(authHeader(fixtureEmails.owner))
      .send({ assigneeId: fixtureUserIds.agent })
      .expect(201);
    return body;
  }

  /**
   * Every `message_added` push for one ticket.
   *
   * Spied rather than observed on a socket, exactly as `sla-realtime.spec.ts`
   * does it: realtime is switched off in tests, so what is assertable is that
   * the service ASKS to publish - the part this code owns.
   */
  function watchPushes(ticketId: string) {
    // ⚠️ SPY ON THE INSTANCES THE SERVICES HOLD, NOT THE ONE THE INJECTOR
    // HANDS BACK. Measured here: `app.get(TicketRealtimeService)` and
    // `app.select(TicketsModule).get(...)` are the SAME object, and
    // `TicketsService`'s own `ticketRealtime` is a THIRD one - almost certainly
    // a second instantiation caused by the `forwardRef` cycle between
    // `TicketsService` and `InboundEmailService`. Spying the injector's copy
    // records nothing and reads exactly like "no push was sent", which cost an
    // hour before it was measured rather than assumed.
    //
    // Both are watched because the two pushes come from different services: the
    // first from `addMessage`, the second from the inbound ingest.
    const held = [
      realtimeHeldBy(app.get(TicketsService)),
      realtimeHeldBy(app.get(InboundEmailService)),
    ];
    const spies = [...new Set(held)].map((instance) =>
      jest
        .spyOn(instance, 'emitTicketRealtimeEvent')
        .mockResolvedValue(undefined),
    );
    return () =>
      spies
        .flatMap((spy) => spy.mock.calls)
        .filter(
          ([params]) =>
            params.ticketId === ticketId && params.reason === 'message_added',
        )
        .map(([params]) => params.message as PushedMessage);
  }

  async function emailIn(
    displayId: string,
    body: string,
    attachments: unknown[],
  ) {
    const res = await request(server)
      .post('/api/tickets/inbound-email')
      .set(inboundSecretHeader)
      .send({
        fromEmail: fixtureEmails.requester,
        fromName: 'Requester',
        subject: `Re: ${displayId} the file you asked for`,
        body,
        messageId: `card-1137-${Date.now()}-${Math.random()}@mail.example`,
        attachments,
      })
      .expect(201);
    // ⚠️ ASSERTED, BECAUSE AN UNTHREADED EMAIL ALSO RETURNS 201 - it just opens
    // a brand new ticket instead. Every push assertion below filters on this
    // ticket's id, so a silent failure to thread would read as "no push was
    // sent" and the whole file would fail for the wrong reason.
    expect((res.body as { threaded: boolean }).threaded).toBe(true);
  }

  /** A small text file, as the webhook carries it. */
  function textFile(fileName: string, contents: string) {
    return {
      fileName,
      contentType: 'text/plain',
      sizeBytes: Buffer.byteLength(contents, 'utf8'),
      contentBase64: Buffer.from(contents, 'utf8').toString('base64'),
    };
  }

  it('⚠️ a paperclip document reaches the open ticket as a chip', async () => {
    // THE ASSERTION THIS CARD EXISTS FOR. Before it, the only push carrying a
    // body fired before the file was stored, and card 1.135's second push was
    // gated on the body changing - which attaching a document never does. So
    // the chip waited for a reload.
    const ticket = await ticketToReplyTo();
    const pushes = watchPushes(ticket.id);
    const contents = `log line ${Date.now()}`;

    await emailIn(ticket.displayId, 'Here is the file.', [
      textFile('inbound-log.txt', contents),
    ]);

    const withFile = pushes().filter(
      (message) => (message?.attachments.length ?? 0) > 0,
    );
    expect(withFile).toHaveLength(1);
    expect(withFile[0]?.attachments[0]?.fileName).toBe('inbound-log.txt');
    expect(withFile[0]?.attachments[0]?.sizeBytes).toBe(
      Buffer.byteLength(contents, 'utf8'),
    );
  });

  it('⚠️ the pushed file is exactly what a reload would show', async () => {
    // "The two paths agree" is the point of cards 1.137 and 1.139 together, so
    // it is asserted rather than assumed.
    const ticket = await ticketToReplyTo();
    const pushes = watchPushes(ticket.id);
    const contents = `second log ${Date.now()}`;

    await emailIn(ticket.displayId, 'And this one.', [
      textFile('second.txt', contents),
    ]);

    const pushed = pushes().find(
      (message) => (message?.attachments.length ?? 0) > 0,
    );
    // ⚠️ THIS GUARD IS NOT DECORATION. Without it the comparison below reads
    // `undefined` on both sides and passes while nothing was pushed at all -
    // which is exactly how this test first went green against a spy watching
    // the wrong instance.
    expect(pushed?.attachments).toHaveLength(1);
    const fetched = await request(server)
      .get(`/api/tickets/${ticket.id}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
    const message = (
      fetched.body as {
        data: { id: string; attachments?: { id: string; fileName: string }[] }[];
      }
    ).data.find((row) => row.id === pushed?.id);

    expect(message?.attachments?.map((file) => file.fileName)).toEqual(
      pushed?.attachments.map((file) => file.fileName),
    );
    expect(message?.attachments?.map((file) => file.id)).toEqual(
      pushed?.attachments.map((file) => file.id),
    );
  });

  it('⚠️ a reply with no file sends no second push', async () => {
    // NON-VACUITY, AND THE COST CONTROL. Almost every inbound email is text:
    // if this fired for those too, the card would have bought a chip at the
    // price of a wasted publish and a database read on every message.
    const ticket = await ticketToReplyTo();
    const pushes = watchPushes(ticket.id);

    await emailIn(ticket.displayId, 'No file on this one, thanks.', []);

    expect(pushes()).toHaveLength(1);
    expect(pushes()[0]?.attachments).toEqual([]);
  });

  it('⚠️ the blob key never rides along on the wire', async () => {
    // `storageKey` names the blob. The fetch path selects rather than includes
    // for exactly this reason, and this is the copy that crosses a network.
    const ticket = await ticketToReplyTo();
    const pushes = watchPushes(ticket.id);
    const contents = `third log ${Date.now()}`;

    await emailIn(ticket.displayId, 'One more.', [
      textFile('third.txt', contents),
    ]);

    const pushed = pushes().find(
      (message) => (message?.attachments.length ?? 0) > 0,
    );
    expect(JSON.stringify(pushed)).not.toContain('storageKey');
    const stored = await prisma.attachment.findFirstOrThrow({
      where: { fileName: 'third.txt' },
      select: { storageKey: true },
    });
    expect(JSON.stringify(pushed)).not.toContain(stored.storageKey);
  });
});
