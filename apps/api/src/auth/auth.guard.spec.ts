import { ExecutionContext, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'crypto';
import { AuthGuard } from './auth.guard';
import { DuplicateAccountService } from '../common/duplicate-account.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserIdentityService } from '../common/user-identity.service';

const SECRET = 'unit-test-secret';

/** Build a signed HS256 token from arbitrary claims. */
function makeToken(
  claims: Record<string, unknown>,
  secret: string = SECRET,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const signedContent = `${encode(header)}.${encode(claims)}`;
  const signature = createHmac('sha256', secret)
    .update(signedContent)
    .digest('base64url');
  return `${signedContent}.${signature}`;
}

const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const PAST = Math.floor(Date.now() / 1000) - 3600;

/**
 * Card 1.54 — twenty rejection paths, one indistinguishable `statusCode: 401`.
 *
 * The owner hit eleven 401s in a 70 ms burst on 2026-09-09 and a whole day of
 * production log could not say which of the twenty causes fired. These tests
 * pin the two properties that make that answerable: every rejection names
 * itself, and none of them writes the credential into the log.
 */
describe('AuthGuard rejection logging (card 1.54)', () => {
  let warnings: string[];
  let warnSpy: jest.SpyInstance;

  /**
   * A guard wired to in-memory doubles. No database: every path below is
   * decided before the guard reaches Prisma, bar `Unknown user`, whose lookup
   * is stubbed to miss.
   */
  function buildGuard(config: Record<string, string | undefined>): AuthGuard {
    const configService = {
      get: (key: string) => config[key],
    } as unknown as ConfigService;
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      teamMember: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const reflector = {
      getAllAndOverride: () => false,
    } as unknown as Reflector;
    return new AuthGuard(
      prisma,
      reflector,
      configService,
      {} as DuplicateAccountService,
      {} as UserIdentityService,
    );
  }

  function contextFor(headers: Record<string, string>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    warnings = [];
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message: unknown) => {
        warnings.push(String(message));
      });
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  type Case = {
    name: string;
    reason: string;
    config?: Record<string, string | undefined>;
    headers: Record<string, string>;
    detail?: string;
  };

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  const CASES: Case[] = [
    {
      name: 'no credentials at all, insecure headers off',
      reason: 'Bearer token is required',
      headers: {},
    },
    {
      name: 'insecure headers on but nothing supplied',
      reason: 'Missing authentication credentials',
      config: { AUTH_ALLOW_INSECURE_HEADERS: 'true', NODE_ENV: 'test' },
      headers: {},
    },
    {
      name: 'header identity for an account that does not exist',
      reason: 'Unknown user',
      config: { AUTH_ALLOW_INSECURE_HEADERS: 'true', NODE_ENV: 'test' },
      headers: { 'x-user-email': 'nobody@company.com' },
    },
    {
      name: 'HS256 token with no secret configured',
      reason: 'HS256 auth is not configured',
      config: {},
      headers: bearer(makeToken({ sub: 'a', exp: FUTURE })),
    },
    {
      name: 'expired token',
      reason: 'Token expired',
      config: { AUTH_JWT_SECRET: SECRET },
      headers: bearer(makeToken({ sub: 'a', exp: PAST })),
      detail: 'expiredSecondsAgo=',
    },
    {
      name: 'token not valid yet',
      reason: 'Token is not active yet',
      config: { AUTH_JWT_SECRET: SECRET },
      headers: bearer(makeToken({ sub: 'a', exp: FUTURE, nbf: FUTURE })),
    },
    {
      name: 'wrong issuer',
      reason: 'Invalid token issuer',
      config: { AUTH_JWT_SECRET: SECRET, AUTH_JWT_ISSUER: 'https://expected' },
      headers: bearer(
        makeToken({ sub: 'a', exp: FUTURE, iss: 'https://somewhere-else' }),
      ),
      detail: 'expectedIss="https://expected"',
    },
    {
      name: 'wrong audience',
      reason: 'Invalid token audience',
      config: { AUTH_JWT_SECRET: SECRET, AUTH_JWT_AUDIENCE: 'api://real' },
      headers: bearer(
        makeToken({ sub: 'a', exp: FUTURE, aud: 'api://someone-else' }),
      ),
      detail: 'expectedAud="api://real"',
    },
    {
      name: 'signature signed with the wrong secret',
      reason: 'Invalid token signature',
      config: { AUTH_JWT_SECRET: SECRET },
      headers: bearer(makeToken({ sub: 'a', exp: FUTURE }, 'the-wrong-secret')),
      detail: 'stage="mismatch"',
    },
    {
      // An opaque access token sent where an id_token was meant. It fails at
      // the header parse, BEFORE the segment count, and says so.
      name: 'an opaque token with no JWT structure',
      reason: 'Invalid token header',
      config: { AUTH_JWT_SECRET: SECRET },
      headers: bearer('not-a-jwt'),
      detail: 'stage="json"',
    },
    {
      // A well-formed header alone: enough for `getTokenAlgorithm` to read
      // HS256, then caught by the segment count.
      name: 'a header with no payload or signature',
      reason: 'Invalid bearer token',
      config: { AUTH_JWT_SECRET: SECRET },
      headers: bearer(
        Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
      ),
      detail: 'segments=1',
    },
    {
      name: 'a token carrying neither sub nor email',
      reason: 'Token must include sub or email claim',
      config: { AUTH_JWT_SECRET: SECRET },
      headers: bearer(makeToken({ exp: FUTURE })),
    },
    {
      name: 'an RS256 token with Azure not configured',
      reason: 'Azure auth is not configured',
      config: {},
      headers: bearer(
        makeToken({ sub: 'a', exp: FUTURE }, SECRET, { alg: 'RS256' }),
      ),
    },
  ];

  it.each(CASES)(
    '⚠️ names the reason in the log: $name',
    async ({ reason, config, headers, detail }) => {
      // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. Before card 1.54 every
      // one of these produced an identical `statusCode: 401` and nothing else,
      // so a production 401 burst could not be attributed to any of them.
      const guard = buildGuard(config ?? {});
      await expect(guard.canActivate(contextFor(headers))).rejects.toThrow(
        UnauthorizedException,
      );
      const line = warnings.find((entry) => entry.startsWith('AUTH_REJECT'));
      expect(line).toBeDefined();
      expect(line).toContain(`reason=${JSON.stringify(reason)}`);
      expect(line).toContain('requestId=');
      if (detail) {
        expect(line).toContain(detail);
      }
    },
  );

  it('⚠️ never writes the bearer token, or any part of it, into the log', async () => {
    // THE ASSERTION THAT STOPS "just log the payload while we debug this".
    // An id_token is a credential and this log ships to Kudu, so a rejection
    // line must name the claim it CHECKED and nothing else.
    const token = makeToken(
      { sub: 'a', exp: PAST, email: 'owner@company.com' },
      SECRET,
    );
    const guard = buildGuard({ AUTH_JWT_SECRET: SECRET });
    await expect(
      guard.canActivate(contextFor(bearer(token))),
    ).rejects.toThrow(UnauthorizedException);
    const output = warnings.join('\n');
    expect(output).toContain('AUTH_REJECT');
    expect(output).not.toContain(token);
    for (const segment of token.split('.')) {
      expect(output).not.toContain(segment);
    }
    // The email is in the payload, not a claim this path checked.
    expect(output).not.toContain('owner@company.com');
  });

  it('every reason is distinguishable from every other', () => {
    // One distinctive string per cause is the whole point: two paths sharing a
    // message would put us back to guessing between them.
    const reasons = CASES.map((entry) => entry.reason);
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it('reports the reason to the caller without the detail', async () => {
    // The log gets the diagnosis; the HTTP response stays as vague as it was.
    const guard = buildGuard({ AUTH_JWT_SECRET: SECRET });
    await expect(
      guard.canActivate(contextFor(bearer(makeToken({ sub: 'a', exp: PAST })))),
    ).rejects.toThrow('Token expired');
    const line = warnings.find((entry) => entry.startsWith('AUTH_REJECT'));
    expect(line).toContain('exp=');
  });
});
