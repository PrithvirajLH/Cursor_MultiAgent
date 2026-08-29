import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthRequest } from '../auth/current-user.decorator';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { stripPort } from './strip-port.util';

/**
 * Card 1.20 defect A: the anonymous idempotency scope used to include
 * `X-Forwarded-For`, which Azure App Service writes as `ip:port` with a new
 * source port per TCP connection — so a retry never replayed. A caller holding
 * a shared secret is now scoped by that secret instead.
 */

type RequestOverrides = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  user?: { id: string };
};

function makeRequest(overrides: RequestOverrides = {}): Request & AuthRequest {
  return {
    ip: overrides.ip ?? '127.0.0.1',
    headers: overrides.headers ?? {},
    ...(overrides.user ? { user: overrides.user } : {}),
  } as unknown as Request & AuthRequest;
}

function resolveScope(request: Request & AuthRequest): string {
  const interceptor = new IdempotencyInterceptor(
    {} as never,
    new ConfigService({}),
  );
  return (
    interceptor as unknown as {
      resolveActorScope: (req: Request & AuthRequest) => string;
    }
  ).resolveActorScope(request);
}

describe('stripPort', () => {
  it('removes a port from an IPv4 address', () => {
    expect(stripPort('1.2.3.4:5678')).toBe('1.2.3.4');
  });

  it('leaves a bare IPv4 address alone', () => {
    expect(stripPort('1.2.3.4')).toBe('1.2.3.4');
  });

  it('removes a port from a bracketed IPv6 address', () => {
    expect(stripPort('[::1]:5678')).toBe('[::1]');
  });

  it('leaves a bare IPv6 address alone — its colons are part of the address', () => {
    expect(stripPort('::1')).toBe('::1');
    expect(stripPort('2001:db8::1')).toBe('2001:db8::1');
  });

  it('leaves an empty string alone', () => {
    expect(stripPort('')).toBe('');
  });
});

describe('IdempotencyInterceptor.resolveActorScope', () => {
  it('scopes an authenticated request by user id', () => {
    expect(resolveScope(makeRequest({ user: { id: 'user-1' } }))).toBe(
      'user-1',
    );
  });

  it('gives the same scope for one secret regardless of ip, port or user agent', () => {
    const first = resolveScope(
      makeRequest({
        ip: '10.0.0.1',
        headers: {
          'x-intake-secret': 'shared-secret',
          'x-forwarded-for': '1.2.3.4:1111',
          'user-agent': 'PowerAutomate/1.0',
        },
      }),
    );
    const second = resolveScope(
      makeRequest({
        ip: '10.9.9.9',
        headers: {
          'x-intake-secret': 'shared-secret',
          'x-forwarded-for': '5.6.7.8:2222',
          'user-agent': 'curl/8.0',
        },
      }),
    );
    expect(second).toBe(first);
    expect(first.startsWith('anonymous:')).toBe(true);
  });

  it('gives different scopes to different secret values and to different secret headers', () => {
    const intake = resolveScope(
      makeRequest({ headers: { 'x-intake-secret': 'secret-a' } }),
    );
    const otherValue = resolveScope(
      makeRequest({ headers: { 'x-intake-secret': 'secret-b' } }),
    );
    const otherHeader = resolveScope(
      makeRequest({ headers: { 'x-inbound-email-secret': 'secret-a' } }),
    );
    expect(otherValue).not.toBe(intake);
    expect(otherHeader).not.toBe(intake);
  });

  it('never puts the raw secret in the scope', () => {
    const scope = resolveScope(
      makeRequest({ headers: { 'x-intake-secret': 'super-secret-value' } }),
    );
    expect(scope).not.toContain('super-secret-value');
    expect(scope).toMatch(/^anonymous:[0-9a-f]{24}$/);
  });

  it('prefers the intake secret when several secret headers are present', () => {
    const both = resolveScope(
      makeRequest({
        headers: {
          'x-intake-secret': 'secret-a',
          'x-inbound-email-secret': 'secret-z',
        },
      }),
    );
    expect(both).toBe(
      resolveScope(makeRequest({ headers: { 'x-intake-secret': 'secret-a' } })),
    );
  });

  it('falls back to the network for a caller with no secret, ignoring the source port', () => {
    const headers = (forwardedFor: string) => ({
      'x-forwarded-for': forwardedFor,
      'user-agent': 'curl/8.0',
    });
    const first = resolveScope(
      makeRequest({ ip: '1.2.3.4:5001', headers: headers('9.9.9.9:1111') }),
    );
    const second = resolveScope(
      makeRequest({ ip: '1.2.3.4:6002', headers: headers('9.9.9.9:2222') }),
    );
    expect(second).toBe(first);
    const otherClient = resolveScope(
      makeRequest({ ip: '1.2.3.4:5001', headers: headers('8.8.8.8:1111') }),
    );
    expect(otherClient).not.toBe(first);
  });

  it('reads only the first entry of a comma-separated X-Forwarded-For chain', () => {
    const direct = resolveScope(
      makeRequest({ headers: { 'x-forwarded-for': '9.9.9.9:1111' } }),
    );
    const chained = resolveScope(
      makeRequest({ headers: { 'x-forwarded-for': '9.9.9.9:2222, 10.0.0.5' } }),
    );
    expect(chained).toBe(direct);
  });
});
