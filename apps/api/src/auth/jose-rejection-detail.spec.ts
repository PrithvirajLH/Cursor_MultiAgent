import {
  JWSSignatureVerificationFailed,
  JWTClaimValidationFailed,
  JWTExpired,
  JWKSNoMatchingKey,
} from 'jose/errors';
import { joseRejectionDetail } from './jose-rejection-detail.util';

/**
 * Card 1.54 — the production path.
 *
 * Production authenticates with Azure/RS256, where `verifyAzureJwt` collapses
 * every `jose` failure into one `'Invalid bearer token'`. `validateRegisteredClaims`,
 * the only code that can say `'Token expired'`, is never reached on that branch.
 * These tests pin the mapping that recovers the real cause for the log.
 */
describe('joseRejectionDetail (card 1.54)', () => {
  it('⚠️ distinguishes an EXPIRED token from a forged one', () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. These two arrive at the
    // same catch and produce the same 401; before this card the log could not
    // tell "the owner's tab sat idle" from "someone is presenting a bad token".
    const expired = joseRejectionDetail(
      new JWTExpired('token expired', {}, 'exp', 'check_failed'),
    );
    const forged = joseRejectionDetail(new JWSSignatureVerificationFailed());
    expect(expired.cause).toBe('ERR_JWT_EXPIRED');
    expect(forged.cause).toBe('ERR_JWS_SIGNATURE_VERIFICATION_FAILED');
    expect(expired.cause).not.toBe(forged.cause);
  });

  it('names the failing claim on a claim-validation error', () => {
    const detail = joseRejectionDetail(
      new JWTClaimValidationFailed('unexpected "aud"', {}, 'aud', 'check_failed'),
    );
    expect(detail.cause).toBe('ERR_JWT_CLAIM_VALIDATION_FAILED');
    expect(detail.claim).toBe('aud');
  });

  it('reports a JWKS miss, which is a key-rollover symptom rather than a bad token', () => {
    const detail = joseRejectionDetail(new JWKSNoMatchingKey());
    expect(detail.cause).toBe('ERR_JWKS_NO_MATCHING_KEY');
  });

  it('⚠️ never copies the decoded payload out of the error', () => {
    // `jose`'s JWTExpired carries the whole decoded payload, and this log ships
    // to Kudu. The mapper copies three named fields; it must never grow into a
    // spread of the error object.
    const error = new JWTExpired('token expired', {}, 'exp', 'check_failed');
    (error as unknown as { payload: unknown }).payload = {
      email: 'owner@company.com',
      oid: 'a-directory-object-id',
      sub: 'a-pairwise-subject',
    };
    const detail = joseRejectionDetail(error);
    const serialised = JSON.stringify(detail);
    expect(serialised).not.toContain('owner@company.com');
    expect(serialised).not.toContain('a-directory-object-id');
    expect(serialised).not.toContain('a-pairwise-subject');
    expect(Object.keys(detail).sort()).toEqual(['cause', 'claim', 'claimReason']);
  });

  it('falls back to the error name, then to unknown, for a non-jose throw', () => {
    expect(joseRejectionDetail(new TypeError('fetch failed')).cause).toBe(
      'TypeError',
    );
    expect(joseRejectionDetail('a string').cause).toBe('unknown');
    expect(joseRejectionDetail(null).cause).toBe('unknown');
  });
});
