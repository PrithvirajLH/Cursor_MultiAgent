import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator';

/**
 * Whether this reader may see the internal side of a ticket (card 1.83).
 *
 * ⚠️ ONE RULE, TWO READERS. This is lifted verbatim from `listMessages`, which
 * has decided who sees internal NOTES since the payroll-lead case. Card 1.83
 * needs the identical decision for the FILES attached to those notes, and
 * writing it a second time is how the two drift: a later fix to one would leave
 * the other quietly wrong, with a screenshot still downloadable.
 *
 * ⚠️ RELATIONSHIP BEATS RANK, and that is the part most likely to be
 * "simplified" later. It is not `role !== EMPLOYEE`. The requester is excluded
 * whatever their rank, because Payroll is the only department operationally
 * taking tickets — so a payroll lead with a problem about her own pay has
 * nowhere else to file it, and "staff will not raise tickets to their own
 * department" is not a mitigation that exists.
 *
 * ⚠️ Kept as a LEAF: it imports an enum and a type and nothing else. Card 1.103
 * spent a batch breaking a cycle that started with a helper reaching into a
 * feature module.
 */
export function canSeeInternalMessages(
  user: AuthUser,
  ticket: { requesterId: string },
): boolean {
  return !(user.role === UserRole.EMPLOYEE || ticket.requesterId === user.id);
}
