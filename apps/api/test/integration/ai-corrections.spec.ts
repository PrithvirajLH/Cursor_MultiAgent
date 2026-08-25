import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { AiRoutingMethod } from '@prisma/client';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

/**
 * Corrections are the ground truth AI routing accuracy is scored against, so
 * two properties matter and both are asserted here:
 *
 *  1. moving an AI-routed ticket records exactly one correction;
 *  2. moving a manually created ticket records none — an ordinary edit is not
 *     evidence the AI was wrong, and counting it would silently deflate the
 *     accuracy figure.
 */
describe('AI routing corrections', () => {
  let app: INestApplication;
  let server: SupertestApp;
  const prisma = getPrisma();

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    await app.init();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  /**
   * recordCorrection is fire-and-forget by design — observability must never
   * block or fail an agent's transfer. So the row lands shortly after the HTTP
   * response, and the test polls rather than assuming it is already there.
   */
  async function waitForCorrections(
    ticketId: string,
    expected: number,
    timeoutMs = 4000,
  ): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    let count = 0;
    for (;;) {
      count = await prisma.correctionLog.count({ where: { ticketId } });
      if (count >= expected || Date.now() > deadline) {
        return count;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async function createTicket(subject: string): Promise<string> {
    const response = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject,
        description: 'Correction wiring fixture',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  /** Mark a ticket as AI-routed by writing the decision the pipeline would have. */
  async function markAsAiRouted(ticketId: string): Promise<void> {
    await prisma.routingDecisionLog.create({
      data: {
        correlationId: `test-${ticketId}`,
        ticketId,
        predictedTeamId: fixtureTeamIds.it,
        confidence: 0.91,
        thresholdUsed: 0.75,
        method: AiRoutingMethod.AI,
        accepted: true,
      },
    });
  }

  async function transferToHr(ticketId: string): Promise<void> {
    await request(server)
      .post(`/api/tickets/${ticketId}/transfer`)
      .set(authHeader(fixtureEmails.lead))
      .send({ newTeamId: fixtureTeamIds.hr })
      .expect((response) => {
        if (response.status >= 400) {
          throw new Error(
            `transfer failed: ${response.status} ${JSON.stringify(response.body)}`,
          );
        }
      });
  }

  it('records a department correction when an AI-routed ticket is moved', async () => {
    const ticketId = await createTicket('AI-routed, then moved');
    await markAsAiRouted(ticketId);

    await transferToHr(ticketId);

    expect(await waitForCorrections(ticketId, 1)).toBe(1);
    const correction = await prisma.correctionLog.findFirst({
      where: { ticketId },
    });
    expect(correction?.field).toBe('department');
    expect(correction?.fromValue).toBe(fixtureTeamIds.it);
    expect(correction?.toValue).toBe(fixtureTeamIds.hr);
  });

  it('records nothing when a manually created ticket is moved', async () => {
    const ticketId = await createTicket('Manual, then moved');
    // Deliberately no RoutingDecisionLog: the AI never routed this.

    await transferToHr(ticketId);

    // Give the async write the same chance to land, then assert it did not.
    await waitForCorrections(ticketId, 1, 1500);
    expect(await prisma.correctionLog.count({ where: { ticketId } })).toBe(0);
  });

  it('reports the correction through the accuracy endpoint', async () => {
    const ticketId = await createTicket('Scored by the endpoint');
    await markAsAiRouted(ticketId);
    await transferToHr(ticketId);
    await waitForCorrections(ticketId, 1);

    const response = await request(server)
      .get('/api/reports/ai-accuracy')
      .set(authHeader(fixtureEmails.owner))
      .expect(200);

    const body = response.body as {
      acceptedDecisions: number;
      correctedDecisions: number;
      accuracy: number | null;
      caveat: string;
    };
    expect(body.acceptedDecisions).toBeGreaterThanOrEqual(1);
    expect(body.correctedDecisions).toBeGreaterThanOrEqual(1);
    expect(body.caveat).toMatch(/upper bound/i);
  });

  it('denies the accuracy endpoint to an agent', async () => {
    await request(server)
      .get('/api/reports/ai-accuracy')
      .set(authHeader(fixtureEmails.agent))
      .expect(403);
  });
});
