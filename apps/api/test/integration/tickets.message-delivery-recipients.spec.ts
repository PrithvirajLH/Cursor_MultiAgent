import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import {
  fixtureEmails,
  fixtureTeamIds,
  fixtureUserIds,
} from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type DeliveryLabel = {
  emailed: number;
  refused: number;
  pending: number;
  recipients: string[];
  internal: boolean;
};

/**
 * Card 1.73, the API half — who a message went to, and that it is still queued.
 *
 * The owner asked for a right-click menu showing "who this message went to" and
 * "delivery status". Two of the four items needed server work first:
 *
 *  - the recipients existed and were **deliberately discarded**.
 *    `messageOutboxRows` opened the payload for `email.cc`, computed
 *    `1 + cc.length`, and kept only the number.
 *  - `pending` was computed, returned, and then dropped by the client's type,
 *    and the no-outbox fallback spelled `{ emailed: 0, refused: 0 }` - so a
 *    queued email rendered as nothing at all, identical to an internal note.
 *
 * ⚠️ No new endpoint and no widened access: this rides on the existing
 * message-list access check, which card 1.36 established is the thing that
 * decides who reads what.
 */
describe('a message reports who it went to (card 1.73)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let ticketId: string;
  let publicId: string;
  let internalId: string;

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;

    // Built with Prisma, mirroring tickets.message-recipients.spec.ts: a public
    // reply only queues email when there is somebody outside the desk to reach,
    // so the ticket needs a requester, an assignee and a non-staff follower.
    const prisma = getPrisma();
    const ticket = await prisma.ticket.create({
      data: {
        requesterId: fixtureUserIds.requester,
        subject: `c173 delivery recipients ${Date.now()}`,
        description: 'card 1.73 fixture',
        assignedTeamId: fixtureTeamIds.it,
        assigneeId: fixtureUserIds.agent,
        followers: { create: [{ userId: fixtureUserIds.otherRequester }] },
      },
      select: { id: true },
    });
    ticketId = ticket.id;

    const publicPost = await request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({ body: 'A public reply that gets emailed.', type: 'PUBLIC' })
      .expect(201);
    publicId = (publicPost.body as { id: string }).id;

    const internalPost = await request(server)
      .post(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .send({ body: 'An internal note that is not.', type: 'INTERNAL' })
      .expect(201);
    internalId = (internalPost.body as { id: string }).id;
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  const labels = async (): Promise<Map<string, DeliveryLabel>> => {
    const listed = await request(server)
      .get(`/api/tickets/${ticketId}/messages`)
      .set(authHeader(fixtureEmails.agent))
      .expect(200);
    const rows = (listed.body as { data: { id: string; delivery: DeliveryLabel }[] })
      .data;
    return new Map(rows.map((row) => [row.id, row.delivery]));
  };

  it('⚠️ names the recipients instead of only counting them', async () => {
    // THE ASSERTION THAT FAILS IF THE ADDRESSES GO BACK TO BEING DISCARDED.
    // The primary comes from `NotificationOutbox.toEmail`, a top-level column -
    // no new query, and nothing invented. The requester is who a public reply
    // is addressed to.
    const label = (await labels()).get(publicId);
    expect(label).toBeDefined();
    expect(label?.recipients).toContain(fixtureEmails.requester);
    expect(label?.recipients.length).toBeGreaterThan(0);
  });

  it('⚠️ reports a queued email as pending rather than as nothing', async () => {
    // THE ASSERTION FOR THE HALF THAT WAS DROPPED. A message whose email is
    // still queued used to render no label at all - indistinguishable from an
    // internal note that was never emailed. In production that state is not
    // momentary: there is no Redis, so the sweeper runs on a 60-second interval.
    //
    // The status is SET here rather than waited for. Without SMTP this
    // environment marks the row FAILED almost immediately, so asserting on
    // whatever the processor happened to leave would be testing the harness's
    // timing, not the mapping.
    const prisma = getPrisma();
    await prisma.notificationOutbox.updateMany({
      where: { ticketId, eventType: 'MESSAGE_ADDED' },
      data: { status: 'PENDING' },
    });
    const label = (await labels()).get(publicId);
    expect(label?.pending).toBeGreaterThan(0);
    expect(label?.emailed).toBe(0);
    expect(label?.refused).toBe(0);
  });

  it('⚠️ reports a refused email as refused, not as pending', async () => {
    // The discriminating half: a label that reported everything as pending
    // would pass the test above. This is also the state this environment
    // produces naturally, since there is no SMTP configured.
    const prisma = getPrisma();
    await prisma.notificationOutbox.updateMany({
      where: { ticketId, eventType: 'MESSAGE_ADDED' },
      data: { status: 'FAILED' },
    });
    const label = (await labels()).get(publicId);
    expect(label?.refused).toBeGreaterThan(0);
    expect(label?.pending).toBe(0);
    // The recipients are reported whatever the outcome - who it was addressed
    // to does not depend on whether it arrived.
    expect(label?.recipients).toContain(fixtureEmails.requester);
  });

  it('an internal note names nobody and is marked internal', async () => {
    // The discriminating half: without it, a label that always returned the
    // ticket's participants would pass the test above.
    const label = (await labels()).get(internalId);
    expect(label?.internal).toBe(true);
    expect(label?.recipients).toEqual([]);
    expect(label?.pending).toBe(0);
  });

  it('⚠️ every message carries the full shape, including one with no outbox row', async () => {
    // The fallback used to be `{ emailed: 0, refused: 0 }` - a different shape
    // from a message that had rows, which is how `pending` came to be dropped
    // on exactly the messages where it mattered.
    for (const label of (await labels()).values()) {
      expect(label).toHaveProperty('emailed');
      expect(label).toHaveProperty('refused');
      expect(label).toHaveProperty('pending');
      expect(label).toHaveProperty('recipients');
      expect(Array.isArray(label.recipients)).toBe(true);
    }
  });

  it('does not repeat an address that appears on more than one row', async () => {
    // One message can fan out to several outbox rows; the menu should list a
    // person once.
    const label = (await labels()).get(publicId);
    const lower = (label?.recipients ?? []).map((r) => r.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });
});
