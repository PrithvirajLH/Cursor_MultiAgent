import { MessageType, TeamRole, UserRole } from '@prisma/client';
import { AccessControlService } from '../common/access-control.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  RealtimeService,
  type TicketChangedPayload,
} from '../realtime/realtime.service';
import { TicketRealtimeService } from './ticket-realtime.service';

type MockPrisma = {
  ticket: {
    findUnique: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
  };
};

type MockRealtime = Pick<
  RealtimeService,
  'isEnabled' | 'publishTicketChanged' | 'publishTicketTyping'
> & {
  isEnabled: jest.MockedFunction<RealtimeService['isEnabled']>;
  publishTicketChanged: jest.MockedFunction<
    RealtimeService['publishTicketChanged']
  >;
  publishTicketTyping: jest.MockedFunction<
    RealtimeService['publishTicketTyping']
  >;
};

function buildTeamMembership(
  teamId: string,
  role: TeamRole,
  createdAt: string,
  teamName = teamId,
) {
  return {
    teamId,
    role,
    createdAt: new Date(createdAt),
    team: {
      name: teamName,
    },
  };
}

function buildCandidateUser(params: {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  primaryTeamId?: string | null;
  memberships?: Array<ReturnType<typeof buildTeamMembership>>;
}) {
  return {
    id: params.id,
    email: params.email,
    displayName: params.displayName,
    role: params.role,
    primaryTeamId: params.primaryTeamId ?? null,
    teamMemberships: params.memberships ?? [],
  };
}

