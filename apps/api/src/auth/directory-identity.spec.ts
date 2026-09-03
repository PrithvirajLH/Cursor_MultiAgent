import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Card 1.30, PREVENT. The identity key must be `oid`, never `sub`.
 *
 * `sub` is a PAIRWISE subject — scoped per application — so the same human
 * arriving through a different client presents a different value. Keying on it
 * would look like it worked and quietly stop matching, which is exactly the
 * class of failure this card exists to remove. `oid` is the tenant-wide
 * directory object id, and the same value Graph returns as `/me.id`.
 *
 * Asserted against the source because the two claims are one character apart in
 * intent and the failure is silent: nothing would throw, people would simply
 * start acquiring second accounts again.
 */
describe('the directory identity claim', () => {
  const source = readFileSync(join(__dirname, 'auth.guard.ts'), 'utf-8');

  it('reads oid from the token', () => {
    expect(source).toContain("firstStringClaim(claims, ['oid'])");
  });

  it('never uses sub as the directory identity', () => {
    // `sub` is still read for the HS256 branch's userId, which is a different
    // thing entirely — so this asserts the specific misuse, not the mention.
    expect(source).not.toContain("firstStringClaim(claims, ['sub'])");
    expect(source).not.toMatch(/entraObjectId[^\n]*claims\.sub/);
    expect(source).not.toMatch(/entraObjectId:\s*this\.firstStringClaim\(\s*claims,\s*\[\s*'sub'/);
  });

  it('stores the claim on entraObjectId, not on the email', () => {
    expect(source).toContain('entraObjectId: this.firstStringClaim(claims');
  });

  it('resolves by the directory object before the address', () => {
    const byObject = source.indexOf('where: { entraObjectId }');
    const byEmail = source.indexOf('const existing = await this.prisma.user.findUnique');
    expect(byObject).toBeGreaterThan(-1);
    expect(byEmail).toBeGreaterThan(-1);
    expect(byObject).toBeLessThan(byEmail);
  });

  it('does not write email in the profile update, so a token cannot flap it', () => {
    // A human resolved by object can present either address form on any given
    // token; overwriting would make the stored address alternate between them.
    const updateBlock = source.slice(
      source.indexOf('private async applyProfileUpdates'),
      source.indexOf('private async recordDirectoryAddresses'),
    );
    expect(updateBlock).not.toMatch(/updateData\.email\s*=/);
  });
});
