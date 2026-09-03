import { UserRole } from '@prisma/client';
import { canManageOtherFollowers } from './can-manage-followers.util';

/**
 * Card 1.29, 7b. This rule was written out three times — twice enforcing it in
 * `followTicket`/`unfollowTicket`, once asking it in card 1.28's recipient
 * preview. They agreed, but a permission question answered independently in
 * separate places is what cards 1.36 (Fault C) and 1.38 both turned out to be,
 * and here the drift would put an x in front of someone the server refuses.
 */
describe('canManageOtherFollowers', () => {
  it.each([
    [UserRole.OWNER, true],
    [UserRole.TEAM_ADMIN, true],
    [UserRole.LEAD, true],
    [UserRole.AGENT, false],
    [UserRole.EMPLOYEE, false],
  ])('%s -> %s', (role, expected) => {
    expect(canManageOtherFollowers(role)).toBe(expected);
  });

  it('covers every role in the enum, so a new one cannot be forgotten', () => {
    // A role added to the schema without a decision here would default to
    // "cannot", which is the safe direction — but it should be a choice.
    for (const role of Object.values(UserRole)) {
      expect(typeof canManageOtherFollowers(role)).toBe('boolean');
    }
    expect(Object.values(UserRole)).toHaveLength(5);
  });
});
