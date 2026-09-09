/**
 * Turn a `jose` verification failure into safe, greppable log detail (card 1.54).
 *
 * ⚠️ THIS IS THE HALF THAT MAKES A PRODUCTION 401 DIAGNOSABLE.
 *
 * `verifyAzureJwt` wraps `jwtVerify` in a `try/catch` that throws a single
 * `'Invalid bearer token'` for every possible failure. Production runs the
 * Azure/RS256 path exclusively, and `validateRegisteredClaims` — the only code
 * that can say `'Token expired'` — is reached **only on the HS256 branch**. So
 * an expired production token has never been distinguishable from a forged
 * signature, a wrong audience, or an unreachable JWKS endpoint: all four arrive
 * as the same message behind the same `statusCode: 401`.
 *
 * `jose` already knows which it was. Its errors carry a stable `code`
 * (`ERR_JWT_EXPIRED`, `ERR_JWS_SIGNATURE_VERIFICATION_FAILED`,
 * `ERR_JWT_CLAIM_VALIDATION_FAILED`, `ERR_JWKS_NO_MATCHING_KEY`,
 * `ERR_JWKS_TIMEOUT`, …) plus `claim` and `reason` on claim failures. This
 * lifts those out so the log names the cause while the HTTP response stays
 * deliberately vague — a caller learns nothing new, an operator learns
 * everything.
 *
 * ⚠️ **`payload` is never read.** `jose`'s `JWTExpired` carries the entire
 * decoded token payload, and an id_token payload is a credential in a log that
 * ships to Kudu. Only the three fields below are copied out, by name, so a
 * later `...error` spread cannot quietly start exporting the token.
 */
export function joseRejectionDetail(error: unknown): Record<string, string> {
  if (typeof error !== 'object' || error === null) {
    return { cause: 'unknown' };
  }
  const candidate = error as {
    code?: unknown;
    name?: unknown;
    claim?: unknown;
    reason?: unknown;
  };
  const detail: Record<string, string> = {};
  // `code` is jose's stable identifier and the thing worth grepping for; `name`
  // is the fallback for a non-jose error reaching the same catch.
  if (typeof candidate.code === 'string' && candidate.code) {
    detail.cause = candidate.code;
  } else if (typeof candidate.name === 'string' && candidate.name) {
    detail.cause = candidate.name;
  } else {
    detail.cause = 'unknown';
  }
  // Which claim failed, and jose's own word for why. Both are claim NAMES and
  // fixed enum-like strings, never claim values, so neither can carry identity.
  if (typeof candidate.claim === 'string' && candidate.claim) {
    detail.claim = candidate.claim;
  }
  if (typeof candidate.reason === 'string' && candidate.reason) {
    detail.claimReason = candidate.reason;
  }
  return detail;
}
