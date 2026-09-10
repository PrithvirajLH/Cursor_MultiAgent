/**
 * Which identity the rate-limit bucket was chosen from, most trustworthy first.
 *
 * Reported rather than inferred, because the difference between `user` and `ip`
 * is the difference between a working rate limit and card 1.69's outage: `ip`
 * behind the App Service ingress is ONE bucket for everybody.
 */
export type ThrottleTrackerSource = 'user' | 'token' | 'header' | 'ip';

/** A rate-limit bucket key and the tier it came from. */
export type ThrottleTracker = {
  readonly key: string;
  readonly source: ThrottleTrackerSource;
};

type TrackerRequest = {
  user?: unknown;
  ip?: unknown;
  headers?: unknown;
};

/**
 * Decode a JWT payload WITHOUT verifying the signature.
 *
 * ⚠️ NEVER USE THIS FOR AUTHORIZATION. It is deliberately not exported. An
 * unverified claim is safe for choosing a rate-limit bucket - forging one gets
 * you your own bucket, which is the opposite of an attack - and catastrophic
 * for deciding what someone may read. `AuthGuard.identityFromBearerToken`
 * verifies an HMAC over the same token and is the only thing entitled to
 * believe it.
 */
function unverifiedClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const decoded = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // A malformed token is not this function's problem to report - AuthGuard
    // rejects it a moment later with a reason. Here it just means the next
    // tier chooses the bucket.
    return null;
  }
}

function bearerToken(headers: unknown): string | null {
  if (headers === null || typeof headers !== 'object') {
    return null;
  }
  const raw = (headers as Record<string, unknown>).authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function headerValue(headers: unknown, name: string): string | null {
  if (headers === null || typeof headers !== 'object') {
    return null;
  }
  const raw = (headers as Record<string, unknown>)[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function firstStringClaim(
  claims: Record<string, unknown>,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const value = claims[name];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Choose the rate-limit bucket for a request (card 1.69).
 *
 * ⚠️ WHY THIS IS NOT SIMPLY `request.user.id`. It was measured, not assumed:
 * there are two global `APP_GUARD` providers - `AuthGuard` in the imported
 * `AuthModule` and `RouteThrottlerGuard` in `AppModule`'s own providers - and
 * NestJS does not guarantee ordering across modules. A probe on a real
 * authenticated `GET /api/tickets` showed the tracker receives a request with
 * **no `user` property at all**: the throttler runs FIRST. So a tracker that
 * read `request.user.id` would have found `undefined` on every request and
 * keyed the entire application into one bucket again - looking fixed and
 * changing nothing, which is precisely the fault card 1.69 exists to remove.
 *
 * Tier 1 is kept anyway. It costs one property read, it is the correct source,
 * and if the guard order ever changes - a NestJS upgrade, a module reshuffle -
 * this starts using it instead of silently degrading.
 *
 * @param req The HTTP request, as the throttler hands it over.
 * @param options `allowInsecureHeaders` MUST mirror
 *   `AuthGuard.shouldAllowInsecureHeaders()`. See the tier-3 comment.
 */
export function resolveThrottleTracker(
  req: TrackerRequest,
  options: { readonly allowInsecureHeaders: boolean },
): ThrottleTracker {
  const user = req.user;
  if (user !== null && typeof user === 'object') {
    const id = (user as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim()) {
      return { key: `user:${id.trim()}`, source: 'user' };
    }
  }
  const token = bearerToken(req.headers);
  if (token) {
    const claims = unverifiedClaims(token);
    // `sub` first, `oid` second: Entra ID issues both, and `oid` is the stable
    // object id where `sub` is pairwise per application. Either identifies one
    // person consistently within this app, which is all a bucket needs. A
    // whole-token hash would also work and was rejected: it changes on every
    // refresh, handing one person a fresh budget every hour.
    const subject = claims && firstStringClaim(claims, ['sub', 'oid']);
    if (subject) {
      return { key: `token:${subject}`, source: 'token' };
    }
  }
  // ⚠️ TIER 3 IS GATED ON PURPOSE, and the gate is the security-relevant line
  // in this file. `x-user-id` / `x-user-email` are accepted as CREDENTIALS only
  // when `AUTH_ALLOW_INSECURE_HEADERS=true` and NODE_ENV is not production. In
  // production they authenticate nothing - so bucketing on them there would let
  // anyone name a header and spend a chosen victim's budget. Keying on them
  // only where they already are the login means this adds no reachable surface.
  if (options.allowInsecureHeaders) {
    const identifier =
      headerValue(req.headers, 'x-user-id') ??
      headerValue(req.headers, 'x-user-email');
    if (identifier) {
      return { key: `header:${identifier.toLowerCase()}`, source: 'header' };
    }
  }
  // ⚠️ NOT A SAFETY NET FOR SIGNED-IN TRAFFIC. There is no `trust proxy`
  // anywhere, so `req.ip` is the immediate peer - the App Service ingress - and
  // all 1,640 production requests measured on 2026-09-10 logged the same
  // `169.254.131.5`. This tier exists for genuinely anonymous routes: card
  // 1.44's email-action links and the inbound webhook, which are `@Public()`
  // and have no user to key on. For those, one shared bucket is the intended
  // behaviour; for anything authenticated it is the bug.
  const ip = typeof req.ip === 'string' && req.ip.trim() ? req.ip.trim() : 'unknown';
  return { key: `ip:${ip}`, source: 'ip' };
}
