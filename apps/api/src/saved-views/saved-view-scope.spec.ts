import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator';
import { canManageTeamViews } from './can-manage-team-views.util';

function user(partial: Partial<AuthUser> & { role: UserRole }): AuthUser {
  return {
    id: 'u1',
    email: 'u@company.com',
    displayName: 'U',
    ...partial,
  } as AuthUser;
}

const PAYROLL = 'team-payroll';
const IT = 'team-it';

/**
 * Card 1.53 — who may publish a view into everybody else's sidebar.
 */
describe('canManageTeamViews (card 1.53)', () => {
  it('⚠️ an EMPLOYEE cannot create a team view, even for their own team', () => {
    // THE ASSERTION THAT FAILS IF THE BUG COMES BACK. There was NO role check
    // at all: `create()` honoured `dto.teamId` whenever it matched the caller's
    // own team, so any user could publish a view to every colleague's sidebar.
    // The requirement makes this stricter, not looser.
    expect(
      canManageTeamViews(
        user({ role: UserRole.EMPLOYEE, teamId: PAYROLL }),
        PAYROLL,
      ),
    ).toBe(false);
    expect(
      canManageTeamViews(
        user({ role: UserRole.AGENT, teamId: PAYROLL }),
        PAYROLL,
      ),
    ).toBe(false);
    // A LEAD runs the queue but does not administer the team.
    expect(
      canManageTeamViews(
        user({ role: UserRole.LEAD, teamId: PAYROLL }),
        PAYROLL,
      ),
    ).toBe(false);
  });

  it('a TEAM_ADMIN manages their own team', () => {
    expect(
      canManageTeamViews(
        user({ role: UserRole.TEAM_ADMIN, teamId: PAYROLL }),
        PAYROLL,
      ),
    ).toBe(true);
  });

  it("⚠️ a TEAM_ADMIN cannot manage a DIFFERENT team's views", () => {
    // The other half of the gate: scoping by role alone would let Payroll's
    // admin publish into IT's sidebar.
    expect(
      canManageTeamViews(
        user({ role: UserRole.TEAM_ADMIN, teamId: PAYROLL }),
        IT,
      ),
    ).toBe(false);
  });

  it('an OWNER manages any team', () => {
    expect(
      canManageTeamViews(user({ role: UserRole.OWNER, teamId: IT }), PAYROLL),
    ).toBe(true);
    expect(
      canManageTeamViews(user({ role: UserRole.OWNER, teamId: null }), PAYROLL),
    ).toBe(true);
  });

  it('a team admin with no resolved team manages nothing', () => {
    expect(
      canManageTeamViews(
        user({ role: UserRole.TEAM_ADMIN, teamId: null }),
        PAYROLL,
      ),
    ).toBe(false);
  });
});
