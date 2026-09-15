import { INestApplication } from '@nestjs/common';
import { InboundEmailService } from '../../src/tickets/inbound-email.service';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

const MINUTE = 60 * 1000;

/**
 * Card 1.84 — an interrupted inbound email used to block itself forever.
 *
 * ⚠️ THE FAILURE IS PERMANENT, WHICH IS WHAT MAKES IT WORTH A CARD. The
 * reservation row is inserted with a null `ticketId` to claim the message, and
 * is released only in the `catch`. A process exit between the INSERT and
 * completion — a deploy, an OOM, a killed container — leaves a row nothing
 * clears. The Graph worker then re-offers that message every 30 seconds and
 * every attempt conflicts, forever. Recovery was editing the database by hand.
 *
 * ⚠️ BOTH HALVES ARE ASSERTED. The second is the one that matters: a message
 * that is merely SLOW must still conflict, or the fix trades a stuck message
 * for a duplicated one.
 */
describe('a stale inbound reservation is reclaimed (card 1.84)', () => {
  let app: INestApplication;
  let inbound: InboundEmailService;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    inbound = app.get(InboundEmailService);
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  /** Plant a reservation that never completed, aged to order. */
  const plantAbandoned = async (messageId: string, ageMs: number) => {
    const at = new Date(Date.now() - ageMs);
    await getPrisma().inboundEmailReceipt.create({
      data: {
        messageId,
        fromEmail: 'sender@example.com',
        subject: 'interrupted delivery',
        ticketId: null,
        createdAt: at,
        updatedAt: at,
      },
    });
  };

  it('⚠️ a reservation abandoned long ago is taken over, not refused forever', async () => {
    // THE REGRESSION ASSERTION. Before the fix this threw ConflictException on
    // every redelivery, for the life of the row.
    const messageId = 'c184-stale@example.com';
    await plantAbandoned(messageId, 30 * MINUTE);

    const result = await inbound.reserveInboundEmailReceipt(
      messageId,
      'sender@example.com',
      'interrupted delivery',
    );
    expect(result.mode).toBe('reserved');
  });

  it('⚠️ a reservation made moments ago still conflicts', async () => {
    // THE HALF THAT STOPS DOUBLE-PROCESSING. A message being handled right now
    // by another worker must not be picked up a second time, or the requester
    // gets two tickets for one email.
    const messageId = 'c184-fresh@example.com';
    await plantAbandoned(messageId, 5 * MINUTE);

    await expect(
      inbound.reserveInboundEmailReceipt(
        messageId,
        'sender@example.com',
        'interrupted delivery',
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('⚠️ two workers racing to reclaim the same stale row: only one wins', async () => {
    // The UPDATE is conditional on the row still being unowned AND still stale,
    // so it is the lock. If both won, the fix would itself create duplicates.
    const messageId = 'c184-race@example.com';
    await plantAbandoned(messageId, 30 * MINUTE);

    const attempts = await Promise.allSettled([
      inbound.reserveInboundEmailReceipt(
        messageId,
        'sender@example.com',
        'interrupted delivery',
      ),
      inbound.reserveInboundEmailReceipt(
        messageId,
        'sender@example.com',
        'interrupted delivery',
      ),
    ]);
    const reserved = attempts.filter(
      (a) => a.status === 'fulfilled' && a.value.mode === 'reserved',
    );
    expect(reserved).toHaveLength(1);
  });

  it('a completed receipt still replays rather than reserving again', async () => {
    // Unchanged behaviour, pinned: once a message HAS produced a ticket, a
    // redelivery must return that ticket, not start over.
    const messageId = 'c184-done@example.com';
    const ticket = await getPrisma().ticket.findFirstOrThrow({
      select: { id: true },
    });
    await getPrisma().inboundEmailReceipt.create({
      data: {
        messageId,
        fromEmail: 'sender@example.com',
        subject: 'already handled',
        ticketId: ticket.id,
      },
    });

    const result = await inbound.reserveInboundEmailReceipt(
      messageId,
      'sender@example.com',
      'already handled',
    );
    expect(result).toMatchObject({ mode: 'replay', ticketId: ticket.id });
  });

  it('a different sender reusing a messageId is still refused', async () => {
    // Also unchanged: the reclaim must not become a way to hijack somebody
    // else's message id.
    const messageId = 'c184-other-sender@example.com';
    await plantAbandoned(messageId, 30 * MINUTE);

    await expect(
      inbound.reserveInboundEmailReceipt(
        messageId,
        'someone.else@example.com',
        'interrupted delivery',
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
