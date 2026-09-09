import { INestApplication } from '@nestjs/common';
import { OutboxStatus } from '@prisma/client';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { EmailOutboxSweeperService } from '../../src/notifications/email-outbox-sweeper.service';
import { EmailService } from '../../src/notifications/email.service';
import {
  OutboxService,
  REDACTION_CANCELLED_REASON,
} from '../../src/notifications/outbox.service';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

const SECRET = 'Patient 90210 is in bed 4 with the wrong chart';

/**
 * Card 1.47 — redaction must not be outrun by its own email.
 *
 * The defect: `redactMessage` overwrote `TicketMessage.body` and never touched
 * the `NotificationOutbox` row, whose `body` column holds the FULLY RENDERED
 * email. The processor reads that column at send time, so a message redacted
 * while its row was still unsent went out anyway - and the dialog, which
 * counted only SENT rows, showed no warning at all.
 *
 * ⚠️ WHY THESE TESTS FORCE THE ROW TO `PENDING` BY HAND.
 *
 * The handoff says production leaves rows PENDING for up to a minute because
 * "there is no Redis, so the sweeper delivers." That is not what the code does.
 * `EmailQueueService.enqueue` (`:113`) branches on `NOTIFICATIONS_QUEUE_ENABLED`
 * alone - not on whether Redis is reachable - and when the queue is off it
 * calls `processor.process()` INLINE, in the same request. The first test below
 * pins that, because it is the premise everything else rests on. So a naturally
 * occurring PENDING row does not exist in this configuration, and a test that
 * waited for one would be testing nothing.
 *
 * The window is real in any configuration where the queue IS on (BullMQ hands
 * the row to a worker) or where a send is in flight concurrently with a
 * redaction, and the fix has to hold there. Forcing the status is how you write
 * that test without a Redis in the suite.
 */
