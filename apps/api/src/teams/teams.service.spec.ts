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

describe('TeamsService.list scoping (BUG-09)', () => {
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

  it('scopes AGENT to their member team ids', async () => {
    await service.list(
      {} as ListTeamsDto,
      user({ role: UserRole.AGENT, memberTeamIds: ['T1', 'T2'] }),
    );
    expect(whereArg()?.id).toEqual({ in: ['T1', 'T2'] });
  });

  it('drops falsy member team ids for AGENT', async () => {
    await service.list(
      {} as ListTeamsDto,
      user({ role: UserRole.AGENT, memberTeamIds: ['T1', '', 'T2'] }),
    );
    expect(whereArg()?.id).toEqual({ in: ['T1', 'T2'] });
  });

  it('falls back to session teamId for AGENT without memberTeamIds', async () => {
    await service.list(
      {} as ListTeamsDto,
      user({ role: UserRole.AGENT, memberTeamIds: [], teamId: 'T9' }),
    );
    expect(whereArg()?.id).toEqual({ in: ['T9'] });
  });

  it('scopes AGENT with no teams to an empty id set (sees nothing)', async () => {
    await service.list(
      {} as ListTeamsDto,
      user({ role: UserRole.AGENT, memberTeamIds: [], teamId: null }),
    );
    expect(whereArg()?.id).toEqual({ in: [] });
  });

  it('scopes EMPLOYEE to their member team ids', async () => {
    await service.list(
      {} as ListTeamsDto,
      user({ role: UserRole.EMPLOYEE, memberTeamIds: ['T3'] }),
    );
    expect(whereArg()?.id).toEqual({ in: ['T3'] });
  });

  it('scopes EMPLOYEE with no teams to an empty id set', async () => {
    await service.list(
      {} as ListTeamsDto,
      user({ role: UserRole.EMPLOYEE, memberTeamIds: [] }),
    );
    expect(whereArg()?.id).toEqual({ in: [] });
  });

  it('does not filter teams by id for OWNER', async () => {
    await service.list(
      {} as ListTeamsDto,
      user({ id: 'owner-1', role: UserRole.OWNER }),
    );
    expect(whereArg()?.id).toBeUndefined();
  });

  it('scopes LEAD to a single team id', async () => {
    await service.list(
      {} as ListTeamsDto,
      user({ role: UserRole.LEAD, teamId: 'T5' }),
    );
    expect(whereArg()?.id).toBe('T5');
  });
});
