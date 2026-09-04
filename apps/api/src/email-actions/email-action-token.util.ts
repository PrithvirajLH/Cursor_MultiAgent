import { createHmac, timingSafeEqual } from 'crypto';

/** The three things a link from an email is allowed to do. */
export type EmailActionKind = 'confirm' | 'reopen' | 'rate';

export interface EmailActionClaims {
  /** The one ticket this token can touch. */
  ticketId: string;
  /** The one thing it can do. */
  action: EmailActionKind;
  /** The rating, for `rate` only. 1-5. */
  value?: number;
  /** Seconds since the epoch. */
  expiresAt: number;
}

/**
 * Domain separation.
 *
 * The secret may be shared with `AUTH_JWT_SECRET`, so the signed content is
 * prefixed with a constant that no JWT can produce. Without it, a token minted
 * by one scheme could in principle be presented to the other; with it, the two
 * sign different byte strings and neither will verify the other's.
 */
const DOMAIN = 'email-action.v1:';

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64url');

/**
 * Sign one action on one ticket (card 1.44).
 *
 * ⚠️ ONE action per token. A confirm token cannot reopen and a `rate=4` token
 * cannot write 5, because the action and the value are inside the signature.
 * That is the difference between this and the hazard card 1.40 exists to
 * prevent: that token would have let a stranger post a message, whereas this
 * one flips one narrow state on one ticket, reveals nothing, and expires.
 *
 * The token goes in the URL PATH. Never a fragment - fragments are not sent to
 * the server, so the link would silently do nothing.
 */
export function signEmailActionToken(
  claims: EmailActionClaims,
  secret: string,
): string {
  const payload = b64url(
    JSON.stringify({
      t: claims.ticketId,
      a: claims.action,
      ...(claims.value === undefined ? {} : { v: claims.value }),
      e: claims.expiresAt,
    }),
  );
  const signature = createHmac('sha256', secret)
    .update(DOMAIN + payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export type EmailActionVerdict =
  | { ok: true; claims: EmailActionClaims }
  | { ok: false; reason: 'invalid' | 'expired' };

/**
 * Verify a token, in constant time where it matters.
 *
 * Everything malformed answers `invalid` with the same shape, so the endpoint
 * cannot be used to learn which part was wrong. Expiry is reported separately
 * only because an expired link deserves a different sentence for the human -
 * and by then the signature has already been checked, so saying so leaks
 * nothing an attacker could not compute.
 */
export function verifyEmailActionToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): EmailActionVerdict {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'invalid' };
  }
  const [payload, signature] = parts;
  const expected = createHmac('sha256', secret)
    .update(DOMAIN + payload)
    .digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, 'base64url');
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return { ok: false, reason: 'invalid' };
  }
  let parsed: { t?: unknown; a?: unknown; v?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as typeof parsed;
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const action = parsed.a;
  if (
    typeof parsed.t !== 'string' ||
    parsed.t === '' ||
    (action !== 'confirm' && action !== 'reopen' && action !== 'rate') ||
    typeof parsed.e !== 'number'
  ) {
    return { ok: false, reason: 'invalid' };
  }
  // A rating must be a whole 1-5 and must not appear on the other two. A
  // `confirm` token carrying `v: 5` is a tampered token even if it verifies,
  // which it cannot - but the shape is checked anyway rather than trusted.
  if (action === 'rate') {
    if (
      typeof parsed.v !== 'number' ||
      !Number.isInteger(parsed.v) ||
      parsed.v < 1 ||
      parsed.v > 5
    ) {
      return { ok: false, reason: 'invalid' };
    }
  } else if (parsed.v !== undefined) {
    return { ok: false, reason: 'invalid' };
  }
  if (parsed.e * 1000 <= now.getTime()) {
    return { ok: false, reason: 'expired' };
  }
  return {
    ok: true,
    claims: {
      ticketId: parsed.t,
      action,
      ...(action === 'rate' ? { value: parsed.v as number } : {}),
      expiresAt: parsed.e,
    },
  };
}
