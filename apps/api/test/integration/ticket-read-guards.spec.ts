import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

type TicketResponse = { id: string };

/**
 * Card 1.79 — two reads that skipped the visibility chokepoint.
 *
 * ⚠️ THE CSAT HALF WAS LIVE: any signed-in person could read any ticket's
 * rating and its free-text comment by knowing an id. The AI half leaked
 * nothing only because the pipeline has never run (card 1.63: zero rows
 * against 461 tickets), which is luck rather than a guard.
 *
 * ⚠️ 404, NEVER 403, for a ticket the caller cannot see — the sibling reads
 * answer that way so the existence of a ticket is not confirmed to an
 * outsider.
 */
describe('unguarded ticket reads are guarded now (card 1.79)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  let ticketId = '';

  beforeAll(async () => {
    await resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;

    // A ticket owned by the fixture requester, on the IT team.
    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: 'card 1.79 fixture',
        description: 'rated and classified',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    ticketId = (created.body as TicketResponse).id;

    // A rating, and an AI classification carrying the requester's verbatim
    // message — both written directly, because the endpoints that would
    // normally write them are not what is under test.
    await getPrisma().ticketEvent.create({
      data: {
        ticketId,
        type: 'CSAT_SUBMITTED',
        payload: { rating: 2, comment: 'The agent was unhelpful and rude.' },
        createdById: fixtureUserIds.requester,
      },
    });
    await getPrisma().ticketEvent.create({
      data: {
        ticketId,
        type: 'AI_CLASSIFICATION',
        payload: {
          source: 'ai_pipeline',
          tags: ['vpn'],
          rawText: 'My password is hunter2 and I cannot log in',
          aiAnalysis: { department: 'IT', confidence: 0.9 },
        },
        createdById: fixtureUserIds.requester,
      },
    });
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  describe('CSAT', () => {
    it('⚠️ a non-participant gets 404, not the rating and not a 403', async () => {
      // THE ASSERTION THAT MATTERS. otherRequester has no relationship to this
      // ticket at all.
      const res = await request(server)
        .get(`/api/csat/${ticketId}`)
        .set(authHeader(fixtureEmails.otherRequester))
        .expect(404);
      expect(JSON.stringify(res.body)).not.toContain('unhelpful');
    });

    it('the requester still gets their own rating', async () => {
      // The non-vacuity half: a guard that refused everybody would pass the
      // test above and break the feature.
      const res = await request(server)
        .get(`/api/csat/${ticketId}`)
        .set(authHeader(fixtureEmails.requester))
        .expect(200);
      expect(JSON.stringify(res.body)).toContain('unhelpful');
    });

    it('an agent on the owning team still gets it', async () => {
      const res = await request(server)
        .get(`/api/csat/${ticketId}`)
        .set(authHeader(fixtureEmails.agent))
        .expect(200);
      expect(JSON.stringify(res.body)).toContain('unhelpful');
    });

    it('404 for a ticket that does not exist, the same as for one you cannot see', async () => {
      // The two answers are indistinguishable on purpose.
      await request(server)
        .get('/api/csat/7fe5d219-4b3c-4a2f-9f3a-1c2d3e4f5a6b')
        .set(authHeader(fixtureEmails.otherRequester))
        .expect(404);
    });
  });

  describe('AI analysis', () => {
    it('⚠️ a non-participant gets 404', async () => {
      await request(server)
        .get(`/api/ai/analysis/${ticketId}`)
        .set(authHeader(fixtureEmails.otherRequester))
        .expect(404);
    });

    it('an OWNER gets 200 with content', async () => {
      const res = await request(server)
        .get(`/api/ai/analysis/${ticketId}`)
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      expect(JSON.stringify(res.body)).toContain('ai_pipeline');
    });

    it('⚠️ the payload carries no rawText', async () => {
      // The requester's verbatim message, which this endpoint has no reason to
      // return. Asserted on the serialised body so re-adding the field later
      // fails here.
      const res = await request(server)
        .get(`/api/ai/analysis/${ticketId}`)
        .set(authHeader(fixtureEmails.owner))
        .expect(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('rawText');
      expect(body).not.toContain('hunter2');
    });
  });
});
