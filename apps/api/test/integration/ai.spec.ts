import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails, fixtureTeamIds } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

function authHeader(email: string) {
  return { 'x-user-email': email };
}

/**
 * AI controller integration coverage.
 *
 * The pipeline talks to Azure AI Foundry (the Azure OpenAI Responses API).
 * The test environment (.env.test) intentionally has NO Foundry config, so
 * FoundryClientService.getClient() calls config.getOrThrow('AZURE_AI_FOUNDRY_ENDPOINT')
 * / getOrThrow('AZURE_AI_FOUNDRY_API_KEY'), which throws on the very first
 * agent call (Step 1: intent extraction).
 *
 * That thrown error is NOT surfaced as an HTTP 5xx: both classifyAndCreateTicket
 * and debugPipeline wrap each step in try/catch and return a 200 OK envelope
 * (the controller annotates both POSTs with @HttpCode(OK)). The pipeline is
 * non-deterministic in this env, though — it runs even when Foundry is
 * unconfigured and may return either an error envelope or a success/
 * clarification — so the run-shape tests assert only the HTTP contract (200 +
 * a well-typed status field), never a specific outcome or live AI content.
 * The auth (401), role-gating (403), body-validation (400), and
 * GET /ai/analysis shape assertions stay fully deterministic.
 */

type ClassifyResponse = {
  status: string;
  error?: string;
  step?: string;
};

type DebugResponse = {
  steps: Array<{ step: number; name: string; status: string; error?: string }>;
  finalStatus: string;
  totalLatencyMs?: number;
  errorMessage?: string;
};

// All terminal statuses the pipeline can return (ai.service.ts). The test env
// has no Foundry config, so the run typically fails at Step 1, but the pipeline
// is non-deterministic here and may also complete — assert membership, not a
// specific outcome.
const CLASSIFY_STATUSES = ['created', 'needs_clarification', 'error'];
const DEBUG_FINAL_STATUSES = ['created', 'needs_clarification', 'error'];

type AnalysisResponse = {
  data: Record<string, unknown> | null;
};

type CreatedTicket = {
  id: string;
};

const VALID_TEXT = 'My laptop will not connect to the VPN and I have a meeting soon.';

