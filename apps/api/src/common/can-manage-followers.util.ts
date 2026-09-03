import { UserRole } from '@prisma/client';

/**
 * May this role add or remove OTHER people as followers of a ticket?
 *
 * Anyone may follow or unfollow themselves; this is only about acting on
 * somebody else. One definition, three call sites: `followTicket` and
 * `unfollowTicket` enforce it, and card 1.28's recipient preview asks it so the
 * compose screen does not offer an x the server will refuse.
 *
 * It lives here because the same rule written twice is what card 1.36's Fault C
 * and card 1.38 both turned out to be - a permission question answered
 * independently in two places drifts, and the drift is silent until somebody
 * clicks. It was already written three times when this was consolidated.
 */
export function canManageOtherFollowers(role: UserRole): boolean {
  return (
    role === UserRole.OWNER ||
    role === UserRole.TEAM_ADMIN ||
    role === UserRole.LEAD
  );
}
