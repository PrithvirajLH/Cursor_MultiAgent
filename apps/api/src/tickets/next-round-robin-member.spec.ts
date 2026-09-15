import { leastLoadedMember } from './least-loaded-member.util';
import { nextRoundRobinMember } from './next-round-robin-member.util';

const at = (day: number) => new Date(Date.UTC(2026, 0, day));

/** A five-member team, in join order. */
const TEAM = [
  { userId: 'a', createdAt: at(1) },
  { userId: 'b', createdAt: at(2) },
  { userId: 'c', createdAt: at(3) },
  { userId: 'd', createdAt: at(4) },
  { userId: 'e', createdAt: at(5) },
];

const without = (...ids: string[]) =>
  TEAM.filter((member) => !ids.includes(member.userId));

/**
 * Card 1.112 — round robin used to restart at the top whenever the pointer
 * holder was away.
 *
 * ⚠️ BE HONEST ABOUT THE SIZE OF IT: IT IS SMALL. The pointer is rewritten
 * immediately afterwards, so the rotation self-corrects on the very next
 * ticket. The cost was one extra ticket to `members[0]` per away-event, not the
 * permanent pin the audit's wording implies.
 */
describe('nextRoundRobinMember (card 1.112)', () => {
  it('⚠️ the pointer holder going away does not send two tickets to members[0]', () => {
    // THE REGRESSION ASSERTION. 'b' holds the pointer and goes away; the next
    // ticket must go to 'c', not back to 'a'.
    expect(nextRoundRobinMember(without('b'), 'b', at(2))).toBe('c');
  });

  it('⚠️ two consecutive away-events do not both land on members[0]', () => {
    // The shape the card describes, played out: 'a' is handed the ticket, then
    // 'b' goes away too. Before the fix both steps returned 'a'.
    const afterB = nextRoundRobinMember(without('b'), 'b', at(2));
    expect(afterB).toBe('c');
    const afterC = nextRoundRobinMember(without('b', 'c'), 'c', at(3));
    expect(afterC).toBe('d');
  });

  it('wraps round when the pointer holder was last in the join order', () => {
    expect(nextRoundRobinMember(without('e'), 'e', at(5))).toBe('a');
  });

  it('⚠️ someone who has LEFT the team restarts at the top', () => {
    // There is no position to resume from once the TeamMember row is gone, and
    // the top is the only honest answer. `pointerJoinedAt` is null for exactly
    // this case.
    expect(nextRoundRobinMember(TEAM, 'ghost', null)).toBe('a');
  });

  it('⚠️ the ordinary case is completely unchanged', () => {
    // NON-VACUITY. The pointer holder is available, which is almost every call.
    expect(nextRoundRobinMember(TEAM, 'b', at(2))).toBe('c');
    expect(nextRoundRobinMember(TEAM, 'e', at(5))).toBe('a');
    expect(nextRoundRobinMember(TEAM, null, null)).toBe('a');
  });

  it('an empty available list still returns null', () => {
    expect(nextRoundRobinMember([], 'b', at(2))).toBeNull();
  });

  it('⚠️ LEAST_LOADED tie-breaking is unchanged', () => {
    // NON-VACUITY, and the one the card warns about: `leastLoadedMember` breaks
    // ties by walking the SAME member list from the pointer, so re-sorting that
    // list would silently change card 2.1 - which is deployed but switched off,
    // so no test in production would catch it.
    const noLoad = new Map<string, number>();
    expect(leastLoadedMember(TEAM, noLoad, 'b')).toBe('c');
    expect(leastLoadedMember(TEAM, noLoad, null)).toBe('a');
    expect(leastLoadedMember(without('b'), noLoad, 'b')).toBe('a');
    const loads = new Map([['a', 5], ['b', 5], ['c', 1], ['d', 5], ['e', 5]]);
    expect(leastLoadedMember(TEAM, loads, 'a')).toBe('c');
  });
});
