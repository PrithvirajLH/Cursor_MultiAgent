import { leastLoadedMember } from './least-loaded-member.util';

const members = (...ids: string[]) => ids.map((userId) => ({ userId }));

describe('leastLoadedMember (card 2.1)', () => {
  it('⚠️ picks the lightest member, not the next one in rotation', () => {
    // THE CARD'S POINT. The pointer is on a, so round robin would pick b -
    // which is the one drowning. If this test ever agrees with round robin it
    // proves nothing.
    const chosen = leastLoadedMember(
      members('a', 'b', 'c'),
      new Map([
        ['a', 5],
        ['b', 40],
        ['c', 4],
      ]),
      'a',
    );
    expect(chosen).toBe('c');
  });

  it('counts a member with no tickets at all as zero, not as missing', () => {
    const chosen = leastLoadedMember(
      members('a', 'b'),
      new Map([['a', 3]]),
      null,
    );
    expect(chosen).toBe('b');
  });

  it('⚠️ breaks a tie with the pointer, not with the member order', () => {
    // Everybody level. Starting after the pointer is what stops the earliest
    // member taking every ticket on a quiet team.
    const level = new Map([
      ['a', 2],
      ['b', 2],
      ['c', 2],
    ]);
    expect(leastLoadedMember(members('a', 'b', 'c'), level, 'a')).toBe('b');
    expect(leastLoadedMember(members('a', 'b', 'c'), level, 'b')).toBe('c');
    expect(leastLoadedMember(members('a', 'b', 'c'), level, 'c')).toBe('a');
  });

  it('starts at the top when there is no pointer', () => {
    expect(
      leastLoadedMember(members('a', 'b', 'c'), new Map(), null),
    ).toBe('a');
  });

  it('starts at the top when the pointer is on somebody no longer in the list', () => {
    // They went away, or left the team. Card 2.2 filters them out of `members`
    // before this ever runs, so the pointer can legitimately name a stranger.
    expect(
      leastLoadedMember(members('a', 'b'), new Map([['a', 1]]), 'gone'),
    ).toBe('b');
  });

  it('returns null when nobody is available', () => {
    expect(leastLoadedMember([], new Map(), 'a')).toBeNull();
  });

  it('picks the only member there is, however loaded', () => {
    expect(
      leastLoadedMember(members('a'), new Map([['a', 99]]), 'a'),
    ).toBe('a');
  });
});