describe('TicketRealtimeService', () => {
  let service: TicketRealtimeService;
  let prisma: MockPrisma;
  let realtime: MockRealtime;

  beforeEach(() => {
    prisma = {
      ticket: {
        findUnique: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    };
    realtime = {
      isEnabled: jest.fn() as jest.MockedFunction<RealtimeService['isEnabled']>,
      publishTicketChanged: jest.fn() as jest.MockedFunction<
        RealtimeService['publishTicketChanged']
      >,
      publishTicketTyping: jest.fn() as jest.MockedFunction<
        RealtimeService['publishTicketTyping']
      >,
    };
    realtime.isEnabled.mockReturnValue(true);

    service = new TicketRealtimeService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeService,
      new AccessControlService(),
    );
  });

  it('targets ticket.changed only to users who can actually view the ticket', async () => {
    prisma.ticket.findUnique.mockResolvedValueOnce({
      id: 'ticket-1',
      status: 'IN_PROGRESS',
      priority: 'SEV2',
      updatedAt: new Date('2026-03-09T18:00:00.000Z'),
      assignedTeamId: 'team-1',
      assignedTeam: {
        id: 'team-1',
        name: 'IT Service Desk',
      },
      requesterId: 'requester-1',
      assigneeId: 'agent-1',
      assignee: {
        id: 'agent-1',
        email: 'agent1@company.com',
        displayName: 'Agent One',
      },
      followers: [{ userId: 'requester-1' }],
      accessGrants: [{ teamId: 'team-2' }],
    });
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'agent-1',
      email: 'agent1@company.com',
      displayName: 'Agent One',
    });
    prisma.user.findMany.mockResolvedValueOnce([
      buildCandidateUser({
        id: 'requester-1',
        email: 'requester@company.com',
        displayName: 'Requester',
        role: UserRole.EMPLOYEE,
      }),
      buildCandidateUser({
        id: 'agent-1',
        email: 'agent1@company.com',
        displayName: 'Agent One',
        role: UserRole.AGENT,
        memberships: [
          buildTeamMembership(
            'team-1',
            TeamRole.AGENT,
            '2026-01-01T00:00:00.000Z',
          ),
        ],
      }),
      buildCandidateUser({
        id: 'agent-2',
        email: 'agent2@company.com',
        displayName: 'Agent Two',
        role: UserRole.AGENT,
        memberships: [
          buildTeamMembership(
            'team-1',
            TeamRole.AGENT,
            '2026-01-02T00:00:00.000Z',
          ),
        ],
      }),
      buildCandidateUser({
        id: 'lead-1',
        email: 'lead@company.com',
        displayName: 'Lead',
        role: UserRole.LEAD,
        memberships: [
          buildTeamMembership(
            'team-1',
            TeamRole.LEAD,
            '2026-01-03T00:00:00.000Z',
          ),
        ],
      }),
      buildCandidateUser({
        id: 'admin-1',
        email: 'admin@company.com',
        displayName: 'Admin',
        role: UserRole.TEAM_ADMIN,
        primaryTeamId: 'team-1',
        memberships: [
          buildTeamMembership(
            'team-1',
            TeamRole.ADMIN,
            '2026-01-04T00:00:00.000Z',
          ),
        ],
      }),
      buildCandidateUser({
        id: 'grant-agent-1',
        email: 'grant@company.com',
        displayName: 'Grant Agent',
        role: UserRole.AGENT,
        memberships: [
          buildTeamMembership(
            'team-2',
            TeamRole.AGENT,
            '2026-01-05T00:00:00.000Z',
          ),
        ],
      }),
    ]);

    const message: NonNullable<TicketChangedPayload['message']> = {
      id: 'message-1',
      body: 'Need more logs',
      type: MessageType.PUBLIC,
      createdAt: '2026-03-09T18:00:00.000Z',
      author: {
        id: 'agent-1',
        email: 'agent1@company.com',
        displayName: 'Agent One',
      },
    };

    await service.emitTicketRealtimeEvent({
      ticketId: 'ticket-1',
      reason: 'message_added',
      actorId: 'agent-1',
      message,
    });

    expect(realtime.publishTicketChanged).toHaveBeenCalledTimes(1);
    const changedPayload = realtime.publishTicketChanged.mock.calls[0][0];
    const changedAudience = realtime.publishTicketChanged.mock.calls[0][1];
    expect(changedPayload).toMatchObject({
      ticketId: 'ticket-1',
      reason: 'message_added',
      message,
    });
    expect(changedAudience.userIds).toEqual(
      expect.arrayContaining([
        'requester-1',
        'agent-1',
        'lead-1',
        'admin-1',
        'grant-agent-1',
      ]),
    );
    expect(changedAudience.userIds).not.toContain('agent-2');
    expect(changedAudience.userIds).not.toContain('owner-1');
  });

  it('applies the same view rules to typing events', async () => {
    prisma.user.findMany.mockResolvedValueOnce([
      buildCandidateUser({
        id: 'requester-1',
        email: 'requester@company.com',
        displayName: 'Requester',
        role: UserRole.EMPLOYEE,
      }),
      buildCandidateUser({
        id: 'agent-1',
        email: 'agent1@company.com',
        displayName: 'Agent One',
        role: UserRole.AGENT,
        memberships: [
          buildTeamMembership(
            'team-1',
            TeamRole.AGENT,
            '2026-01-01T00:00:00.000Z',
          ),
        ],
      }),
      buildCandidateUser({
        id: 'agent-2',
        email: 'agent2@company.com',
        displayName: 'Agent Two',
        role: UserRole.AGENT,
        memberships: [
          buildTeamMembership(
            'team-1',
            TeamRole.AGENT,
            '2026-01-02T00:00:00.000Z',
          ),
        ],
      }),
      buildCandidateUser({
        id: 'lead-1',
        email: 'lead@company.com',
        displayName: 'Lead',
        role: UserRole.LEAD,
        memberships: [
          buildTeamMembership(
            'team-1',
            TeamRole.LEAD,
            '2026-01-03T00:00:00.000Z',
          ),
        ],
      }),
      buildCandidateUser({
        id: 'admin-1',
        email: 'admin@company.com',
        displayName: 'Admin',
        role: UserRole.TEAM_ADMIN,
        primaryTeamId: 'team-1',
        memberships: [
          buildTeamMembership(
            'team-1',
            TeamRole.ADMIN,
            '2026-01-04T00:00:00.000Z',
          ),
        ],
      }),
    ]);

    await service.publishTicketTypingForTicket({
      ticket: {
        id: 'ticket-1',
        requesterId: 'requester-1',
        assigneeId: 'agent-1',
        assignedTeamId: 'team-1',
        followers: [{ userId: 'requester-1' }],
        accessGrants: [],
      },
      actor: {
        id: 'agent-1',
        email: 'agent1@company.com',
        displayName: 'Agent One',
      },
      isTyping: true,
    });

    expect(realtime.publishTicketTyping).toHaveBeenCalledTimes(1);
    const typingAudience = realtime.publishTicketTyping.mock.calls[0][1];
    expect(typingAudience.userIds).toEqual(
      expect.arrayContaining(['requester-1', 'agent-1', 'lead-1', 'admin-1']),
    );
    expect(typingAudience.userIds).not.toContain('agent-2');
    expect(typingAudience.userIds).not.toContain('owner-1');
  });
});
