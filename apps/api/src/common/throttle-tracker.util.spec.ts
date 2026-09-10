import { resolveThrottleTracker } from './throttle-tracker.util';

/** A signed JWT's middle segment is all this reads - the signature is ignored. */
function tokenWith(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString(
    'base64url',
  );
  return `header.${payload}.signature-not-checked`;
}

const OPEN = { allowInsecureHeaders: true };
const CLOSED = { allowInsecureHeaders: false };

/**
 * Card 1.69 — the rate limit was one bucket for the whole application.
 *
 * `req.ip` behind the App Service ingress is the same value for every caller,
 * so 288 requests were refused with 429 in a day while no single user was
 * anywhere near the limit.
 */
describe('resolveThrottleTracker (card 1.69)', () => {
  describe('the tiers, in order', () => {
    it('prefers request.user when it is there', () => {
      // Not reachable in this application today - the throttler runs before
      // AuthGuard, proven by probe - but it is the correct source and costs one
      // property read. If the guard order ever changes this starts winning.
      expect(
        resolveThrottleTracker(
          { user: { id: 'user-1' }, ip: '10.0.0.1' },
          CLOSED,
        ),
      ).toEqual({ key: 'user:user-1', source: 'user' });
    });

    it("⚠️ falls back to the bearer token's subject, which is the live path", () => {
      // THE ASSERTION THAT MATTERS IN PRODUCTION. `request.user` is undefined at
      // throttle time, so this tier is the one that actually separates users.
      const result = resolveThrottleTracker(
        {
          headers: { authorization: `Bearer ${tokenWith({ sub: 'aad-sub-1' })}` },
          ip: '169.254.131.5',
        },
        CLOSED,
      );
      expect(result).toEqual({ key: 'token:aad-sub-1', source: 'token' });
    });

    it('uses oid when sub is absent', () => {
      expect(
        resolveThrottleTracker(
          {
            headers: {
              authorization: `Bearer ${tokenWith({ oid: 'entra-oid-9' })}`,
            },
          },
          CLOSED,
        ).key,
      ).toBe('token:entra-oid-9');
    });

    it('prefers sub over oid when both are present', () => {
      expect(
        resolveThrottleTracker(
          {
            headers: {
              authorization: `Bearer ${tokenWith({ sub: 's', oid: 'o' })}`,
            },
          },
          CLOSED,
        ).key,
      ).toBe('token:s');
    });

    it('reads the dev headers only when they are accepted as credentials', () => {
      // ⚠️ THE SECURITY-RELEVANT ASSERTION. In production `x-user-email`
      // authenticates nothing, so bucketing on it would let anyone name a
      // header and spend a chosen victim's budget. Gated on the same predicate
      // AuthGuard uses.
      const req = { headers: { 'x-user-email': 'Agent@Company.com' } };
      expect(resolveThrottleTracker(req, OPEN)).toEqual({
        key: 'header:agent@company.com',
        source: 'header',
      });
      expect(resolveThrottleTracker(req, CLOSED).source).toBe('ip');
    });

    it('prefers x-user-id over x-user-email', () => {
      expect(
        resolveThrottleTracker(
          { headers: { 'x-user-id': 'u-7', 'x-user-email': 'a@b.com' } },
          OPEN,
        ).key,
      ).toBe('header:u-7');
    });

    it('falls back to the IP last, and says so', () => {
      expect(resolveThrottleTracker({ ip: '10.1.2.3' }, CLOSED)).toEqual({
        key: 'ip:10.1.2.3',
        source: 'ip',
      });
    });
  });

  describe('the failure mode that would make the fix cosmetic', () => {
    it('⚠️ never returns the same key for two different signed-in users', () => {
      // THE REGRESSION ASSERTION FOR CARD 1.69. This is the whole card: if these
      // two are ever equal, every user shares one budget again and the outage
      // is back while every other test still passes.
      const a = resolveThrottleTracker(
        {
          headers: { authorization: `Bearer ${tokenWith({ sub: 'alice' })}` },
          ip: '169.254.131.5',
        },
        CLOSED,
      );
      const b = resolveThrottleTracker(
        {
          headers: { authorization: `Bearer ${tokenWith({ sub: 'bob' })}` },
          // The SAME ip - which is the production reality behind the ingress.
          ip: '169.254.131.5',
        },
        CLOSED,
      );
      expect(a.key).not.toBe(b.key);
      expect(a.source).toBe('token');
      expect(b.source).toBe('token');
    });

    it('⚠️ gives one user ONE budget across two IPs', () => {
      // The other half. A per-device budget would let one person multiply their
      // own allowance and would put the limit back to being unenforceable.
      const one = resolveThrottleTracker(
        {
          headers: { authorization: `Bearer ${tokenWith({ sub: 'alice' })}` },
          ip: '10.0.0.1',
        },
        CLOSED,
      );
      const two = resolveThrottleTracker(
        {
          headers: { authorization: `Bearer ${tokenWith({ sub: 'alice' })}` },
          ip: '10.0.0.2',
        },
        CLOSED,
      );
      expect(one.key).toBe(two.key);
    });

    it('⚠️ reaches the IP tier deliberately, never by accident', () => {
      // The `source` field exists for this test and for the log line. A tracker
      // that silently degraded to IP looked identical to a working one, which is
      // how this shipped in the first place - so every degrading input has to
      // SAY it degraded.
      const degrading: Array<Record<string, unknown>> = [
        {},
        { user: null },
        { user: {} },
        { user: { id: '' } },
        { user: { id: 42 } },
        { headers: {} },
        { headers: { authorization: 'Bearer' } },
        { headers: { authorization: 'Basic dXNlcjpwYXNz' } },
        { headers: { authorization: 'Bearer not.a.jwt' } },
        { headers: { authorization: `Bearer ${tokenWith({ nothing: 1 })}` } },
        { headers: { authorization: `Bearer ${tokenWith({ sub: '   ' })}` } },
      ];
      for (const req of degrading) {
        const result = resolveThrottleTracker({ ...req, ip: '1.2.3.4' }, CLOSED);
        expect(result).toEqual({ key: 'ip:1.2.3.4', source: 'ip' });
      }
    });

    it('does not throw on a token whose payload is not JSON or not an object', () => {
      // A malformed token is AuthGuard's to reject a moment later with a
      // reason. Here it must only mean "choose the next tier".
      const notJson = `header.${Buffer.from('{{{', 'utf8').toString('base64url')}.sig`;
      const notObject = `header.${Buffer.from('[1,2]', 'utf8').toString('base64url')}.sig`;
      for (const token of [notJson, notObject]) {
        expect(
          resolveThrottleTracker(
            { headers: { authorization: `Bearer ${token}` }, ip: '1.2.3.4' },
            CLOSED,
          ).source,
        ).toBe('ip');
      }
    });

    it('names the IP tier "unknown" rather than emitting a bare prefix', () => {
      // `ip:` alone would be a real bucket shared by every request with no
      // remote address - a silent global bucket by another route.
      expect(resolveThrottleTracker({}, CLOSED).key).toBe('ip:unknown');
      expect(resolveThrottleTracker({ ip: '  ' }, CLOSED).key).toBe('ip:unknown');
    });
  });

  describe('header shapes Node actually produces', () => {
    it('takes the first value when a header arrives repeated', () => {
      expect(
        resolveThrottleTracker(
          {
            headers: {
              authorization: [`Bearer ${tokenWith({ sub: 'first' })}`, 'Bearer x'],
            },
          },
          CLOSED,
        ).key,
      ).toBe('token:first');
    });

    it('is not case-sensitive about the Bearer scheme', () => {
      expect(
        resolveThrottleTracker(
          { headers: { authorization: `bearer ${tokenWith({ sub: 'x' })}` } },
          CLOSED,
        ).key,
      ).toBe('token:x');
    });
  });
});
