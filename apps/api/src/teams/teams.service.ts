import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TeamRole, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { CreateTeamDto } from './dto/create-team.dto';
import { ListTeamsDto } from './dto/list-teams.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListTeamsDto, user?: AuthUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const baseWhere: { isActive: boolean; id?: string } = {
      isActive: true,
    };
    if (user?.role === UserRole.TEAM_ADMIN) {
      if (!user.primaryTeamId) {
        throw new ForbiddenException(
          'Team administrator must have a primary team set',
        );
      }
      baseWhere.id = user.primaryTeamId;
    }
    if (user?.role === UserRole.LEAD) {
      const leadTeamId = user.teamId ?? user.primaryTeamId;
      if (!leadTeamId) {
        throw new ForbiddenException('Lead must belong to a team');
      }
      baseWhere.id = leadTeamId;
    }
    // OWNER and non-privileged roles: no team filter (full list or caller restricts elsewhere)
    const where = {
      ...baseWhere,
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              {
                description: {
                  contains: query.q,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.team.count({ where }),
      this.prisma.team.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { name: 'asc' },
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

  async create(payload: CreateTeamDto, user: AuthUser) {
    this.ensureOwner(user);
    const slug = payload.slug ?? this.slugify(payload.name);

    return this.prisma.team.create({
      data: {
        name: payload.name,
        slug,
        description: payload.description,
        assignmentStrategy: payload.assignmentStrategy,
      },
    });
  }

  async update(teamId: string, payload: UpdateTeamDto, user: AuthUser) {
    this.ensureTeamAdminOrOwner(user, teamId);

    await this.ensureTeam(teamId);

    return this.prisma.team.update({
      where: { id: teamId },
      data: {
        name: payload.name,
        slug: payload.slug,
        description: payload.description,
        isActive: payload.isActive,
        assignmentStrategy: payload.assignmentStrategy,
      },
    });
  }

  async listMembers(teamId: string, user: AuthUser) {
    this.ensureMemberAccess(user, teamId);

    await this.ensureTeam(teamId);

    const data = await this.prisma.teamMember.findMany({
      where: { teamId },
      include: { user: true, team: true },
      orderBy: { createdAt: 'asc' },
    });

    return { data };
  }

  async addMember(teamId: string, payload: AddTeamMemberDto, user: AuthUser) {
    this.ensureTeamAdminOrOwner(user, teamId);

    await this.ensureTeam(teamId);
    const targetUser = await this.ensureUser(payload.userId);
    this.ensureEligibleTeamMemberRole(targetUser.role);
    const teamRole = this.resolveTeamRole(targetUser.role, payload.role);

    return this.prisma.$transaction(async (tx) => {
      const member = await tx.teamMember.upsert({
        where: {
          teamId_userId: {
            teamId,
            userId: payload.userId,
          },
        },
        update: {
          role: teamRole,
        },
        create: {
          teamId,
          userId: payload.userId,
          role: teamRole,
        },
        include: { user: true, team: true },
      });

      await this.syncOperationalUserRole(tx, payload.userId);

      return tx.teamMember.findUniqueOrThrow({
        where: { id: member.id },
        include: { user: true, team: true },
      });
    });
  }

  async updateMember(
    teamId: string,
    memberId: string,
    payload: UpdateTeamMemberDto,
    user: AuthUser,
  ) {
    this.ensureTeamAdminOrOwner(user, teamId);

    const member = await this.prisma.teamMember.findUnique({
      where: { id: memberId },
      include: { user: true },
    });

    if (!member || member.teamId !== teamId) {
      throw new NotFoundException('Team member not found');
    }

    this.ensureEligibleTeamMemberRole(member.user.role);
    const teamRole = this.resolveTeamRole(member.user.role, payload.role);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.teamMember.update({
        where: { id: memberId },
        data: { role: teamRole },
        include: { user: true, team: true },
      });

      await this.syncOperationalUserRole(tx, member.user.id);

      return tx.teamMember.findUniqueOrThrow({
        where: { id: updated.id },
        include: { user: true, team: true },
      });
    });
  }

  async removeMember(teamId: string, memberId: string, user: AuthUser) {
    this.ensureTeamAdminOrOwner(user, teamId);

    const member = await this.prisma.teamMember.findUnique({
      where: { id: memberId },
    });

    if (!member || member.teamId !== teamId) {
      throw new NotFoundException('Team member not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.teamMember.delete({ where: { id: memberId } });
      await this.syncOperationalUserRole(tx, member.userId);
    });

    return { id: memberId };
  }

  private ensureOwner(user: AuthUser) {
    if (user.role !== UserRole.OWNER) {
      throw new ForbiddenException('Owner access required');
    }
  }

  private ensureTeamAdminOrOwner(user: AuthUser, teamId: string) {
    if (user.role === UserRole.OWNER) return;
    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId === teamId)
      return;
    throw new ForbiddenException('Team admin or owner access required');
  }

  private ensureMemberAccess(user: AuthUser, teamId: string) {
    if (user.role === UserRole.OWNER) return;
    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId === teamId)
      return;

    const isTeamMember =
      user.teamId === teamId &&
      (user.role === UserRole.LEAD || user.role === UserRole.AGENT);

    if (!isTeamMember) {
      throw new ForbiddenException('Team access required');
    }
  }

  private async ensureTeam(teamId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
  }

  private async ensureUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private ensureEligibleTeamMemberRole(userRole: UserRole) {
    if (
      userRole === UserRole.EMPLOYEE ||
      userRole === UserRole.AGENT ||
      userRole === UserRole.LEAD ||
      userRole === UserRole.TEAM_ADMIN ||
      userRole === UserRole.ADMIN
    ) {
      return;
    }
    throw new ForbiddenException(
      'Only employee, agent, lead, or team admin users can be added as team members',
    );
  }

  private resolveTeamRole(userRole: UserRole, requestedRole?: TeamRole) {
    const defaultTeamRole =
      userRole === UserRole.TEAM_ADMIN || userRole === UserRole.ADMIN
        ? TeamRole.ADMIN
        : TeamRole.AGENT;
    const teamRole = requestedRole ?? defaultTeamRole;

    if (
      (userRole === UserRole.TEAM_ADMIN || userRole === UserRole.ADMIN) &&
      teamRole !== TeamRole.ADMIN
    ) {
      throw new ForbiddenException('Team admin users must use ADMIN team role');
    }

    if (
      userRole !== UserRole.TEAM_ADMIN &&
      userRole !== UserRole.ADMIN &&
      teamRole === TeamRole.ADMIN
    ) {
      throw new ForbiddenException(
        'ADMIN team role is only allowed for team admin users',
      );
    }

    if (userRole === UserRole.EMPLOYEE && teamRole !== TeamRole.AGENT) {
      throw new ForbiddenException(
        'Employees can only be promoted to AGENT when added to a team',
      );
    }

    return teamRole;
  }

  private async syncOperationalUserRole(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (
      user.role === UserRole.OWNER ||
      user.role === UserRole.TEAM_ADMIN ||
      user.role === UserRole.ADMIN
    ) {
      return;
    }

    const memberships = await tx.teamMember.findMany({
      where: { userId },
      select: { role: true },
    });

    const hasLeadMembership = memberships.some(
      (membership) => membership.role === TeamRole.LEAD,
    );
    const hasOperationalMembership = memberships.some(
      (membership) =>
        membership.role === TeamRole.LEAD ||
        membership.role === TeamRole.AGENT ||
        membership.role === TeamRole.ADMIN,
    );

    const desiredRole = hasLeadMembership
      ? UserRole.LEAD
      : hasOperationalMembership
        ? UserRole.AGENT
        : UserRole.EMPLOYEE;

    if (desiredRole === user.role) {
      return;
    }

    await tx.user.update({
      where: { id: userId },
      data: { role: desiredRole },
    });
  }

  private slugify(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }
}