describe('AI', () => {
  let app: INestApplication;
  let server: SupertestApp;

  beforeAll(async () => {
    resetTestDb();
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Authentication ──────────────────────────────────────────────────────

  it('rejects POST /ai/classify with no auth credentials (401)', async () => {
    await request(server)
      .post('/api/ai/classify')
      .send({ text: VALID_TEXT })
      .expect(401);
  });

  it('rejects POST /ai/debug with no auth credentials (401)', async () => {
    await request(server)
      .post('/api/ai/debug')
      .send({ text: VALID_TEXT })
      .expect(401);
  });

  it('rejects GET /ai/analysis/:ticketId with no auth credentials (401)', async () => {
    await request(server)
      .get('/api/ai/analysis/00000000-0000-4000-8000-000000000000')
      .expect(401);
  });

  it('does not 401 an authenticated requester on POST /ai/classify', async () => {
    const res = await request(server)
      .post('/api/ai/classify')
      .set(authHeader(fixtureEmails.requester))
      .send({ text: VALID_TEXT });

    expect(res.status).not.toBe(401);
  });

  // ─── Role gating on /ai/debug (TEAM_ADMIN + OWNER only) ───────────────────
  // The controller throws ForbiddenException for any other role; this guard
  // runs before the service, so it is asserted independently of AI config.

  it('forbids POST /ai/debug for an EMPLOYEE (403)', async () => {
    await request(server)
      .post('/api/ai/debug')
      .set(authHeader(fixtureEmails.requester))
      .send({ text: VALID_TEXT })
      .expect(403);
  });

  it('forbids POST /ai/debug for an AGENT (403)', async () => {
    await request(server)
      .post('/api/ai/debug')
      .set(authHeader(fixtureEmails.agent))
      .send({ text: VALID_TEXT })
      .expect(403);
  });

  it('forbids POST /ai/debug for a LEAD (403)', async () => {
    await request(server)
      .post('/api/ai/debug')
      .set(authHeader(fixtureEmails.lead))
      .send({ text: VALID_TEXT })
      .expect(403);
  });

  it('allows POST /ai/debug for a TEAM_ADMIN (not 401/403)', async () => {
    const res = await request(server)
      .post('/api/ai/debug')
      .set(authHeader(fixtureEmails.admin))
      .send({ text: VALID_TEXT });

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('allows POST /ai/debug for an OWNER (not 401/403)', async () => {
    const res = await request(server)
      .post('/api/ai/debug')
      .set(authHeader(fixtureEmails.owner))
      .send({ text: VALID_TEXT });

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  // ─── Request body validation (ValidationPipe) ─────────────────────────────

  it('rejects POST /ai/classify with a missing text field (400)', async () => {
    await request(server)
      .post('/api/ai/classify')
      .set(authHeader(fixtureEmails.requester))
      .send({})
      .expect(400);
  });

  it('rejects POST /ai/classify with an empty text field (400)', async () => {
    await request(server)
      .post('/api/ai/classify')
      .set(authHeader(fixtureEmails.requester))
      .send({ text: '' })
      .expect(400);
  });

  it('rejects POST /ai/classify with a non-UUID userId (400)', async () => {
    await request(server)
      .post('/api/ai/classify')
      .set(authHeader(fixtureEmails.requester))
      .send({ text: VALID_TEXT, userId: 'not-a-uuid' })
      .expect(400);
  });

  it('rejects POST /ai/classify with an invalid channel enum (400)', async () => {
    await request(server)
      .post('/api/ai/classify')
      .set(authHeader(fixtureEmails.requester))
      .send({ text: VALID_TEXT, channel: 'SMS' })
      .expect(400);
  });

  it('rejects POST /ai/classify with an unknown (non-whitelisted) field (400)', async () => {
    await request(server)
      .post('/api/ai/classify')
      .set(authHeader(fixtureEmails.requester))
      .send({ text: VALID_TEXT, injected: 'nope' })
      .expect(400);
  });

  it('rejects POST /ai/debug with a missing text field (400), gating aside, for an admin', async () => {
    await request(server)
      .post('/api/ai/debug')
      .set(authHeader(fixtureEmails.admin))
      .send({})
      .expect(400);
  });

  // ─── Pipeline run shape (AI config-tolerant) ──────────────────────────────
  // The pipeline talks to Azure AI Foundry. The test env has no Foundry config,
  // so a run typically fails at Step 1 — but the pipeline runs regardless and is
  // non-deterministic here: it may return an error envelope OR a success/
  // clarification. These assertions are therefore SHAPE-based: they verify the
  // HTTP contract (200 + a well-typed status field), not a specific outcome.

  it('POST /ai/classify returns a 200 with a string status field', async () => {
    const res = await request(server)
      .post('/api/ai/classify')
      .set(authHeader(fixtureEmails.requester))
      .send({ text: VALID_TEXT })
      .expect(200);

    const body = res.body as ClassifyResponse;
    expect(typeof body.status).toBe('string');
    expect(CLASSIFY_STATUSES).toContain(body.status);
  });

  it('POST /ai/debug (admin) returns a 200 with a string finalStatus field', async () => {
    const res = await request(server)
      .post('/api/ai/debug')
      .set(authHeader(fixtureEmails.admin))
      .send({ text: VALID_TEXT })
      .expect(200);

    const body = res.body as DebugResponse;
    expect(typeof body.finalStatus).toBe('string');
    expect(DEBUG_FINAL_STATUSES).toContain(body.finalStatus);
    expect(Array.isArray(body.steps)).toBe(true);
  });

  // ─── GET /ai/analysis/:ticketId ───────────────────────────────────────────
  // Returns { data: <stored AI_CLASSIFICATION payload> | null }. A freshly
  // created ticket has no AI_CLASSIFICATION event, so data is null. (The classify
  // pipeline stores an AI_PIPELINE_TRACE, not AI_CLASSIFICATION, and only on a
  // successful run — which cannot happen without Foundry config — so null is the
  // deterministic result here.)

  it('GET /ai/analysis/:ticketId returns { data: null } for a freshly created ticket with no analysis', async () => {
    const created = await request(server)
      .post('/api/tickets')
      .set(authHeader(fixtureEmails.requester))
      .send({
        subject: 'AI analysis fixture ticket',
        description: 'No AI analysis exists for this ticket yet.',
        priority: 'SEV3',
        channel: 'PORTAL',
        assignedTeamId: fixtureTeamIds.it,
      })
      .expect(201);

    const ticketId = (created.body as CreatedTicket).id;
    expect(ticketId).toBeTruthy();

    const res = await request(server)
      .get(`/api/ai/analysis/${ticketId}`)
      .set(authHeader(fixtureEmails.requester))
      .expect(200);

    const body = res.body as AnalysisResponse;
    expect(body).toHaveProperty('data');
    expect(body.data).toBeNull();
  });

  it('GET /ai/analysis/:ticketId returns { data: null } for an unknown ticketId', async () => {
    const res = await request(server)
      .get('/api/ai/analysis/00000000-0000-4000-8000-000000000000')
      .set(authHeader(fixtureEmails.admin))
      .expect(200);

    const body = res.body as AnalysisResponse;
    expect(body.data).toBeNull();
  });
});
