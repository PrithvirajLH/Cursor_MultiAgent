import { UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ListTeamsDto } from './dto/list-teams.dto';
import { TeamsService } from './teams.service';

type MockPrisma = {
  team: {
    findMany: jest.Mock;
    count: jest.Mock;
  };
};

function user(overrides: Partial<AuthUser>): AuthUser {
  return {
    id: 'user-1',
    email: 'user@company.com',
    displayName: 'User',
    role: UserRole.AGENT,
    primaryTeamId: null,
    ...overrides,
  } satisfies AuthUser;
}

describe('TeamsService.list scoping', () => {
  let service: TeamsService;
  let prisma: MockPrisma;
  let realtime: Pick<RealtimeService, 'publishAdminChanged'>;

  beforeEach(() => {
    prisma = {
      team: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    realtime = { publishAdminChanged: jest.fn() };
    service = new TeamsService(
      prisma as unknown as PrismaService,
      realtime as RealtimeService,
    );
  });

  function whereArg() {
    const calls = prisma.team.findMany.mock.calls as Array<
      [{ where: { id?: unknown; isActive?: boolean } }]
    >;
    return calls[0]?.[0]?.where;
  }

  // AGENT, EMPLOYEE, and OWNER get the full active list (no id filter) — required
  // for the new-ticket department picker and ticket routing/transfer. Only
  // TEAM_ADMIN and LEAD are scoped to their own team.
  it('does not filter teams by id for AGENT (full list for routing)', async () => {
    await service.list(
      {} as ListTeamsDto,
      user({ role: UserRole.AGENT, memberTeamIds: ['T1', 'T2'] }),
    );
    expect(whereArg()?.id).toBeUndefined();
    expect(whereArg()?.isActive).toBe(true);
  });

  it('does not filter teams by id for EMPLOYEE (department picker)', async () => {
    await service.list(
      {} as ListTeamsDto,
      user({ role: UserRole.EMPLOYEE, memberTeamIds: [] }),
    );
    expect(whereArg()?.id).toBeUndefined();
  });

  it('does not filter teams by id for OWNER', async () => {
    await service.list(
      {} as ListTeamsDto,
      user({ id: 'owner-1', role: UserRole.OWNER }),
    );
    expect(whereArg()?.id).toBeUndefined();
  });

  it('scopes TEAM_ADMIN to their primary team', async () => {
    await service.list(
      {} as ListTeamsDto,
      user({ role: UserRole.TEAM_ADMIN, primaryTeamId: 'T7' }),
    );
    expect(whereArg()?.id).toBe('T7');
  });

  it('scopes LEAD to a single team id', async () => {
    await service.list(
      {} as ListTeamsDto,
      user({ role: UserRole.LEAD, teamId: 'T5' }),
    );
    expect(whereArg()?.id).toBe('T5');
  });
});
