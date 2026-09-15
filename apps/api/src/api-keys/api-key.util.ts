import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * How a presented key is recognised, so a leaked string is identifiable on
 * sight in a log or a paste and can be revoked without guessing what it was.
 */
const KEY_PREFIX = 'tk_';

/** 32 bytes of randomness. Guessing is not a threat model at this size. */
const KEY_BYTES = 32;

/**
 * Mint a new key (card 2.6).
 *
 * Returned once and never recoverable: only `hashApiKey(key)` is stored, so the
 * database never holds a usable credential. The caller shows this to the person
 * creating it and then forgets it.
 */
export function generateApiKey(): string {
  return `${KEY_PREFIX}${randomBytes(KEY_BYTES).toString('base64url')}`;
}

/**
 * The stored form of a key.
 *
 * ⚠️ SHA-256 AND DELIBERATELY NOT BCRYPT, WHICH IS THE OPPOSITE OF THE ADVICE
 * FOR PASSWORDS — because the threat is the opposite. A password is short,
 * human-chosen and guessable, so it needs a slow hash to make guessing
 * expensive. This key is 32 bytes from `randomBytes`: there is nothing to
 * guess, and the only thing a slow hash would buy is being unable to look the
 * key up. bcrypt has no queryable form, so every request would have to read
 * every key row and compare each one — turning authentication into a table scan
 * that gets slower as keys are issued.
 *
 * With a fast hash the lookup is a single indexed read on `hashedKey`, and the
 * stored value is still useless to anyone who reads the table.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * Compare two hashes without leaking where they first differ.
 *
 * The indexed lookup already does the finding; this guards the confirmation
 * step, matching what `intake.service.ts` does for the shared intake secret.
 * Never compare a credential with `===`.
 */
export function apiKeyHashMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
