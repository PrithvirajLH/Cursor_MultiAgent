import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TeamRole, UserRole } from '@prisma/client';
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
        throw new ForbiddenException('Team administrator must have a primary team set');
      }
      baseWhere.id = user.primaryTeamId;
    }
    if (user?.role === UserRole.LEAD && user.primaryTeamId) {
      baseWhere.id = user.primaryTeamId;
    }
    // OWNER and non-admins: no team filter (full list or caller restricts elsewhere)
    const where = {
      ...baseWhere,
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { description: { contains: query.q, mode: 'insensitive' as const } },
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
    await this.ensureUser(payload.userId);

    return this.prisma.teamMember.upsert({
      where: {
        teamId_userId: {
          teamId,
          userId: payload.userId,
        },
      },
      update: {
        role: payload.role ?? TeamRole.AGENT,
      },
      create: {
        teamId,
        userId: payload.userId,
        role: payload.role ?? TeamRole.AGENT,
      },
      include: { user: true, team: true },
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
    });

    if (!member || member.teamId !== teamId) {
      throw new NotFoundException('Team member not found');
    }

    return this.prisma.teamMember.update({
      where: { id: memberId },
      data: { role: payload.role },
      include: { user: true, team: true },
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

    await this.prisma.teamMember.delete({ where: { id: memberId } });

    return { id: memberId };
  }

  private ensureOwner(user: AuthUser) {
    if (user.role !== UserRole.OWNER) {
      throw new ForbiddenException('Owner access required');
    }
  }

  private ensureTeamAdminOrOwner(user: AuthUser, teamId: string) {
    if (user.role === UserRole.OWNER) return;
    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId === teamId) return;
    throw new ForbiddenException('Team admin or owner access required');
  }

  private ensureMemberAccess(user: AuthUser, teamId: string) {
    if (user.role === UserRole.OWNER) return;
    if (user.role === UserRole.TEAM_ADMIN && user.primaryTeamId === teamId) return;

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
  }

  private slugify(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }
}
