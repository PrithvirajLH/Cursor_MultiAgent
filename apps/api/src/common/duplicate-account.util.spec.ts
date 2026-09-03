import {
  assessProbableDuplicate,
  type DuplicateCandidate,
} from './duplicate-account.util';

/**
 * Card 1.30. The rule this file pins is not "find duplicates" — it is "never
 * guess which human an abbreviation belongs to".
 *
 * `jsmith@` is a plausible short form of BOTH `john_smith@` and `jane_smith@`.
 * Acting on that automatically would put one person's tickets, including HR and
 * payroll tickets and the internal notes written about them, in front of
 * somebody else. That is worse than the duplicate account being surfaced, so
 * ambiguity must stay ambiguous.
 */

function user(email: string, role = 'EMPLOYEE'): DuplicateCandidate {
  return { id: `id-${email}`, email, role };
}

describe('assessProbableDuplicate', () => {
  describe('the production pair this card exists for', () => {
    it('flags prithviraj_hulgur@ against an existing phulgur@', () => {
      const result = assessProbableDuplicate('prithviraj_hulgur@csnhc.com', [
        user('phulgur@csnhc.com', 'AGENT'),
      ]);
      expect(result.verdict).toBe('probable');
      expect(
        result.verdict === 'probable' && result.matches.map((m) => m.email),
      ).toEqual(['phulgur@csnhc.com']);
    });

    it('flags it in the other direction too, whichever arrives first', () => {
      const result = assessProbableDuplicate('phulgur@csnhc.com', [
        user('prithviraj_hulgur@csnhc.com'),
      ]);
      expect(result.verdict).toBe('probable');
    });
  });

  describe('two different people who share a short form', () => {
    it('is AMBIGUOUS, not a match, when both long forms exist', () => {
      const result = assessProbableDuplicate('jane_smith@csnhc.com', [
        user('jsmith@csnhc.com'),
        user('john_smith@csnhc.com'),
      ]);
      expect(result.verdict).toBe('ambiguous');
    });

    it('is AMBIGUOUS when the short form arrives and two long forms exist', () => {
      // The dangerous direction: jsmith@ logs in, and the system must not pick
      // one of the two people it could be.
      const result = assessProbableDuplicate('jsmith@csnhc.com', [
        user('john_smith@csnhc.com'),
        user('jane_smith@csnhc.com'),
      ]);
      expect(result.verdict).toBe('ambiguous');
    });

    it('never returns a verdict that authorises a merge', () => {
      const result = assessProbableDuplicate('jane_smith@csnhc.com', [
        user('jsmith@csnhc.com'),
        user('john_smith@csnhc.com'),
      ]);
      // There is no 'merge' or 'same' verdict in the type at all; this asserts
      // the intent survives a refactor that adds one.
      expect(['none', 'probable', 'ambiguous']).toContain(result.verdict);
    });
  });

  describe('what it must leave alone', () => {
    it('does not match unrelated addresses', () => {
      expect(
        assessProbableDuplicate('alice@csnhc.com', [user('bob@csnhc.com')])
          .verdict,
      ).toBe('none');
    });

    it('does not match across domains', () => {
      // A different tenant is a different human until somebody says otherwise.
      expect(
        assessProbableDuplicate('prithviraj_hulgur@example.com', [
          user('phulgur@csnhc.com'),
        ]).verdict,
      ).toBe('none');
    });

    it('does not match on surname alone', () => {
      // Same surname, different first initial: two people.
      expect(
        assessProbableDuplicate('alan_hulgur@csnhc.com', [
          user('phulgur@csnhc.com'),
        ]).verdict,
      ).toBe('none');
    });

    it('does not match the address to itself', () => {
      expect(
        assessProbableDuplicate('phulgur@csnhc.com', [
          user('phulgur@csnhc.com'),
        ]).verdict,
      ).toBe('none');
    });

    it('ignores a one-letter surname rather than matching noise', () => {
      expect(
        assessProbableDuplicate('a_b@csnhc.com', [user('ab@csnhc.com')])
          .verdict,
      ).toBe('none');
    });

    it('handles an address that is not an address', () => {
      for (const bad of ['', 'no-at-sign', '@csnhc.com', 'local@']) {
        expect(assessProbableDuplicate(bad, [user('phulgur@csnhc.com')]).verdict)
          .toBe('none');
      }
    });

    it('treats dots and hyphens the same as underscores', () => {
      for (const address of [
        'prithviraj.hulgur@csnhc.com',
        'prithviraj-hulgur@csnhc.com',
      ]) {
        expect(
          assessProbableDuplicate(address, [user('phulgur@csnhc.com')]).verdict,
        ).toBe('probable');
      }
    });

    it('is case and whitespace insensitive', () => {
      expect(
        assessProbableDuplicate('  Prithviraj_Hulgur@CSNHC.com  ', [
          user('phulgur@csnhc.com'),
        ]).verdict,
      ).toBe('probable');
    });

    it('uses the LAST segment as the surname on a three-part address', () => {
      // first_middle_last -> flast, the same convention the tenant uses.
      expect(
        assessProbableDuplicate('prithviraj_kumar_hulgur@csnhc.com', [
          user('phulgur@csnhc.com'),
        ]).verdict,
      ).toBe('probable');
    });
  });
});
