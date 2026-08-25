import fs from 'fs';
import path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

const LIVE = process.env.AI_LIVE_TEST_ENABLED === 'true';

/**
 * End-to-end proof that AI intake actually creates a ticket.
 *
 * Everything else about the pipeline has been measured through `debugPipeline`,
 * which is a dry run — it classifies but never persists. So the real endpoint an
 * employee hits, POST /api/ai/classify, had never executed end to end.
 *
 * This also covers the one thing a dry run structurally cannot: that the
 * pipeline writes its own observability rows. The other correction test writes
 * the RoutingDecisionLog row itself, so the pipeline's writes were unproven.
 *
 * OPT-IN. Real Azure OpenAI calls, roughly 2 cents a run. `.env.test`
 * deliberately carries no Foundry config, so the credentials are loaded from
 * `.env` only when the flag is set. Never runs in CI.
 */
function loadFoundryConfigFromDotEnv(): void {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error(
      'AI_LIVE_TEST_ENABLED=true but apps/api/.env is missing — no Foundry credentials to run against.',
    );
  }
  const needed = [
    'AZURE_AI_FOUNDRY_ENDPOINT',
    'AZURE_AI_FOUNDRY_API_KEY',
    'AZURE_AI_FOUNDRY_MODEL',
    'AZURE_AI_FOUNDRY_API_VERSION',
    'AI_INLINE_PROMPTS',
  ];
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (needed.includes(key) && value) {
      process.env[key] = value;
    }
  }
}

(LIVE ? describe : describe.skip)('AI intake — live end to end', () => {
  let app: INestApplication;
  let server: SupertestApp;
  const prisma = getPrisma();

  beforeAll(async () => {
    loadFoundryConfigFromDotEnv();
    resetTestDb();
    app = await createTestApp();
    await app.init();
    server = app.getHttpServer() as SupertestApp;
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await disconnectPrisma();
  });

  /** Observability writes are fire-and-forget, so poll rather than assume. */
  async function waitFor<T>(
    read: () => Promise<T | null>,
    timeoutMs = 8000,
  ): Promise<T | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (value !== null || Date.now() > deadline) return value;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  it(
    'creates a real ticket, grounded in real departments, with observability written',
    async () => {
      const response = await request(server)
        .post('/api/ai/classify')
        .set({ 'x-user-email': fixtureEmails.requester })
        .send({
          text: "My laptop won't turn on. I've tried holding the power button and nothing happens, no lights at all.",
          channel: 'PORTAL',
        })
        .expect(200);

      const body = response.body as {
        status: string;
        error?: string;
        step?: string;
        ticket?: { id: string; assignedTeamId: string | null };
      };

      // Surface the pipeline's own error rather than failing on a vague assertion.
      expect(
        body.status === 'created' ? null : `${body.status}: ${body.error ?? ''} (step ${body.step ?? '?'})`,
      ).toBeNull();
      expect(body.ticket?.id).toBeTruthy();

      const ticketId = body.ticket!.id;

      // 1. The ticket actually exists.
      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
      expect(ticket).not.toBeNull();

      // 2. Grounding: the assigned team must be a REAL team. This is the direct
      //    check on the failure that made intake unusable — the classifier
      //    returning invented department ids at high confidence.
      expect(ticket?.assignedTeamId).toBeTruthy();
      const team = await prisma.team.findUnique({
        where: { id: ticket!.assignedTeamId! },
      });
      expect(team).not.toBeNull();

      // 3. The pipeline wrote its own inference log.
      const inferenceRows = await waitFor(async () => {
        const rows = await prisma.aiInferenceLog.findMany({
          where: { ticketId },
          orderBy: { step: 'asc' },
        });
        return rows.length > 0 ? rows : null;
      });
      expect(inferenceRows?.length ?? 0).toBeGreaterThan(0);
      // Every row of a run shares one correlation id.
      const correlationIds = new Set(inferenceRows!.map((row) => row.correlationId));
      expect(correlationIds.size).toBe(1);

      // 4. And its routing decision, which accuracy scoring reads.
      const routing = await waitFor(() =>
        prisma.routingDecisionLog.findFirst({ where: { ticketId } }),
      );
      expect(routing).not.toBeNull();
      expect(routing?.accepted).toBe(true);
      expect(routing?.predictedTeamId).toBe(ticket?.assignedTeamId);
      expect(routing?.confidence).toBeGreaterThan(0);
      expect(routing?.confidence).toBeLessThanOrEqual(1);
      expect(routing?.thresholdUsed).toBeGreaterThan(0);
      // The gate accepted it, so the score must have cleared the bar.
      expect(routing!.confidence).toBeGreaterThanOrEqual(routing!.thresholdUsed);
    },
    180_000,
  );
});
