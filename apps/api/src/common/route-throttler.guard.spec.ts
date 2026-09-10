import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as Throttler from '@nestjs/throttler';
import { RouteThrottlerGuard } from './route-throttler.guard';
import { ThrottlePolicy } from './throttle-policy.decorator';

class WebhookRoute {
  @ThrottlePolicy('webhook')
  handler(): void {}
}

class WebhookRouteExempt {
  @Throttler.SkipThrottle()
  @ThrottlePolicy('webhook')
  handler(): void {}
}

class WebhookRouteExemptByName {
  @Throttler.SkipThrottle({ webhook: true })
  @ThrottlePolicy('webhook')
  handler(): void {}
}

class PlainRoute {
  handler(): void {}
}

type RouteClass = { prototype: object };

function contextFor(
  cls: RouteClass,
  request: Record<string, unknown>,
): ExecutionContext {
  const handler = (cls.prototype as Record<string, unknown>).handler;
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ header: () => undefined }),
    }),
  } as unknown as ExecutionContext;
}

function buildGuard(env: Record<string, string> = {}) {
  // Typed parameters so `increment.mock.calls[0][n]` is readable below - an
  // untyped jest.fn() infers an empty tuple and every index is a type error.
  const increment = jest.fn(
    async (
      _key: string,
      _ttl: number,
      _limit: number,
      _blockDuration: number,
      _throttlerName: string,
    ) => ({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
  );
  const storage = { increment } as unknown as Throttler.ThrottlerStorage;
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  // An ARRAY, exactly as app.module.ts supplies it - which is what sends
  // onModuleInit down its Array.isArray branch and makes commonOptions.getTracker
  // the guard's own bound method.
  const options: Throttler.ThrottlerModuleOptions = [
    { name: 'default', ttl: 60_000, limit: 120, setHeaders: true },
  ];
  const guard = new RouteThrottlerGuard(
    options,
    storage,
    new Reflector(),
    config,
  );
  return { guard, increment };
}

/**
 * Card 1.69 — the guard, as opposed to the tracker function it delegates to.
 *
 * Two things are only observable here: that the tracker override reaches the
 * webhook / highWrite branch at all, and that `@SkipThrottle()` is honoured on
 * a route that has a policy.
 */
describe('RouteThrottlerGuard (card 1.69)', () => {
  const AUTHENTICATED = {
    headers: {
      authorization:
        'Bearer header.' +
        Buffer.from(JSON.stringify({ sub: 'aad-1' }), 'utf8').toString(
          'base64url',
        ) +
        '.sig',
    },
    ip: '169.254.131.5',
  };

  describe('the tracker override', () => {
    it('⚠️ applies to the webhook policy path, not only the default one', async () => {
      // THE ASSERTION FOR THE HANDOFF'S PROPOSED FIX BEING INSUFFICIENT. Adding
      // getTracker to the ThrottlerModule config would have keyed the default
      // path per user and left this branch on req.ip, because it reads
      // commonOptions.getTracker rather than the array element. Overriding the
      // METHOD is what makes both paths agree - and the storage key is where
      // that shows.
      const { guard, increment } = buildGuard();
      await guard.onModuleInit();
      await guard.canActivate(contextFor(WebhookRoute, AUTHENTICATED));
      expect(increment).toHaveBeenCalledTimes(1);
      const webhookKey = increment.mock.calls[0][0];

      // Same route, a different user, same IP: the keys must differ.
      const second = buildGuard();
      await second.guard.onModuleInit();
      await second.guard.canActivate(
        contextFor(WebhookRoute, {
          headers: {
            authorization:
              'Bearer header.' +
              Buffer.from(JSON.stringify({ sub: 'aad-2' }), 'utf8').toString(
                'base64url',
              ) +
              '.sig',
          },
          ip: '169.254.131.5',
        }),
      );
      const otherKey = second.increment.mock.calls[0][0];
      expect(webhookKey).not.toBe(otherKey);
    });

    it('names the webhook policy on the storage call, so the limits stay separate', async () => {
      const { guard, increment } = buildGuard();
      await guard.onModuleInit();
      await guard.canActivate(contextFor(WebhookRoute, AUTHENTICATED));
      // increment(key, ttl, limit, blockDuration, throttlerName)
      expect(increment.mock.calls[0][4]).toBe('webhook');
      expect(increment.mock.calls[0][2]).toBe(30);
    });

    it('reads the configured webhook limit at request time', async () => {
      const { guard, increment } = buildGuard({
        RATE_LIMIT_WEBHOOK_LIMIT: '7',
      });
      await guard.onModuleInit();
      await guard.canActivate(contextFor(WebhookRoute, AUTHENTICATED));
      expect(increment.mock.calls[0][2]).toBe(7);
    });
  });

  describe('@SkipThrottle() on a policy route', () => {
    it('⚠️ exempts it — it was silently ignored before card 1.69', async () => {
      // THE ASSERTION THAT PINS THE LIBRARY-INTERNAL METADATA KEY. The guard
      // hard-codes 'THROTTLER:SKIP' because @nestjs/throttler does not export
      // it; if a future version changes the value this test fails here rather
      // than in production, where the symptom would be a route somebody
      // believed they had exempted quietly staying limited.
      const { guard, increment } = buildGuard();
      await guard.onModuleInit();
      const allowed = await guard.canActivate(
        contextFor(WebhookRouteExempt, AUTHENTICATED),
      );
      expect(allowed).toBe(true);
      // Not merely allowed - it never reached the counter, so it spends nothing.
      expect(increment).not.toHaveBeenCalled();
    });

    it('also honours the explicit per-policy form', async () => {
      // `@SkipThrottle({ webhook: true })` is the library's own spelling. Both
      // forms have to work, or the fix is a trap in the other direction.
      const { guard, increment } = buildGuard();
      await guard.onModuleInit();
      expect(
        await guard.canActivate(contextFor(WebhookRouteExemptByName, AUTHENTICATED)),
      ).toBe(true);
      expect(increment).not.toHaveBeenCalled();
    });

    it('does not exempt an identical route without the decorator', async () => {
      // The discriminating half: without this, the test above would pass on a
      // guard that exempted every policy route.
      const { guard, increment } = buildGuard();
      await guard.onModuleInit();
      await guard.canActivate(contextFor(WebhookRoute, AUTHENTICATED));
      expect(increment).toHaveBeenCalledTimes(1);
    });
  });

  describe('a route with no policy', () => {
    it('falls through to the library default path', async () => {
      const { guard, increment } = buildGuard();
      await guard.onModuleInit();
      await guard.canActivate(contextFor(PlainRoute, AUTHENTICATED));
      // The 'default' throttler from the options array, not a policy.
      expect(increment.mock.calls[0][4]).toBe('default');
      expect(increment.mock.calls[0][2]).toBe(120);
    });
  });
});
