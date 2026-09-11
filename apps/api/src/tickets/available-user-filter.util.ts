import { Prisma } from '@prisma/client';

/**
 * Who is currently taking auto-assigned work (card 2.2).
 *
 * Auto-assignment was sending tickets to people on leave. This is the one
 * definition of "actually here", written once so the round-robin picker and the
 * least-loaded picker (card 2.1) cannot answer it differently — one rule in two
 * places is the drift behind cards 1.36, 1.38, 1.47, 1.50, 1.61, 1.70, 1.71,
 * 1.75 and 1.77.
 *
 * ⚠️ A PAST `awayUntil` COUNTS AS BACK, even if the stored flag still says away.
 * The scheduled job flips the flag at the return date, but making correctness
 * depend on a job having run is how somebody stays invisible for a week because
 * a worker was wedged. The flag is what the UI shows; this expression is what
 * assignment believes, and it is self-healing.
 *
 * The two are not redundant: `isAvailable: false` with a null `awayUntil` is
 * "away indefinitely", which no date could express.
 *
 * ⚠️ Deliberately says nothing about `isActive`. Deactivating a user deletes
 * their `TeamMember` rows, so they are already out of every rotation; adding
 * the check here would be dead code that reads like a safeguard.
 *
 * @param now Injectable for tests; defaults to the current time.
 * @returns A `User` filter suitable for a relation filter on `TeamMember`.
 */
export function availableUserFilter(now: Date = new Date()): Prisma.UserWhereInput {
  return {
    OR: [{ isAvailable: true }, { awayUntil: { not: null, lte: now } }],
  };
}
