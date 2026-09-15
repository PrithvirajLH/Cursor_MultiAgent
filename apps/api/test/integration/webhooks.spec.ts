import { INestApplication } from '@nestjs/common';
import { NotificationChannel, OutboxStatus } from '@prisma/client';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { WebhooksService } from '../../src/webhooks/webhooks.service';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type Created = { data: { id: string; secret: string; url: string } };

/**
 * Card 2.6 — outbound webhooks, end to end.
 *
 * ⚠️ The delivery tests point at `.invalid`, a TLD reserved by RFC 2606 that
 * can never resolve. That gives a real, fast transport failure without this
 * suite depending on the network, and exercises the retry-to-dead path the card
 * asks for.
 */
describe('outbound webhooks (card 2.6)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let webhooks: WebhooksService;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
    webhooks = app.get(WebhooksService);
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  const subscribe = async (url: string, events = ['ticket.created']) => {
    const res = await request(server)
      .post('/api/admin/webhooks')
      .set(authHeader(fixtureEmails.owner))
      .send({ url, events })
      .expect(201);
    return (res.body as Created).data;
  };

  describe('⚠️ where a webhook may point', () => {
    it('⚠️ refuses the cloud metadata address, with a reason an admin can act on', async () => {
      // THE SECURITY ASSERTION OF THIS CARD. 169.254.169.254 hands out
      // managed-identity tokens to anything inside the VM that asks.
      const res = await request(server)
        .post('/api/admin/webhooks')
        .set(authHeader(fixtureEmails.owner))
        .send({ url: 'https://169.254.169.254/hook', events: ['ticket.created'] })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/private network/i);
    });

    it('refuses loopback, a private range and plain http', async () => {
      for (const url of [
        'https://127.0.0.1/hook',
        'https://10.0.0.1/hook',
        'https://192.168.1.1/hook',
        'http://example.com/hook',
      ]) {
        await request(server)
          .post('/api/admin/webhooks')
          .set(authHeader(fixtureEmails.owner))
          .send({ url, events: ['ticket.created'] })
          .expect(400);
      }
    });

    it('refuses an unknown event name rather than silently never firing', async () => {
      await request(server)
        .post('/api/admin/webhooks')
        .set(authHeader(fixtureEmails.owner))
        .send({ url: 'https://example.com/hook', events: ['ticket.exploded'] })
        .expect(400);
    });

    it('accepts an ordinary public https URL', async () => {
      // The non-vacuity half.
      const created = await subscribe('https://example.com/hooks/a');
      expect(created.id).toBeTruthy();
    });

    it('⚠️ is owner-only', async () => {
      await request(server)
        .post('/api/admin/webhooks')
        .set(authHeader(fixtureEmails.admin))
        .send({ url: 'https://example.com/x', events: ['ticket.created'] })
        .expect(403);
    });
  });

  describe('the signing secret', () => {
    it('⚠️ is returned once and never listed again', async () => {
      const created = await subscribe('https://example.com/hooks/secret');
      expect(created.secret).toBeTruthy();
      const list = await request(server)
        .get('/api/admin/webhooks')
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain(created.secret);
    });
  });

  describe('⚠️ what actually goes out', () => {
    it('⚠️ queues a payload with no subject, body or description in it', async () => {
      // Asserted on the bytes that would be posted, not on the builder.
      const created = await subscribe('https://example.com/hooks/payload');
      const ticket = await request(server)
        .post('/api/tickets')
        .set(authHeader(fixtureEmails.requester))
        .send({
          subject: 'CANARY_SUBJECT_7781 my prescription is wrong',
          description: 'CANARY_BODY_7781 sensitive clinical detail',
          priority: 'SEV3',
          channel: 'PORTAL',
          assignedTeamId: fixtureTeamIds.it,
        })
        .expect(201);
      const ticketId = (ticket.body as { id: string }).id;

      const rows = await getPrisma().notificationOutbox.findMany({
        where: { channel: NotificationChannel.WEBHOOK, ticketId },
        select: { body: true, toEmail: true, eventType: true },
      });
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.body).not.toContain('CANARY_SUBJECT_7781');
        expect(row.body).not.toContain('CANARY_BODY_7781');
        expect(row.body).toContain('"version":1');
        expect(row.eventType).toBe('ticket.created');
        expect(row.toEmail).toBe(created.url);
      }
    });

    it('does not queue for a subscription that did not ask for the event', async () => {
      await subscribe('https://example.com/hooks/messages-only', ['message.added']);
      const before = await getPrisma().notificationOutbox.count({
        where: { channel: NotificationChannel.WEBHOOK, eventType: 'ticket.created' },
      });
      await request(server)
        .post('/api/tickets')
        .set(authHeader(fixtureEmails.requester))
        .send({
          subject: 'routing check',
          description: 'x',
          priority: 'SEV3',
          channel: 'PORTAL',
          assignedTeamId: fixtureTeamIds.it,
        })
        .expect(201);
      const after = await getPrisma().notificationOutbox.count({
        where: { channel: NotificationChannel.WEBHOOK, eventType: 'ticket.created' },
      });
      // The messages-only subscription must not have added a row of its own.
      expect(after - before).toBeLessThanOrEqual(
        await getPrisma().webhookSubscription.count({
          where: { isActive: true, events: { has: 'ticket.created' } },
        }),
      );
    });
  });

  describe('⚠️ delivery, retries and the dead state', () => {
    it('⚠️ retries to the attempt budget and then goes dead, visibly', async () => {
      // `.invalid` can never resolve (RFC 2606), so every attempt fails at
      // transport without this suite touching the network.
      await getPrisma().webhookSubscription.updateMany({
        data: { isActive: false },
      });
      const created = await subscribe('https://unreachable.invalid/hook');
      await request(server)
        .post('/api/tickets')
        .set(authHeader(fixtureEmails.requester))
        .send({
          subject: 'dead letter fixture',
          description: 'x',
          priority: 'SEV3',
          channel: 'PORTAL',
          assignedTeamId: fixtureTeamIds.it,
        })
        .expect(201);

      const queued = await getPrisma().notificationOutbox.findFirst({
        where: {
          channel: NotificationChannel.WEBHOOK,
          toEmail: 'https://unreachable.invalid/hook',
        },
        select: { id: true },
      });
      expect(queued).not.toBeNull();

      // Five attempts is MAX_EMAIL_OUTBOX_ATTEMPTS - the same budget email uses,
      // because this rides the same machinery rather than a second copy.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await webhooks.deliverPending();
      }

      const row = await getPrisma().notificationOutbox.findUniqueOrThrow({
        where: { id: (queued as { id: string }).id },
        select: { status: true, attempts: true, lastError: true },
      });
      expect(row.status).toBe(OutboxStatus.FAILED);
      expect(row.attempts).toBe(5);
      expect(row.lastError).toBeTruthy();
      // ⚠️ The error must never carry the signing secret.
      expect(row.lastError).not.toContain(created.secret);

      // And an admin can see it, because a webhook that silently stopped
      // delivering is worse than one that never worked.
      const dead = await request(server)
        .get('/api/admin/webhooks/dead-letters')
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      expect(JSON.stringify(dead.body)).toContain('unreachable.invalid');
    }, 60_000);
  });
});
