/**
 * May this person publish a saved view to their whole team (card 1.53)?
 *
 * ⚠️ THE SERVER IS THE GATE, NOT THIS. `SavedViewsService` refuses a `teamId`
 * from anyone who is not a team admin or an owner, and that check is the one
 * that matters. This exists so the checkbox is not offered to people it would
 * only frustrate - an inert control invites "why can't I?", and a control that
 * appears to work and then 403s is worse.
 *
 * Mirrors `canManageTeamViews` on the API deliberately closely. If the two ever
 * disagree the server wins and the user sees a refusal, which is the safe
 * direction for a permission check to drift.
 *
 * @param role The caller's role, as the session reports it.
 * @param teamId Their resolved primary team; nothing to share with when null.
 */
export function canShareViewWithTeam(
  role: string | undefined,
  teamId: string | null,
): boolean {
  if (role === "OWNER") {
    return true;
  }
  return role === "TEAM_ADMIN" && teamId !== null;
}
