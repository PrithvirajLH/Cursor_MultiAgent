/**
 * The next member in the rotation (card 1.112).
 *
 * ⚠️ IT USED TO RESTART AT THE TOP WHENEVER THE POINTER HOLDER WAS AWAY.
 * The rotation did `findIndex(member => member.userId === lastAssignedUserId)`
 * against the AVAILABLE member list, and when that person was unavailable or
 * had left the team `findIndex` returned -1, leaving `nextMember` as
 * `members[0]`. So going away handed an extra ticket to whoever joined the team
 * first.
 *
 * ⚠️ BE HONEST ABOUT THE SIZE OF IT: IT IS SMALL. The pointer is rewritten
 * immediately afterwards, so the rotation self-corrects on the very next
 * ticket. The cost is one extra ticket to `members[0]` per away-event, not a
 * permanent pin. It is worth fixing because it is a few lines and fairness is
 * the entire point of round robin, not because it is urgent.
 *
 * The fix resumes from a POSITION rather than from zero: given where the
 * pointer holder sits in the team's join order, take the first available member
 * who joined after them, wrapping round.
 *
 * Kept pure and separate for the same reason `leastLoadedMember` is - it is the
 * only part of the strategy with a decision in it, and this way the away case
 * can be tested without a database.
 *
 * @param members Available members, in the caller's stable order (createdAt).
 * @param lastAssignedUserId The team's pointer, or null.
 * @param pointerJoinedAt When the pointer holder joined the team, or null when
 *   they are no longer a member at all - then there is no position to resume
 *   from and the top is the only honest answer.
 * @returns The chosen user id, or null when there are no available members.
 */
export function nextRoundRobinMember(
  members: { userId: string; createdAt: Date }[],
  lastAssignedUserId: string | null,
  pointerJoinedAt: Date | null,
): string | null {
  if (members.length === 0) {
    return null;
  }
  if (!lastAssignedUserId) {
    return members[0].userId;
  }
  const currentIndex = members.findIndex(
    (member) => member.userId === lastAssignedUserId,
  );
  if (currentIndex >= 0) {
    // The ordinary case, unchanged: the pointer holder is available.
    return members[(currentIndex + 1) % members.length].userId;
  }
  if (!pointerJoinedAt) {
    return members[0].userId;
  }
  const next = members.find(
    (member) => member.createdAt.getTime() > pointerJoinedAt.getTime(),
  );
  return (next ?? members[0]).userId;
}
