import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TicketStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListUsersDto, actor: AuthUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const statusFilter = query.status ?? 'active';
    const activeWhere: Prisma.UserWhereInput =
      statusFilter === 'active'
        ? { isActive: true }
        : statusFilter === 'inactive'
          ? { isActive: false }
          : {};

    const queryWhere: Prisma.UserWhereInput = {
      role: query.role,
      OR: query.q
        ? [
            {
              displayName: { contains: query.q, mode: 'insensitive' as const },
            },
            { email: { contains: query.q, mode: 'insensitive' as const } },
          ]
        : undefined,
      ...activeWhere,
    };
    const scopeWhere = this.buildListScopeWhere(actor);
    const where: Prisma.UserWhereInput = {
      AND: [queryWhere, scopeWhere],
    };

    const [total, data] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { displayName: 'asc' },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          department: true,
          location: true,
          primaryTeamId: true,
          isActive: true,
          deactivatedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  private buildListScopeWhere(actor: AuthUser): Prisma.UserWhereInput {
    if (actor.role === UserRole.OWNER) {
      return {};
    }

    if (actor.role === UserRole.TEAM_ADMIN) {
      if (!actor.primaryTeamId) {
        throw new ForbiddenException(
          'Team administrator must have a primary team set',
        );
      }
      const teamId = actor.primaryTeamId;
      return {
        OR: [
          { id: actor.id },
          { primaryTeamId: teamId },
          { teamMemberships: { some: { teamId } } },
        ],
      };
    }

    if (actor.role === UserRole.LEAD || actor.role === UserRole.AGENT) {
      if (!actor.teamId) {
        throw new ForbiddenException('User is not assigned to a team');
      }
      const teamId = actor.teamId;
      return {
        OR: [{ id: actor.id }, { teamMemberships: { some: { teamId } } }],
      };
    }

    throw new ForbiddenException('Only support roles can list users');
  }

  async updateRole(
    userId: string,
    payload: UpdateUserRoleDto,
    actor: AuthUser,
  ) {
    if (actor.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only owners can update user roles');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Guard against locking everyone out of owner-level admin: forbid an OWNER
    // from demoting themselves, and forbid demoting the last active OWNER.
    // Mirrors the self/last-owner protection in deactivate().
    const demotingFromOwner =
      user.role === UserRole.OWNER && payload.role !== UserRole.OWNER;
    if (demotingFromOwner) {
      if (actor.id === userId) {
        throw new BadRequestException('You cannot change your own owner role');
      }
      const activeOwnerCount = await this.prisma.user.count({
        where: { role: UserRole.OWNER, isActive: true },
      });
      if (activeOwnerCount <= 1) {
        throw new ForbiddenException('Cannot demote the last active owner');
      }
    }

    if (payload.role === UserRole.TEAM_ADMIN) {
      const teamId = payload.primaryTeamId ?? user.primaryTeamId;
      if (!teamId) {
        throw new BadRequestException('TEAM_ADMIN role requires primaryTeamId');
      }
      const team = await this.prisma.team.findUnique({ where: { id: teamId } });
      if (!team) {
        throw new BadRequestException('Primary team not found');
      }
      return this.prisma.user.update({
        where: { id: userId },
        data: { role: payload.role, primaryTeamId: teamId },
      });
    }

    const primaryTeamId =
      payload.role === UserRole.OWNER ? null : (payload.primaryTeamId ?? null);

    return this.prisma.user.update({
      where: { id: userId },
      data: { role: payload.role, primaryTeamId },
    });
  }

  async deactivate(userId: string, actor: AuthUser) {
    if (actor.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only owners can deactivate users');
    }
    if (actor.id === userId) {
      throw new BadRequestException('You cannot deactivate yourself');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true, role: true, email: true, displayName: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.isActive) {
      throw new ConflictException('User is already inactive');
    }
    if (user.role === UserRole.OWNER) {
      throw new ForbiddenException('Cannot deactivate another owner');
    }

    const summary = await this.prisma.$transaction(async (tx) => {
      const openTicketStatuses: TicketStatus[] = [
        TicketStatus.NEW,
        TicketStatus.TRIAGED,
        TicketStatus.ASSIGNED,
        TicketStatus.IN_PROGRESS,
        TicketStatus.WAITING_ON_REQUESTER,
        TicketStatus.WAITING_ON_VENDOR,
        TicketStatus.REOPENED,
      ];

      const unassign = await tx.ticket.updateMany({
        where: { assigneeId: userId, status: { in: openTicketStatuses } },
        data: { assigneeId: null, status: TicketStatus.NEW },
      });

      // Routing rules that pin to this user lose their assignee but keep the team rule
      await tx.routingRule.updateMany({
        where: { assigneeId: userId },
        data: { assigneeId: null },
      });

      const teamRemoval = await tx.teamMember.deleteMany({
        where: { userId },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
          primaryTeamId: null,
        },
      });

      return {
        ticketsUnassigned: unassign.count,
        teamsRemoved: teamRemoval.count,
      };
    });

    await this.recordAdminAuditEvent('USER_DEACTIVATED', { userId, email: user.email, displayName: user.displayName, ...summary }, actor);

    return { ok: true, ...summary };
  }

  async reactivate(userId: string, actor: AuthUser) {
    if (actor.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only owners can reactivate users');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true, email: true, displayName: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.isActive) {
      throw new ConflictException('User is already active');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: true, deactivatedAt: null },
    });

    await this.recordAdminAuditEvent('USER_REACTIVATED', { userId, email: user.email, displayName: user.displayName }, actor);

    return { ok: true };
  }

  async setPrimaryTeam(userId: string, teamId: string | null, actor: AuthUser) {
    if (actor.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only owners can change primary team');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, email: true, displayName: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (teamId !== null) {
      const team = await this.prisma.team.findUnique({ where: { id: teamId } });
      if (!team) {
        throw new BadRequestException('Team not found');
      }
    } else if (user.role === UserRole.TEAM_ADMIN) {
      throw new BadRequestException(
        'TEAM_ADMIN role requires a primary team — clear the role first',
      );
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { primaryTeamId: teamId },
      select: { id: true, primaryTeamId: true, role: true },
    });
    await this.recordAdminAuditEvent(
      'USER_PRIMARY_TEAM_SET',
      { userId, email: user.email, displayName: user.displayName, primaryTeamId: teamId },
      actor,
    );
    return updated;
  }

  /**
   * Returns the impact a deactivation would have without changing anything.
   * Used by the UI to show "this will unassign N tickets, remove from M teams" before confirming.
   */
  async deactivationPreview(userId: string, actor: AuthUser) {
    if (actor.role !== UserRole.OWNER) {
      throw new ForbiddenException('Only owners can preview deactivation');
    }
    const openTicketStatuses: TicketStatus[] = [
      TicketStatus.NEW,
      TicketStatus.TRIAGED,
      TicketStatus.ASSIGNED,
      TicketStatus.IN_PROGRESS,
      TicketStatus.WAITING_ON_REQUESTER,
      TicketStatus.WAITING_ON_VENDOR,
      TicketStatus.REOPENED,
    ];
    const [ticketsOpen, memberships, user] = await Promise.all([
      this.prisma.ticket.count({
        where: { assigneeId: userId, status: { in: openTicketStatuses } },
      }),
      this.prisma.teamMember.findMany({
        where: { userId },
        include: { team: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, displayName: true, isActive: true },
      }),
    ]);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      email: user.email,
      displayName: user.displayName,
      isActive: user.isActive,
      ticketsOpen,
      teams: memberships.map((m) => m.team.name),
    };
  }

  private async recordAdminAuditEvent(
    type: string,
    payload: Record<string, unknown>,
    actor: AuthUser,
  ) {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "AdminAuditEvent" ("id", "type", "payload", "createdById", "teamId", "actorEmail", "actorName", "teamName", "createdAt")
        VALUES (${randomUUID()}, ${type}, ${JSON.stringify(payload)}::jsonb, ${actor.id}, ${null}, ${actor.email}, ${actor.displayName ?? actor.email}, ${null}, now())
      `;
    } catch {
      // Non-blocking audit log write
    }
  }
}
