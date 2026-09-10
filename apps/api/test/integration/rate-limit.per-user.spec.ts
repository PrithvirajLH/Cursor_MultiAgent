import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import request from 'supertest';
import type { App as SupertestApp } from 'supertest/types';
import { fixtureEmails } from '../utils/fixtures';
import { resetTestDb } from '../utils/reset-test-db';
import { createTestApp } from '../utils/test-app';

/** The limit for this suite. Small so the 429 arrives in four requests. */
const LIMIT = 3;

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

/** Same shape as security.auth.spec.ts — a real HS256 token AuthGuard accepts. */
function signHs256Token(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const content = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(
    JSON.stringify(payload),
  )}`;
  const signature = createHmac('sha256', secret)
    .update(content)
    .digest('base64url');
  return `${content}.${signature}`;
}

/**
 * Card 1.69 — the rate limit was one bucket for the entire application.
 *
 * `ThrottlerModule` supplied no `getTracker`, so the library default `req.ip`
 * applied; with no `trust proxy` anywhere that is the App Service ingress, one
 * address for every caller. Measured 2026-09-10: 1,640 production requests all
 * logging `169.254.131.5`, and 288 refused with 429 — every one of them
 * `/api/tickets`.
 *
 * ⚠️ WHAT THIS SUITE EXISTS TO CATCH is not "does a limit apply" — that always
 * passed. It is "do two different people share one budget", which is invisible
 * to every other test in the repo.
 *
 * ⚠️ AND WHY THE TRACKER IS NOT `request.user.id`: there are two global
 * `APP_GUARD` providers and NestJS does not order them across modules. A probe
 * on a real authenticated `GET /api/tickets` showed the tracker receives a
 * request with no `user` property at all — the throttler runs BEFORE AuthGuard.
 * So the live tier is the bearer token's subject, and the first test below is
 * the one that proves it against the real guard stack rather than a stub.
 */
describe('rate limiting is per user, not per application (card 1.69)', () => {
  let app: INestApplication;
  let server: SupertestApp;
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    await resetTestDb();
    for (const key of [
      'RATE_LIMIT_LIMIT',
      'RATE_LIMIT_TTL_MS',
      'AUTH_ALLOW_INSECURE_HEADERS',
      'AUTH_JWT_SECRET',
    ]) {
      previous[key] = process.env[key];
    }
    // Set BEFORE the app boots: ThrottlerModule.forRootAsync reads the limit in
    // its factory, once, at module initialisation.
    process.env.RATE_LIMIT_LIMIT = String(LIMIT);
    process.env.RATE_LIMIT_TTL_MS = '60000';
    // ⚠️ Insecure headers OFF, so this exercises the PRODUCTION identity path -
    // a bearer token - rather than the `x-user-email` shortcut the rest of the
    // integration suite uses. The header tier is covered separately below.
    process.env.AUTH_ALLOW_INSECURE_HEADERS = 'false';
    process.env.AUTH_JWT_SECRET =
      process.env.AUTH_JWT_SECRET ?? 'rate-limit-suite-secret';
    app = await createTestApp();
    server = app.getHttpServer() as SupertestApp;
  }, 180_000);

  afterAll(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (app) {
      await app.close();
    }
  });

  const tokenFor = (email: string, subject: string) =>
    signHs256Token(
      {
        email,
        sub: subject,
        exp: Math.floor(Date.now() / 1000) + 60 * 5,
      },
      process.env.AUTH_JWT_SECRET ?? '',
    );

  const get = (token: string) =>
    request(server)
      .get('/api/tickets?pageSize=1')
      .set('authorization', `Bearer ${token}`);

  it('⚠️ exhausting one user’s budget leaves another user unaffected', async () => {
    // THE REGRESSION ASSERTION FOR CARD 1.69, and the only test in the repo that
    // would fail if the tracker went back to keying on the IP. Both callers
    // arrive from the same address - which is the production reality behind the
    // ingress - so an IP-keyed bucket makes the second user's first request the
    // fourth hit and refuses it.
    const owner = tokenFor(fixtureEmails.owner, 'subject-owner');
    const agent = tokenFor(fixtureEmails.agent, 'subject-agent');

    for (let i = 0; i < LIMIT; i += 1) {
      await get(owner).expect(200);
    }
    await get(owner).expect(429);

    // The other user has spent nothing. Asserted on 200 rather than "not 429"
    // so an unrelated 500 cannot pass this.
    await get(agent).expect(200);
    await get(agent).expect(200);
  });

  it('⚠️ two tokens for the SAME subject share one budget', async () => {
    // The other half of the fix, and the half a hash of the whole token would
    // have broken: a token is reissued on every refresh, so hashing it would
    // hand one person a fresh allowance every hour. Two distinct token strings,
    // same `sub`, one bucket.
    const first = tokenFor(fixtureEmails.requester, 'subject-shared');
    // A different `exp` makes a different signature and a different string.
    const second = signHs256Token(
      {
        email: fixtureEmails.requester,
        sub: 'subject-shared',
        exp: Math.floor(Date.now() / 1000) + 60 * 9,
      },
      process.env.AUTH_JWT_SECRET ?? '',
    );
    expect(first).not.toBe(second);

    await get(first).expect(200);
    await get(second).expect(200);
    await get(first).expect(200);
    // Fourth hit on the shared bucket, whichever string carries it.
    await get(second).expect(429);
  });

  it('still limits an anonymous public route, via the IP tier', async () => {
    // `GET /` is `@Public()`, so there is no user and no token to key on. One
    // shared bucket is the INTENDED behaviour here - card 1.44's email-action
    // links and the inbound webhook are in the same position, and they are
    // write paths reachable from outside that should stay limited.
    for (let i = 0; i < LIMIT; i += 1) {
      await request(server).get('/api/').expect(200);
    }
    await request(server).get('/api/').expect(429);
  });

  it('⚠️ a request with no usable identity does not consume a signed-in user’s budget', async () => {
    // The failure mode that would make the fix cosmetic: if an unidentifiable
    // request fell into the same bucket as an identified one, the anonymous
    // tier would quietly become the global bucket again. The anonymous route
    // above is already exhausted; a signed-in user is still fine.
    const fresh = tokenFor(fixtureEmails.owner, 'subject-untouched');
    await get(fresh).expect(200);
  });
});
