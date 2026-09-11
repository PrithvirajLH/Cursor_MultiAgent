/**
 * Pick the member holding the fewest unfinished tickets (card 2.1).
 *
 * Kept separate from the picker because it is the only part of this strategy
 * with a decision in it: everything else is a query. Pure, so the tie-break can
 * be tested without a database, and so the rule below is written down once.
 *
 * ⚠️ TIES FALL TO THE ROUND-ROBIN POINTER, which is why `lastAssignedUserId`
 * comes in. Evaluation starts at the member AFTER the pointer and the first
 * minimum wins, so a team where everybody holds the same load behaves exactly
 * like round robin rather than handing every ticket to whoever joined first.
 * On a fresh team — no pointer, no tickets — that makes this identical to round
 * robin, which is the correct answer and not an accident.
 *
 * @param members Available members, in the caller's stable order (createdAt).
 * @param openCounts Unfinished ticket count per user id; a missing id means 0.
 * @param lastAssignedUserId The team's pointer, or null.
 * @returns The chosen user id, or null when there are no members.
 */
export function leastLoadedMember(
  members: { userId: string }[],
  openCounts: Map<string, number>,
  lastAssignedUserId: string | null,
): string | null {
  if (members.length === 0) {
    return null;
  }
  const pointerIndex = lastAssignedUserId
    ? members.findIndex((member) => member.userId === lastAssignedUserId)
    : -1;
  // -1 covers both "no pointer" and "the pointer is on somebody who is away or
  // no longer a member", and both mean the same thing: start at the top.
  const start = pointerIndex >= 0 ? pointerIndex + 1 : 0;
  let chosen: string | null = null;
  let lowest = Number.POSITIVE_INFINITY;
  for (let step = 0; step < members.length; step += 1) {
    const member = members[(start + step) % members.length];
    const load = openCounts.get(member.userId) ?? 0;
    // Strictly less than, so the first member reached at the lowest load keeps
    // it — that is the tie-break, and it is the whole reason for the rotation.
    if (load < lowest) {
      lowest = load;
      chosen = member.userId;
    }
  }
  return chosen;
}
