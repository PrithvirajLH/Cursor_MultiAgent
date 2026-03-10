import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from './realtime.service';

type MockPrisma = {
  team: {
    findMany: jest.Mock;
  };
  slaPolicyConfig: {
    findUnique: jest.Mock;
  };
};

function buildUser(
  overrides: Partial<AuthUser> &
    Pick<AuthUser, 'id' | 'email' | 'displayName' | 'role'>,
): AuthUser {
  return {
    id: overrides.id,
    email: overrides.email,
    displayName: overrides.displayName,
    role: overrides.role,
    teamId: overrides.teamId ?? null,
    teamName: overrides.teamName ?? null,
    teamRole: overrides.teamRole ?? null,
    primaryTeamId: overrides.primaryTeamId ?? null,
  };
}

function createService() {
  const prisma: MockPrisma = {
    team: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    slaPolicyConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  };

  const service = new RealtimeService(
    config as unknown as ConfigService,
    prisma as unknown as PrismaService,
  );

  const client = {
    getClientAccessToken: jest
      .fn()
      .mockResolvedValue({ url: 'wss://example.test/client/hubs/ticketing' }),
    group: jest.fn((groupName: string) => ({
      sendToAll: jest.fn().mockResolvedValue({ groupName }),
    })),
    sendToUser: jest.fn().mockResolvedValue(undefined),
  };

  Object.defineProperty(service as object, 'client', {
    value: client,
    configurable: true,
  });

  return { service, prisma, client };
}

describe('RealtimeService', () => {
  it('negotiates only scoped admin groups for authorized roles', async () => {
    const { service } = createService();

    const agent = await service.negotiateForUser(
      buildUser({
        id: 'agent-1',
        email: 'agent@company.com',
        displayName: 'Agent',
        role: UserRole.AGENT,
        teamId: 'team-1',
      }),
    );
    const lead = await service.negotiateForUser(
      buildUser({
        id: 'lead-1',
        email: 'lead@company.com',
        displayName: 'Lead',
        role: UserRole.LEAD,
        teamId: 'team-1',
      }),
    );
    const teamAdmin = await service.negotiateForUser(
      buildUser({
        id: 'admin-1',
        email: 'admin@company.com',
        displayName: 'Admin',
        role: UserRole.TEAM_ADMIN,
        teamId: 'team-1',
        primaryTeamId: 'team-1',
      }),
    );
    const owner = await service.negotiateForUser(
      buildUser({
        id: 'owner-1',
        email: 'owner@company.com',
        displayName: 'Owner',
        role: UserRole.OWNER,
      }),
    );

    expect(agent.groups).toEqual([]);
    expect(lead.groups).toEqual(['role:lead:team-1']);
    expect(teamAdmin.groups).toEqual(['role:team-admin:team-1']);
    expect(owner.groups).toEqual(['role:owner']);
  });

  it('publishes routing rule changes only to owners and the matching team admin group', async () => {
    const { service, client } = createService();

    await service.publishAdminChanged({
      scope: 'routing_rule',
      action: 'updated',
      entityId: 'routing-1',
      teamId: 'team-2',
      actorId: 'owner-1',
    });

    const groups = client.group.mock.calls.map(([groupName]) => groupName);
    expect(groups).toEqual(['role:owner', 'role:team-admin:team-2']);
    expect(groups).not.toContain('role:lead:team-2');
    expect(
      groups.every((groupName: string) => !groupName.startsWith('team:')),
    ).toBe(true);
  });

  it('publishes global SLA business-hours changes only to scoped lead and team-admin groups', async () => {
    const { service, prisma, client } = createService();
    prisma.team.findMany.mockResolvedValue([
      { id: 'team-1' },
      { id: 'team-2' },
    ]);

    await service.publishAdminChanged({
      scope: 'sla_business_hours',
      action: 'updated',
      entityId: 'global',
      teamId: null,
      actorId: 'owner-1',
    });

    const groups = client.group.mock.calls.map(([groupName]) => groupName);
    expect(groups).toEqual([
      'role:owner',
      'role:team-admin:team-1',
      'role:team-admin:team-2',
      'role:lead:team-1',
      'role:lead:team-2',
    ]);
    expect(
      groups.every((groupName: string) => !groupName.startsWith('team:')),
    ).toBe(true);
  });

  it('uses SLA policy assignments to target only affected lead and team-admin groups', async () => {
    const { service, prisma, client } = createService();
    prisma.slaPolicyConfig.findUnique.mockResolvedValue({
      isDefault: false,
      assignments: [{ teamId: 'team-1' }, { teamId: 'team-3' }],
    });

    await service.publishAdminChanged({
      scope: 'sla_policy',
      action: 'updated',
      entityId: 'policy-1',
      teamId: null,
      actorId: 'owner-1',
    });

    const groups = client.group.mock.calls.map(([groupName]) => groupName);
    expect(groups).toEqual([
      'role:owner',
      'role:team-admin:team-1',
      'role:team-admin:team-3',
      'role:lead:team-1',
      'role:lead:team-3',
    ]);
    expect(groups).not.toContain('role:team-admin:team-2');
    expect(groups).not.toContain('role:lead:team-2');
  });
});
