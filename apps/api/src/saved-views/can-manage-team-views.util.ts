import { UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';

/**
 * May this user manage TEAM-WIDE saved views for `teamId`?
 *
 * ⚠️ THIS MAKES THE RULE STRICTER, NOT LOOSER. Before card 1.53 there was no
 * role check at all: `create()` honoured `dto.teamId` whenever it matched the
 * caller's own team, so any user - an EMPLOYEE included - could create a view
 * that appeared in every colleague's sidebar.
 *
 * OWNER manages any team. TEAM_ADMIN manages their own. Nobody else manages a
 * team view at all, and personal views are untouched by this function.
 *
 * ⚠️ Uses the single resolved `teamId`, matching `list()` and the rest of this
 * service. `AuthUser` also carries `memberTeamIds`, but a multi-team admin
 * managing several teams' views is a different feature nobody has asked for -
 * and unioning here would let one team's admin edit another's.
 */
export function canManageTeamViews(user: AuthUser, teamId: string): boolean {
  if (user.role === UserRole.OWNER) {
    return true;
  }
  return user.role === UserRole.TEAM_ADMIN && user.teamId === teamId;
}
