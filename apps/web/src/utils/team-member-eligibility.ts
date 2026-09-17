import type { UserRef } from "../api/client";

/**
 * The user roles the server will accept as a team member.
 *
 * Kept in step with `ensureEligibleTeamMemberRole` (`teams.service.ts:407`).
 * An OWNER is deliberately absent: owners reach every team already and hold no
 * `TeamMember` row, which the owner settled on 2026-09-17 - *"no owner cannot
 * have team should have access to all the teams"*.
 */
const ELIGIBLE_MEMBER_USER_ROLES = new Set([
  "EMPLOYEE",
  "AGENT",
  "LEAD",
  "TEAM_ADMIN",
]);

/**
 * Whether this person can actually be added to a team (card 1.132).
 *
 * ⚠️ FAILS CLOSED, AND THAT IS THE CHANGE. The picker used to read
 * `!user.role || ELIGIBLE.has(user.role)`, so a record arriving without a role
 * was OFFERED and then refused by the server. A picker that lists somebody
 * unaddable is a promise the page cannot keep.
 *
 * ⚠️ IT CANNOT EMPTY THE PICKER, which is the risk worth naming: closing the
 * filter would be worse than the bug if the endpoint omitted `role`. It does
 * not - `users.service.ts:131` selects `role: true` on the query behind this
 * page. `role` is optional on `UserRef` only because the web's response types
 * are hand-written.
 *
 * @param user A person from the users list.
 * @returns True when the server would accept them as a member.
 */
export function isEligibleTeamMemberUser(user: UserRef): boolean {
  return user.role ? ELIGIBLE_MEMBER_USER_ROLES.has(user.role) : false;
}