describe('Redaction stops a queued email (card 1.47)', () => {
  const prisma = getPrisma();
  let app: INestApplication;
  let server: SupertestApp;
  let sweeper: EmailOutboxSweeperService;
  let email: EmailService;
  let sendSpy: jest.SpyInstance;

  let seq = 0;
  const unique = () => {
    seq += 1;
    return `${Date.now()}${seq}`;
  };

  async function plantTicket() {
    return prisma.ticket.create({
      data: {
        subject: `Redaction race ${unique()}`,
        description: 'Fixture',
        requesterId: fixtureUserIds.requester,
        assignedTeamId: fixtureTeamIds.it,
        assigneeId: fixtureUserIds.agent,
        status: 'IN_PROGRESS',
      },
      select: { id: true },
    });
  }

  /** Post a public reply through the real endpoint, so a real row is queued. */
  async function postPublicReply(ticketId: string) {
    const res = await request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.lead))
      .send({ body: SECRET, type: 'PUBLIC' })
      .expect(201);
    return res.body.id as string;
  }

  const outboxFor = (ticketId: string) =>
    prisma.notificationOutbox.findMany({
      where: { ticketId, eventType: 'MESSAGE_ADDED' },
      select: {
        id: true,
        status: true,
        body: true,
        subject: true,
        toEmail: true,
        lastError: true,
        payload: true,
        createdAt: true,
      },
    });

  const redact = (ticketId: string, messageId: string, actor: string) =>
    request(server)
      .delete(`/api/tickets/${ticketId}/messages/${messageId}`)
      .set(authHeader(actor));

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    sweeper = app.get(EmailOutboxSweeperService);
    email = app.get(EmailService);
    // SMTP is deliberately unconfigured in the test environment, so the
    // processor would refuse every send and this suite would pass vacuously
    // with the bug fully present. Make the send path live and watch it.
    jest.spyOn(email, 'isConfigured').mockReturnValue(true);
    sendSpy = jest
      .spyOn(email, 'sendEmail')
      .mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await disconnectPrisma();
  });

  beforeEach(() => {
    sendSpy.mockClear();
  });

  describe('the premise, pinned', () => {
    it('processes inline when the queue is off, so a fresh row is NOT left pending', async () => {
      // The handoff's step 2 says otherwise. This is the assertion that will
      // tell the next person the truth: with NOTIFICATIONS_QUEUE_ENABLED=false
      // - which is what production runs - the row is handled in the same
      // request, and PENDING is momentary after all.
      const ticket = await plantTicket();
      await postPublicReply(ticket.id);
      const rows = await outboxFor(ticket.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).not.toBe(OutboxStatus.PENDING);
    });
  });

  describe('⚠️ redacting while the email is still queued', () => {
    it('stops the send, and the sweeper then has nothing to deliver', async () => {
      const ticket = await plantTicket();
      const messageId = await postPublicReply(ticket.id);
      // Put the row back the way a queue-enabled deployment leaves it.
      await prisma.notificationOutbox.updateMany({
        where: { ticketId: ticket.id, eventType: 'MESSAGE_ADDED' },
        data: { status: OutboxStatus.PENDING, lastError: null, attempts: 0 },
      });
      sendSpy.mockClear();

      const res = await redact(ticket.id, messageId, fixtureEmails.lead).expect(
        200,
      );
      // The whole point of the card: it says it stopped it, and it did.
      expect(res.body.emailsStopped).toBe(1);
      expect(res.body.alreadyEmailed).toBe(false);

      // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. Run the sweeper - the
      // thing that would have delivered - and nothing goes out.
      const summary = await sweeper.runOnce();
      expect(summary?.sent ?? 0).toBe(0);
      expect(sendSpy).not.toHaveBeenCalled();

      const [row] = await outboxFor(ticket.id);
      expect(row.status).toBe(OutboxStatus.FAILED);
      expect(row.lastError).toBe(REDACTION_CANCELLED_REASON);
      // And the words are gone from BOTH halves of the stored email.
      expect(row.body).toBe('');
      expect(JSON.stringify(row.payload)).not.toContain('90210');
      // The audit question still has an answer.
      expect(row.subject).not.toBe('');
      expect(row.toEmail).toBe(fixtureEmails.requester);
    });

    it('records in the timeline that the send was caught', async () => {
      const ticket = await plantTicket();
      const messageId = await postPublicReply(ticket.id);
      await prisma.notificationOutbox.updateMany({
        where: { ticketId: ticket.id, eventType: 'MESSAGE_ADDED' },
        data: { status: OutboxStatus.PENDING, lastError: null, attempts: 0 },
      });
      await redact(ticket.id, messageId, fixtureEmails.lead).expect(200);
      const event = await prisma.ticketEvent.findFirstOrThrow({
        where: { ticketId: ticket.id, type: 'TICKET_MESSAGE_REDACTED' },
        select: { payload: true },
      });
      const payload = event.payload as Record<string, unknown>;
      // "We caught it" has to be distinguishable from "we did not", or the
      // agent cannot tell an awkward apology from a breach report.
      expect(payload.emailsStopped).toBe(1);
      expect(payload.alreadyEmailed).toBe(false);
    });

    it('exposes the queued state to the dialog BEFORE the click', async () => {
      // Without this the dialog shows no caveat at all mid-window, which is
      // the false reassurance the card exists to remove.
      const ticket = await plantTicket();
      await postPublicReply(ticket.id);
      await prisma.notificationOutbox.updateMany({
        where: { ticketId: ticket.id, eventType: 'MESSAGE_ADDED' },
        data: { status: OutboxStatus.PENDING, lastError: null, attempts: 0 },
      });
      const res = await request(server)
        .get(`/api/tickets/${ticket.id}/messages`)
        .set(authHeader(fixtureEmails.lead))
        .expect(200);
      const message = (
        res.body.data as {
          delivery?: { emailed: number; pending: number };
        }[]
      ).at(-1);
      expect(message?.delivery?.pending).toBe(1);
      expect(message?.delivery?.emailed).toBe(0);
    });
  });

  describe('⚠️ when the send got away, it must not claim otherwise', () => {
    it('reports a PROCESSING row as already sent, not as stopped', async () => {
      // The race, from the losing side: the sweeper claimed the row between
      // the read and the write. A conditional update matches nothing, and the
      // honest answer is the third case.
      const ticket = await plantTicket();
      const messageId = await postPublicReply(ticket.id);
      await prisma.notificationOutbox.updateMany({
        where: { ticketId: ticket.id, eventType: 'MESSAGE_ADDED' },
        data: { status: OutboxStatus.PROCESSING },
      });
      const res = await redact(ticket.id, messageId, fixtureEmails.lead).expect(
        200,
      );
      expect(res.body.emailsStopped).toBe(0);
      expect(res.body.alreadyEmailed).toBe(true);
    });

    it('reports a row that was PENDING at read time but claimed before the write', async () => {
      // Simulate losing the race precisely: flip the row to PROCESSING in the
      // middle of the redaction, between the read and the conditional update.
      const ticket = await plantTicket();
      const messageId = await postPublicReply(ticket.id);
      await prisma.notificationOutbox.updateMany({
        where: { ticketId: ticket.id, eventType: 'MESSAGE_ADDED' },
        data: { status: OutboxStatus.PENDING, lastError: null, attempts: 0 },
      });
      const outboxService = app.get(OutboxService);
      const original =
        outboxService.cancelUnsentForRedaction.bind(outboxService);
      const spy = jest
        .spyOn(outboxService, 'cancelUnsentForRedaction')
        .mockImplementation(async (ids: string[]) => {
          // The sweeper gets there first, right between the read and the write.
          await prisma.notificationOutbox.updateMany({
            where: { id: { in: ids } },
            data: { status: OutboxStatus.PROCESSING },
          });
          return original(ids);
        });
      try {
        const res = await redact(
          ticket.id,
          messageId,
          fixtureEmails.lead,
        ).expect(200);
        // Nothing was stopped, and it says so.
        expect(res.body.emailsStopped).toBe(0);
        expect(res.body.alreadyEmailed).toBe(true);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('when the email really has gone', () => {
    it('keeps the "cannot take it back" answer and still scrubs the copy', async () => {
      const ticket = await plantTicket();
      const messageId = await postPublicReply(ticket.id);
      // Let it actually send, through the sweeper, with the spy watching.
      await prisma.notificationOutbox.updateMany({
        where: { ticketId: ticket.id, eventType: 'MESSAGE_ADDED' },
        data: { status: OutboxStatus.PENDING, lastError: null, attempts: 0 },
      });
      await sweeper.runOnce();
      expect(sendSpy).toHaveBeenCalled();
      const [sentRow] = await outboxFor(ticket.id);
      expect(sentRow.status).toBe(OutboxStatus.SENT);

      const res = await redact(ticket.id, messageId, fixtureEmails.lead).expect(
        200,
      );
      expect(res.body.alreadyEmailed).toBe(true);
      expect(res.body.emailsStopped).toBe(0);
      expect(res.body.emailedCount).toBeGreaterThanOrEqual(1);

      // Card 1.11's argument applied to this column: the email is gone, but
      // the transcript does not get to live for ever in a row the retention
      // job is not deleting.
      const [after] = await outboxFor(ticket.id);
      expect(after.body).toBe('');
      expect(JSON.stringify(after.payload)).not.toContain('90210');
      expect(after.status).toBe(OutboxStatus.SENT);
      expect(after.toEmail).toBe(fixtureEmails.requester);
    });
  });

  describe('the cases that must not change', () => {
    it('an internal note queues nothing and reports nothing', async () => {
      const ticket = await plantTicket();
      const res = await request(server)
        .post(`/api/tickets/${ticket.id}/messages`)
        .set(authHeader(fixtureEmails.lead))
        .send({ body: SECRET, type: 'INTERNAL' })
        .expect(201);
      const redacted = await redact(
        ticket.id,
        res.body.id as string,
        fixtureEmails.lead,
      ).expect(200);
      expect(redacted.body.alreadyEmailed).toBe(false);
      expect(redacted.body.emailsStopped).toBe(0);
      expect(await outboxFor(ticket.id)).toHaveLength(0);
    });
  });
});
