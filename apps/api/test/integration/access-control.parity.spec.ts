import { Prisma, UserRole } from '@prisma/client';
import { AccessControlService } from '../../src/common/access-control.service';
import type { AuthUser } from '../../src/auth/current-user.decorator';
import { fixtureTeamIds, fixtureUserIds } from '../utils/fixtures';
import { disconnectPrisma, getPrisma } from '../utils/prisma';
import { resetTestDb } from '../utils/reset-test-db';

/**
 * `AccessControlService` expresses one visibility rule twice: as a Prisma
 * `where` filter (`buildTicketAccessFilter`) and as raw SQL
 * (`accessConditionSql`). The two are hand-synced, so any drift between them is
 * a silent cross-team data leak — one code path would return tickets the other
 * correctly hides.
 *
 * This suite is the drift detector. For every role and team shape it asserts
 * both paths select an identical set of ticket ids. It is a security control,
 * not a nicety: if it fails, do not "fix" it by loosening the assertion.
 */
describe('AccessControlService — ORM/SQL parity', () => {
  const prisma = getPrisma();
  const accessControl = new AccessControlService();

  let ticketIds: {
    it: string;
    hr: string;
    unassigned: string;
    grantedToIt: string;
  };

  beforeAll(async () => {
    resetTestDb();

    const base = {
      requesterId: fixtureUserIds.requester,
      description: 'Parity fixture ticket',
    };

    const itTicket = await prisma.ticket.create({
      data: {
        ...base,
        subject: 'Parity — assigned to IT',
        assignedTeamId: fixtureTeamIds.it,
      },
      select: { id: true },
    });

    const hrTicket = await prisma.ticket.create({
      data: {
        ...base,
        subject: 'Parity — assigned to HR',
        assignedTeamId: fixtureTeamIds.hr,
      },
      select: { id: true },
    });

    // No assigned team, and requested by a different user, so it is invisible to
    // every team-scoped role and visible only to OWNER and its own requester.
    const unassignedTicket = await prisma.ticket.create({
      data: {
        ...base,
        requesterId: fixtureUserIds.otherRequester,
        subject: 'Parity — unassigned',
        assignedTeamId: null,
      },
      select: { id: true },
    });

    // Owned by HR but explicitly shared with IT: exercises the accessGrants
    // branch, which the ORM expresses as a nested `some` and the SQL path as an
    // EXISTS subquery. Most likely place for the two to diverge.
    const grantedTicket = await prisma.ticket.create({
      data: {
        ...base,
        subject: 'Parity — HR ticket granted to IT',
        assignedTeamId: fixtureTeamIds.hr,
        accessGrants: { create: [{ teamId: fixtureTeamIds.it }] },
      },
      select: { id: true },
    });

    ticketIds = {
      it: itTicket.id,
      hr: hrTicket.id,
      unassigned: unassignedTicket.id,
      grantedToIt: grantedTicket.id,
    };
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  async function idsViaOrm(user: AuthUser): Promise<string[]> {
    const rows = await prisma.ticket.findMany({
      where: accessControl.buildTicketAccessFilter(user),
      select: { id: true },
    });
    return rows.map((row) => row.id).sort();
  }

  async function idsViaSql(user: AuthUser): Promise<string[]> {
    const condition = accessControl.accessConditionSql(user, 't');
    const rows = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT t."id" FROM "Ticket" t WHERE ${condition}`,
    );
    return rows.map((row) => row.id).sort();
  }

  function buildUser(overrides: Partial<AuthUser> & { role: UserRole }): AuthUser {
    return {
      id: fixtureUserIds.agent,
      email: 'parity@company.com',
      displayName: 'Parity Probe',
      teamId: null,
      primaryTeamId: null,
      memberTeamIds: [],
      ...overrides,
    };
  }

  const cases: Array<{ name: string; user: AuthUser }> = [
    {
      name: 'OWNER (platform-wide)',
      user: buildUser({ role: UserRole.OWNER, id: fixtureUserIds.owner }),
    },
    {
      name: 'TEAM_ADMIN with a primary team',
      user: buildUser({
        role: UserRole.TEAM_ADMIN,
        id: fixtureUserIds.admin,
        primaryTeamId: fixtureTeamIds.it,
      }),
    },
    {
      name: 'TEAM_ADMIN with no primary team (falls through to team scope)',
      user: buildUser({
        role: UserRole.TEAM_ADMIN,
        id: fixtureUserIds.admin,
        primaryTeamId: null,
        memberTeamIds: [fixtureTeamIds.hr],
      }),
    },
    {
      name: 'LEAD on one team',
      user: buildUser({
        role: UserRole.LEAD,
        id: fixtureUserIds.lead,
        teamId: fixtureTeamIds.it,
        memberTeamIds: [fixtureTeamIds.it],
      }),
    },
    {
      name: 'LEAD on multiple teams (flatMap branch)',
      user: buildUser({
        role: UserRole.LEAD,
        id: fixtureUserIds.lead,
        teamId: fixtureTeamIds.it,
        memberTeamIds: [fixtureTeamIds.it, fixtureTeamIds.hr],
      }),
    },
    {
      name: 'AGENT on one team',
      user: buildUser({
        role: UserRole.AGENT,
        memberTeamIds: [fixtureTeamIds.it],
      }),
    },
    {
      name: 'AGENT on multiple teams',
      user: buildUser({
        role: UserRole.AGENT,
        memberTeamIds: [fixtureTeamIds.it, fixtureTeamIds.hr],
      }),
    },
    {
      name: 'AGENT with no team membership (falls back to own requests)',
      user: buildUser({
        role: UserRole.AGENT,
        memberTeamIds: [],
        teamId: null,
      }),
    },
    {
      name: 'AGENT falling back to the session teamId when memberTeamIds is empty',
      user: buildUser({
        role: UserRole.AGENT,
        memberTeamIds: [],
        teamId: fixtureTeamIds.it,
      }),
    },
    {
      name: 'EMPLOYEE (own tickets only)',
      user: buildUser({
        role: UserRole.EMPLOYEE,
        id: fixtureUserIds.requester,
      }),
    },
  ];

  it.each(cases)(
    'ORM and SQL select the same tickets for $name',
    async ({ user }) => {
      const [ormIds, sqlIds] = await Promise.all([
        idsViaOrm(user),
        idsViaSql(user),
      ]);
      expect(sqlIds).toEqual(ormIds);
    },
  );

  it('actually discriminates — an IT agent cannot see the HR-only ticket', async () => {
    const itAgent = buildUser({
      role: UserRole.AGENT,
      memberTeamIds: [fixtureTeamIds.it],
    });
    const visible = await idsViaOrm(itAgent);
    expect(visible).toContain(ticketIds.it);
    expect(visible).toContain(ticketIds.grantedToIt);
    expect(visible).not.toContain(ticketIds.hr);
    expect(visible).not.toContain(ticketIds.unassigned);
  });

  it('grants cross-team read through TicketAccess in both paths', async () => {
    const itAgent = buildUser({
      role: UserRole.AGENT,
      memberTeamIds: [fixtureTeamIds.it],
    });
    const [ormIds, sqlIds] = await Promise.all([
      idsViaOrm(itAgent),
      idsViaSql(itAgent),
    ]);
    expect(ormIds).toContain(ticketIds.grantedToIt);
    expect(sqlIds).toContain(ticketIds.grantedToIt);
  });

  it('rejects an unsafe SQL alias rather than interpolating it', () => {
    const owner = buildUser({ role: UserRole.OWNER });
    expect(() => accessControl.accessConditionSql(owner, 't; DROP TABLE')).toThrow(
      /Invalid SQL alias/,
    );
  });
});
